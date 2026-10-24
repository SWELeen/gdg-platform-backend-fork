import { ConflictException, ForbiddenException } from '@nestjs/common';
import { MembershipCommitteeDecision as Decision } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { MembershipRequestService } from './membership-request.service.js';

const findUniqueCommittee = vi.fn();
const hasCommitteePermission = vi.fn();
const hasGlobalPermission = vi.fn();
const tx: Record<string, any> = {};
const prisma = {
  committee: { findUnique: findUniqueCommittee },
  $transaction: vi.fn((callback: (arg: typeof tx) => unknown) => callback(tx)),
} as unknown as PrismaService;
const access = { hasCommitteePermission, hasGlobalPermission } as unknown as CommitteeAccessService;
const service = new MembershipRequestService(prisma, access);
const actor = { personId: 8, memberId: 17 };

beforeEach(() => {
  vi.clearAllMocks();
  hasCommitteePermission.mockResolvedValue(true);
  hasGlobalPermission.mockResolvedValue(true);
  findUniqueCommittee.mockResolvedValue({ committeeId: 3 });
  tx.$queryRaw = vi.fn().mockResolvedValue([{ membership_request_id: 40 }]);
  tx.membershipRequestCommittee = {
    findFirst: vi.fn().mockResolvedValue({
      membershipRequestCommitteeId: 400,
      membershipRequestId: 40,
      committeeId: 3,
      status: Decision.PENDING,
      requestedRole: 'Member',
      approvalScope: 'COMMITTEE',
    }),
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([
      { status: Decision.APPROVED },
      { status: Decision.PENDING },
    ]),
  };
  tx.membershipRequest = {
    findUniqueOrThrow: vi.fn()
      .mockResolvedValueOnce({ personId: 61 })
      .mockResolvedValueOnce({
        membershipRequestId: 40,
        personId: 61,
        status: 'PENDING',
        applicationData: { university: 'Example University' },
        createdAt: new Date('2026-10-24T00:00:00Z'),
        person: { fullName: 'Noura', emailPersonal: 'noura@example.test', emailUniversity: null },
        committees: [
          { committeeId: 3, status: Decision.APPROVED, requestedRole: 'Leader', decidedAt: new Date(), committee: { committeeCode: 'DATA', committeeName: 'Data' } },
          { committeeId: 4, status: Decision.PENDING, requestedRole: 'Member', decidedAt: null, committee: { committeeCode: 'PR', committeeName: 'Public Relations' } },
        ],
      }),
    update: vi.fn().mockResolvedValue({}),
  };
  tx.membershipRequestGlobalRole = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  };
  tx.member = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ memberId: 99, isActive: true }),
  };
  tx.memberCommittee = { upsert: vi.fn().mockResolvedValue({}) };
  tx.memberRole = { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) };
});

describe('MembershipRequestService.decide', () => {
  it('changes only the selected committee, grants Member role, and keeps aggregate pending', async () => {
    const result = await service.decide(40, 'DATA', 'APPROVED', actor);

    expect(hasCommitteePermission).toHaveBeenCalledWith(17, 'applications.decide', 'DATA');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.memberCommittee.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId_committeeId: { memberId: 99, committeeId: 3 } },
      create: { memberId: 99, committeeId: 3, role: 'Member' },
      update: {},
    }));
    expect(tx.membershipRequestCommittee.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { membershipRequestCommitteeId: 400 },
      data: expect.objectContaining({ status: 'APPROVED', decidedByMemberId: 17 }),
    }));
    expect(tx.membershipRequest.update).toHaveBeenCalledWith({
      where: { membershipRequestId: 40 },
      data: { status: 'PENDING' },
    });
    expect(result).toMatchObject({
      status: 'PENDING',
      committeeDecision: { committeeCode: 'DATA', status: 'APPROVED' },
      committees: [
        { code: 'DATA', status: 'APPROVED' },
        { code: 'PR', status: 'PENDING' },
      ],
    });
  });

  it('returns 403 before reading a request if the actor cannot decide for that committee', async () => {
    hasCommitteePermission.mockResolvedValue(false);

    await expect(service.decide(40, 'PR', 'REJECTED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate decision with 409 and leaves the decision unchanged', async () => {
    tx.membershipRequestCommittee.findFirst.mockResolvedValueOnce({
      membershipRequestCommitteeId: 400,
      status: Decision.REJECTED,
      requestedRole: 'Member',
      approvalScope: 'COMMITTEE',
    });

    await expect(service.decide(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.membershipRequestCommittee.update).not.toHaveBeenCalled();
  });

  it('does not let committee review decide a leadership application', async () => {
    tx.membershipRequestCommittee.findFirst.mockResolvedValueOnce({
      membershipRequestCommitteeId: 400,
      approvalScope: 'DEVELOPER_COMMITTEES',
      status: Decision.PENDING,
      requestedRole: 'Leader',
    });
    await expect(service.decide(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.memberCommittee.upsert).not.toHaveBeenCalled();
  });

  it('prevents a request owner from approving their own leadership position', async () => {
    tx.membershipRequestCommittee.findUnique.mockResolvedValue({
      membershipRequestCommitteeId: 400,
      membershipRequestId: 40,
      approvalScope: 'DEVELOPER_COMMITTEES',
      status: Decision.PENDING,
      requestedRole: 'Leader',
      membershipRequest: { personId: actor.personId },
    });
    await expect(service.decideLeadershipCommittee(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.developer_leaders.decide');
    expect(tx.memberCommittee.upsert).not.toHaveBeenCalled();
  });

  it('grants an individual committee leader role only after the developer-tier approval', async () => {
    tx.membershipRequestCommittee.findUnique.mockResolvedValue({
      membershipRequestCommitteeId: 400,
      membershipRequestId: 40,
      committeeId: 3,
      approvalScope: 'DEVELOPER_COMMITTEES',
      status: Decision.PENDING,
      requestedRole: 'Leader',
      membershipRequest: { personId: 61 },
    });
    await service.decideLeadershipCommittee(40, 'DATA', 'APPROVED', actor);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.developer_leaders.decide');
    expect(tx.memberCommittee.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { memberId: 99, committeeId: 3, role: 'Leader' },
      update: { role: 'Leader' },
    }));
  });

  it('assigns a requested global role only after club-leadership approval', async () => {
    tx.membershipRequestGlobalRole.findUnique.mockResolvedValue({
      membershipRequestGlobalRoleId: 700,
      membershipRequestId: 40,
      roleCode: 'ADVISOR',
      status: Decision.PENDING,
      membershipRequest: { personId: 61 },
    });
    await service.decideGlobalRole(40, 'ADVISOR', 'APPROVED', actor);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.club_leaders.decide');
    expect(tx.memberRole.create).toHaveBeenCalledWith({ data: { memberId: 99, roleCode: 'ADVISOR', assignedBy: actor.memberId } });
    expect(tx.membershipRequestGlobalRole.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', decidedByMemberId: actor.memberId }) }));
  });

  it('does not let developer leaders approve a club-only global role', async () => {
    hasGlobalPermission.mockResolvedValue(false);
    await expect(service.decideGlobalRole(40, 'DEVELOPER_COMMITTEES_LEADER', 'APPROVED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.club_leaders.decide');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
