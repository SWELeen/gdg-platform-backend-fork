import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRANTS_VIEW,
} from './committee-access.service.js';
import { registrationForbidden } from './registration-errors.js';

export interface RegistrationListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: RegistrationStatus;
}

@Injectable()
export class RegistrationListService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async list(
    eventId: number,
    query: RegistrationListQuery,
    actorMemberId: number,
  ) {
    if (
      !(await this.access.hasCommitteePermission(
        actorMemberId,
        REGISTRANTS_VIEW,
      ))
    ) {
      throw registrationForbidden();
    }

    const event = await this.prisma.event.findUnique({
      where: { eventId },
      select: { eventId: true, name: true, capacity: true },
    });
    if (!event) {
      throw new NotFoundException('The event was not found.', {
        errorCode: 'EVENT_NOT_FOUND',
      });
    }

    const search = query.search?.trim();
    const where: Prisma.EventRegistrationWhereInput = {
      eventId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            person: {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { emailPersonal: { contains: search, mode: 'insensitive' } },
                { emailUniversity: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [total, rows, counts, checkedIn] = await this.prisma.$transaction([
      this.prisma.eventRegistration.count({ where }),
      this.prisma.eventRegistration.findMany({
        where,
        orderBy: [{ registeredAt: 'asc' }, { registrationId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          registrationId: true,
          status: true,
          registeredAt: true,
          waitlistPosition: true,
          confirmationDeadline: true,
          checkedInAt: true,
          person: {
            select: {
              fullName: true,
              emailPersonal: true,
              emailUniversity: true,
            },
          },
          answers: {
            orderBy: { question: { position: 'asc' } },
            select: {
              questionId: true,
              answerText: true,
              question: { select: { questionText: true } },
            },
          },
        },
      }),
      this.prisma.eventRegistration.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.eventRegistration.count({
        where: { eventId, checkedInAt: { not: null } },
      }),
    ]);

    const countOf = (status: RegistrationStatus) =>
      counts.find((row) => row.status === status)?._count._all ?? 0;
    const confirmed = countOf(RegistrationStatus.CONFIRMED);

    return {
      event: {
        eventId: event.eventId,
        name: event.name,
        capacity: event.capacity,
      },
      summary: {
        accepted: countOf(RegistrationStatus.AWAITING_CONFIRMATION) + confirmed,
        capacity: event.capacity,
        confirmed,
        awaitingConfirmation: countOf(RegistrationStatus.AWAITING_CONFIRMATION),
        waitlisted: countOf(RegistrationStatus.WAITLISTED),
        pending: countOf(RegistrationStatus.PENDING),
        // Attendance: confirmed people who scanned in, and those who have
        // not (still CONFIRMED without a scan, or marked NO_CHECK_IN).
        checkedIn,
        notCheckedIn:
          confirmed - checkedIn + countOf(RegistrationStatus.NO_CHECK_IN),
      },
      items: rows.map((row) => ({
        registrationId: row.registrationId,
        name: row.person.fullName,
        email: row.person.emailPersonal ?? row.person.emailUniversity,
        status: row.status,
        registeredAt: row.registeredAt,
        waitlistPosition: row.waitlistPosition,
        confirmationDeadline: row.confirmationDeadline,
        checkedInAt: row.checkedInAt,
        answers: row.answers.map((answer) => ({
          questionId: answer.questionId,
          question: answer.question.questionText,
          answer: answer.answerText,
        })),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
}
