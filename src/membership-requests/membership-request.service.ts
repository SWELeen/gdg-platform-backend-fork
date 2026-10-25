import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipCommitteeDecision,
  MembershipRequestStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/current-user.js';
import {
  CommitteeAccessService,
} from '../registrations/committee-access.service.js';
import type {
  CreateMembershipRequestDto,
  DecideMembershipRequestDto,
} from './membership-request.dto.js';

export const APPLICATIONS_DECIDE = 'applications.decide';

const requestInclude = {
  person: {
    select: {
      fullName: true,
      emailPersonal: true,
      emailUniversity: true,
    },
  },
  committees: {
    include: { committee: { select: { committeeCode: true, committeeName: true } } },
    orderBy: { committeeId: 'asc' as const },
  },
  globalRoles: { include: { role: { select: { roleCode: true, description: true } } } },
} as const;

@Injectable()
export class MembershipRequestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService) private readonly access: CommitteeAccessService,
  ) {}

  async create(user: AuthenticatedUser, body: CreateMembershipRequestDto) {
    const person = await this.prisma.person.findUnique({
      where: { personId: user.personId },
      select: { emailPersonalVerifiedAt: true, emailUniversity: true, emailUniversityVerifiedAt: true },
    });
    if (!person?.emailPersonalVerifiedAt || (person.emailUniversity && !person.emailUniversityVerifiedAt)) {
      throw new ForbiddenException('Verify every registered email before submitting a membership request.');
    }
    if ((body.applicationData.universityEmail?.toLowerCase() ?? null) !== (person.emailUniversity?.toLowerCase() ?? null)) {
      throw new ForbiddenException('The application must use the verified university email on the account.');
    }
    const committeeCodes = body.committees.map(({ committeeCode }) => committeeCode);
    const committees = await this.prisma.committee.findMany({
      where: { committeeCode: { in: committeeCodes } },
      select: { committeeId: true, committeeCode: true },
    });
    if (committees.length !== new Set(committeeCodes).size) {
      throw new NotFoundException('One or more selected committees are unavailable.');
    }

    const existing = await this.prisma.membershipRequest.findUnique({
      where: { personId: user.personId },
      include: requestInclude,
    });
    if (existing) return this.serialize(existing);

    const applicationData = JSON.parse(JSON.stringify(body.applicationData));
    try {
      const request = await this.prisma.membershipRequest.create({
        data: {
          personId: user.personId,
          applicationData,
          committees: {
            create: body.committees.map((item) => ({
              committeeId: committees.find((c) => c.committeeCode === item.committeeCode)!.committeeId,
              requestedRole: item.requestedRole,
              approvalScope: ['Leader', 'Co-Leader'].includes(item.requestedRole)
                ? (['AUTOMATION', 'DATA', 'WEB', 'AI', 'ROBOTICS', 'CYBER'].includes(item.committeeCode) ? 'DEVELOPER_COMMITTEES' : 'CLUB')
                : 'COMMITTEE',
            })),
          },
        },
        include: requestInclude,
      });
      return this.serialize(request);
    } catch (error) {
      // Concurrent duplicate submissions are treated as idempotent.
      const raced = await this.prisma.membershipRequest.findUnique({
        where: { personId: user.personId },
        include: requestInclude,
      });
      if (raced) return this.serialize(raced);
      throw error;
    }
  }

  async list(committeeCode: string, actorMemberId: number) {
    await this.assertCanDecide(actorMemberId, committeeCode);
    const committee = await this.prisma.committee.findUnique({
      where: { committeeCode },
      select: { committeeId: true },
    });
    if (!committee) throw new NotFoundException('Committee not found.');

    const rows = await this.prisma.membershipRequestCommittee.findMany({
      where: { committeeId: committee.committeeId, approvalScope: 'COMMITTEE', requestedRole: 'Member' },
      orderBy: [
        { status: 'asc' },
        { membershipRequest: { createdAt: 'asc' } },
        { membershipRequestCommitteeId: 'asc' },
      ],
      include: {
        membershipRequest: { include: requestInclude },
      },
    });
    return rows.map((row) => ({
      ...this.serialize(row.membershipRequest),
      committeeDecision: {
        committeeCode,
        status: row.status,
        requestedRole: row.requestedRole,
        decidedAt: row.decidedAt,
      },
    }));
  }

  async decide(
    requestId: number,
    committeeCode: string,
    decision: DecideMembershipRequestDto['decision'],
    actor: AuthenticatedUser,
  ) {
    const actorMemberId = actor.memberId;
    if (!actorMemberId) throw new ForbiddenException();
    await this.assertCanDecide(actorMemberId, committeeCode);

    const committee = await this.prisma.committee.findUnique({
      where: { committeeCode },
      select: { committeeId: true },
    });
    if (!committee) throw new NotFoundException('Committee not found.');

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ membership_request_id: number }[]>`
        SELECT membership_request_id FROM membership_request
        WHERE membership_request_id = ${requestId}
        FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Membership request not found.');

      const application = await tx.membershipRequestCommittee.findFirst({
        where: { membershipRequestId: requestId, committeeId: committee.committeeId },
      });
      if (!application) throw new NotFoundException('Membership request not found.');
      if (application.approvalScope !== 'COMMITTEE' || application.requestedRole !== 'Member') throw new ForbiddenException('Leadership applications require the leadership approval route.');
      const requestOwner = await tx.membershipRequest.findUniqueOrThrow({ where: { membershipRequestId: requestId }, select: { personId: true } });
      if (requestOwner.personId === actor.personId) throw new ForbiddenException('You cannot approve your own request.');
      if (application.status !== MembershipCommitteeDecision.PENDING) {
        throw new ConflictException('This committee has already decided this request.');
      }

      if (decision === MembershipCommitteeDecision.APPROVED) {
        const member = await this.getOrCreateActiveMember(tx, requestOwner.personId);
        // The selected role is only a preference. Never promote an applicant
        // into a privileged committee position through this decision endpoint.
        await tx.memberCommittee.upsert({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
          create: { memberId: member.memberId, committeeId: committee.committeeId, role: 'Member' },
          update: {},
        });
      }

      await tx.membershipRequestCommittee.update({
        where: { membershipRequestCommitteeId: application.membershipRequestCommitteeId },
        data: {
          status: decision,
          decidedByMemberId: actorMemberId,
          decidedAt: new Date(),
        },
      });

      await this.refreshAggregateStatus(tx, requestId);

      const updated = await tx.membershipRequest.findUniqueOrThrow({
        where: { membershipRequestId: requestId },
        include: requestInclude,
      });
      const ownDecision = updated.committees.find((row) => row.committeeId === committee.committeeId)!;
      return {
        ...this.serialize(updated),
        committeeDecision: {
          committeeCode,
          status: ownDecision.status,
          requestedRole: ownDecision.requestedRole,
          decidedAt: ownDecision.decidedAt,
        },
      };
    });
  }

  async listLeadership(scope: 'CLUB' | 'DEVELOPER_COMMITTEES', actor: AuthenticatedUser) {
    if (!actor.memberId) throw new ForbiddenException();
    await this.assertLeadershipPermission(actor.memberId, scope);
    const rows = await this.prisma.membershipRequestCommittee.findMany({
      where: { status: MembershipCommitteeDecision.PENDING, approvalScope: scope, requestedRole: { in: ['Leader', 'Co-Leader'] } },
      orderBy: { membershipRequest: { createdAt: 'asc' } },
      include: { membershipRequest: { include: requestInclude }, committee: { select: { committeeCode: true, committeeName: true } } },
    });
    const globalRoleRows = scope === 'CLUB'
      ? await this.prisma.membershipRequestGlobalRole.findMany({
          where: { status: MembershipCommitteeDecision.PENDING },
          orderBy: { membershipRequest: { createdAt: 'asc' } },
          include: { membershipRequest: { include: requestInclude }, role: { select: { roleCode: true, description: true } } },
        })
      : [];
    return [
      ...rows.map((row) => ({ type: 'COMMITTEE_LEADERSHIP', ...this.serialize(row.membershipRequest), committee: row.committee, requestedRole: row.requestedRole, decisionStatus: row.status })),
      ...globalRoleRows.map((row) => ({ type: 'GLOBAL_ROLE', ...this.serialize(row.membershipRequest), role: row.role, decisionStatus: row.status })),
    ].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  }

  async decideLeadershipCommittee(requestId: number, committeeCode: string, decision: DecideMembershipRequestDto['decision'], actor: AuthenticatedUser) {
    if (!actor.memberId) throw new ForbiddenException();
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode }, select: { committeeId: true } });
    if (!committee) throw new NotFoundException('Committee not found.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT membership_request_id FROM membership_request WHERE membership_request_id = ${requestId} FOR UPDATE`;
      const row = await tx.membershipRequestCommittee.findUnique({
        where: { membershipRequestId_committeeId: { membershipRequestId: requestId, committeeId: committee.committeeId } },
        include: { membershipRequest: { select: { personId: true } } },
      });
      if (!row || row.approvalScope === 'COMMITTEE' || !['Leader', 'Co-Leader'].includes(row.requestedRole)) throw new NotFoundException('Leadership request not found.');
      await this.assertLeadershipPermission(actor.memberId!, row.approvalScope as 'CLUB' | 'DEVELOPER_COMMITTEES');
      if (row.membershipRequest.personId === actor.personId) throw new ForbiddenException('You cannot approve your own request.');
      if (row.status !== MembershipCommitteeDecision.PENDING) throw new ConflictException('This request has already been decided.');
      if (decision === MembershipCommitteeDecision.APPROVED) {
        const member = await this.getOrCreateActiveMember(tx, row.membershipRequest.personId);
        await tx.memberCommittee.upsert({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
          create: { memberId: member.memberId, committeeId: committee.committeeId, role: row.requestedRole },
          update: { role: row.requestedRole },
        });
      }
      await tx.membershipRequestCommittee.update({ where: { membershipRequestCommitteeId: row.membershipRequestCommitteeId }, data: { status: decision, decidedByMemberId: actor.memberId, decidedAt: new Date() } });
      await this.refreshAggregateStatus(tx, requestId);
      return { id: row.membershipRequestId, committeeCode, decision };
    });
  }

  async decideGlobalRole(requestId: number, roleCode: string, decision: DecideMembershipRequestDto['decision'], actor: AuthenticatedUser) {
    if (!actor.memberId) throw new ForbiddenException();
    await this.assertLeadershipPermission(actor.memberId, 'CLUB');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT membership_request_id FROM membership_request WHERE membership_request_id = ${requestId} FOR UPDATE`;
      const row = await tx.membershipRequestGlobalRole.findUnique({
        where: { membershipRequestId_roleCode: { membershipRequestId: requestId, roleCode } },
        include: { membershipRequest: { select: { personId: true } } },
      });
      if (!row) throw new NotFoundException('Leadership request not found.');
      if (row.membershipRequest.personId === actor.personId) throw new ForbiddenException('You cannot approve your own request.');
      if (row.status !== MembershipCommitteeDecision.PENDING) throw new ConflictException('This request has already been decided.');
      if (decision === MembershipCommitteeDecision.APPROVED) {
        const member = await this.getOrCreateActiveMember(tx, row.membershipRequest.personId);
        const existing = await tx.memberRole.findFirst({ where: { memberId: member.memberId, roleCode, endsOn: null } });
        if (!existing) await tx.memberRole.create({ data: { memberId: member.memberId, roleCode, assignedBy: actor.memberId } });
      }
      await tx.membershipRequestGlobalRole.update({ where: { membershipRequestGlobalRoleId: row.membershipRequestGlobalRoleId }, data: { status: decision, decidedByMemberId: actor.memberId, decidedAt: new Date() } });
      await this.refreshAggregateStatus(tx, requestId);
      return { id: row.membershipRequestId, roleCode, decision };
    });
  }

  private async assertCanDecide(memberId: number, committeeCode: string) {
    if (!(await this.access.hasCommitteePermission(memberId, APPLICATIONS_DECIDE, committeeCode))) {
      throw new ForbiddenException();
    }
  }

  private async getOrCreateActiveMember(tx: Prisma.TransactionClient, personId: number) {
    const member = await tx.member.findUnique({ where: { personId } })
      ?? await tx.member.create({ data: { personId } });
    if (!member.isActive) {
      throw new ConflictException('The member account must be reactivated before approval.');
    }
    return member;
  }

  private async assertLeadershipPermission(memberId: number, scope: 'CLUB' | 'DEVELOPER_COMMITTEES') {
    const permission = scope === 'CLUB' ? 'applications.club_leaders.decide' : 'applications.developer_leaders.decide';
    if (!(await this.access.hasGlobalPermission(memberId, permission))) throw new ForbiddenException();
  }

  private async refreshAggregateStatus(tx: Prisma.TransactionClient, requestId: number) {
    const [committees, roles] = await Promise.all([
      tx.membershipRequestCommittee.findMany({ where: { membershipRequestId: requestId }, select: { status: true } }),
      tx.membershipRequestGlobalRole.findMany({ where: { membershipRequestId: requestId }, select: { status: true } }),
    ]);
    const decisions = [...committees, ...roles];
    const status = decisions.some((item) => item.status === MembershipCommitteeDecision.PENDING)
      ? MembershipRequestStatus.PENDING
      : decisions.some((item) => item.status === MembershipCommitteeDecision.APPROVED)
        ? MembershipRequestStatus.APPROVED : MembershipRequestStatus.REJECTED;
    await tx.membershipRequest.update({ where: { membershipRequestId: requestId }, data: { status } });
  }

  private serialize(request: {
    membershipRequestId: number;
    personId: number;
    status: MembershipRequestStatus;
    applicationData: unknown;
    createdAt: Date;
    person: { fullName: string; emailPersonal: string | null; emailUniversity: string | null };
    committees: Array<{
      status: MembershipCommitteeDecision;
      requestedRole: string;
      decidedAt: Date | null;
      committee: { committeeCode: string; committeeName: string };
    }>;
  }) {
    return {
      id: request.membershipRequestId,
      status: request.status,
      submittedAt: request.createdAt,
      applicant: {
        fullName: request.person.fullName,
        email: request.person.emailPersonal ?? request.person.emailUniversity,
        universityEmail: request.person.emailUniversity,
        details: request.applicationData,
      },
      committees: request.committees.map((item) => ({
        code: item.committee.committeeCode,
        name: item.committee.committeeName,
        status: item.status,
        requestedRole: item.requestedRole,
        decidedAt: item.decidedAt,
      })),
    };
  }
}
