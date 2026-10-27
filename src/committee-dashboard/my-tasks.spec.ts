import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiValidationPipe } from '../common/http/api-validation.pipe.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CommitteeTaskStatus, UpdateMyTaskDto } from './committee-dashboard.dto.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

const findMany = vi.fn();
const service = new CommitteeDashboardService(
  { committeeTask: { findMany } } as unknown as PrismaService,
  {} as CommitteeAccessService,
);

const task = (taskId: number, committeeCode: string, committeeName: string) => ({
  taskId, title: `Task ${taskId}`, description: '', assignedMemberId: 30, createdByMemberId: 12,
  dueAt: new Date('2026-11-10T00:00:00Z'), priority: 'HIGH', status: 'TODO',
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
  assignee: { member: { person: { fullName: 'Member Demo' } } },
  committee: { committeeCode, committeeName },
});

beforeEach(() => vi.clearAllMocks());

describe('A member\'s own tasks', () => {
  it('returns nothing for someone who is not a member, without querying', async () => {
    await expect(service.getMyTasks(null)).resolves.toEqual([]);
    await expect(service.getMyTasks(undefined)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('only asks for tasks assigned to the signed-in member, while active', async () => {
    findMany.mockResolvedValue([]);
    await service.getMyTasks(30);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedMemberId: 30, assignee: { member: { isActive: true } } },
    }));
  });

  it('lets the assignee move their own task, and only their own', async () => {
    const findFirst = vi.fn();
    const updateMany = vi.fn();
    const mine = new CommitteeDashboardService(
      { committeeTask: { findFirst, updateMany, findMany } } as unknown as PrismaService,
      {} as CommitteeAccessService,
    );
    await expect(mine.updateMyTaskStatus(null, 5, CommitteeTaskStatus.IN_PROGRESS)).rejects.toBeInstanceOf(ForbiddenException);

    findFirst.mockResolvedValueOnce(null);
    await expect(mine.updateMyTaskStatus(30, 5, CommitteeTaskStatus.IN_PROGRESS)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { taskId: 5, assignedMemberId: 30, assignee: { member: { isActive: true } } } }));

    findFirst.mockResolvedValueOnce({ status: 'COMPLETED' });
    await expect(mine.updateMyTaskStatus(30, 5, CommitteeTaskStatus.IN_PROGRESS)).rejects.toBeInstanceOf(ConflictException);

    findFirst.mockResolvedValueOnce({ status: 'IN_PROGRESS' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findMany.mockResolvedValueOnce([task(5, 'WEB', 'Web')]);
    await expect(mine.updateMyTaskStatus(30, 5, CommitteeTaskStatus.PENDING_REVIEW)).resolves.toMatchObject({ id: '5' });
    expect(updateMany).toHaveBeenCalledWith({ where: { taskId: 5, assignedMemberId: 30, status: 'IN_PROGRESS' }, data: { status: 'PENDING_REVIEW' } });
  });

  it('never lets a member mark a task completed themselves', async () => {
    const pipe = new ApiValidationPipe();
    await expect(pipe.transform({ status: 'COMPLETED' }, { type: 'body', metatype: UpdateMyTaskDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ status: 'PENDING_REVIEW' }, { type: 'body', metatype: UpdateMyTaskDto })).resolves.toEqual({ status: 'PENDING_REVIEW' });
  });

  it('lets a committee leader confirm or return only tasks waiting for review', async () => {
    const findFirst = vi.fn();
    const updateMany = vi.fn();
    const findUniqueOrThrow = vi.fn().mockResolvedValue(task(5, 'WEB', 'Web'));
    const hasCommitteePermission = vi.fn().mockResolvedValue(true);
    const leader = new CommitteeDashboardService(
      {
        committee: { findUnique: vi.fn().mockResolvedValue({ committeeId: 3, committeeCode: 'WEB' }) },
        memberCommittee: { findUnique: vi.fn().mockResolvedValue({ memberId: 12, member: { isActive: true, person: { isActive: true } } }) },
        committeeTask: { findFirst, updateMany, findUniqueOrThrow },
      } as unknown as PrismaService,
      { hasCommitteePermission } as unknown as CommitteeAccessService,
    );
    const user = { personId: 8, memberId: 12 };

    hasCommitteePermission.mockResolvedValueOnce(false);
    await expect(leader.reviewTask(user, 'WEB', 5, 'APPROVE')).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasCommitteePermission).toHaveBeenCalledWith(12, 'tasks.manage', undefined, 3);

    findFirst.mockResolvedValueOnce({ status: 'IN_PROGRESS' });
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(leader.reviewTask(user, 'WEB', 5, 'APPROVE')).rejects.toBeInstanceOf(ConflictException);

    findFirst.mockResolvedValueOnce({ status: 'PENDING_REVIEW' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    await leader.reviewTask(user, 'WEB', 5, 'APPROVE');
    expect(updateMany).toHaveBeenLastCalledWith({ where: { taskId: 5, committeeId: 3, status: 'PENDING_REVIEW' }, data: { status: 'COMPLETED' } });

    findFirst.mockResolvedValueOnce({ status: 'PENDING_REVIEW' });
    updateMany.mockResolvedValueOnce({ count: 1 });
    await leader.reviewTask(user, 'WEB', 5, 'RETURN');
    expect(updateMany).toHaveBeenLastCalledWith({ where: { taskId: 5, committeeId: 3, status: 'PENDING_REVIEW' }, data: { status: 'IN_PROGRESS' } });
  });

  it('labels each task with its committee so the dashboard can switch between committees', async () => {
    findMany.mockResolvedValue([task(1, 'WEB', 'Web'), task(2, 'PR', 'Public Relations')]);
    await expect(service.getMyTasks(30)).resolves.toEqual([
      expect.objectContaining({ id: '1', committeeCode: 'WEB', committeeName: 'Web', status: 'TODO', priority: 'HIGH' }),
      expect.objectContaining({ id: '2', committeeCode: 'PR', committeeName: 'Public Relations' }),
    ]);
  });
});
