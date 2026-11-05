import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus } from '../generated/prisma/client.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { CommitteeTaskStatus, type CreateLeadershipTaskDto, type UpdateLeadershipTaskDto } from './committee-dashboard.dto.js';

const CLUB_TARGETS = ['CONTENT', 'PM', 'PR', 'DMD'] as const;
const DEVELOPER_TARGETS = ['DATA', 'CYBER', 'ROBOTICS', 'WEB', 'AUTOMATION', 'AI'] as const;
const ALL_COMMITTEE_TARGETS = [...CLUB_TARGETS, ...DEVELOPER_TARGETS] as const;
const COMMITTEE_TASK_PERMISSION = 'tasks.manage';

@Injectable()
export class LeadershipTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService) private readonly access: CommitteeAccessService,
  ) {}

  async getClubTasks(user: RequestUser | undefined) {
    await this.requireGlobal(user, 'club.tasks.manage');
    const [tasks, targets] = await Promise.all([
      this.listTasks('CLUB'),
      this.listLeadershipTargets([...CLUB_TARGETS, 'DEV'], true),
    ]);
    return { tasks, targets };
  }

  async createClubTask(user: RequestUser | undefined, dto: CreateLeadershipTaskDto) {
    const actorId = await this.requireGlobal(user, 'club.tasks.manage');
    const target = await this.resolveLeadershipTarget(dto.targetCommitteeCode, dto.assignedMemberId, [...CLUB_TARGETS, 'DEV'], true);
    return this.createTask(actorId, target, dto, 'CLUB');
  }

  async updateClubTask(user: RequestUser | undefined, taskId: number, dto: UpdateLeadershipTaskDto) {
    const actorId = await this.requireGlobal(user, 'club.tasks.manage');
    return this.updateScopedTask(actorId, taskId, 'CLUB', dto, [...CLUB_TARGETS, 'DEV'], true);
  }

  async reviewClubTask(user: RequestUser | undefined, taskId: number, decision: 'APPROVE' | 'RETURN') {
    const actorId = await this.requireGlobal(user, 'club.tasks.manage');
    return this.reviewScopedTask(actorId, taskId, 'CLUB', decision);
  }

  async deleteClubTask(user: RequestUser | undefined, taskId: number) {
    const actorId = await this.requireGlobal(user, 'club.tasks.manage');
    return this.deleteScopedTask(actorId, taskId, 'CLUB');
  }

  async getDeveloperTasks(user: RequestUser | undefined) {
    const memberId = await this.requireGlobal(user, 'developer_committees.dashboard.view');
    const canManageTasks = await this.access.hasGlobalPermission(memberId, 'developer_committees.tasks.manage');
    const [tasks, targets, inboxTasks] = await Promise.all([
      canManageTasks ? this.listTasks('DEVELOPER_COMMITTEES') : Promise.resolve([]),
      canManageTasks ? this.listLeadershipTargets(DEVELOPER_TARGETS) : Promise.resolve([]),
      this.listAssignedTasks(memberId, ['CLUB']),
    ]);
    return { canManageTasks, tasks, targets, inboxTasks };
  }

  async createDeveloperTask(user: RequestUser | undefined, dto: CreateLeadershipTaskDto) {
    const actorId = await this.requireGlobal(user, 'developer_committees.tasks.manage');
    const target = await this.resolveLeadershipTarget(dto.targetCommitteeCode, dto.assignedMemberId, DEVELOPER_TARGETS);
    return this.createTask(actorId, target, dto, 'DEVELOPER_COMMITTEES');
  }

  async updateDeveloperTask(user: RequestUser | undefined, taskId: number, dto: UpdateLeadershipTaskDto) {
    const actorId = await this.requireGlobal(user, 'developer_committees.tasks.manage');
    return this.updateScopedTask(actorId, taskId, 'DEVELOPER_COMMITTEES', dto, DEVELOPER_TARGETS);
  }

  async reviewDeveloperTask(user: RequestUser | undefined, taskId: number, decision: 'APPROVE' | 'RETURN') {
    const actorId = await this.requireGlobal(user, 'developer_committees.tasks.manage');
    return this.reviewScopedTask(actorId, taskId, 'DEVELOPER_COMMITTEES', decision);
  }

  async deleteDeveloperTask(user: RequestUser | undefined, taskId: number) {
    const actorId = await this.requireGlobal(user, 'developer_committees.tasks.manage');
    return this.deleteScopedTask(actorId, taskId, 'DEVELOPER_COMMITTEES');
  }

  async getProjectEvents(user: RequestUser | undefined) {
    const pm = await this.requireCommitteeLeader(user, 'PM');
    await this.requireCommitteePermission(pm.memberId, 'PM', pm.committeeId, COMMITTEE_TASK_PERMISSION);
    const [events, targets] = await Promise.all([
      this.prisma.event.findMany({
        where: { status: EventStatus.PUBLISHED, committee: { committeeCode: 'PR' } },
        include: {
          tasks: {
            where: { taskScope: 'EVENT' },
            include: {
              assignee: { include: { person: true } },
              committee: { select: { committeeCode: true, committeeName: true } },
              event: { select: { name: true } },
            },
            orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }],
          },
        },
        orderBy: [{ startsAt: 'asc' }, { eventId: 'desc' }],
      }),
      this.listLeadershipTargets(ALL_COMMITTEE_TARGETS),
    ]);
    return {
      targets,
      events: events.map((event: any) => ({
        id: String(event.eventId), title: event.name, description: event.description ?? '',
        startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), location: event.location,
        tasks: event.tasks.map((task: any) => this.mapTask(task)),
      })),
    };
  }

  async createProjectEventTask(user: RequestUser | undefined, eventId: number, dto: CreateLeadershipTaskDto) {
    const pm = await this.requireCommitteeLeader(user, 'PM');
    await this.requireCommitteePermission(pm.memberId, 'PM', pm.committeeId, COMMITTEE_TASK_PERMISSION);
    await this.requirePublishedPrEvent(eventId);
    const target = await this.resolveLeadershipTarget(dto.targetCommitteeCode, dto.assignedMemberId, ALL_COMMITTEE_TARGETS);
    return this.createTask(pm.memberId, target, dto, 'EVENT', eventId);
  }

  async updateProjectEventTask(user: RequestUser | undefined, eventId: number, taskId: number, dto: UpdateLeadershipTaskDto) {
    const pm = await this.requireCommitteeLeader(user, 'PM');
    await this.requireCommitteePermission(pm.memberId, 'PM', pm.committeeId, COMMITTEE_TASK_PERMISSION);
    await this.requirePublishedPrEvent(eventId);
    return this.updateScopedTask(pm.memberId, taskId, 'EVENT', dto, ALL_COMMITTEE_TARGETS, false, eventId);
  }

  async reviewProjectEventTask(user: RequestUser | undefined, eventId: number, taskId: number, decision: 'APPROVE' | 'RETURN') {
    const pm = await this.requireCommitteeLeader(user, 'PM');
    await this.requireCommitteePermission(pm.memberId, 'PM', pm.committeeId, COMMITTEE_TASK_PERMISSION);
    await this.requirePublishedPrEvent(eventId);
    return this.reviewScopedTask(pm.memberId, taskId, 'EVENT', decision, eventId);
  }

  async deleteProjectEventTask(user: RequestUser | undefined, eventId: number, taskId: number) {
    const pm = await this.requireCommitteeLeader(user, 'PM');
    await this.requireCommitteePermission(pm.memberId, 'PM', pm.committeeId, COMMITTEE_TASK_PERMISSION);
    await this.requirePublishedPrEvent(eventId);
    return this.deleteScopedTask(pm.memberId, taskId, 'EVENT', eventId);
  }

  private async requireGlobal(user: RequestUser | undefined, permission: string) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, permission))) throw new ForbiddenException();
    return user.memberId;
  }

  private async requireCommitteeLeader(user: RequestUser | undefined, code: string) {
    if (!user?.memberId) throw new ForbiddenException();
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode: code } });
    if (!committee) throw new NotFoundException();
    const seat = await this.prisma.memberCommittee.findFirst({
      where: { memberId: user.memberId, committeeId: committee.committeeId, role: { in: ['Leader', 'Co-Leader'] }, member: { isActive: true, person: { isActive: true } } },
      select: { memberId: true, committeeId: true },
    });
    if (!seat) throw new ForbiddenException();
    return seat;
  }

  private async requireCommitteePermission(memberId: number, committeeCode: string, committeeId: number, permission: string) {
    if (!(await this.access.hasCommitteePermission(memberId, permission, committeeCode, committeeId))) throw new ForbiddenException();
  }

  private async resolveLeadershipTarget(codeValue: string, memberId: number, allowedCodes: readonly string[], allowDeveloperLeader = false) {
    const code = codeValue.trim().toUpperCase();
    if (!allowedCodes.includes(code)) throw new BadRequestException('The selected leadership target is not allowed.');
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode: code } });
    if (!committee) throw new NotFoundException('Target committee not found.');
    if (code === 'DEV' && allowDeveloperLeader) {
      const today = new Date();
      const assignment = await this.prisma.memberRole.findFirst({
        where: {
          memberId, roleCode: 'DEVELOPER_COMMITTEES_LEADER',
          AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: today } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
          member: { isActive: true, person: { isActive: true } },
        },
        select: { memberId: true },
      });
      if (!assignment) throw new BadRequestException('Select the Developer Committees Leader account.');
      return committee;
    }
    const seat = await this.prisma.memberCommittee.findFirst({
      where: {
        memberId, committeeId: committee.committeeId,
        role: { in: ['Leader', 'Co-Leader'] },
        member: { isActive: true, person: { isActive: true } },
      },
      select: { memberId: true },
    });
    if (!seat) throw new BadRequestException('Tasks can only be assigned to an active committee Leader or Co-Leader.');
    return committee;
  }

  private async listLeadershipTargets(codes: readonly string[], includeDeveloperLeader = false) {
    const committees = await this.prisma.committee.findMany({
      where: { committeeCode: { in: codes.filter((code) => code !== 'DEV') }, children: { none: {} } },
      select: {
        committeeCode: true, committeeName: true,
        members: {
          where: { role: { in: ['Leader', 'Co-Leader'] }, member: { isActive: true, person: { isActive: true } } },
          select: { memberId: true, role: true, member: { select: { person: { select: { fullName: true } } } } },
          orderBy: [{ role: 'asc' }, { member: { person: { fullName: 'asc' } } }],
        },
      },
      orderBy: { committeeName: 'asc' },
    });
    const targets = committees.flatMap((committee: any) => committee.members.map((seat: any) => ({
      memberId: String(seat.memberId), name: seat.member.person.fullName,
      committeeCode: committee.committeeCode, committeeName: committee.committeeName, role: seat.role,
    })));
    if (includeDeveloperLeader && codes.includes('DEV')) {
      const today = new Date();
      const leaders = await this.prisma.memberRole.findMany({
        where: {
          roleCode: 'DEVELOPER_COMMITTEES_LEADER',
          AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: today } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
          member: { isActive: true, person: { isActive: true } },
        },
        select: { memberId: true, member: { select: { person: { select: { fullName: true } } } } },
      });
      targets.push(...leaders.map((leader: any) => ({ memberId: String(leader.memberId), name: leader.member.person.fullName, committeeCode: 'DEV', committeeName: 'Developers', role: 'DEVELOPER_COMMITTEES_LEADER' })));
    }
    return targets;
  }

  private async createTask(actorId: number, target: { committeeId: number; committeeCode: string; committeeName: string }, dto: CreateLeadershipTaskDto, scope: string, eventId?: number) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Task title is required.');
    const task = await this.prisma.committeeTask.create({
      data: {
        committeeId: target.committeeId, title, description: dto.description?.trim() ?? '',
        assignedMemberId: dto.assignedMemberId, createdByMemberId: actorId, dueAt: new Date(dto.dueAt),
        priority: dto.priority, status: CommitteeTaskStatus.TODO, taskScope: scope, eventId: eventId ?? null,
      },
      include: { assignee: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } }, event: { select: { name: true } } },
    });
    return this.mapTask(task);
  }

  private async listAssignedTasks(memberId: number, scopes: readonly string[]) {
    const tasks = await this.prisma.committeeTask.findMany({
      where: { assignedMemberId: memberId, taskScope: { in: [...scopes] } },
      include: { assignee: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } }, event: { select: { name: true } } },
      orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }], take: 100,
    });
    return tasks.map((task: any) => this.mapTask(task));
  }
  private async listTasks(scope: string) {
    const tasks = await this.prisma.committeeTask.findMany({
      where: { taskScope: scope },
      include: { assignee: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } }, event: { select: { name: true } } },
      orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }], take: 500,
    });
    return tasks.map((task: any) => this.mapTask(task));
  }

  private async updateScopedTask(actorId: number, taskId: number, scope: string, dto: UpdateLeadershipTaskDto, allowedCodes: readonly string[], allowDeveloperLeader = false, eventId?: number) {
    const existing = await this.prisma.committeeTask.findFirst({ where: { taskId, taskScope: scope, ...(eventId ? { eventId } : {}) } });
    if (!existing) throw new NotFoundException();
    const requestedMemberId = dto.assignedMemberId ?? existing.assignedMemberId;
    const targetCode = dto.targetCommitteeCode?.trim().toUpperCase() ?? (await this.prisma.committee.findUnique({ where: { committeeId: existing.committeeId }, select: { committeeCode: true } }))?.committeeCode;
    if (!targetCode) throw new NotFoundException();
    const target = await this.resolveLeadershipTarget(targetCode, requestedMemberId, allowedCodes, allowDeveloperLeader);
    if (dto.title !== undefined && !dto.title.trim()) throw new BadRequestException('Task title is required.');
    const task = await this.prisma.committeeTask.update({
      where: { taskId },
      data: {
        committeeId: target.committeeId,
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        assignedMemberId: requestedMemberId,
        ...(dto.dueAt !== undefined ? { dueAt: new Date(dto.dueAt) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { assignee: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } }, event: { select: { name: true } } },
    });
    return this.mapTask(task);
  }

  private async reviewScopedTask(actorId: number, taskId: number, scope: string, decision: 'APPROVE' | 'RETURN', eventId?: number) {
    const where = { taskId, taskScope: scope, ...(eventId ? { eventId } : {}) };
    const { count } = await this.prisma.committeeTask.updateMany({
      where: { ...where, status: CommitteeTaskStatus.PENDING_REVIEW },
      data: { status: decision === 'APPROVE' ? CommitteeTaskStatus.COMPLETED : CommitteeTaskStatus.IN_PROGRESS },
    });
    if (!count) {
      const exists = await this.prisma.committeeTask.findFirst({ where, select: { taskId: true } });
      if (!exists) throw new NotFoundException();
      throw new ConflictException('Only a task waiting for confirmation can be reviewed.');
    }
    return this.getTask(taskId);
  }

  private async deleteScopedTask(actorId: number, taskId: number, scope: string, eventId?: number) {
    const { count } = await this.prisma.committeeTask.deleteMany({ where: { taskId, taskScope: scope, ...(eventId ? { eventId } : {}) } });
    if (!count) throw new NotFoundException();
    return { deleted: true };
  }

  private async getTask(taskId: number) {
    const task = await this.prisma.committeeTask.findUniqueOrThrow({
      where: { taskId },
      include: { assignee: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } }, event: { select: { name: true } } },
    });
    return this.mapTask(task);
  }

  private async requirePublishedPrEvent(eventId: number) {
    const event = await this.prisma.event.findFirst({ where: { eventId, status: EventStatus.PUBLISHED, committee: { committeeCode: 'PR' } }, select: { eventId: true } });
    if (!event) throw new NotFoundException('Published PR event not found.');
  }

  private mapTask(task: any) {
    return {
      id: String(task.taskId), title: task.title, description: task.description,
      assignedMemberId: String(task.assignedMemberId), assignedMemberName: task.assignee.person.fullName,
      createdByMemberId: String(task.createdByMemberId), dueAt: task.dueAt.toISOString(),
      priority: task.priority, status: task.status, taskScope: task.taskScope,
      committeeCode: task.committee.committeeCode, committeeName: task.committee.committeeName,
      eventId: task.eventId == null ? null : String(task.eventId), eventTitle: task.event?.name ?? null,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    };
  }
}
