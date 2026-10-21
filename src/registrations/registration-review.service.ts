import { Inject, Injectable } from '@nestjs/common';
import {
  BlacklistReason,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import {
  countHeldSeats,
  eventStarted,
  inEventTransaction,
  type LockedEvent,
  lockEvent,
  parkWaitlist,
  renumberWaitlist,
  seatOffer,
  type Tx,
} from './event-seats.js';
import {
  capacityReached,
  invalidStatusTransition,
  registrationForbidden,
  registrationNotFound,
} from './registration-errors.js';
import {
  type RegistrationEmail,
  RegistrationEmailService,
} from './registration-email.service.js';

export type ReviewDecision = 'ACCEPT' | 'REJECT';

const REVIEWABLE_STATUSES: RegistrationStatus[] = [
  RegistrationStatus.PENDING,
  RegistrationStatus.WAITLISTED,
];
const recipientSelect = {
  person: {
    select: { fullName: true, emailPersonal: true, emailUniversity: true },
  },
} as const;

@Injectable()
export class RegistrationReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
    @Inject(RegistrationEmailService)
    private readonly emails: RegistrationEmailService,
  ) {}

  async review(
    registrationId: number,
    decision: ReviewDecision,
    actorMemberId: number,
  ) {
    await this.assertCanReview(actorMemberId);

    const { result, email } = await inEventTransaction(
      this.prisma,
      async (tx) => {
        const found = await tx.eventRegistration.findUnique({
          where: { registrationId },
          select: { eventId: true },
        });
        if (!found) throw registrationNotFound();

        // Every change that affects seats or the waitlist locks the event row
        // first, so concurrent reviewers of one event run one after another.
        const event = await lockEvent(tx, found.eventId);
        const current = await tx.eventRegistration.findUniqueOrThrow({
          where: { registrationId },
          select: { status: true },
        });
        if (!REVIEWABLE_STATUSES.includes(current.status)) {
          throw invalidStatusTransition();
        }

        let updated;
        if (decision === 'ACCEPT') {
          const offer = seatOffer(event);
          if (!offer) throw eventStarted();
          if ((await countHeldSeats(tx, event.eventId)) >= event.capacity) {
            throw capacityReached();
          }
          updated = await tx.eventRegistration.update({
            where: { registrationId },
            data: { ...offer, reviewedByMemberId: actorMemberId },
            include: recipientSelect,
          });
        } else {
          updated = await tx.eventRegistration.update({
            where: { registrationId },
            data: {
              status: RegistrationStatus.REJECTED,
              waitlistPosition: null,
              reviewedByMemberId: actorMemberId,
            },
            include: recipientSelect,
          });
        }

        if (current.status === RegistrationStatus.WAITLISTED) {
          await renumberWaitlist(tx, event.eventId);
        }

        return {
          result: {
            registrationId: updated.registrationId,
            eventId: updated.eventId,
            status: updated.status,
            approvedAt: updated.approvedAt,
            confirmationDeadline: updated.confirmationDeadline,
          },
          email: this.emailFor(
            decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
            updated,
            event,
          ),
        };
      },
    );

    await this.emails.sendSafely(email);
    return result;
  }

  // Replaces the event's waitlist with registrationIds in the given order.
  // Waitlisted people left out of the list return to PENDING.
  async setWaitlist(
    eventId: number,
    registrationIds: number[],
    actorMemberId: number,
  ) {
    await this.assertCanReview(actorMemberId);

    return inEventTransaction(this.prisma, async (tx) => {
      await lockEvent(tx, eventId);

      const listed = await tx.eventRegistration.findMany({
        where: { registrationId: { in: registrationIds }, eventId },
        select: { registrationId: true, status: true },
      });
      if (listed.length !== registrationIds.length) {
        throw registrationNotFound();
      }
      if (listed.some((row) => !REVIEWABLE_STATUSES.includes(row.status))) {
        throw invalidStatusTransition();
      }

      await tx.eventRegistration.updateMany({
        where: {
          eventId,
          status: RegistrationStatus.WAITLISTED,
          registrationId: { notIn: registrationIds },
        },
        data: { status: RegistrationStatus.PENDING, waitlistPosition: null },
      });
      await parkWaitlist(tx, eventId);

      for (const [index, registrationId] of registrationIds.entries()) {
        const wasPending =
          listed.find((row) => row.registrationId === registrationId)
            ?.status === RegistrationStatus.PENDING;
        await tx.eventRegistration.update({
          where: { registrationId },
          data: {
            status: RegistrationStatus.WAITLISTED,
            waitlistPosition: index + 1,
            ...(wasPending ? { reviewedByMemberId: actorMemberId } : {}),
          },
        });
      }

      return registrationIds.map((registrationId, index) => ({
        registrationId,
        waitlistPosition: index + 1,
      }));
    });
  }

  // Gives the first waitlisted person a free seat, if there is one.
  // Returns the promoted registration id, or null when nothing changed.
  async promoteNextFromWaitlist(eventId: number): Promise<number | null> {
    const email = await inEventTransaction(this.prisma, async (tx) => {
      const event = await lockEvent(tx, eventId);
      return this.promoteWithin(tx, event);
    });
    if (!email) return null;
    await this.emails.sendSafely(email);
    return email.registrationId;
  }

  // Scheduled-job entry point: expires overdue confirmations and refills
  // each freed seat from the waitlist. Safe to run concurrently: a row only
  // expires if it is still awaiting confirmation once the event is locked.
  async expireOverdueConfirmations(now = new Date()) {
    const overdue = await this.prisma.eventRegistration.findMany({
      where: {
        status: RegistrationStatus.AWAITING_CONFIRMATION,
        confirmationDeadline: { lt: now },
      },
      select: { registrationId: true, eventId: true },
      orderBy: { confirmationDeadline: 'asc' },
    });

    let expired = 0;
    const promoted: number[] = [];
    for (const { registrationId, eventId } of overdue) {
      const outcome = await inEventTransaction(this.prisma, async (tx) => {
        const event = await lockEvent(tx, eventId);
        const { count } = await tx.eventRegistration.updateMany({
          where: {
            registrationId,
            status: RegistrationStatus.AWAITING_CONFIRMATION,
            confirmationDeadline: { lt: now },
          },
          data: { status: RegistrationStatus.EXPIRED },
        });
        if (count === 0) return null;
        // Approved rule: a missed confirmation leaves an attendance notice.
        await tx.registrationBlacklistEntry.createMany({
          data: {
            registrationId,
            reason: BlacklistReason.CONFIRMATION_EXPIRED,
          },
          skipDuplicates: true,
        });
        return { email: await this.promoteWithin(tx, event) };
      });
      if (!outcome) continue;
      expired += 1;
      if (outcome.email) {
        promoted.push(outcome.email.registrationId);
        await this.emails.sendSafely(outcome.email);
      }
    }
    return { expired, promoted };
  }

  private async promoteWithin(
    tx: Tx,
    event: LockedEvent,
  ): Promise<RegistrationEmail | null> {
    const offer = seatOffer(event);
    if (!offer) return null;
    if ((await countHeldSeats(tx, event.eventId)) >= event.capacity) {
      return null;
    }
    const next = await tx.eventRegistration.findFirst({
      where: { eventId: event.eventId, status: RegistrationStatus.WAITLISTED },
      orderBy: { waitlistPosition: 'asc' },
      select: { registrationId: true },
    });
    if (!next) return null;

    const promoted = await tx.eventRegistration.update({
      where: { registrationId: next.registrationId },
      data: offer,
      include: recipientSelect,
    });
    await renumberWaitlist(tx, event.eventId);
    return this.emailFor('PROMOTED', promoted, event);
  }

  private async assertCanReview(memberId: number) {
    if (
      !(await this.access.hasCommitteePermission(
        memberId,
        REGISTRATIONS_REVIEW,
      ))
    ) {
      throw registrationForbidden();
    }
  }

  private emailFor(
    kind: RegistrationEmail['kind'],
    registration: {
      registrationId: number;
      confirmationDeadline: Date | null;
      person: {
        fullName: string;
        emailPersonal: string | null;
        emailUniversity: string | null;
      };
    },
    event: LockedEvent,
  ): RegistrationEmail {
    return {
      kind,
      registrationId: registration.registrationId,
      to:
        registration.person.emailPersonal ??
        registration.person.emailUniversity,
      recipientName: registration.person.fullName,
      eventName: event.name,
      confirmationDeadline: registration.confirmationDeadline ?? undefined,
    };
  }
}
