import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import { RegistrationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import { registrationForbidden } from './registration-errors.js';

// Approved window: scanning opens one hour before the event starts and
// closes when it ends.
const OPENS_BEFORE_START_MS = 60 * 60 * 1000;

// Unknown token, wrong event, or a registration that is no longer
// confirmed all get the same answer, so a scan reveals nothing else.
function invalidQrCode(): BadRequestException {
  return new BadRequestException('Invalid QR Code.', {
    errorCode: 'INVALID_QR_CODE',
  });
}

function alreadyCheckedIn(): ConflictException {
  return new ConflictException('Already Checked In.', {
    errorCode: 'ALREADY_CHECKED_IN',
  });
}

function checkInClosed(): ConflictException {
  return new ConflictException(
    'Check-in opens one hour before the event and closes when it ends.',
    { errorCode: 'CHECK_IN_CLOSED' },
  );
}

@Injectable()
export class CheckInService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async checkIn(eventId: number, token: string, staffMemberId: number) {
    if (
      !(await this.access.hasCommitteePermission(
        staffMemberId,
        REGISTRATIONS_REVIEW,
      ))
    ) {
      throw registrationForbidden();
    }

    const registration = await this.prisma.eventRegistration.findUnique({
      where: { attendanceTokenHash: AttendanceTokenService.hash(token) },
      select: {
        registrationId: true,
        eventId: true,
        status: true,
        checkedInAt: true,
        person: { select: { fullName: true } },
        event: { select: { startsAt: true, endsAt: true } },
      },
    });
    if (
      !registration ||
      registration.eventId !== eventId ||
      registration.status !== RegistrationStatus.CONFIRMED
    ) {
      throw invalidQrCode();
    }
    if (registration.checkedInAt) throw alreadyCheckedIn();

    const now = new Date();
    const { startsAt, endsAt } = registration.event;
    if (
      now.getTime() < startsAt.getTime() - OPENS_BEFORE_START_MS ||
      now.getTime() > endsAt.getTime()
    ) {
      throw checkInClosed();
    }

    // Conditional update: of two simultaneous scans, only one records.
    const { count } = await this.prisma.eventRegistration.updateMany({
      where: {
        registrationId: registration.registrationId,
        status: RegistrationStatus.CONFIRMED,
        checkedInAt: null,
      },
      data: { checkedInAt: now, checkedInByMemberId: staffMemberId },
    });
    if (count === 0) throw alreadyCheckedIn();

    return {
      registrationId: registration.registrationId,
      name: registration.person.fullName,
      checkedInAt: now,
    };
  }
}
