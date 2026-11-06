import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import type { MembershipRequestEmailService } from '../membership-requests/membership-request-email.service.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

const actor = { personId: 10, memberId: 20 };
const person = {
  personId: 50,
  fullName: 'Existing Account',
  emailPersonal: 'existing@example.test',
  emailUniversity: null,
  authUserId: 'auth-user-50',
  isActive: true,
};

function setup() {
  const emailService = { sendDecisionEmail: vi.fn().mockResolvedValue(undefined) };
  const tx = {
    person: {
      findFirst: vi.fn().mockResolvedValue({ ...person, member: { memberId: 70, isActive: true, roleAssignments: [] } }),
      findMany: vi.fn().mockResolvedValue([{ ...person, member: { memberId: 70, isActive: true, roleAssignments: [] } }]),
    },
    member: { update: vi.fn().mockResolvedValue({ memberId: 70, isActive: false }) },
    memberRole: {
      findFirst: vi.fn().mockResolvedValue({ id: 5 }),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    memberCommittee: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ role: 'Member' }),
      delete: vi.fn().mockResolvedValue({ id: 123 }),
    },
    committee: { findFirst: vi.fn().mockResolvedValue({ committeeId: 3, committeeCode: 'PR', committeeName: 'Public Relations' }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    committee: {
      findUnique: vi.fn().mockResolvedValue({ committeeId: 3, committeeCode: 'PR', committeeName: 'Public Relations' }),
    },
    memberCommittee: { findUnique: vi.fn().mockResolvedValue({ memberId: actor.memberId, role: 'Co-Leader', member: { isActive: true, person: { isActive: true } } }) },
  };
  const access = {
    hasGlobalPermission: vi.fn().mockResolvedValue(true),
    hasCommitteePermission: vi.fn().mockResolvedValue(true),
  };
  const service = new CommitteeDashboardService(
    prisma as unknown as PrismaService,
    access as unknown as CommitteeAccessService,
    undefined,
    emailService as unknown as MembershipRequestEmailService,
  );
  return { service, tx, prisma, access, emailService };
}

describe('direct member assignment notifications', () => {
  it('sends the existing approval email after a committee leader adds an account', async () => {
    const { service, emailService } = setup();
    await service.addMember(actor, 'PR', { email: person.emailPersonal! });
    await vi.waitFor(() => expect(emailService.sendDecisionEmail).toHaveBeenCalledWith({
      to: person.emailPersonal,
      recipientName: person.fullName,
      decision: 'APPROVED',
      committeeName: 'Public Relations',
      roleName: 'Member',
    }));
  });

  it('sends the approval email when group leadership directly assigns a committee role', async () => {
    const { service, tx, emailService } = setup();
    tx.committee.findFirst.mockResolvedValue({ committeeId: 3, committeeCode: 'PR', committeeName: 'Public Relations' });
    tx.memberCommittee.create.mockResolvedValue({ role: 'Co-Leader' });
    await service.assignClubPerson(actor, {
      email: person.emailPersonal!,
      committeeCode: 'PR',
      role: 'Co-Leader',
    });
    await vi.waitFor(() => expect(emailService.sendDecisionEmail).toHaveBeenCalledWith({
      to: person.emailPersonal,
      recipientName: person.fullName,
      decision: 'APPROVED',
      committeeName: 'Public Relations',
      roleName: 'Co-Leader',
    }));
  });

  it('sends the approval email when the overall Developer Committees Leader assigns a role', async () => {
    const { service, prisma, tx, emailService } = setup();
    vi.mocked(prisma.committee.findUnique).mockResolvedValue({
      committeeId: 6,
      committeeCode: 'DATA',
      committeeName: 'Data Analysis',
      parent: { committeeCode: 'DEV' },
    } as any);
    tx.memberCommittee.create.mockResolvedValue({ role: 'Leader' });
    await service.assignDeveloperCommitteeMember(actor, {
      email: person.emailPersonal!,
      committeeCode: 'DATA',
      role: 'Leader',
    });
    await vi.waitFor(() => expect(emailService.sendDecisionEmail).toHaveBeenCalledWith({
      to: person.emailPersonal,
      recipientName: person.fullName,
      decision: 'APPROVED',
      committeeName: 'Data Analysis',
      roleName: 'Leader',
    }));
  });
});

describe('club member removal', () => {
  it('requires the group member-management permission', async () => {
    const { service, access, prisma } = setup();
    vi.mocked(access.hasGlobalPermission).mockResolvedValue(false);
    await expect(service.removeClubPerson(actor, { email: person.emailPersonal! })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deactivates membership and ends active roles while retaining account records', async () => {
    const { service, tx } = setup();
    const result = await service.removeClubPerson(actor, { email: person.emailPersonal! });
    expect(tx.member.update).toHaveBeenCalledWith({ where: { memberId: 70 }, data: { isActive: false } });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(result).toMatchObject({ memberId: '70', membershipRemoved: true });
  });

  it('removes only the selected committee membership without deactivating the group account', async () => {
    const { service, tx } = setup();
    tx.committee.findFirst.mockResolvedValue({ committeeId: 3, committeeCode: 'PR', committeeName: 'Public Relations' });
    tx.memberCommittee.findUnique.mockResolvedValue({ id: 123, role: 'Co-Leader' });
    const result = await service.removeClubPerson(actor, { email: person.emailPersonal!, committeeCode: 'PR' });
    expect(tx.memberCommittee.delete).toHaveBeenCalledWith({ where: { id: 123 } });
    expect(tx.member.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ committee: { code: 'PR', role: 'Co-Leader' }, committeeMembershipRemoved: true, membershipRemoved: false });
  });

  it('revokes only the selected advisor role and keeps the account active', async () => {
    const { service, tx } = setup();
    const result = await service.removeClubPerson(actor, { email: person.emailPersonal!, committeeCode: 'ADVISOR' });
    expect(tx.memberRole.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ memberId: 70, roleCode: 'ADVISOR', AND: expect.any(Array) }),
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.memberCommittee.delete).not.toHaveBeenCalled();
    expect(tx.member.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ globalRole: 'ADVISOR', globalRoleRemoved: true, membershipRemoved: false });
  });

  it('does not remove the last active group leader', async () => {
    const { service, tx } = setup();
    tx.person.findMany.mockResolvedValue([{
      ...person,
      member: { memberId: 70, isActive: true, roleAssignments: [{ roleCode: 'GROUP_LEADER' }] },
    }]);
    await expect(service.removeClubPerson(actor, { email: person.emailPersonal! })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.member.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
