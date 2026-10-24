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
