import { Inject, Injectable } from '@nestjs/common';
import { apiValidationError } from '../common/http/api-response.js';
import {
  BlacklistReason,
  EventStatus,
  Prisma,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  eventNotFound,
  SEAT_HOLDING_STATUSES,
  inEventTransaction,
  lockEvent,
  renumberWaitlist,
} from '../registrations/event-seats.js';
import {
  alreadyRegistered,
  confirmationExpired,
  invalidStatusTransition,
  notYourRegistration,
  registrationClosed,
  registrationNotFound,
} from '../registrations/registration-errors.js';
import { RegistrationReviewService } from '../registrations/registration-review.service.js';
import { RegistrationEmailService } from '../registrations/registration-email.service.js';
import { checkAnswers } from './answers.js';
import { AttendanceTokenService } from './attendance-token.service.js';
import type { AnswerDto } from './event-registration.dto.js';

const UNIQUE_VIOLATION = 'P2002';
// Cancelling a confirmed seat within this long of the start is late.
const LATE_CANCELLATION_MS = 2 * 60 * 60 * 1000;

const publicEventSelect = {
  eventId: true,
  name: true,
  description: true,
  startsAt: true,
  endsAt: true,
  location: true,
  imageUrl: true,
  requirements: true,
  eventType: true,
  speakers: true,
  mapsLink: true,
  requiredRegistrantFields: true,
  capacity: true,
  registrationDeadline: true,
  status: true,
} as const;

type PublicEvent = Prisma.EventGetPayload<{ select: typeof publicEventSelect }>;

function isRegistrationOpen(event: PublicEvent, now = new Date()): boolean {
  return (
    event.status === EventStatus.PUBLISHED &&
    now.getTime() <= event.registrationDeadline.getTime()
  );
}

function toPublicEvent(event: PublicEvent) {
  const { status: _status, requiredRegistrantFields, ...fields } = event;
  return {
    ...fields,
    requiredRegistrantFields: requiredRegistrantFields.filter((field) => field !== 'universityId'),
    registrationOpen: isRegistrationOpen(event),
  };
}

@Injectable()
export class EventRegistrationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AttendanceTokenService)
    private readonly tokens: AttendanceTokenService,
    @Inject(RegistrationReviewService)
    private readonly review: RegistrationReviewService,
    @Inject(RegistrationEmailService)
    private readonly emails: RegistrationEmailService,
  ) {}

  async listPublishedEvents() {
    const events = await this.prisma.event.findMany({
      where: { status: EventStatus.PUBLISHED },
      orderBy: [{ startsAt: 'asc' }, { eventId: 'asc' }],
      select: publicEventSelect,
    });
    const taken = await this.seatsTaken(events.map((e) => e.eventId));
    return events.map((event) => ({
      ...toPublicEvent(event),
      seatsTaken: taken.get(event.eventId) ?? 0,
    }));
  }

  // Seats held by accepted people; registrations themselves never fill up.
  private async seatsTaken(eventIds: number[]) {
    const rows = await this.prisma.eventRegistration.groupBy({
      by: ['eventId'],
      where: {
        eventId: { in: eventIds },
        status: { in: SEAT_HOLDING_STATUSES },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.eventId, row._count._all]));
  }

  async getPublishedEvent(eventId: number, personId: number | null) {
    const event = await this.prisma.event.findFirst({
      where: { eventId, status: EventStatus.PUBLISHED },
      select: {
        ...publicEventSelect,
        questions: {
          orderBy: { position: 'asc' },
          select: {
            questionId: true,
            questionText: true,
            questionType: true,
            isRequired: true,
            options: true,
          },
        },
      },
    });
    if (!event) throw eventNotFound();

    const mine = personId
      ? await this.prisma.eventRegistration.findUnique({
          where: { eventId_personId: { eventId, personId } },
          select: {
            registrationId: true,
            status: true,
            waitlistPosition: true,
            confirmationDeadline: true,
          },
        })
      : null;

    const { questions, ...fields } = event;
    const taken = await this.seatsTaken([eventId]);
    return {
      ...toPublicEvent(fields),
      seatsTaken: taken.get(eventId) ?? 0,
      questions,
      myRegistration: mine,
    };
  }

  // Registration is not limited by capacity: everyone enters as PENDING and
  // PR chooses who gets a seat.
  async register(eventId: number, personId: number, answers: AnswerDto[]) {
    const event = await this.prisma.event.findUnique({
      where: { eventId },
      select: {
        ...publicEventSelect,
        questions: {
          select: {
            questionId: true,
            questionType: true,
            isRequired: true,
            options: true,
          },
        },
      },
    });
    if (!event || event.status !== EventStatus.PUBLISHED) throw eventNotFound();
    if (!isRegistrationOpen(event)) throw registrationClosed();

    const existing = await this.prisma.eventRegistration.findUnique({
      where: { eventId_personId: { eventId, personId } },
      select: { registrationId: true },
    });
    if (existing) throw alreadyRegistered();

    const { stored, errors } = checkAnswers(event.questions, answers);
    if (errors.length > 0) throw apiValidationError(errors);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const registration = await tx.eventRegistration.create({
          data: { eventId, personId },
          select: { registrationId: true, status: true, registeredAt: true },
        });
        await tx.registrationAnswer.createMany({
          data: stored.map((row) => ({
            ...row,
            eventId,
            registrationId: registration.registrationId,
          })),
        });
        return { ...registration, eventId };
      });
    } catch (error) {
      // Two submissions at once: the unique (event, person) key keeps one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw alreadyRegistered();
      }
      throw error;
    }
  }

  async myRegistrations(personId: number) {
    const rows = await this.prisma.eventRegistration.findMany({
      where: { personId },
      orderBy: [{ registeredAt: 'desc' }, { registrationId: 'desc' }],
      select: {
        registrationId: true,
        status: true,
        registeredAt: true,
        waitlistPosition: true,
        confirmationDeadline: true,
        confirmedAt: true,
        checkedInAt: true,
        attendanceTokenEncrypted: true,
        event: {
          select: {
            eventId: true,
            name: true,
            startsAt: true,
            endsAt: true,
            location: true,
            imageUrl: true,
          },
        },
      },
    });

    const now = Date.now();
    return Promise.all(
      rows.map(async ({ attendanceTokenEncrypted, ...row }) => {
        const msLeft =
          row.status === RegistrationStatus.AWAITING_CONFIRMATION &&
          row.confirmationDeadline
            ? row.confirmationDeadline.getTime() - now
            : 0;
        const awaiting = msLeft > 0;
        return {
          ...row,
          secondsToConfirm: awaiting ? Math.floor(msLeft / 1000) : null,
          canConfirm: awaiting,
          // Mirrors decline(): an open offer, a waitlist place, or a
          // confirmed seat that is not used yet and whose event has not started.
          canDecline:
            awaiting ||
            row.status === RegistrationStatus.WAITLISTED ||
            (row.status === RegistrationStatus.CONFIRMED &&
              !row.checkedInAt &&
              row.event.startsAt.getTime() > now),
          // The owner's QR, issued only once they confirm.
          attendanceQrCodeDataUrl:
            row.status === RegistrationStatus.CONFIRMED &&
            attendanceTokenEncrypted
              ? await AttendanceTokenService.qrImage(
                  this.tokens.reveal(attendanceTokenEncrypted),
                )
              : null,
        };
      }),
    );
  }

  async confirm(registrationId: number, personId: number) {
    const registration = await this.ownRegistration(registrationId, personId);
    const now = new Date();
    const issued = this.tokens.issue();

    // Conditional update: it cannot race with the expiry job, which only
    // touches rows whose deadline has already passed.
    const { count } = await this.prisma.eventRegistration.updateMany({
      where: {
        registrationId,
        status: RegistrationStatus.AWAITING_CONFIRMATION,
        confirmationDeadline: { gt: now },
      },
      data: {
        status: RegistrationStatus.CONFIRMED,
        confirmedAt: now,
        attendanceTokenHash: issued.hash,
        attendanceTokenEncrypted: issued.encrypted,
      },
    });
    if (count === 0) throw this.cannotRespond(registration.status);

    const attendanceQrCodeDataUrl = await AttendanceTokenService.qrImage(
      issued.token,
    );
    await this.emails.sendSafely({
      kind: 'CONFIRMED',
      registrationId,
      to:
        registration.person.emailPersonal ??
        registration.person.emailUniversity,
      recipientName: registration.person.fullName,
      eventName: registration.event.name,
      eventStartsAt: registration.event.startsAt,
      eventLocation: registration.event.location,
      attendanceQrCodeDataUrl,
    });

    return {
      registrationId,
      status: RegistrationStatus.CONFIRMED,
      confirmedAt: now,
      attendanceToken: issued.token,
      attendanceQrCodeDataUrl,
    };
  }

  // Voluntary withdrawal (approved transition rules):
  // - an offered seat (AWAITING_CONFIRMATION) → DECLINED, the seat is freed;
  // - a waitlist place → DECLINED, the waitlist closes up, no seat is freed;
  // - a confirmed seat before the event → CANCELLED, or LATE_CANCELLATION in
  //   the final two hours (with an attendance notice); the seat is freed.
  async decline(registrationId: number, personId: number) {
    const registration = await this.ownRegistration(registrationId, personId);
    const { eventId } = registration;
    const now = new Date();

    const outcome = await inEventTransaction(this.prisma, async (tx) => {
      const event = await lockEvent(tx, eventId);
      const offered = await tx.eventRegistration.updateMany({
        where: {
          registrationId,
          status: RegistrationStatus.AWAITING_CONFIRMATION,
          confirmationDeadline: { gt: now },
        },
        data: { status: RegistrationStatus.DECLINED },
      });
      if (offered.count === 1) {
        return { status: RegistrationStatus.DECLINED, releasedSeat: true };
      }

      const waitlisted = await tx.eventRegistration.updateMany({
        where: { registrationId, status: RegistrationStatus.WAITLISTED },
        data: { status: RegistrationStatus.DECLINED, waitlistPosition: null },
      });
      if (waitlisted.count === 1) {
        await renumberWaitlist(tx, eventId);
        return { status: RegistrationStatus.DECLINED, releasedSeat: false };
      }

      if (now.getTime() < event.startsAt.getTime()) {
        const late =
          now.getTime() > event.startsAt.getTime() - LATE_CANCELLATION_MS;
        const status = late
          ? RegistrationStatus.LATE_CANCELLATION
          : RegistrationStatus.CANCELLED;
        const cancelled = await tx.eventRegistration.updateMany({
          where: {
            registrationId,
            status: RegistrationStatus.CONFIRMED,
            checkedInAt: null,
          },
          data: { status, cancelledAt: now },
        });
        if (cancelled.count === 1) {
          if (late) {
            await tx.registrationBlacklistEntry.createMany({
              data: {
                registrationId,
                reason: BlacklistReason.LATE_CANCELLATION,
              },
              skipDuplicates: true,
            });
          }
          return { status, releasedSeat: true };
        }
      }
      throw this.cannotRespond(registration.status);
    });

    if (outcome.releasedSeat) {
      await this.review.promoteNextFromWaitlist(eventId);
    }
    return { registrationId, status: outcome.status };
  }

  private async ownRegistration(registrationId: number, personId: number) {
    const registration = await this.prisma.eventRegistration.findUnique({
      where: { registrationId },
      select: {
        personId: true,
        eventId: true,
        status: true,
        person: {
          select: {
            fullName: true,
            emailPersonal: true,
            emailUniversity: true,
          },
        },
        event: { select: { name: true, startsAt: true, location: true } },
      },
    });
    if (!registration) throw registrationNotFound();
    if (registration.personId !== personId) throw notYourRegistration();
    return registration;
  }

  // An offer whose deadline passed reads as expired even before the job runs.
  private cannotRespond(status: RegistrationStatus) {
    return status === RegistrationStatus.AWAITING_CONFIRMATION ||
      status === RegistrationStatus.EXPIRED
      ? confirmationExpired()
      : invalidStatusTransition();
  }
}
