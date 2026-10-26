import type { Prisma } from '../generated/prisma/client.js';

// Parent of the developer committees. Their leader applications are approved
// by the developer-committees leader instead of club leadership.
export const DEVELOPER_COMMITTEES_CODE = 'DEV';

export type ApprovalScope = 'COMMITTEE' | 'DEVELOPER_COMMITTEES' | 'CLUB';

export interface ApplicableCommittee {
  committeeId: number;
  committeeCode: string;
  isDeveloperCommittee: boolean;
}

type CommitteeReader = Pick<Prisma.TransactionClient, 'committee'>;

// Resolves the committees a person may apply to. Parent committees group other
// committees and have no members of their own, so they are never applicable.
// Returns null when any code is unknown or not applicable.
export async function findApplicableCommittees(
  db: CommitteeReader,
  committeeCodes: string[],
): Promise<ApplicableCommittee[] | null> {
  const codes = [...new Set(committeeCodes)];
  if (!codes.length) return [];
  const rows = await db.committee.findMany({
    where: { committeeCode: { in: codes }, children: { none: {} } },
    select: { committeeId: true, committeeCode: true, parent: { select: { committeeCode: true } } },
  });
  if (rows.length !== codes.length) return null;
  return rows.map(({ committeeId, committeeCode, parent }) => ({
    committeeId,
    committeeCode,
    isDeveloperCommittee: parent?.committeeCode === DEVELOPER_COMMITTEES_CODE,
  }));
}

export function approvalScopeFor(committee: ApplicableCommittee, requestedRole: string): ApprovalScope {
  if (requestedRole !== 'Leader' && requestedRole !== 'Co-Leader') return 'COMMITTEE';
  return committee.isDeveloperCommittee ? 'DEVELOPER_COMMITTEES' : 'CLUB';
}
