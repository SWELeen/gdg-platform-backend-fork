import { ForbiddenException } from '@nestjs/common';
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

  it('returns the shared organization overview as read-only data for an authorized club leader', async () => {
    const clubService = new CommitteeDashboardService({
      person: { findUnique: vi.fn().mockResolvedValue({ fullName: 'Abdullah' }) },
      member: { findMany: vi.fn().mockResolvedValue([{
        memberId: 12,
        isActive: true,
        person: { fullName: 'Abdullah', emailPersonal: 'abdullah@example.test', emailUniversity: null },
        committees: [{ role: 'Leader' }],
        roleAssignments: [{ roleCode: 'GROUP_LEADER' }],
      }]) },
      committeeTask: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      committeePointEntry: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([{ memberId: 12, _sum: { pointsDelta: 8 } }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { pointsDelta: 0 } }),
      },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      eventRegistration: { groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService, { hasGlobalPermission } as unknown as CommitteeAccessService);
    hasGlobalPermission.mockResolvedValue(true);

    const overview = await clubService.getClubLeadershipOverview({ personId: 8, memberId: 12 });

    expect(overview.currentMember).toEqual({ id: '12', name: 'Abdullah', role: 'Club Leadership' });
    expect(overview.members).toEqual([expect.objectContaining({ id: '12', role: 'Leader / GROUP_LEADER', points: 8 })]);
    expect(overview.permissions).toEqual({ canManageTasks: false, canManagePoints: false, canManageRegistrations: false, canAddMembers: false });
    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'club.dashboard.view');
  });
});
