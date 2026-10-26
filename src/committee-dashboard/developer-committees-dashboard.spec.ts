import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

const hasGlobalPermission = vi.fn();
const findMany = vi.fn();
const groupBy = vi.fn();
const count = vi.fn();
const service = new CommitteeDashboardService(
  {
    committee: { findMany },
    memberCommittee: { groupBy },
    committeeTask: { count },
  } as unknown as PrismaService,
  { hasGlobalPermission } as unknown as CommitteeAccessService,
);

beforeEach(() => {
  vi.clearAllMocks();
  hasGlobalPermission.mockResolvedValue(true);
  findMany.mockResolvedValue([{ committeeId: 2, committeeCode: 'DATA', committeeName: 'Data Analysis', _count: { members: 5 } }]);
  groupBy.mockResolvedValue([{ committeeId: 2, _count: { _all: 2 } }]);
  count.mockResolvedValue(3);
});

describe('Developer Committees Leader dashboard', () => {
  it('requires the global dashboard permission before querying committee data', async () => {
    hasGlobalPermission.mockResolvedValue(false);
    await expect(service.getDeveloperOverview({ personId: 9, memberId: 12 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns aggregate developer committee counts without exposing applicant or member records', async () => {
    await expect(service.getDeveloperOverview({ personId: 9, memberId: 12 })).resolves.toEqual([
      { code: 'DATA', name: 'Data Analysis', memberCount: 5, leaderCount: 2, activeTaskCount: 3 },
    ]);
    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'developer_committees.dashboard.view');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { committeeCode: { in: ['AUTOMATION', 'DATA', 'WEB', 'AI', 'ROBOTICS', 'CYBER'] } },
    }));
  });
});

describe('Club Leadership dashboard', () => {
  it('requires the club dashboard permission before exposing organization data', async () => {
    hasGlobalPermission.mockResolvedValue(false);
    await expect(service.getClubLeadershipOverview({ personId: 9, memberId: 12 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'club.dashboard.view');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('denies unauthenticated and non-member users', async () => {
    await expect(service.getClubLeadershipOverview(undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getClubLeadershipOverview({ personId: 9, memberId: null })).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).not.toHaveBeenCalled();
  });

  it('returns the organization overview with committee details for filtering', async () => {
    const clubService = new CommitteeDashboardService({
      person: { findUnique: vi.fn().mockResolvedValue({ fullName: 'Abdullah' }) },
      member: { findMany: vi.fn().mockResolvedValue([{
        memberId: 12,
        isActive: true,
        person: { fullName: 'Abdullah', emailPersonal: 'abdullah@example.test', emailUniversity: null },
        committees: [{ role: 'Leader', committeeId: 1, committee: { committeeCode: 'DATA', committeeName: 'Data' } }],
        roleAssignments: [{ roleCode: 'GROUP_LEADER' }],
      }]) },
      committee: { findMany: vi.fn().mockResolvedValue([{ committeeCode: 'DATA', committeeName: 'Data' }, { committeeCode: 'PR', committeeName: 'Public Relations' }]) },
      committeeTask: {
        findMany: vi.fn().mockResolvedValue([{
          taskId: 3, title: 'Report', description: '', assignedMemberId: 12, createdByMemberId: 12,
          dueAt: new Date('2026-11-01T00:00:00Z'), priority: 'HIGH', status: 'TODO',
          createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
          assignee: { member: { person: { fullName: 'Abdullah' } } },
          committee: { committeeCode: 'DATA', committeeName: 'Data' },
        }]),
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      committeePointEntry: {
        findMany: vi.fn().mockResolvedValue([{
          pointEntryId: 4, memberId: 12, pointsDelta: 8, reason: 'Workshop', createdAt: new Date('2026-10-02T00:00:00Z'),
          recipient: { member: { person: { fullName: 'Abdullah' } }, committee: { committeeCode: 'DATA', committeeName: 'Data' } },
        }]),
        groupBy: vi.fn()
          .mockResolvedValueOnce([{ memberId: 12, _sum: { pointsDelta: 8 } }])
          .mockResolvedValueOnce([{ memberId: 12, committeeId: 1, _sum: { pointsDelta: 8 } }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { pointsDelta: 0 } }),
      },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      eventRegistration: { groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService, { hasGlobalPermission } as unknown as CommitteeAccessService);
    hasGlobalPermission.mockResolvedValue(true);

    const overview = await clubService.getClubLeadershipOverview({ personId: 8, memberId: 12 });

    expect(overview.currentMember).toEqual({ id: '12', name: 'Abdullah', role: 'Club Leadership' });
    expect(overview.members).toEqual([expect.objectContaining({
      id: '12', role: 'Leader / GROUP_LEADER', points: 8, globalRoles: ['GROUP_LEADER'],
      committees: [{ code: 'DATA', name: 'Data', role: 'Leader', points: 8 }],
    })]);
    expect(overview.committees).toEqual([{ code: 'DATA', name: 'Data' }, { code: 'PR', name: 'Public Relations' }]);
    expect(overview.tasks).toEqual([expect.objectContaining({ id: '3', committeeCode: 'DATA', committeeName: 'Data' })]);
    expect(overview.pointHistory).toEqual([expect.objectContaining({ id: '4', committeeCode: 'DATA', committeeName: 'Data' })]);
    expect(overview.permissions).toEqual({ canManageTasks: false, canManagePoints: false, canManageRegistrations: false, canAddMembers: true });
    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'club.dashboard.view');
    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'members.manage');
  });
});

describe('Club Leadership adds a member to another committee', () => {
  const findCommittee = vi.fn();
  const findMember = vi.fn();
  const createMembership = vi.fn();
  const clubService = new CommitteeDashboardService({
    committee: { findUnique: findCommittee },
    member: { findUnique: findMember },
    memberCommittee: { create: createMembership },
  } as unknown as PrismaService, { hasGlobalPermission } as unknown as CommitteeAccessService);

  beforeEach(() => {
    findCommittee.mockResolvedValue({ committeeId: 2, committeeCode: 'PR', committeeName: 'Public Relations' });
    findMember.mockResolvedValue({ memberId: 30, isActive: true, person: { isActive: true } });
    createMembership.mockResolvedValue({ role: 'Member' });
  });

  it('requires members.manage before touching any membership', async () => {
    hasGlobalPermission.mockResolvedValue(false);
    await expect(clubService.addMemberToCommittee({ personId: 8, memberId: 12 }, 30, { committeeCode: 'PR' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(clubService.addMemberToCommittee({ personId: 8, memberId: null }, 30, { committeeCode: 'PR' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'members.manage');
    expect(createMembership).not.toHaveBeenCalled();
  });

  it('adds the member with the least-privileged Member position', async () => {
    await expect(clubService.addMemberToCommittee({ personId: 8, memberId: 12 }, 30, { committeeCode: 'pr' })).resolves.toEqual({
      memberId: '30', committee: { code: 'PR', name: 'Public Relations', role: 'Member', points: 0 },
    });
    expect(findCommittee).toHaveBeenCalledWith({ where: { committeeCode: 'PR' } });
    expect(createMembership).toHaveBeenCalledWith({ data: { memberId: 30, committeeId: 2, role: 'Member' } });
  });

  it('rejects unknown committees and inactive members', async () => {
    findCommittee.mockResolvedValueOnce(null);
    await expect(clubService.addMemberToCommittee({ personId: 8, memberId: 12 }, 30, { committeeCode: 'NOPE' })).rejects.toBeInstanceOf(NotFoundException);
    findMember.mockResolvedValueOnce({ memberId: 30, isActive: false, person: { isActive: true } });
    await expect(clubService.addMemberToCommittee({ personId: 8, memberId: 12 }, 30, { committeeCode: 'PR' })).rejects.toBeInstanceOf(NotFoundException);
    expect(createMembership).not.toHaveBeenCalled();
  });

  it('returns a conflict when the member is already in the committee', async () => {
    createMembership.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }));
    await expect(clubService.addMemberToCommittee({ personId: 8, memberId: 12 }, 30, { committeeCode: 'PR' })).rejects.toBeInstanceOf(ConflictException);
  });
});
