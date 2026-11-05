import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { LeadershipTasksService } from './leadership-tasks.service.js';

function makeService() {
  const prisma = {
    committee: { findUnique: vi.fn(), findMany: vi.fn() },
    memberCommittee: { findFirst: vi.fn() },
    memberRole: { findFirst: vi.fn(), findMany: vi.fn() },
    committeeTask: { create: vi.fn(), findMany: vi.fn() },
    event: { findMany: vi.fn(), findFirst: vi.fn() },
  };
  const access = { hasGlobalPermission: vi.fn(), hasCommitteePermission: vi.fn() };
  return {
    service: new LeadershipTasksService(prisma as unknown as PrismaService, access as unknown as CommitteeAccessService),
    prisma,
    access,
  };
}

describe('leadership task authorization', () => {
  it('rejects group task access without the group task permission', async () => {
    const { service, access } = makeService();
    access.hasGlobalPermission.mockResolvedValue(false);
    await expect(service.getClubTasks({ memberId: 12 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.hasGlobalPermission).toHaveBeenCalledWith(12, 'club.tasks.manage');
  });

  it('allows group leaders to assign to a leader of a developer subcommittee', async () => {
    const { service, access, prisma } = makeService();
    access.hasGlobalPermission.mockResolvedValue(true);
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 8, committeeCode: 'DATA', committeeName: 'Data' });
    prisma.memberCommittee.findFirst.mockResolvedValue({ memberId: 4 });
    prisma.committeeTask.create.mockResolvedValue({
      taskId: 21, title: 'Coordinate data work', description: '', assignedMemberId: 4, createdByMemberId: 1,
      dueAt: new Date('2026-12-01T10:00:00.000Z'), priority: 'HIGH', status: 'TODO', taskScope: 'CLUB', eventId: null,
      createdAt: new Date(), updatedAt: new Date(), assignee: { person: { fullName: 'Data Lead' } },
      committee: { committeeCode: 'DATA', committeeName: 'Data' }, event: null,
    });

    await service.createClubTask({ memberId: 1 } as any, {
      title: 'Coordinate data work', assignedMemberId: 4, targetCommitteeCode: 'DATA', dueAt: '2026-12-01T10:00:00.000Z', priority: 'HIGH',
    } as any);

    expect(prisma.committee.findUnique).toHaveBeenCalledWith({ where: { committeeCode: 'DATA' } });
    expect(prisma.committeeTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ committeeId: 8, assignedMemberId: 4, taskScope: 'CLUB' }),
    }));
  });

  it('offers group leaders all ten committee leadership targets plus the overall Developer Committees Leader', async () => {
    const { service, access, prisma } = makeService();
    access.hasGlobalPermission.mockResolvedValue(true);
    prisma.committeeTask.findMany.mockResolvedValue([]);
    prisma.committee.findMany.mockResolvedValue([]);
    prisma.memberRole.findMany.mockResolvedValue([]);

    await service.getClubTasks({ memberId: 1 } as any);

    expect(prisma.committee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        committeeCode: { in: ['CONTENT', 'PM', 'PR', 'DMD', 'DATA', 'CYBER', 'ROBOTICS', 'WEB', 'AUTOMATION', 'AI'] },
      }),
    }));
    expect(prisma.memberRole.findMany).toHaveBeenCalled();
  });

  it('allows group leaders to assign to an active leader in the four club committees', async () => {
    const { service, access, prisma } = makeService();
    access.hasGlobalPermission.mockResolvedValue(true);
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 5, committeeCode: 'PR', committeeName: 'Public Relations' });
    prisma.memberCommittee.findFirst.mockResolvedValue({ memberId: 4 });
    prisma.committeeTask.create.mockResolvedValue({
      taskId: 21, title: 'Coordinate outreach', description: '', assignedMemberId: 4, createdByMemberId: 1,
      dueAt: new Date('2026-12-01T10:00:00.000Z'), priority: 'MEDIUM', status: 'TODO', taskScope: 'CLUB', eventId: null,
      createdAt: new Date(), updatedAt: new Date(), assignee: { person: { fullName: 'PR Lead' } },
      committee: { committeeCode: 'PR', committeeName: 'Public Relations' }, event: null,
    });
    await service.createClubTask({ memberId: 1 } as any, {
      title: 'Coordinate outreach', assignedMemberId: 4, targetCommitteeCode: 'PR', dueAt: '2026-12-01T10:00:00.000Z', priority: 'MEDIUM',
    } as any);
    expect(prisma.committeeTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ committeeId: 5, assignedMemberId: 4, taskScope: 'CLUB' }),
    }));
  });

  it('lets the Developer Committees Leader assign to a child committee leader only', async () => {
    const { service, access, prisma } = makeService();
    access.hasGlobalPermission.mockResolvedValue(true);
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 8, committeeCode: 'DATA', committeeName: 'Data' });
    prisma.memberCommittee.findFirst.mockResolvedValue({ memberId: 4 });
    prisma.committeeTask.create.mockResolvedValue({
      taskId: 20, title: 'Prepare report', description: '', assignedMemberId: 4, createdByMemberId: 1,
      dueAt: new Date('2026-12-01T10:00:00.000Z'), priority: 'HIGH', status: 'TODO', taskScope: 'DEVELOPER_COMMITTEES', eventId: null,
      createdAt: new Date(), updatedAt: new Date(), assignee: { person: { fullName: 'Data Lead' } },
      committee: { committeeCode: 'DATA', committeeName: 'Data' }, event: null,
    });
    await service.createDeveloperTask({ memberId: 1 } as any, {
      title: 'Prepare report', assignedMemberId: 4, targetCommitteeCode: 'DATA', dueAt: '2026-12-01T10:00:00.000Z', priority: 'HIGH',
    } as any);
    expect(access.hasGlobalPermission).toHaveBeenCalledWith(1, 'developer_committees.tasks.manage');
    expect(prisma.committeeTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ committeeId: 8, assignedMemberId: 4, taskScope: 'DEVELOPER_COMMITTEES' }),
    }));

    await expect(service.createDeveloperTask({ memberId: 1 } as any, {
      title: 'Outside developer committees', assignedMemberId: 4, targetCommitteeCode: 'PR', dueAt: '2026-12-01T10:00:00.000Z', priority: 'HIGH',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-PM users from accessing published event task plans', async () => {
    const { service, prisma } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 3, committeeCode: 'PM' });
    prisma.memberCommittee.findFirst.mockResolvedValue(null);
    await expect(service.getProjectEvents({ memberId: 22 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it('allows a PM Co-Leader to access event task plans', async () => {
    const { service, access, prisma } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 3, committeeCode: 'PM' });
    prisma.memberCommittee.findFirst.mockResolvedValue({ memberId: 22, committeeId: 3 });
    access.hasCommitteePermission.mockResolvedValue(true);
    prisma.event.findMany.mockResolvedValue([]);
    prisma.committee.findMany.mockResolvedValue([]);
    await expect(service.getProjectEvents({ memberId: 22 } as any)).resolves.toMatchObject({ events: [] });
    expect(prisma.memberCommittee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { in: ['Leader', 'Co-Leader'] } }) }));
    expect(prisma.committee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        committeeCode: { in: ['CONTENT', 'PM', 'PR', 'DMD', 'DATA', 'CYBER', 'ROBOTICS', 'WEB', 'AUTOMATION', 'AI'] },
      }),
    }));
  });

  it('only links PM tasks to published PR events', async () => {
    const { service, access, prisma } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 3, committeeCode: 'PM' });
    prisma.memberCommittee.findFirst.mockResolvedValue({ memberId: 22, committeeId: 3 });
    access.hasCommitteePermission.mockResolvedValue(true);
    prisma.event.findFirst.mockResolvedValue(null);
    await expect(service.createProjectEventTask({ memberId: 22 } as any, 99, {
      title: 'Event task', assignedMemberId: 4, targetCommitteeCode: 'CONTENT', dueAt: '2026-12-01T10:00:00.000Z', priority: 'MEDIUM',
    } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventId: 99, status: 'PUBLISHED', committee: { committeeCode: 'PR' } }) }));
    expect(prisma.committeeTask.create).not.toHaveBeenCalled();
  });
});
