import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import { RegistrationEmailService } from './registration-email.service.js';
import {
  registrationForbidden,
  registrationNotFound,
} from './registration-errors.js';

@Injectable()
export class RegistrationEmailDeliveryService {
  private readonly logger = new Logger(RegistrationEmailDeliveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RegistrationEmailService)
    private readonly email: RegistrationEmailService,
    @Inject(AttendanceTokenService)
    private readonly tokens: AttendanceTokenService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async retry(registrationId: number, actorMemberId: number) {
    if (
      !(await this.access.hasCommitteePermission(
        actorMemberId,
        REGISTRATIONS_REVIEW,
      ))
    )
      throw registrationForbidden();
    const delivery = await this.prisma.registrationEmailDelivery.findFirst({
      where: { registrationId },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        kind: true,
      },
    });
    if (!delivery) throw registrationNotFound();
    const { count } = await this.prisma.registrationEmailDelivery.updateMany({
      where: { id: delivery.id, state: 'FAILED' },
      data: { state: 'PENDING' },
    });
    if (!count)
      throw new ConflictException(
        'Only a failed registration email can be retried.',
      );
    return { emailState: 'PENDING' as const };
  }

  @Cron('*/15 * * * * *', { waitForCompletion: true })
  async runScheduled() {
    if (process.env.NODE_ENV !== 'test') await this.processPending();
  }

  async processPending() {
    // An interrupted send has an uncertain SMTP outcome. Require an explicit retry.
    await this.prisma.registrationEmailDelivery.updateMany({
      where: { state: 'SENDING', leaseExpiresAt: { lt: new Date() } },
      data: { state: 'FAILED', leaseExpiresAt: null },
    });
    const jobs = await this.prisma.registrationEmailDelivery.findMany({
      where: { state: 'PENDING' },
      orderBy: { id: 'asc' },
      take: 10,
      select: { id: true },
    });

    for (const { id } of jobs) await this.deliver(id);
  }

  async deliver(id: number) {
    const leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
    const { count } = await this.prisma.registrationEmailDelivery.updateMany({
      where: { id, state: 'PENDING' },
      data: { state: 'SENDING', leaseExpiresAt },
    });
    if (!count) return;
    let state: 'SENT' | 'FAILED' | 'SKIPPED';
    try {
      state = (await this.sendCurrent(id)) ? 'SENT' : 'SKIPPED';
    } catch {
      this.logger.warn({
        event: 'registration_email_failed',
        deliveryId: id,
      });
      state = 'FAILED';
    }
    await this.prisma.registrationEmailDelivery.updateMany({
      where: { id, state: 'SENDING', leaseExpiresAt },
      data: { state, leaseExpiresAt: null },
    });
  }

  private async sendCurrent(id: number) {
    const { kind, registration } =
      await this.prisma.registrationEmailDelivery.findUniqueOrThrow({
        where: { id },
        select: {
          kind: true,
          registration: {
            select: {
              registrationId: true,
              status: true,
              confirmationDeadline: true,
              attendanceMethod: true,
              attendanceTokenEncrypted: true,
              event: {
                select: {
                  name: true,
                  eventType: true,
                  startsAt: true,
                  endsAt: true,
                  location: true,
                  mapsLink: true,
                  whatsappGroupLink: true,
                  status: true,
                },
              },
              person: {
                select: {
                  fullName: true,
                  emailPersonal: true,
                  emailUniversity: true,
                  isActive: true,
                },
              },
            },
          },
        },
      });
    const { status, attendanceMethod, event, person } = registration;
    const offered =
      status === 'AWAITING_CONFIRMATION' &&
      !!registration.confirmationDeadline &&
      registration.confirmationDeadline > new Date();
    const confirmedMember =
      status === 'CONFIRMED' && attendanceMethod === 'MEMBER_CARD';
    if (!person.isActive || event.status === 'CANCELLED') return false;
    if (kind === 'REJECTED') {
      if (status !== 'REJECTED') return false;
    } else if (kind === 'WAITLISTED') {
      if (status !== 'WAITLISTED' || event.startsAt <= new Date()) return false;
    } else {
      if (event.endsAt <= new Date()) return false;
      if (
        kind === 'CONFIRMED'
          ? status !== 'CONFIRMED'
          : !offered && !confirmedMember
      )
        return false;
    }
    const to = person.emailPersonal ?? person.emailUniversity;
    if (!to) throw new Error('Missing recipient');
    const attendanceQrCodeDataUrl =
      kind === 'CONFIRMED' && registration.attendanceTokenEncrypted
        ? await AttendanceTokenService.qrImage(
            this.tokens.reveal(registration.attendanceTokenEncrypted),
          )
        : undefined;
    await this.email.send({
      kind,
      registrationId: registration.registrationId,
      to,
      recipientName: person.fullName,
      eventName: event.name,
      eventType: event.eventType,
      eventStartsAt: event.startsAt,
      eventLocation: event.location,
      eventMapsLink: event.mapsLink,
      confirmationDeadline: offered
        ? (registration.confirmationDeadline ?? undefined)
        : undefined,
      attendanceQrCodeDataUrl,
      ...(kind === 'CONFIRMED'
        ? { whatsappGroupLink: event.whatsappGroupLink }
        : {}),
    });
    return true;
  }
}
