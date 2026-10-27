import { approvalScopeFor, findApplicableCommittees } from './committee-catalog.js';

const findMany = vi.fn();
const db = { committee: { findMany } } as unknown as Parameters<typeof findApplicableCommittees>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findApplicableCommittees', () => {
  it('only matches committees without sub-committees', async () => {
    findMany.mockResolvedValue([
      { committeeId: 5, committeeCode: 'WEB', parent: { committeeCode: 'DEV' } },
      { committeeId: 2, committeeCode: 'PR', parent: null },
    ]);

    await expect(findApplicableCommittees(db, ['WEB', 'PR', 'WEB'])).resolves.toEqual([
      { committeeId: 5, committeeCode: 'WEB', isDeveloperCommittee: true },
      { committeeId: 2, committeeCode: 'PR', isDeveloperCommittee: false },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { committeeCode: { in: ['WEB', 'PR'] }, children: { none: {} } },
    }));
  });

  it('rejects unknown codes and parent committees such as DEV', async () => {
    findMany.mockResolvedValue([{ committeeId: 5, committeeCode: 'WEB', parent: { committeeCode: 'DEV' } }]);

    await expect(findApplicableCommittees(db, ['WEB', 'DEV'])).resolves.toBeNull();
  });

  it('skips the query when nothing was selected', async () => {
    await expect(findApplicableCommittees(db, [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('approvalScopeFor', () => {
  const web = { committeeId: 5, committeeCode: 'WEB', isDeveloperCommittee: true };
  const pr = { committeeId: 2, committeeCode: 'PR', isDeveloperCommittee: false };

  it('routes leader applications by committee group', () => {
    expect(approvalScopeFor(web, 'Leader')).toBe('DEVELOPER_COMMITTEES');
    expect(approvalScopeFor(web, 'Co-Leader')).toBe('DEVELOPER_COMMITTEES');
    expect(approvalScopeFor(pr, 'Leader')).toBe('CLUB');
  });

  it('leaves member applications to the committee itself', () => {
    expect(approvalScopeFor(web, 'Member')).toBe('COMMITTEE');
    expect(approvalScopeFor(pr, 'Advisor')).toBe('COMMITTEE');
  });
});
