import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { schemaTestTarget } from './schema-test-target.js';

type Tx = Prisma.TransactionClient;
type Patch = Record<string, string | number | boolean | Date | null>;
const approved = new Date('2030-01-01T10:00:00Z');
const deadline = new Date('2030-01-01T12:00:00Z');
const confirmed = new Date('2030-01-01T11:00:00Z');
const cancelled = new Date('2030-01-01T11:30:00Z');
const approval = { approved_at: approved, confirmation_deadline: deadline };
const confirmation = {
  ...approval,
  confirmed_at: confirmed,
  attendance_token_hash: 'synthetic-hash',
  attendance_token_encrypted: 'synthetic-ciphertext',
};
const excuse = {
  excused_at: cancelled,
  excused_by_member_id: 0,
  excuse_reason: 'Documented excuse',
};
const rollback = new Error('rollback successful fixture');
const approvedSkills: { skill_id: number; skill_name: string }[] = JSON.parse(
  readFileSync(
    new URL('./fixtures/approved-skills.json', import.meta.url),
    'utf8',
  ),
);

// Normal app e2e runs do not connect to a schema target unless explicitly supplied.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'PostgreSQL schema integrity',
  () => {
    let db: PrismaClient;

    beforeAll(async () => {
      const connectionString = schemaTestTarget(
        process.env.TEST_DATABASE_URL,
        process.env.DATABASE_URL,
      );
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString,
          max: 4,
          connectionTimeoutMillis: 5000,
        }),
      });
      await db.$connect();
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    async function fixture(tx: Tx) {
      const code = randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase();
      const person = await tx.person.create({
        data: {
          fullName: 'Synthetic participant',
          emailPersonal: `${code}@example.test`,
        },
      });
      const actorPerson = await tx.person.create({
        data: { fullName: 'Synthetic staff' },
      });
      const member = await tx.member.create({
        data: { personId: actorPerson.personId },
      });
      const committee = await tx.committee.create({
        data: { committeeCode: code, committeeName: code },
      });
      const event = await tx.event.create({
        data: {
          name: 'Synthetic event',
          capacity: 1,
          startsAt: new Date('2030-01-02T10:00:00Z'),
          endsAt: new Date('2030-01-02T12:00:00Z'),
          registrationDeadline: deadline,
          createdByMemberId: member.memberId,
          committeeId: committee.committeeId,
        },
      });
      const question = await tx.eventQuestion.create({
        data: {
          eventId: event.eventId,
          questionText: 'Why attend?',
          questionType: 'TEXT',
          position: 0,
        },
      });
      const registration = await tx.eventRegistration.create({
        data: { eventId: event.eventId, personId: person.personId },
      });
      return {
        person,
        actorPerson,
        member,
        committee,
        event,
        question,
        registration,
      };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;

    async function patch(
      tx: Tx,
      table: string,
      key: string,
      id: number,
      values: Patch,
    ) {
      const entries = Object.entries(values);
      // Identifiers come only from literal test cases; all values are parameters.
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET ${entries.map(([name], i) => `"${name}" = $${i + 1}`).join(', ')} WHERE "${key}" = $${entries.length + 1}`,
        ...entries.map(([, value]) => value),
        id,
      );
    }

    async function valid(action: (tx: Tx, f: Fixture) => Promise<void>) {
      try {
        await db.$transaction(async (tx) => {
          await action(tx, await fixture(tx));
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }

    async function invalid(
      action: (tx: Tx, f: Fixture) => Promise<void>,
      constraint: string,
    ) {
      await expect(
        db.$transaction(async (tx) => {
          await action(tx, await fixture(tx));
        }),
      ).rejects.toThrow(constraint);
    }

    it('includes exactly the three approved initial roles', async () => {
      expect(await db.role.findMany({ orderBy: { roleCode: 'asc' } })).toEqual([
        {
          roleCode: 'ADVISOR',
          description: 'Club advisor',
          isPrivileged: true,
        },
        {
          roleCode: 'GROUP_CO_LEADER',
          description: 'Club (group) co-leader',
          isPrivileged: true,
        },
        {
          roleCode: 'GROUP_LEADER',
          description: 'Club (group) leader',
          isPrivileged: true,
        },
      ]);
    });

    it('supports optional role descriptions and the database privilege default', async () => {
      await valid(async (tx) => {
        const [role] = await tx.$queryRaw<
          { description: string | null; is_privileged: boolean }[]
        >`
          INSERT INTO role(role_code) VALUES ('TEST_ROLE') RETURNING description, is_privileged`;
        expect(role).toEqual({ description: null, is_privileged: true });
        const ordinary = await tx.role.create({
          data: { roleCode: 'TEST_ORDINARY', isPrivileged: false },
        });
        expect(ordinary.isPrivileged).toBe(false);
      });
    });

    it.each(['', 'advisor', 'ROLE_1', '_ROLE', 'ROLE ADMIN'])(
      'rejects invalid role code %j',
      async (roleCode) => {
        await invalid(async (tx) => {
          await tx.$executeRaw`INSERT INTO role(role_code) VALUES (${roleCode})`;
        }, 'role_code_check');
      },
    );

    it('rejects duplicate role codes', async () => {
      await invalid(async (tx) => {
        await tx.$executeRaw`INSERT INTO role(role_code) VALUES ('ADVISOR')`;
      }, 'role_pkey');
    });

    it('keeps role-permission links valid and restricts deletion of referenced roles', async () => {
      await invalid(async (tx) => {
        const permission = await tx.permission.create({
          data: { permissionName: randomUUID() },
        });
        await tx.rolePermission.create({
          data: { roleCode: 'ADVISOR', permissionId: permission.permissionId },
        });
        await tx.$executeRaw`DELETE FROM role WHERE role_code = 'ADVISOR'`;
      }, 'role_permissions_role_code_fkey');
      await invalid(async (tx) => {
        const permission = await tx.permission.create({
          data: { permissionName: randomUUID() },
        });
        await tx.$executeRaw`INSERT INTO role_permissions(role_code, permission_id) VALUES ('MISSING_ROLE', ${permission.permissionId})`;
      }, 'role_permissions_role_code_fkey');
    });

    it('contains exactly the 32 approved production skill definitions', async () => {
      const rows =
        await db.$queryRaw`SELECT skill_id, skill_name FROM skill ORDER BY skill_id`;
      expect(rows).toEqual(approvedSkills);
      expect(approvedSkills).toHaveLength(32);
    });

    it('generates new skill IDs from 1000 and permits explicit IDs', async () => {
      await valid(async (tx) => {
        const [row] = await tx.$queryRaw<{ skill_id: number }[]>`
          INSERT INTO skill(skill_name) VALUES ('Synthetic skill') RETURNING skill_id`;
        expect(row.skill_id).toBeGreaterThanOrEqual(1000);
        const explicit = await tx.skill.create({
          data: { skillId: -100, skillName: 'x'.repeat(255) },
        });
        expect(explicit.skillId).toBe(-100);
        expect(explicit.skillName).toHaveLength(255);
        const [identity] = await tx.$queryRaw<
          { identity_start: string; identity_generation: string }[]
        >`
          SELECT identity_start, identity_generation FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'skill' AND column_name = 'skill_id'`;
        expect(identity).toEqual({
          identity_start: '1000',
          identity_generation: 'BY DEFAULT',
        });
      });
    });

    it('rejects duplicate skill names on insert and update', async () => {
      await invalid(async (tx) => {
        await tx.$executeRaw`INSERT INTO skill(skill_name) VALUES (${approvedSkills[0].skill_name})`;
      }, 'skill_skill_name_key');
      await invalid(async (tx) => {
        const skill = await tx.skill.create({
          data: { skillName: 'Synthetic skill rename' },
        });
        await tx.$executeRaw`UPDATE skill SET skill_name = ${approvedSkills[0].skill_name} WHERE skill_id = ${skill.skillId}`;
      }, 'skill_skill_name_key');
    });

    it('rejects duplicate skill IDs', async () => {
      await invalid(async (tx) => {
        await tx.$executeRaw`INSERT INTO skill(skill_id, skill_name) VALUES (1, 'Synthetic duplicate ID')`;
      }, 'skill_pkey');
    });

    it('requires skill names and enforces their 255-character limit', async () => {
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`INSERT INTO skill(skill_name) VALUES (NULL)`;
        }),
      ).rejects.toThrow(/23502|not-null/);
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`INSERT INTO skill(skill_name) VALUES (${'x'.repeat(256)})`;
        }),
      ).rejects.toThrow(/22001|character varying\(255\)/);
    });

    it('starts without any member-skill links', async () => {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM member_skill`;
      expect(row.count).toBe(0n);
    });

    it('supports multiple skills per member and multiple members per skill with generated and explicit link IDs', async () => {
      await valid(async (tx, f) => {
        const other = await fixture(tx);
        const [link] = await tx.$queryRaw<{ id: number }[]>`
          INSERT INTO member_skill(member_id, skill_id) VALUES (${f.member.memberId}, 1) RETURNING id`;
        expect(link.id).toBeGreaterThan(0);
        await tx.memberSkill.create({
          data: { id: -100, memberId: f.member.memberId, skillId: 2 },
        });
        await tx.memberSkill.create({
          data: { memberId: other.member.memberId, skillId: 1 },
        });
        const member = await tx.member.findUniqueOrThrow({
          where: { memberId: f.member.memberId },
          include: {
            skills: { include: { skill: true }, orderBy: { skillId: 'asc' } },
          },
        });
        expect(member.skills.map((row) => row.skill.skillName)).toEqual(
          approvedSkills.slice(0, 2).map((row) => row.skill_name),
        );
        const skill = await tx.skill.findUniqueOrThrow({
          where: { skillId: 1 },
          include: {
            members: {
              include: { member: true },
              orderBy: { memberId: 'asc' },
            },
          },
        });
        expect(skill.members.map((row) => row.member.memberId)).toEqual(
          [f.member.memberId, other.member.memberId].sort((a, b) => a - b),
        );
        expect(await tx.memberSkill.count()).toBe(3);
      });
    });

    it('rejects duplicate member-skill pairs on insert and update', async () => {
      await invalid(async (tx, f) => {
        await tx.memberSkill.create({
          data: { memberId: f.member.memberId, skillId: 1 },
        });
        await tx.$executeRaw`INSERT INTO member_skill(member_id, skill_id) VALUES (${f.member.memberId}, 1)`;
      }, 'member_skill_member_id_skill_id_key');
      await invalid(async (tx, f) => {
        await tx.memberSkill.create({
          data: { memberId: f.member.memberId, skillId: 1 },
        });
        const other = await tx.memberSkill.create({
          data: { memberId: f.member.memberId, skillId: 2 },
        });
        await tx.$executeRaw`UPDATE member_skill SET skill_id = 1 WHERE id = ${other.id}`;
      }, 'member_skill_member_id_skill_id_key');
    });

    it('rejects missing member or skill references', async () => {
      await invalid(async (tx) => {
        await tx.$executeRaw`INSERT INTO member_skill(member_id, skill_id) VALUES (-1, 1)`;
      }, 'member_skill_member_id_fkey');
      await invalid(async (tx, f) => {
        await tx.$executeRaw`INSERT INTO member_skill(member_id, skill_id) VALUES (${f.member.memberId}, -1)`;
      }, 'member_skill_skill_id_fkey');
    });

    it('requires both member and skill references', async () => {
      await invalid(async (tx) => {
        await tx.$executeRaw`INSERT INTO member_skill(member_id, skill_id) VALUES (NULL, 1)`;
      }, 'member_id');
      await invalid(async (tx, f) => {
        await tx.$executeRaw`INSERT INTO member_skill(member_id, skill_id) VALUES (${f.member.memberId}, NULL)`;
      }, 'skill_id');
    });

    it('restricts deleting referenced members and skills', async () => {
      await invalid(async (tx) => {
        const person = await tx.person.create({
          data: { fullName: 'Synthetic skill owner' },
        });
        const member = await tx.member.create({
          data: { personId: person.personId },
        });
        await tx.memberSkill.create({
          data: { memberId: member.memberId, skillId: 1 },
        });
        await tx.$executeRaw`DELETE FROM member WHERE member_id = ${member.memberId}`;
      }, 'member_skill_member_id_fkey');
      await invalid(async (tx, f) => {
        await tx.memberSkill.create({
          data: { memberId: f.member.memberId, skillId: 1 },
        });
        await tx.$executeRaw`DELETE FROM skill WHERE skill_id = 1`;
      }, 'member_skill_skill_id_fkey');
    });

    it('allows removing a link without changing its member or skill', async () => {
      await valid(async (tx, f) => {
        const link = await tx.memberSkill.create({
          data: { memberId: f.member.memberId, skillId: 1 },
        });
        await tx.memberSkill.delete({ where: { id: link.id } });
        expect(
          await tx.member.findUnique({
            where: { memberId: f.member.memberId },
          }),
        ).not.toBeNull();
        expect(
          await tx.skill.findUnique({ where: { skillId: 1 } }),
        ).not.toBeNull();
        expect(await tx.memberSkill.count()).toBe(0);
      });
    });

    it('starts without any member-role assignments', async () => {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM member_role`;
      expect(row.count).toBe(0n);
    });

    it('creates member roles with raw database defaults and optional assignment details', async () => {
      await valid(async (tx, f) => {
        const [row] = await tx.$queryRaw<
          {
            id: number;
            member_id: number;
            role_code: string;
            starts_on: Date | null;
            ends_on: Date | null;
            assigned_by: number | null;
            notes: string | null;
            created_at: Date;
          }[]
        >`INSERT INTO member_role(member_id, role_code) VALUES (${f.member.memberId}, 'ADVISOR') RETURNING *`;
        expect(row).toMatchObject({
          member_id: f.member.memberId,
          role_code: 'ADVISOR',
          starts_on: null,
          ends_on: null,
          assigned_by: null,
          notes: null,
        });
        expect(row.id).toBeGreaterThan(0);
        expect(row.created_at).toBeInstanceOf(Date);
        const assigned = await tx.memberRole.create({
          data: {
            memberId: f.member.memberId,
            roleCode: 'GROUP_LEADER',
            assignedBy: f.member.memberId,
            startsOn: new Date('2030-01-01'),
            endsOn: new Date('2030-01-01'),
            notes: 'x'.repeat(500),
          },
          include: { member: true, role: true, assigner: true },
        });
        expect(assigned.member.memberId).toBe(f.member.memberId);
        expect(assigned.role.roleCode).toBe('GROUP_LEADER');
        expect(assigned.assigner?.memberId).toBe(f.member.memberId);
        expect(assigned.notes).toHaveLength(500);
      });
    });

    it('allows multiple roles, other members, repeated ended history and one open assignment', async () => {
      await valid(async (tx, f) => {
        const other = await fixture(tx);
        await tx.memberRole.createMany({
          data: [
            {
              memberId: f.member.memberId,
              roleCode: 'ADVISOR',
              endsOn: new Date('2029-01-01'),
            },
            {
              memberId: f.member.memberId,
              roleCode: 'ADVISOR',
              endsOn: new Date('2029-01-01'),
            },
            {
              memberId: f.member.memberId,
              roleCode: 'ADVISOR',
              startsOn: new Date('2031-01-01'),
            },
            { memberId: f.member.memberId, roleCode: 'GROUP_LEADER' },
            { memberId: other.member.memberId, roleCode: 'ADVISOR' },
          ],
        });
        expect(await tx.memberRole.count()).toBe(5);
      });
    });

    it('rejects duplicate open roles and reopening history while an open assignment exists', async () => {
      await invalid(async (tx, f) => {
        await tx.memberRole.create({
          data: { memberId: f.member.memberId, roleCode: 'ADVISOR' },
        });
        await tx.$executeRaw`INSERT INTO member_role(member_id, role_code) VALUES (${f.member.memberId}, 'ADVISOR')`;
      }, 'uq_member_role_active');
      await invalid(async (tx, f) => {
        await tx.memberRole.create({
          data: { memberId: f.member.memberId, roleCode: 'ADVISOR' },
        });
        const ended = await tx.memberRole.create({
          data: {
            memberId: f.member.memberId,
            roleCode: 'ADVISOR',
            endsOn: new Date('2029-01-01'),
          },
        });
        await tx.$executeRaw`UPDATE member_role SET ends_on = NULL WHERE id = ${ended.id}`;
      }, 'uq_member_role_active');
    });

    it('allows a new open assignment after closing the previous one', async () => {
      await valid(async (tx, f) => {
        const old = await tx.memberRole.create({
          data: { memberId: f.member.memberId, roleCode: 'ADVISOR' },
        });
        await tx.memberRole.update({
          where: { id: old.id },
          data: { endsOn: new Date('2030-01-01') },
        });
        await tx.memberRole.create({
          data: { memberId: f.member.memberId, roleCode: 'ADVISOR' },
        });
        expect(await tx.memberRole.count()).toBe(2);
      });
    });

    it('rejects member-role dates ending before their start on insert and update', async () => {
      await invalid(async (tx, f) => {
        await tx.$executeRaw`INSERT INTO member_role(member_id, role_code, starts_on, ends_on) VALUES (${f.member.memberId}, 'ADVISOR', DATE '2030-02-01', DATE '2030-01-01')`;
      }, 'member_role_dates_check');
      await invalid(async (tx, f) => {
        const row = await tx.memberRole.create({
          data: {
            memberId: f.member.memberId,
            roleCode: 'ADVISOR',
            startsOn: new Date('2030-02-01'),
          },
        });
        await tx.$executeRaw`UPDATE member_role SET ends_on = DATE '2030-01-01' WHERE id = ${row.id}`;
      }, 'member_role_dates_check');
    });

    it('limits assignment notes to 500 characters', async () => {
      await expect(
        db.$transaction(async (tx) => {
          const f = await fixture(tx);
          await tx.$executeRaw`INSERT INTO member_role(member_id, role_code, notes) VALUES (${f.member.memberId}, 'ADVISOR', ${'x'.repeat(501)})`;
        }),
      ).rejects.toThrow(/22001|character varying\(500\)/);
    });

    it('rejects missing members, roles and assigning members', async () => {
      await invalid(async (tx) => {
        await tx.$executeRaw`INSERT INTO member_role(member_id, role_code) VALUES (-1, 'ADVISOR')`;
      }, 'member_role_member_id_fkey');
      await invalid(async (tx, f) => {
        await tx.$executeRaw`INSERT INTO member_role(member_id, role_code) VALUES (${f.member.memberId}, 'MISSING_ROLE')`;
      }, 'member_role_role_code_fkey');
      await invalid(async (tx, f) => {
        await tx.$executeRaw`INSERT INTO member_role(member_id, role_code, assigned_by) VALUES (${f.member.memberId}, 'ADVISOR', -1)`;
      }, 'member_role_assigned_by_fkey');
    });

    it('restricts deletion of roles, recipient members and assigning members with historical assignments', async () => {
      await invalid(async (tx, f) => {
        await tx.memberRole.create({
          data: {
            memberId: f.member.memberId,
            roleCode: 'ADVISOR',
            endsOn: new Date('2029-01-01'),
          },
        });
        await tx.$executeRaw`DELETE FROM role WHERE role_code = 'ADVISOR'`;
      }, 'member_role_role_code_fkey');
      await invalid(async (tx) => {
        const person = await tx.person.create({
          data: { fullName: 'Role recipient' },
        });
        const member = await tx.member.create({
          data: { personId: person.personId },
        });
        await tx.memberRole.create({
          data: {
            memberId: member.memberId,
            roleCode: 'ADVISOR',
            endsOn: new Date('2029-01-01'),
          },
        });
        await tx.$executeRaw`DELETE FROM member WHERE member_id = ${member.memberId}`;
      }, 'member_role_member_id_fkey');
      await invalid(async (tx, f) => {
        const person = await tx.person.create({
          data: { fullName: 'Role assigner' },
        });
        const assigner = await tx.member.create({
          data: { personId: person.personId },
        });
        await tx.memberRole.create({
          data: {
            memberId: f.member.memberId,
            roleCode: 'ADVISOR',
            assignedBy: assigner.memberId,
            endsOn: new Date('2029-01-01'),
          },
        });
        await tx.$executeRaw`DELETE FROM member WHERE member_id = ${assigner.memberId}`;
      }, 'member_role_assigned_by_fkey');
    });

    it('creates separate people and membership with database defaults', async () => {
      await valid(async (tx) => {
        const [person] = await tx.$queryRaw<
          {
            person_id: number;
            is_active: boolean;
            created_at: Date;
            updated_at: Date;
          }[]
        >`
          INSERT INTO person(full_name) VALUES ('Synthetic new person') RETURNING person_id,is_active,created_at,updated_at`;
        expect(person.is_active).toBe(true);
        expect(person.created_at).toEqual(person.updated_at);
        const [member] = await tx.$queryRaw<
          { member_id: number; member_type: string; is_active: boolean }[]
        >`
          INSERT INTO member(person_id) VALUES (${person.person_id}) RETURNING member_id,member_type,is_active`;
        expect(member.member_id).toBeGreaterThanOrEqual(10000000);
        expect(member.member_type).toBe('current');
        expect(member.is_active).toBe(true);
      });
    });

    it('keeps personal data separate, allows optional emails and independent email columns', async () => {
      await valid(async (tx, f) => {
        const person = await tx.person.create({
          data: { fullName: 'No membership' },
        });
        expect(person.emailPersonal).toBeNull();
        expect(person.emailUniversity).toBeNull();
        expect(
          await tx.member.findUnique({ where: { personId: person.personId } }),
        ).toBeNull();
        await tx.person.update({
          where: { personId: f.person.personId },
          data: { emailPersonal: 'Mixed@Example.test' },
        });
        await tx.person.update({
          where: { personId: person.personId },
          data: { emailUniversity: ' mixed@example.TEST ' },
        });
        const columns = await tx.$queryRaw<
          { column_name: string }[]
        >`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='member' ORDER BY column_name`;
        expect(columns.map((c) => c.column_name)).toEqual([
          'created_at',
          'is_active',
          'join_date',
          'member_id',
          'member_type',
          'person_id',
          'updated_at',
        ]);
      });
    });

    it('updates person and member timestamps through raw SQL', async () => {
      await valid(async (tx) => {
        const [person] = await tx.$queryRaw<
          { person_id: number }[]
        >`INSERT INTO person(full_name,updated_at) VALUES ('Timestamp fixture','2000-01-01') RETURNING person_id`;
        const [member] = await tx.$queryRaw<
          { member_id: number }[]
        >`INSERT INTO member(person_id,updated_at) VALUES (${person.person_id},'2000-01-01') RETURNING member_id`;
        for (const [table, key, id] of [
          ['person', 'person_id', person.person_id],
          ['member', 'member_id', member.member_id],
        ] as const) {
          await tx.$executeRawUnsafe(
            `UPDATE "${table}" SET is_active=false WHERE "${key}"=$1`,
            id,
          );
          const [row] = await tx.$queryRawUnsafe<{ changed: boolean }[]>(
            `SELECT updated_at > '2000-01-01'::timestamptz AS changed FROM "${table}" WHERE "${key}"=$1`,
            id,
          );
          expect(row.changed).toBe(true);
        }
      });
    });

    it('allows explicit core IDs and generates member IDs from the documented range', async () => {
      await valid(async (tx) => {
        const person = await tx.person.create({
          data: { personId: -100, fullName: 'Explicit identity' },
        });
        await tx.member.create({
          data: { memberId: -100, personId: person.personId },
        });
        await tx.memberRole.create({
          data: { id: -100, memberId: -100, roleCode: 'ADVISOR' },
        });
        const columns = await tx.$queryRaw<
          {
            table_name: string;
            column_name: string;
            identity_generation: string;
          }[]
        >`SELECT table_name,column_name,identity_generation FROM information_schema.columns WHERE table_schema='public' AND is_identity='YES' ORDER BY table_name,column_name`;
        expect(columns).toEqual([
          {
            table_name: 'committee',
            column_name: 'committee_id',
            identity_generation: 'BY DEFAULT',
          },
          {
            table_name: 'member',
            column_name: 'member_id',
            identity_generation: 'BY DEFAULT',
          },
          {
            table_name: 'member_committee',
            column_name: 'id',
            identity_generation: 'BY DEFAULT',
          },
          {
            table_name: 'member_role',
            column_name: 'id',
            identity_generation: 'BY DEFAULT',
          },
          {
            table_name: 'member_skill',
            column_name: 'id',
            identity_generation: 'BY DEFAULT',
          },
          {
            table_name: 'person',
            column_name: 'person_id',
            identity_generation: 'BY DEFAULT',
          },
          {
            table_name: 'skill',
            column_name: 'skill_id',
            identity_generation: 'BY DEFAULT',
          },
        ]);
      });
    });

    it('defers the committee parent FK until transaction completion', async () => {
      await valid(async (tx) => {
        await tx.committee.create({
          data: {
            committeeId: -100,
            committeeName: 'Deferred child',
            committeeCode: 'DEFERRED_CHILD',
            parentCommitteeId: -101,
          },
        });
        await tx.committee.create({
          data: {
            committeeId: -101,
            committeeName: 'Deferred parent',
            committeeCode: 'DEFERRED_PARENT',
          },
        });
        await tx.$executeRawUnsafe(
          'SET CONSTRAINTS committee_parent_committee_id_fkey IMMEDIATE',
        );
      });
    });

    it.each(['Leader', 'Co-Leader', 'Member'])(
      'allows committee position %s',
      async (role) => {
        await valid(async (tx, f) => {
          const first = await tx.memberCommittee.create({
            data: {
              memberId: f.member.memberId,
              committeeId: f.committee.committeeId,
              role,
            },
          });
          const secondCommittee = await tx.committee.create({
            data: {
              committeeName: 'Another committee',
              committeeCode: 'ANOTHER',
            },
          });
          const second = await tx.memberCommittee.create({
            data: {
              memberId: f.member.memberId,
              committeeId: secondCommittee.committeeId,
            },
          });
          expect(first.role).toBe(role);
          expect(second.role).toBe('Member');
          expect(second.createdAt).toBeInstanceOf(Date);
        });
      },
    );

    it.each(['Coordinator', 'member', ''])(
      'rejects unsupported committee position %s',
      async (role) => {
        await invalid(async (tx, f) => {
          await tx.memberCommittee.create({
            data: {
              memberId: f.member.memberId,
              committeeId: f.committee.committeeId,
              role,
            },
          });
        }, 'member_committee_role_check');
      },
    );

    it.each(['lower', 'HAS SPACE', 'BAD-CHAR', ''])(
      'rejects invalid committee code %s',
      async (committeeCode) => {
        await invalid(async (tx, f) => {
          await tx.committee.update({
            where: { committeeId: f.committee.committeeId },
            data: { committeeCode },
          });
        }, 'committee_code_check');
      },
    );

    it('rejects invalid member types and missing person links', async () => {
      await invalid(async (tx, f) => {
        await tx.member.update({
          where: { memberId: f.member.memberId },
          data: { memberType: 'staff' },
        });
      }, 'member_member_type_check');
      await invalid(async (tx) => {
        await tx.member.create({ data: { personId: -1 } });
      }, 'member_person_id_fkey');
    });

    it('restricts deleting people with membership and members/committees with assignments', async () => {
      await invalid(async (tx, f) => {
        await tx.person.delete({ where: { personId: f.actorPerson.personId } });
      }, 'member_person_id_fkey');
      for (const target of ['member', 'committee']) {
        await invalid(async (tx) => {
          const person = await tx.person.create({
            data: { fullName: 'Assigned member' },
          });
          const member = await tx.member.create({
            data: { personId: person.personId },
          });
          const committee = await tx.committee.create({
            data: {
              committeeName: 'Assigned committee',
              committeeCode: 'ASSIGNED',
            },
          });
          await tx.memberCommittee.create({
            data: {
              memberId: member.memberId,
              committeeId: committee.committeeId,
            },
          });
          if (target === 'member')
            await tx.member.delete({ where: { memberId: member.memberId } });
          else
            await tx.committee.delete({
              where: { committeeId: committee.committeeId },
            });
        }, `member_committee_${target}_id_fkey`);
      }
    });

    it('rejects non-member event creators and reviewers', async () => {
      await invalid(async (tx, f) => {
        await tx.event.update({
          where: { eventId: f.event.eventId },
          data: { createdByMemberId: f.person.personId },
        });
      }, 'events_created_by_member_id_fkey');
      await invalid(async (tx, f) => {
        await tx.eventRegistration.update({
          where: { registrationId: f.registration.registrationId },
          data: { reviewedByMemberId: f.person.personId },
        });
      }, 'event_registrations_reviewed_by_member_id_fkey');
    });

    it('installs all custom checks through migration history', async () => {
      const rows = await db.$queryRaw<
        { conname: string }[]
      >`SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname`;
      expect(rows.map((row) => row.conname)).toEqual([
        'blacklist_resolution_check',
        'committee_code_check',
        'committee_parent_not_self_check',
        'event_questions_options_check',
        'event_questions_position_check',
        'events_capacity_check',
        'events_confirmation_window_check',
        'events_schedule_check',
        'member_committee_role_check',
        'member_member_type_check',
        'member_role_dates_check',
        'person_full_name_check',
        'registrations_approval_check',
        'registrations_cancellation_check',
        'registrations_check_in_check',
        'registrations_confirmation_check',
        'registrations_excuse_check',
        'registrations_token_check',
        'registrations_waitlist_position_check',
        'role_code_check',
      ]);
    });

    it.each<[string, Patch]>([
      ['PENDING', {}],
      ['WAITLISTED', { waitlist_position: 1 }],
      ['AWAITING_CONFIRMATION', approval],
      ['CONFIRMED', confirmation],
      ['DECLINED', {}],
      ['CANCELLED', { ...confirmation, cancelled_at: cancelled }],
      ['LATE_CANCELLATION', { ...confirmation, cancelled_at: cancelled }],
      ['NOT_SELECTED', {}],
      ['REJECTED', {}],
      ['EXPIRED', approval],
      ['NO_CHECK_IN', confirmation],
      ['EXCUSED', { ...approval, ...excuse }],
    ])(
      'allows valid %s records, including optional membership',
      async (status, fields) => {
        await valid(async (tx, f) => {
          expect(
            await tx.member.findUnique({
              where: { personId: f.person.personId },
            }),
          ).toBeNull();
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            f.registration.registrationId,
            {
              status,
              ...fields,
              ...(status === 'EXCUSED'
                ? { excused_by_member_id: f.member.memberId }
                : {}),
            },
          );
        });
      },
    );

    it.each(['CANCELLED', 'LATE_CANCELLATION', 'NO_CHECK_IN'])(
      'retains %s confirmation and QR history when excused',
      async (prior) => {
        await valid(async (tx, f) => {
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            f.registration.registrationId,
            {
              status: prior,
              ...confirmation,
              ...(prior !== 'NO_CHECK_IN' ? { cancelled_at: cancelled } : {}),
            },
          );
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            f.registration.registrationId,
            {
              status: 'EXCUSED',
              ...excuse,
              excused_by_member_id: f.member.memberId,
            },
          );
          const record = await tx.eventRegistration.findUniqueOrThrow({
            where: { registrationId: f.registration.registrationId },
          });
          expect(record.confirmedAt).toEqual(confirmed);
          expect(record.attendanceTokenHash).toBe('synthetic-hash');
        });
      },
    );

    const registrationFailures: [string, Patch, string][] = [
      [
        'waitlist without position',
        { status: 'WAITLISTED' },
        'registrations_waitlist_position_check',
      ],
      [
        'zero waitlist position',
        { status: 'WAITLISTED', waitlist_position: 0 },
        'registrations_waitlist_position_check',
      ],
      [
        'position on pending',
        { waitlist_position: 1 },
        'registrations_waitlist_position_check',
      ],
      [
        'missing approval',
        { status: 'AWAITING_CONFIRMATION' },
        'registrations_approval_check',
      ],
      [
        'partial approval',
        { approved_at: approved },
        'registrations_approval_check',
      ],
      [
        'equal deadline',
        { ...approval, confirmation_deadline: approved },
        'registrations_approval_check',
      ],
      [
        'missing confirmation',
        { status: 'CONFIRMED', ...approval },
        'registrations_confirmation_check',
      ],
      [
        'expired with confirmation',
        { status: 'EXPIRED', ...confirmation },
        'registrations_confirmation_check',
      ],
      [
        'confirmation at deadline',
        { status: 'CONFIRMED', ...confirmation, confirmed_at: deadline },
        'registrations_confirmation_check',
      ],
      [
        'confirmation before approval',
        {
          status: 'CONFIRMED',
          ...confirmation,
          confirmed_at: new Date('2030-01-01T09:00:00Z'),
        },
        'registrations_confirmation_check',
      ],
      [
        'missing cancellation',
        { status: 'CANCELLED', ...confirmation },
        'registrations_cancellation_check',
      ],
      [
        'cancellation before confirmation',
        { status: 'CANCELLED', ...confirmation, cancelled_at: approved },
        'registrations_cancellation_check',
      ],
      [
        'cancellation on confirmed',
        { status: 'CONFIRMED', ...confirmation, cancelled_at: cancelled },
        'registrations_cancellation_check',
      ],
      ['missing excuse', { status: 'EXCUSED' }, 'registrations_excuse_check'],
      [
        'partial excuse',
        { status: 'EXCUSED', excused_at: cancelled },
        'registrations_excuse_check',
      ],
      [
        'excuse on pending',
        { excuse_reason: 'Reason' },
        'registrations_excuse_check',
      ],
      [
        'missing token pair',
        {
          status: 'CONFIRMED',
          ...confirmation,
          attendance_token_hash: null,
          attendance_token_encrypted: null,
        },
        'registrations_token_check',
      ],
      [
        'partial token pair',
        { status: 'CONFIRMED', ...confirmation, attendance_token_hash: null },
        'registrations_token_check',
      ],
      [
        'empty token',
        { status: 'CONFIRMED', ...confirmation, attendance_token_hash: ' ' },
        'registrations_token_check',
      ],
      [
        'token before confirmation',
        { attendance_token_hash: 'hash', attendance_token_encrypted: 'cipher' },
        'registrations_token_check',
      ],
      [
        'partial check-in',
        { status: 'CONFIRMED', ...confirmation, checked_in_at: cancelled },
        'registrations_check_in_check',
      ],
      [
        'check-in before confirmation',
        {
          status: 'CONFIRMED',
          ...confirmation,
          checked_in_at: approved,
          checked_in_by_member_id: 0,
        },
        'registrations_check_in_check',
      ],
      [
        'NO_CHECK_IN with scan',
        {
          status: 'NO_CHECK_IN',
          ...confirmation,
          checked_in_at: cancelled,
          checked_in_by_member_id: 0,
        },
        'registrations_check_in_check',
      ],
      [
        'cancelled and scanned',
        {
          status: 'CANCELLED',
          ...confirmation,
          cancelled_at: cancelled,
          checked_in_at: cancelled,
          checked_in_by_member_id: 0,
        },
        'registrations_check_in_check',
      ],
    ];
    it.each(registrationFailures)(
      'rejects %s',
      async (_name, fields, constraint) => {
        await invalid(
          (tx, f) =>
            patch(
              tx,
              'event_registrations',
              'registration_id',
              f.registration.registrationId,
              {
                ...fields,
                ...('checked_in_by_member_id' in fields
                  ? { checked_in_by_member_id: f.member.memberId }
                  : {}),
              },
            ),
          constraint,
        );
      },
    );

    it.each<[string, string, Patch, string]>([
      ['blank name', 'person', { full_name: '   ' }, 'person_full_name_check'],
      ['self parent', 'committee', {}, 'committee_parent_not_self_check'],
      ['zero capacity', 'events', { capacity: 0 }, 'events_capacity_check'],
      [
        'negative window',
        'events',
        { confirmation_window_hours: -1 },
        'events_confirmation_window_check',
      ],
      [
        'end before start',
        'events',
        { ends_at: approved },
        'events_schedule_check',
      ],
      [
        'late registration deadline',
        'events',
        { registration_deadline: new Date('2031-01-01T00:00:00Z') },
        'events_schedule_check',
      ],
      [
        'negative question position',
        'event_questions',
        { position: -1 },
        'event_questions_position_check',
      ],
      [
        'text with choices',
        'event_questions',
        { options: '["A"]' },
        'event_questions_options_check',
      ],
      [
        'choice without options',
        'event_questions',
        { question_type: 'select' },
        'event_questions_options_check',
      ],
      [
        'empty choices',
        'event_questions',
        { question_type: 'select', options: '[]' },
        'event_questions_options_check',
      ],
      [
        'JSON null choices',
        'event_questions',
        { question_type: 'select', options: 'null' },
        'event_questions_options_check',
      ],
      [
        'object choices',
        'event_questions',
        { question_type: 'checkbox', options: '{}' },
        'event_questions_options_check',
      ],
      [
        'scalar choices',
        'event_questions',
        { question_type: 'radio', options: '"A"' },
        'event_questions_options_check',
      ],
    ])('rejects %s', async (_name, table, fields, constraint) => {
      await invalid(async (tx, f) => {
        const target = {
          person: ['person_id', f.person.personId],
          committee: ['committee_id', f.committee.committeeId],
          events: ['event_id', f.event.eventId],
          event_questions: ['question_id', f.question.questionId],
        }[table] as [string, number];
        await patch(
          tx,
          table,
          target[0],
          target[1],
          table === 'committee' ? { parent_committee_id: target[1] } : fields,
        );
      }, constraint);
    });

    it('accepts nullable and free-form person branches', async () => {
      await valid(async (tx, f) => {
        expect(f.person.branch).toBeNull();
        await tx.person.update({
          where: { personId: f.person.personId },
          data: { branch: 'OTHER' },
        });
      });
    });

    it('accepts choices and both complete/absent check-in groups', async () => {
      await valid(async (tx, f) => {
        await patch(
          tx,
          'event_questions',
          'question_id',
          f.question.questionId,
          { question_type: 'checkbox', options: '["A","B"]' },
        );
        await patch(
          tx,
          'event_registrations',
          'registration_id',
          f.registration.registrationId,
          {
            status: 'CONFIRMED',
            ...confirmation,
            checked_in_at: cancelled,
            checked_in_by_member_id: f.member.memberId,
          },
        );
      });
    });

    it('resolves only one blacklist incident and retains its reason/history', async () => {
      await valid(async (tx, f) => {
        const first = await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'CONFIRMATION_EXPIRED',
            createdAt: approved,
          },
        });
        await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'NO_CHECK_IN',
            createdAt: approved,
          },
        });
        await tx.registrationBlacklistEntry.update({
          where: { entryId: first.entryId },
          data: {
            resolvedAt: cancelled,
            resolvedByMemberId: f.member.memberId,
            resolutionReason: 'Accepted excuse',
          },
        });
        expect(
          await tx.registrationBlacklistEntry.count({
            where: {
              registrationId: f.registration.registrationId,
              resolvedAt: null,
            },
          }),
        ).toBe(1);
        expect(
          (
            await tx.registrationBlacklistEntry.findUniqueOrThrow({
              where: { entryId: first.entryId },
            })
          ).reason,
        ).toBe('CONFIRMATION_EXPIRED');
      });
    });

    it.each<Patch>([
      { resolved_at: cancelled },
      { resolved_by_member_id: 0 },
      {
        resolved_at: cancelled,
        resolved_by_member_id: 0,
        resolution_reason: ' ',
      },
      {
        resolved_at: new Date('2029-01-01T00:00:00Z'),
        resolved_by_member_id: 0,
        resolution_reason: 'Reason',
      },
    ])('rejects incomplete/invalid blacklist resolution %#', async (fields) => {
      await invalid(async (tx, f) => {
        const entry = await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'NO_CHECK_IN',
            createdAt: approved,
          },
        });
        await patch(
          tx,
          'registration_blacklist_entries',
          'entry_id',
          entry.entryId,
          {
            ...fields,
            ...('resolved_by_member_id' in fields
              ? { resolved_by_member_id: f.member.memberId }
              : {}),
          },
        );
      }, 'blacklist_resolution_check');
    });

    it('rejects answers belonging to another event and duplicate answers', async () => {
      await invalid(async (tx, f) => {
        const other = await fixture(tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO registration_answers(registration_id, question_id, event_id, answer_text) VALUES ($1,$2,$3,$4)',
          f.registration.registrationId,
          other.question.questionId,
          f.event.eventId,
          'Answer',
        );
      }, 'registration_answers_question_id_event_id_fkey');
      await invalid(async (tx, f) => {
        const data = {
          registrationId: f.registration.registrationId,
          questionId: f.question.questionId,
          eventId: f.event.eventId,
          answerText: 'Answer',
        };
        await tx.registrationAnswer.create({ data });
        await tx.$executeRawUnsafe(
          'INSERT INTO registration_answers(registration_id, question_id, event_id, answer_text) VALUES ($1,$2,$3,$4)',
          data.registrationId,
          data.questionId,
          data.eventId,
          'Other answer',
        );
      }, 'registration_answers_registration_id_question_id_key');
    });

    it('rejects duplicate question positions within an event', async () => {
      await invalid(async (tx, f) => {
        await tx.$executeRawUnsafe(
          "INSERT INTO event_questions(event_id, question_text, question_type, position) VALUES ($1,'Duplicate','text',0)",
          f.event.eventId,
        );
      }, 'event_questions_event_id_position_key');
    });

    it('rejects a reused attendance token hash across registrations', async () => {
      await invalid(async (tx, f) => {
        const other = await fixture(tx);
        for (const registration of [f.registration, other.registration]) {
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            registration.registrationId,
            {
              status: 'CONFIRMED',
              ...confirmation,
            },
          );
        }
      }, 'event_registrations_attendance_token_hash_key');
    });

    it('allows pending applications above capacity', async () => {
      await valid(async (tx, f) => {
        const person = await tx.person.create({
          data: {
            fullName: 'Another applicant',
            emailPersonal: `${randomUUID()}@example.test`,
          },
        });
        await tx.eventRegistration.create({
          data: { eventId: f.event.eventId, personId: person.personId },
        });
        expect(
          await tx.eventRegistration.count({
            where: { eventId: f.event.eventId },
          }),
        ).toBe(2);
        expect(f.event.capacity).toBe(1);
      });
    });

    it('prevents duplicate membership/provider/email links and authorization pairs', async () => {
      await invalid(async (tx, f) => {
        await tx.member.create({ data: { personId: f.member.personId } });
      }, 'member_person_id_key');
      await invalid(async (tx, f) => {
        const authUserId = randomUUID();
        await tx.person.update({
          where: { personId: f.person.personId },
          data: { authUserId },
        });
        await tx.person.create({
          data: { fullName: 'Duplicate provider', authUserId },
        });
      }, 'person_auth_user_id_key');
      for (const field of ['emailPersonal', 'emailUniversity'] as const) {
        await invalid(
          async (tx, f) => {
            await tx.person.update({
              where: { personId: f.person.personId },
              data: { [field]: 'Same@Example.test' },
            });
            await tx.person.create({
              data: {
                fullName: 'Duplicate email',
                [field]: ' same@example.TEST ',
              },
            });
          },
          field === 'emailPersonal'
            ? 'uq_person_email_personal'
            : 'uq_person_email_university',
        );
      }
      await invalid(async (tx, f) => {
        await tx.memberCommittee.create({
          data: {
            memberId: f.member.memberId,
            committeeId: f.committee.committeeId,
          },
        });
        await tx.memberCommittee.create({
          data: {
            memberId: f.member.memberId,
            committeeId: f.committee.committeeId,
          },
        });
      }, 'member_committee_member_id_committee_id_key');
      await invalid(async (tx) => {
        const role = await tx.role.create({
          data: {
            roleCode:
              'TEST_' +
              randomUUID()
                .replace(/[^a-z]/gi, '')
                .toUpperCase(),
          },
        });
        const permission = await tx.permission.create({
          data: { permissionName: randomUUID() },
        });
        await tx.rolePermission.create({
          data: {
            roleCode: role.roleCode,
            permissionId: permission.permissionId,
          },
        });
        await tx.$executeRawUnsafe(
          'INSERT INTO role_permissions(role_code,permission_id) VALUES ($1,$2)',
          role.roleCode,
          permission.permissionId,
        );
      }, 'role_permissions_role_code_permission_id_key');
    });

    it('enforces registration-side composite FK and referenced history deletion restrictions', async () => {
      await invalid(async (tx, f) => {
        const other = await fixture(tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO registration_answers(registration_id,question_id,event_id,answer_text) VALUES ($1,$2,$3,$4)',
          f.registration.registrationId,
          other.question.questionId,
          other.event.eventId,
          'Answer',
        );
      }, 'registration_answers_registration_id_event_id_fkey');
      for (const [table, key, fk] of [
        ['member', 'member_id', 'events_created_by_member_id_fkey'],
        ['events', 'event_id', 'event_registrations_event_id_fkey'],
      ]) {
        await invalid(async (tx, f) => {
          await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "${key}" = $1`,
            table === 'member' ? f.member.memberId : f.event.eventId,
          );
        }, fk);
      }
      await invalid(async (tx, f) => {
        await tx.registrationAnswer.create({
          data: {
            registrationId: f.registration.registrationId,
            questionId: f.question.questionId,
            eventId: f.event.eventId,
            answerText: 'Answer',
          },
        });
        await tx.$executeRawUnsafe(
          'DELETE FROM event_questions WHERE question_id = $1',
          f.question.questionId,
        );
      }, 'registration_answers_question_id_event_id_fkey');
      await invalid(async (tx, f) => {
        await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'NO_CHECK_IN',
          },
        });
        await tx.$executeRawUnsafe(
          'DELETE FROM event_registrations WHERE registration_id = $1',
          f.registration.registrationId,
        );
      }, 'registration_blacklist_entries_registration_id_fkey');
      await invalid(async (tx, f) => {
        await patch(
          tx,
          'event_registrations',
          'registration_id',
          f.registration.registrationId,
          { reviewed_by_member_id: -1 },
        );
      }, 'event_registrations_reviewed_by_member_id_fkey');
    });

    it('reorders waitlist positions using temporary positive positions and rolls back interrupted changes', async () => {
      const f = await db.$transaction(fixture);
      const other = await db.person.create({
        data: {
          fullName: 'Waitlist applicant',
          emailPersonal: `${randomUUID()}@example.test`,
        },
      });
      try {
        await db.eventRegistration.update({
          where: { registrationId: f.registration.registrationId },
          data: { status: 'WAITLISTED', waitlistPosition: 1 },
        });
        const second = await db.eventRegistration.create({
          data: {
            eventId: f.event.eventId,
            personId: other.personId,
            status: 'WAITLISTED',
            waitlistPosition: 2,
          },
        });
        const order = async () =>
          (
            await db.eventRegistration.findMany({
              where: { eventId: f.event.eventId },
              orderBy: { waitlistPosition: 'asc' },
            })
          ).map((r) => [r.registrationId, r.waitlistPosition]);
        await expect(
          db.$transaction(async (tx) => {
            await tx.eventRegistration.update({
              where: { registrationId: f.registration.registrationId },
              data: { waitlistPosition: 3 },
            });
            throw rollback;
          }),
        ).rejects.toBe(rollback);
        expect(await order()).toEqual([
          [f.registration.registrationId, 1],
          [second.registrationId, 2],
        ]);
        await db.$transaction(async (tx) => {
          await tx.eventRegistration.update({
            where: { registrationId: f.registration.registrationId },
            data: { waitlistPosition: 3 },
          });
          await tx.eventRegistration.update({
            where: { registrationId: second.registrationId },
            data: { waitlistPosition: 1 },
          });
          await tx.eventRegistration.update({
            where: { registrationId: f.registration.registrationId },
            data: { waitlistPosition: 2 },
          });
        });
        expect(await order()).toEqual([
          [second.registrationId, 1],
          [f.registration.registrationId, 2],
        ]);
      } finally {
        await db.eventRegistration.deleteMany({
          where: { eventId: f.event.eventId },
        });
        await db.event.delete({ where: { eventId: f.event.eventId } });
        await db.committee.delete({
          where: { committeeId: f.committee.committeeId },
        });
        await db.member.delete({ where: { memberId: f.member.memberId } });
        await db.person.deleteMany({
          where: {
            personId: {
              in: [f.person.personId, f.actorPerson.personId, other.personId],
            },
          },
        });
      }
    });

    it.each(['registration', 'waitlist', 'incident'])(
      'allows only one simultaneous duplicate %s write',
      async (kind) => {
        const f = await db.$transaction(fixture);
        let secondPersonId: number | undefined;
        try {
          const person = await db.person.create({
            data: {
              fullName: 'Concurrent applicant',
              emailPersonal: `${randomUUID()}@example.test`,
            },
          });
          secondPersonId = person.personId;
          let writes: Promise<unknown>[];
          if (kind === 'registration') {
            writes = [1, 2].map(() =>
              db.$executeRawUnsafe(
                'INSERT INTO event_registrations(event_id,person_id) VALUES ($1,$2)',
                f.event.eventId,
                person.personId,
              ),
            );
          } else if (kind === 'waitlist') {
            writes = [
              db.$executeRawUnsafe(
                "UPDATE event_registrations SET status = 'WAITLISTED', waitlist_position = 1 WHERE registration_id = $1",
                f.registration.registrationId,
              ),
              db.$executeRawUnsafe(
                "INSERT INTO event_registrations(event_id,person_id,status,waitlist_position) VALUES ($1,$2,'WAITLISTED',1)",
                f.event.eventId,
                person.personId,
              ),
            ];
          } else {
            writes = [1, 2].map(() =>
              db.$executeRawUnsafe(
                "INSERT INTO registration_blacklist_entries(registration_id,reason) VALUES ($1,'NO_CHECK_IN')",
                f.registration.registrationId,
              ),
            );
          }
          const results = await Promise.allSettled(writes);
          expect(
            results.filter((result) => result.status === 'fulfilled'),
          ).toHaveLength(1);
          expect(
            results.filter((result) => result.status === 'rejected'),
          ).toHaveLength(1);
          const rejected = results.find(
            (result) => result.status === 'rejected',
          );
          if (rejected?.status === 'rejected') {
            expect(String(rejected.reason)).toContain('23505');
          }
        } finally {
          await db.registrationBlacklistEntry.deleteMany({
            where: { registration: { eventId: f.event.eventId } },
          });
          await db.eventRegistration.deleteMany({
            where: { eventId: f.event.eventId },
          });
          await db.event.delete({ where: { eventId: f.event.eventId } });
          await db.committee.delete({
            where: { committeeId: f.committee.committeeId },
          });
          await db.member.delete({ where: { memberId: f.member.memberId } });
          await db.person.deleteMany({
            where: {
              personId: {
                in: [
                  f.person.personId,
                  f.actorPerson.personId,
                  ...(secondPersonId ? [secondPersonId] : []),
                ],
              },
            },
          });
        }
      },
    );
  },
);
