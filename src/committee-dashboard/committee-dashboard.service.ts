import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, QuestionType } from '../generated/prisma/client.js';
import { apiValidationError, type ApiErrorDetail } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEVELOPER_COMMITTEES_CODE } from '../committees/committee-catalog.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import {
  AddMemberToCommitteeDto,
  CreateCommitteeEventDto,
  CreateCommitteeMemberDto,
  CommitteeTaskStatus,
  MEMBER_TASK_STATUSES,
  CreateCommitteeTaskDto,
  UpdateCommitteePointsDto,
  UpdateCommitteeTaskDto,
} from './committee-dashboard.dto.js';

const VIEW_PERMISSION = 'dashboard.view';
const TASK_PERMISSION = 'tasks.manage';
const POINTS_PERMISSION = 'points.manage';
const MEMBERS_PERMISSION = 'members.manage';
const EVENTS_PERMISSION = 'events.create';
// Tasks still being worked on, including those waiting for a leader to confirm.
const ACTIVE_TASK_STATUSES = [CommitteeTaskStatus.TODO, CommitteeTaskStatus.IN_PROGRESS, CommitteeTaskStatus.PENDING_REVIEW];

@Injectable()
export class CommitteeDashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async getDeveloperOverview(user: RequestUser | undefined) {
    if (!user?.memberId) throw new ForbiddenException();
    if (!(await this.access.hasGlobalPermission(user.memberId, 'developer_committees.dashboard.view'))) throw new ForbiddenException();
    const committees = await this.prisma.committee.findMany({
      where: { parent: { committeeCode: DEVELOPER_COMMITTEES_CODE } },
      select: { committeeId: true, committeeCode: true, committeeName: true, _count: { select: { members: true } } },
      orderBy: { committeeName: 'asc' },
    });
    const leaders = await this.prisma.memberCommittee.groupBy({
      by: ['committeeId'],
      where: { committeeId: { in: committees.map(({ committeeId }) => committeeId) }, role: { in: ['Leader', 'Co-Leader'] }, member: { isActive: true } },
      _count: { _all: true },
    });
    const activeTasks = await Promise.all(committees.map((committee) => this.prisma.committeeTask.count({
      where: { committeeId: committee.committeeId, status: { in: ACTIVE_TASK_STATUSES } },
    })));
    return committees.map((committee, index) => ({
      code: committee.committeeCode,
      name: committee.committeeName,
      memberCount: committee._count.members,
      leaderCount: leaders.find((row) => row.committeeId === committee.committeeId)?._count._all ?? 0,
      activeTaskCount: activeTasks[index],
    }));
  }

  async getClubLeadershipOverview(user: RequestUser | undefined) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, 'club.dashboard.view'))) throw new ForbiddenException();
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }));
    const [person, members, tasks, points, pointTotals, monthPoints, completedTasks, activeTasks, tasksDueThisWeek, events, registrationGroups, committees, committeePointTotals, canAddMembers] = await Promise.all([
      this.prisma.person.findUnique({ where: { personId: user.personId }, select: { fullName: true } }),
      this.prisma.member.findMany({
        where: { isActive: true, person: { isActive: true } },
        include: {
          person: true,
          committees: { select: { role: true, committeeId: true, committee: { select: { committeeCode: true, committeeName: true } } } },
          roleAssignments: {
            where: { AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: today } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }] },
            select: { roleCode: true },
          },
        },
        orderBy: { person: { fullName: 'asc' } },
      }),
      this.prisma.committeeTask.findMany({
        include: {
          assignee: { include: { member: { include: { person: true } } } },
          committee: { select: { committeeCode: true, committeeName: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }], take: 200,
      }),
      this.prisma.committeePointEntry.findMany({
        include: {
          recipient: { include: { member: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { pointEntryId: 'desc' }], take: 200,
      }),
      this.prisma.committeePointEntry.groupBy({ by: ['memberId'], _sum: { pointsDelta: true } }),
      this.prisma.committeePointEntry.aggregate({ where: { createdAt: { gte: riyadhPeriodStart(new Date(), 'month') } }, _sum: { pointsDelta: true } }),
      this.prisma.committeeTask.groupBy({ by: ['assignedMemberId'], where: { status: CommitteeTaskStatus.COMPLETED }, _count: { _all: true } }),
      this.prisma.committeeTask.count({ where: { status: { in: ACTIVE_TASK_STATUSES } } }),
      this.prisma.committeeTask.count({ where: { status: { in: ACTIVE_TASK_STATUSES }, dueAt: { gte: riyadhPeriodStart(new Date(), 'week'), lt: new Date(riyadhPeriodStart(new Date(), 'week').getTime() + 7 * 86400000) } } }),
      this.prisma.event.findMany({
        include: { _count: { select: { registrations: true } } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.eventRegistration.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.committee.findMany({ select: { committeeCode: true, committeeName: true }, orderBy: { committeeName: 'asc' } }),
      this.prisma.committeePointEntry.groupBy({ by: ['memberId', 'committeeId'], _sum: { pointsDelta: true } }),
      this.access.hasGlobalPermission(user.memberId, MEMBERS_PERMISSION),
    ]);
    const memberPoints = new Map(pointTotals.map((row) => [row.memberId, row._sum.pointsDelta ?? 0]));
    const memberCommitteePoints = new Map(committeePointTotals.map((row) => [`${row.memberId}:${row.committeeId}`, row._sum.pointsDelta ?? 0]));
    const memberCompletedTasks = new Map(completedTasks.map((row) => [row.assignedMemberId, row._count._all]));
    const mappedMembers = members.map((member) => ({
      id: String(member.memberId), name: member.person.fullName,
      email: member.person.emailUniversity ?? member.person.emailPersonal ?? '',
      role: [...new Set([...member.committees.map(({ role }) => role), ...member.roleAssignments.map(({ roleCode }) => roleCode)])].join(' / ') || 'Member',
      status: 'Active' as const, points: memberPoints.get(member.memberId) ?? 0,
      tasksCompleted: memberCompletedTasks.get(member.memberId) ?? 0, lastActivity: null,
      committees: member.committees.map(({ role, committeeId, committee }) => ({
        code: committee.committeeCode, name: committee.committeeName, role,
        points: memberCommitteePoints.get(`${member.memberId}:${committeeId}`) ?? 0,
      })),
      globalRoles: member.roleAssignments.map(({ roleCode }) => roleCode),
    }));
    const now = new Date();
    return {
      committee: { id: null, code: 'CLUB', name: 'GDG on Campus UJ' },
      currentMember: user.memberId ? { id: String(user.memberId), name: person?.fullName ?? '', role: 'Club Leadership' } : null,
      stats: {
        committeeMembers: mappedMembers.length, activeMembers: mappedMembers.length, awayMembers: 0,
        upcomingEvents: events.filter((event) => event.status === 'PUBLISHED' && event.startsAt >= now).length,
        upcomingEventsInNext30Days: events.filter((event) => event.status === 'PUBLISHED' && event.startsAt >= now && event.startsAt < new Date(now.getTime() + 30 * 86400000)).length,
        totalPoints: [...memberPoints.values()].reduce((sum, value) => sum + value, 0), pointsThisMonth: monthPoints._sum.pointsDelta ?? 0,
        activeTasks, tasksDueThisWeek, eventsCreated: events.length,
        eventsPublishedThisYear: events.filter((event) => event.status === 'PUBLISHED' && event.createdAt.getUTCFullYear() === now.getUTCFullYear()).length,
        pendingRegistrations: registrationGroups.find(({ status }) => status === 'PENDING')?._count._all ?? 0,
        acceptedRegistrations: registrationGroups.filter(({ status }) => ['CONFIRMED', 'AWAITING_CONFIRMATION'].includes(status)).reduce((sum, row) => sum + row._count._all, 0),
        rejectedRegistrations: registrationGroups.filter(({ status }) => ['REJECTED', 'NOT_SELECTED'].includes(status)).reduce((sum, row) => sum + row._count._all, 0),
      },
      permissions: { canManageTasks: false, canManagePoints: false, canManageRegistrations: false, canAddMembers },
      committees: committees.map(({ committeeCode, committeeName }) => ({ code: committeeCode, name: committeeName })),
      members: mappedMembers,
      events: events.map((event) => ({
        id: String(event.eventId), title: event.name, date: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
        location: event.location, status: event.status, registered: event._count.registrations,
        confirmed: 0, checkedIn: 0, capacity: event.capacity, createdAt: event.createdAt.toISOString(),
      })),
      tasks: tasks.map((task) => ({
        id: String(task.taskId), title: task.title, description: task.description,
        assignedMemberId: String(task.assignedMemberId), assignedMemberName: task.assignee.member.person.fullName,
        createdByMemberId: String(task.createdByMemberId), dueAt: task.dueAt.toISOString(), priority: task.priority,
        status: task.status, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
        committeeCode: task.committee.committeeCode, committeeName: task.committee.committeeName,
      })),
      pointHistory: points.map((entry) => ({
        id: String(entry.pointEntryId), memberId: String(entry.memberId), memberName: entry.recipient.member.person.fullName,
        pointsDelta: entry.pointsDelta, reason: entry.reason, createdAt: entry.createdAt.toISOString(),
        committeeCode: entry.recipient.committee.committeeCode, committeeName: entry.recipient.committee.committeeName,
      })),
      recentActivities: [],
    };
  }

  async getDashboard(user: RequestUser | undefined, committeeCode: string) {
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode } });
    if (!committee) throw new NotFoundException();

    let membership = user?.memberId
      ? await this.prisma.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: user.memberId, committeeId: committee.committeeId } },
          include: { member: { include: { person: true } } },
        })
      : null;
    if (membership && (!membership.member.isActive || !membership.member.person.isActive)) {
      membership = null;
    }

    if (!membership) throw new ForbiddenException('An active member of this committee is required for dashboard access.');

    const memberId = membership?.memberId ?? null;
    const [canViewDashboard, canManageTasks, canManagePoints, canManageRegistrations, canAddMembers, canCreateEvents] = memberId
      ? await Promise.all([
          this.access.hasCommitteePermission(memberId, VIEW_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, TASK_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, POINTS_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, 'registrations.review', undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, MEMBERS_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, EVENTS_PERMISSION, undefined, committee.committeeId),
        ])
      : [true, false, false, false, false, false];
    if (!canViewDashboard) throw new ForbiddenException();
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const monthStart = riyadhPeriodStart(now, 'month');
    const weekStart = riyadhPeriodStart(now, 'week');

    const [memberships, events, tasks, pointEntries, pointTotals, registrationGroups, checkInGroups, totalPoints, pointsThisMonth, tasksDueThisWeek] =
      await Promise.all([
        this.prisma.memberCommittee.findMany({
          where: { committeeId: committee.committeeId },
          include: { member: { include: { person: true } } },
          orderBy: [{ role: 'asc' }, { member: { person: { fullName: 'asc' } } }],
        }),
        this.prisma.event.findMany({
          where: { committeeId: committee.committeeId },
          include: {
            _count: {
              select: {
                registrations: true,
              },
            },
          },
          orderBy: { startsAt: 'asc' },
        }),
        this.prisma.committeeTask.findMany({
          where: { committeeId: committee.committeeId },
          include: { assignee: { include: { member: { include: { person: true } } } } },
          orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }],
        }),
        this.prisma.committeePointEntry.findMany({
          where: { committeeId: committee.committeeId },
          include: { recipient: { include: { member: { include: { person: true } } } } },
          orderBy: [{ createdAt: 'desc' }, { pointEntryId: 'desc' }],
          take: 50,
        }),
        this.prisma.committeePointEntry.groupBy({
          by: ['memberId'],
          where: { committeeId: committee.committeeId },
          _sum: { pointsDelta: true },
        }),
        this.prisma.eventRegistration.groupBy({
          by: ['eventId', 'status'],
          where: { event: { committeeId: committee.committeeId } },
          _count: { _all: true },
        }),
        this.prisma.eventRegistration.groupBy({
          by: ['eventId'],
          where: { event: { committeeId: committee.committeeId }, checkedInAt: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.committeePointEntry.aggregate({
          where: { committeeId: committee.committeeId },
          _sum: { pointsDelta: true },
        }),
        this.prisma.committeePointEntry.aggregate({
          where: { committeeId: committee.committeeId, createdAt: { gte: monthStart } },
          _sum: { pointsDelta: true },
        }),
        this.prisma.committeeTask.count({
          where: { committeeId: committee.committeeId, status: { not: CommitteeTaskStatus.COMPLETED }, dueAt: { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * 86400000) } },
        }),
      ]);

    const memberPoints = new Map(pointTotals.map((item) => [item.memberId, item._sum.pointsDelta ?? 0]));
    const memberCompletedTasks = new Map<number, number>();
    for (const task of tasks) {
      if (task.status === CommitteeTaskStatus.COMPLETED) {
        memberCompletedTasks.set(task.assignedMemberId, (memberCompletedTasks.get(task.assignedMemberId) ?? 0) + 1);
      }
    }
    const activeMemberships = memberships.filter(({ member }) => member.isActive);
    const members = activeMemberships.map(({ member, role }) => ({
      id: String(member.memberId),
      name: member.person.fullName,
      email: member.person.emailUniversity ?? member.person.emailPersonal ?? '',
      role,
      status: 'Active' as const,
      points: memberPoints.get(member.memberId) ?? 0,
      tasksCompleted: memberCompletedTasks.get(member.memberId) ?? 0,
      lastActivity: null,
    }));
    const mappedTasks = tasks.map((task) => ({
      id: String(task.taskId),
      title: task.title,
      description: task.description,
      assignedMemberId: String(task.assignedMemberId),
      assignedMemberName: task.assignee.member.person.fullName,
      createdByMemberId: String(task.createdByMemberId),
      dueAt: task.dueAt.toISOString(),
      priority: task.priority,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));
    const mappedPointHistory = pointEntries.map((entry) => ({
      id: String(entry.pointEntryId),
      memberId: String(entry.memberId),
      memberName: entry.recipient.member.person.fullName,
      pointsDelta: entry.pointsDelta,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    }));
    const registrationCount = (status: string) => registrationGroups.filter((group) => group.status === status).reduce((sum, group) => sum + group._count._all, 0);
    const publishedEvents = events.filter((event) => event.status === 'PUBLISHED');

    return {
      committee: { id: committee.committeeId, code: committee.committeeCode, name: committee.committeeName },
      currentMember: membership
        ? { id: String(memberId), name: membership.member.person.fullName, role: membership.role }
        : null,
      stats: {
        committeeMembers: memberships.length,
        activeMembers: members.length,
        awayMembers: memberships.length - members.length,
        upcomingEvents: publishedEvents.filter((event) => event.startsAt >= now).length,
        upcomingEventsInNext30Days: publishedEvents.filter((event) => event.startsAt >= now && event.startsAt < in30Days).length,
        totalPoints: totalPoints._sum.pointsDelta ?? 0,
        pointsThisMonth: pointsThisMonth._sum.pointsDelta ?? 0,
        activeTasks: tasks.filter((task) => task.status !== CommitteeTaskStatus.COMPLETED).length,
        tasksDueThisWeek,
        eventsCreated: events.length,
        eventsPublishedThisYear: publishedEvents.filter((event) => event.createdAt >= new Date(Date.UTC(now.getUTCFullYear(), 0, 1))).length,
        pendingRegistrations: registrationCount('PENDING'),
        acceptedRegistrations: registrationCount('CONFIRMED') + registrationCount('AWAITING_CONFIRMATION'),
        rejectedRegistrations: registrationCount('REJECTED') + registrationCount('NOT_SELECTED'),
      },
      permissions: { canManageTasks, canManagePoints, canManageRegistrations, canAddMembers, canCreateEvents },
      members,
      events: events.map((event) => ({
        id: String(event.eventId),
        title: event.name,
        date: event.startsAt.toISOString(),
        eventType: event.eventType,
        endsAt: event.endsAt.toISOString(),
        location: event.location,
        status: event.status,
        registered: event._count.registrations,
        confirmed: registrationGroups.filter((group) => group.eventId === event.eventId && ['CONFIRMED', 'AWAITING_CONFIRMATION'].includes(group.status)).reduce((sum, group) => sum + group._count._all, 0),
        checkedIn: checkInGroups.find((group) => group.eventId === event.eventId)?._count._all ?? 0,
        capacity: event.capacity,
        createdAt: event.createdAt.toISOString(),
      })),
      tasks: mappedTasks,
      pointHistory: mappedPointHistory,
      recentActivities: [
        ...mappedPointHistory.slice(0, 10).map((entry) => ({
          id: `point-${entry.id}`, type: 'points_awarded', title: entry.pointsDelta >= 0 ? 'Points awarded' : 'Points deducted',
          description: `${entry.pointsDelta >= 0 ? '+' : ''}${entry.pointsDelta} points to ${entry.memberName} for ${entry.reason}.`, createdAt: entry.createdAt,
        })),
        ...mappedTasks.slice(0, 10).map((task) => ({
          id: `task-${task.id}`, type: 'details_updated', title: 'Task updated', description: task.title, createdAt: task.updatedAt,
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
    };
  }

  async addMember(user: RequestUser | undefined, committeeCode: string, dto: CreateCommitteeMemberDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, MEMBERS_PERMISSION, committee.committeeId);

    const email = dto.email.trim().toLowerCase();
    const fullName = dto.fullName.trim();
    if (!fullName || fullName.length < 3) throw new BadRequestException('A valid member name is required.');

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const person = await transaction.person.findFirst({
          where: {
            OR: [
              { emailUniversity: { equals: email, mode: 'insensitive' } },
              { emailPersonal: { equals: email, mode: 'insensitive' } },
            ],
          },
        });

        if (person && !person.isActive) {
          throw new ConflictException('This person is inactive and cannot be added to the committee.');
        }

        const resolvedPerson = person ?? await transaction.person.create({
          data: { fullName, emailUniversity: email, isActive: true },
        });
        let member = await transaction.member.findUnique({ where: { personId: resolvedPerson.personId } });
        if (member && !member.isActive) {
          throw new ConflictException('This member is inactive and cannot be added to the committee.');
        }
        if (!member) {
          member = await transaction.member.create({
            data: { personId: resolvedPerson.personId, memberType: 'current', isActive: true },
          });
        }

        const existingMembership = await transaction.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
        });
        if (existingMembership) throw new ConflictException('This person is already a member of the committee.');

        await transaction.memberCommittee.create({
          data: { memberId: member.memberId, committeeId: committee.committeeId, role: 'Member' },
        });

        return {
          id: String(member.memberId),
          name: resolvedPerson.fullName,
          email: resolvedPerson.emailUniversity ?? resolvedPerson.emailPersonal ?? email,
          role: 'Member',
          status: 'Active',
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A person or membership with this email already exists.');
      }
      throw error;
    }
  }

  async createEvent(user: RequestUser | undefined, committeeCode: string, dto: CreateCommitteeEventDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const registrationDeadline = new Date(dto.registrationDeadline);
    const questions = (dto.questions ?? []).map((question) => ({
      ...question,
      text: question.text.trim(),
      options: question.type === 'TEXT' ? [] : [...new Set((question.options ?? []).map((option) => option.trim()).filter(Boolean))],
    }));

    const errors: ApiErrorDetail[] = [];
    const now = Date.now();
    if (startsAt.getTime() <= now) errors.push({ pointer: '/startsAt', message: 'The event must start in the future.' });
    if (endsAt.getTime() <= startsAt.getTime()) errors.push({ pointer: '/endsAt', message: 'The event must end after it starts.' });
    if (registrationDeadline.getTime() <= now) errors.push({ pointer: '/registrationDeadline', message: 'The registration deadline must be in the future.' });
    if (registrationDeadline.getTime() > startsAt.getTime()) errors.push({ pointer: '/registrationDeadline', message: 'Registration must close before the event starts.' });
    questions.forEach((question, index) => {
      if (!question.text) errors.push({ pointer: `/questions/${index}/text`, message: 'Question text is required.' });
      if (question.type !== 'TEXT' && question.options.length < 2) {
        errors.push({ pointer: `/questions/${index}/options`, message: 'Choice questions need at least two different options.' });
      }
    });
    if (errors.length > 0) throw apiValidationError(errors);

    const event = await this.prisma.event.create({
      data: {
        name: dto.name.trim(),
        description: dto.description.trim(),
        eventType: dto.eventType,
        startsAt,
        endsAt,
        registrationDeadline,
        location: dto.location.trim(),
        mapsLink: dto.mapsLink?.trim() || null,
        capacity: dto.capacity,
        speakers: dto.speakers?.trim() || null,
        requirements: dto.requirements?.trim() || null,
        requiredRegistrantFields: [...new Set(dto.requiredRegistrantFields ?? [])],
        status: dto.status === 'PUBLISHED' ? EventStatus.PUBLISHED : EventStatus.DRAFT,
        createdByMemberId: memberId,
        committeeId: committee.committeeId,
        questions: {
          create: questions.map((question, index) => ({
            questionText: question.text,
            questionType: QuestionType[question.type],
            isRequired: question.required,
            position: index + 1,
            // SQL NULL, not a JSON null: the table requires text questions to have no options.
            options: question.type === 'TEXT' ? Prisma.DbNull : question.options,
          })),
        },
      },
      select: { eventId: true, name: true, status: true, startsAt: true, registrationDeadline: true },
    });
    return { id: String(event.eventId), ...event };
  }

  // Full details of one of the committee's events, drafts included, for the people who create them.
  async getCommitteeEvent(user: RequestUser | undefined, committeeCode: string, eventId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: {
        eventId: true, name: true, description: true, eventType: true, status: true,
        startsAt: true, endsAt: true, registrationDeadline: true, location: true, mapsLink: true,
        capacity: true, speakers: true, requirements: true, imageUrl: true, requiredRegistrantFields: true,
        questions: {
          orderBy: { position: 'asc' },
          select: { questionId: true, questionText: true, questionType: true, isRequired: true, options: true },
        },
      },
    });
    if (!event) throw new NotFoundException();
    return { id: String(event.eventId), ...event };
  }

  // Only drafts can be deleted: nobody can register for a draft, so no registration is lost.
  async deleteDraftEvent(user: RequestUser | undefined, committeeCode: string, eventId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: { status: true },
    });
    if (!event) throw new NotFoundException();
    if (event.status !== EventStatus.DRAFT) throw new ConflictException('Only a draft can be deleted.');
    // Conditional delete, so a draft published at the same moment is kept. Its questions go with it.
    const { count } = await this.prisma.event.deleteMany({ where: { eventId, status: EventStatus.DRAFT } });
    if (count === 0) throw new ConflictException('Only a draft can be deleted.');
    return { id: String(eventId) };
  }

  async publishEvent(user: RequestUser | undefined, committeeCode: string, eventId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: { status: true, registrationDeadline: true },
    });
    if (!event) throw new NotFoundException();
    if (event.status !== EventStatus.DRAFT) throw new ConflictException('Only a draft can be published.');
    if (event.registrationDeadline.getTime() <= Date.now()) {
      throw apiValidationError([{ pointer: '/registrationDeadline', message: 'The registration deadline has passed.' }]);
    }
    // Conditional update so two publishes at once cannot both succeed.
    const { count } = await this.prisma.event.updateMany({
      where: { eventId, status: EventStatus.DRAFT },
      data: { status: EventStatus.PUBLISHED },
    });
    if (count === 0) throw new ConflictException('Only a draft can be published.');
    return { id: String(eventId), status: EventStatus.PUBLISHED };
  }

  // club leadership adds an existing member to another committee; new people still join through membership requests
  async addMemberToCommittee(user: RequestUser | undefined, targetMemberId: number, dto: AddMemberToCommitteeDto) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, MEMBERS_PERMISSION))) throw new ForbiddenException();
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode: dto.committeeCode.trim().toUpperCase() } });
    if (!committee) throw new NotFoundException('The selected committee does not exist.');
    const member = await this.prisma.member.findUnique({ where: { memberId: targetMemberId }, include: { person: true } });
    if (!member || !member.isActive || !member.person.isActive) throw new NotFoundException('The selected person is not an active member.');

    try {
      const membership = await this.prisma.memberCommittee.create({
        data: { memberId: member.memberId, committeeId: committee.committeeId, role: 'Member' },
      });
      return {
        memberId: String(member.memberId),
        committee: { code: committee.committeeCode, name: committee.committeeName, role: membership.role, points: 0 },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This person is already a member of the committee.');
      }
      throw error;
    }
  }

  async createTask(user: RequestUser | undefined, committeeCode: string, dto: CreateCommitteeTaskDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    await this.requireCommitteeMember(committee.committeeId, dto.assignedMemberId);
    const task = await this.prisma.committeeTask.create({
      data: {
        committeeId: committee.committeeId,
        title: dto.title.trim(),
        description: dto.description?.trim() ?? '',
        assignedMemberId: dto.assignedMemberId,
        createdByMemberId: memberId,
        dueAt: new Date(dto.dueAt),
        priority: dto.priority,
        status: dto.status ?? CommitteeTaskStatus.TODO,
      },
      include: { assignee: { include: { member: { include: { person: true } } } } },
    });
    return this.mapTask(task);
  }

  async updateTask(user: RequestUser | undefined, committeeCode: string, taskId: number, dto: UpdateCommitteeTaskDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    const existing = await this.prisma.committeeTask.findFirst({ where: { taskId, committeeId: committee.committeeId } });
    if (!existing) throw new NotFoundException();
    if (dto.assignedMemberId !== undefined) await this.requireCommitteeMember(committee.committeeId, dto.assignedMemberId);
    const task = await this.prisma.committeeTask.update({
      where: { taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.assignedMemberId !== undefined ? { assignedMemberId: dto.assignedMemberId } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: new Date(dto.dueAt) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { assignee: { include: { member: { include: { person: true } } } } },
    });
    return this.mapTask(task);
  }

  // A member moves their own task along; marking it done only asks a leader to confirm it.
  async updateMyTaskStatus(memberId: number | null | undefined, taskId: number, status: (typeof MEMBER_TASK_STATUSES)[number]) {
    if (!memberId) throw new ForbiddenException();
    const task = await this.prisma.committeeTask.findFirst({
      where: { taskId, assignedMemberId: memberId, assignee: { member: { isActive: true } } },
      select: { status: true },
    });
    if (!task) throw new NotFoundException();
    if (task.status === CommitteeTaskStatus.COMPLETED) throw new ConflictException('A confirmed task cannot be changed.');
    if (task.status !== status) {
      // Conditional, so a leader's confirmation at the same moment is never overwritten.
      const { count } = await this.prisma.committeeTask.updateMany({
        where: { taskId, assignedMemberId: memberId, status: task.status },
        data: { status },
      });
      if (count === 0) throw new ConflictException('The task changed; reload and try again.');
    }
    return (await this.getMyTasks(memberId)).find((item) => item.id === String(taskId));
  }

  // A committee leader confirms a task the member marked done, or sends it back.
  async reviewTask(user: RequestUser | undefined, committeeCode: string, taskId: number, decision: 'APPROVE' | 'RETURN') {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    const task = await this.prisma.committeeTask.findFirst({ where: { taskId, committeeId: committee.committeeId }, select: { status: true } });
    if (!task) throw new NotFoundException();
    const { count } = await this.prisma.committeeTask.updateMany({
      where: { taskId, committeeId: committee.committeeId, status: CommitteeTaskStatus.PENDING_REVIEW },
      data: { status: decision === 'APPROVE' ? CommitteeTaskStatus.COMPLETED : CommitteeTaskStatus.IN_PROGRESS },
    });
    if (count === 0) throw new ConflictException('Only a task waiting for confirmation can be reviewed.');
    const updated = await this.prisma.committeeTask.findUniqueOrThrow({
      where: { taskId },
      include: { assignee: { include: { member: { include: { person: true } } } } },
    });
    return this.mapTask(updated);
  }

  async deleteTask(user: RequestUser | undefined, committeeCode: string, taskId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    const result = await this.prisma.committeeTask.deleteMany({ where: { taskId, committeeId: committee.committeeId } });
    if (!result.count) throw new NotFoundException();
    return { deleted: true };
  }

  async updatePoints(user: RequestUser | undefined, committeeCode: string, targetMemberId: number, dto: UpdateCommitteePointsDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, POINTS_PERMISSION, committee.committeeId);
    await this.requireCommitteeMember(committee.committeeId, targetMemberId);
    if (!Number.isSafeInteger(dto.pointsDelta) || dto.pointsDelta === 0) throw new BadRequestException('A non-zero points change is required.');

    return this.prisma.$transaction(async (transaction) => {
      // Lock the actual committee membership row so concurrent point changes
      // for this member are serialized without returning PostgreSQL's `void`
      // advisory-lock result through Prisma.
      const membership = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM member_committee
        WHERE committee_id = ${committee.committeeId}
          AND member_id = ${targetMemberId}
        FOR UPDATE
      `;
      if (membership.length === 0) throw new NotFoundException();

      const current = await transaction.committeePointEntry.aggregate({
        where: { committeeId: committee.committeeId, memberId: targetMemberId },
        _sum: { pointsDelta: true },
      });
      if ((current._sum.pointsDelta ?? 0) + dto.pointsDelta < 0) {
        throw new ForbiddenException('A points deduction cannot reduce a member below zero.');
      }
      const entry = await transaction.committeePointEntry.create({
        data: {
          committeeId: committee.committeeId,
          memberId: targetMemberId,
          awardedByMemberId: memberId,
          pointsDelta: dto.pointsDelta,
          reason: dto.reason.trim(),
        },
        include: { recipient: { include: { member: { include: { person: true } } } } },
      });
      return {
        id: String(entry.pointEntryId), memberId: String(entry.memberId),
        memberName: entry.recipient.member.person.fullName, pointsDelta: entry.pointsDelta,
        reason: entry.reason, createdAt: entry.createdAt.toISOString(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  // The signed-in member's own tasks in every committee they belong to; the id comes from the token only.
  async getMyTasks(memberId: number | null | undefined) {
    if (!memberId) return [];
    const tasks = await this.prisma.committeeTask.findMany({
      where: { assignedMemberId: memberId, assignee: { member: { isActive: true } } },
      include: {
        assignee: { include: { member: { include: { person: true } } } },
        committee: { select: { committeeCode: true, committeeName: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }],
      take: 500,
    });
    return tasks.map((task) => ({
      ...this.mapTask(task),
      committeeCode: task.committee.committeeCode,
      committeeName: task.committee.committeeName,
    }));
  }

  private mapTask(task: {
    taskId: number; title: string; description: string; assignedMemberId: number;
    createdByMemberId: number; dueAt: Date; priority: string; status: string;
    createdAt: Date; updatedAt: Date; assignee: { member: { person: { fullName: string } } };
  }) {
    return {
      id: String(task.taskId), title: task.title, description: task.description,
      assignedMemberId: String(task.assignedMemberId), assignedMemberName: task.assignee.member.person.fullName,
      createdByMemberId: String(task.createdByMemberId), dueAt: task.dueAt.toISOString(),
      priority: task.priority, status: task.status,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    };
  }

  private async requireMembership(user: RequestUser | undefined, committeeCode: string) {
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode } });
    if (!committee) throw new NotFoundException();
    let membership = user?.memberId
      ? await this.prisma.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: user.memberId, committeeId: committee.committeeId } },
          include: { member: { include: { person: true } } },
        })
      : null;

    if (!membership) {
      if (!user?.memberId) throw new ForbiddenException();
      throw new ForbiddenException('An active member of this committee is required for dashboard changes.');
    }
    if (!membership.member.isActive || !membership.member.person.isActive) throw new ForbiddenException();
    return { committee, memberId: membership.memberId, membership };
  }

  private async requirePermission(memberId: number, permission: string, committeeId: number) {
    if (!(await this.access.hasCommitteePermission(memberId, permission, undefined, committeeId))) throw new ForbiddenException();
  }

  private async requireCommitteeMember(committeeId: number, memberId: number) {
    const membership = await this.prisma.memberCommittee.findFirst({
      where: { committeeId, memberId, member: { isActive: true } },
    });
    if (!membership) throw new NotFoundException('The selected person is not an active member of this committee.');
  }
}

function riyadhPeriodStart(now: Date, period: 'month' | 'week') {
  const local = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const offset = period === 'month' ? day - 1 : day - local.getUTCDay();
  const monthIndex = period === 'month' ? month : month;
  return new Date(Date.UTC(year, monthIndex, 1 + (period === 'week' ? offset : 0)) - 3 * 60 * 60 * 1000);
}
