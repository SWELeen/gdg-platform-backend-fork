# People and Membership Release 2.3 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Implement one authorized stage at a time, use read-only independent investigation/review, and present verification before requesting commit confirmation. All plans must be written in English.

**Goal:** Build the local people/membership structure from a fresh empty database, following the documented DBA release 2.3 columns and relationships.

**Architecture:** NestJS, Prisma 7.10.0, PostgreSQL 17. Preserve committed migration history; replay initial then the new empty-only migration on a separate disposable database. Do not backfill, link old records, or keep temporary legacy identity bridges.

**Spec:** `GDGoC_UJ_Database_Structure_release2_3.pdf`, pages 3–5 for core tables; release 2.2 SQL is supporting DDL evidence only. Backend views and release 2.3 access definitions remain unavailable.

## Approved scope and constraints

- The user approved starting from scratch with no relationship between old/new data, and then authorized implementation of Stage B. This supersedes the original expansion/backfill plan.
- Stage B covers `person`, `member`, `committee`, `member_committee`, plus necessary dependent FK changes. Coordinator is excluded; no conversion of old Coordinator rows is planned.
- Initial migration `20261009173345_initial_core` remains byte-for-byte unchanged. SHA256: `83998bf07328d4a21151f957dcaca58729c36665fcd33bf482da9d3997fe0085`.
- New migration `20261015164000_people_membership_fresh` must lock all 13 initial project tables and reject any populated table before changing domain DDL. It must never erase existing records.
- Test only against runner-owned PostgreSQL. Do not connect to or delete the application database, reset volumes, execute the supplied DBA dump, push, or create a PR.
- Commit each stage only after separate user confirmation. Keep the untracked user proposal and frontend lockfile untouched.
- Existing feature branch: `feat/database-schema-migrations`. Stage A commit: `98fc0c8`.
- No complete official parity claim: Supabase FK, RLS, guards, audit, permissions, views, and remaining event-domain changes require later integration work.

## Target contract — core tables implemented; remaining tables planned

Names below are PostgreSQL names. `?` means nullable; all other fields are NOT NULL. All identity columns are integer and `BY DEFAULT` according to SQL 2.2. Source timestamps use `timestamptz` without restricting precision to 3. SQL foreign keys default to `ON UPDATE NO ACTION`; represent this explicitly in Prisma. This stage starts with empty tables; no legacy IDs or values are transferred.

| Table | Target columns and constraints |
|---|---|
| `person` | `person_id` identity PK; `auth_user_id? uuid` UNIQUE; `full_name varchar(255)` nonempty after btrim; `email_university?`, `email_personal? varchar(255)`; `phone_number? varchar(50)`; `university?`, `major? varchar(255)`; `branch? varchar(100)`; `gender? varchar(20)`; `profile_image_url? text`; `bio? varchar(1000)`; `is_active=true`; `created_at`, `updated_at timestamptz DEFAULT now()` |
| `member` | `member_id` identity PK, generated IDs start at `10000000`; `person_id` UNIQUE FK → person RESTRICT; `member_type text DEFAULT 'current'` CHECK current/alumni; `join_date? date`; `is_active=true`; created/updated DEFAULT now() |
| `committee` | Identity PK; `committee_name varchar(255)` UNIQUE; `committee_code varchar(20)` UNIQUE and CHECK `^[A-Z0-9_]{1,20}$`; `parent_committee_id?` self FK RESTRICT and DEFERRABLE INITIALLY DEFERRED according to SQL 2.2; CHECK preventing self-parenting |
| `member_committee` | Identity PK; member/committee FKs RESTRICT; UNIQUE(member_id, committee_id); `role varchar(100) DEFAULT 'Member'` with CHECK Leader/Co-Leader/Member; created_at DEFAULT now() |
| `role` | `role_code text` PK and CHECK `^[A-Z][A-Z_]*$`; `description? text`; `is_privileged=true` |
| `member_role` | Identity PK; member_id and role_code FKs RESTRICT; `assigned_by?` FK → member RESTRICT; `starts_on?`, `ends_on? date`; `notes? varchar(500)`; created_at DEFAULT now(); CHECK end>=start when both exist; UNIQUE(member_id,role_code) **WHERE ends_on IS NULL** only |
| `skill` | Identity PK; `skill_name varchar(255)` UNIQUE; SQL 2.2 starts identity at 1000 (not specified by the PDF; record its source) |
| `member_skill` | Identity PK; member/skill FKs RESTRICT; UNIQUE(member_id,skill_id) |

- The two email columns have independent indexes: `UNIQUE lower(btrim(email_*)) WHERE email_* IS NOT NULL`. This enforces neither cross-column uniqueness nor lowercase storage. Do not substitute plain `@unique` for an expression index.
- Supabase owns login email and `isVerified/lastLogin`; these are not target person columns. No legacy columns are retained in the fresh design.
- The official `person.auth_user_id → auth.users.id ON DELETE SET NULL` FK is documented, but cannot be installed on the current local PostgreSQL instance without auth.users. Local proposal: a nullable unique UUID, with the difference documented and uniqueness tested; do not build a substitute Supabase system. Completing the FK and testing SET NULL requires a separate Supabase integration environment.
- Added timestamps use DEFAULT now(); updated_at requires database-level updates matching source triggers, tested through raw SQL. `@updatedAt` alone does not reproduce source behavior.
- Reference indexes: committee parent; member_committee committee_id; member_role(role_code) WHERE ends_on IS NULL; member_skill skill_id. UNIQUE(member_id,committee_id) supports member lookup; do not add a duplicate member_id index merely because the dump has one. Other new indexes require a concrete query justification.
- “Every member belongs to a committee” was a previous proposal; no general constraint enforcing it appeared in the reviewed DDL. Do not invent a general trigger; accepting a committee application has its own commit check in a later application stage.
- Do not restrict global role codes to PDF examples or derive seed values from official row counts. Actual reference names and codes are still unavailable as seed data.

## Stage A — Completed and committed

- [x] Sort migration discovery, copy history prefixes, and retain initial/latest rollback, recovery, and no-op checks.
- [x] Replace fixed table counts with explicit manifests; compare schema and domain rows and preserve a synthetic sentinel.
- [x] Exercise multiple migrations with a scratch-only probe; include real-filesystem helper tests in `pnpm test`.
- [x] Independent review and the transaction guard regression fix completed; checks, schema, startup, and performance runners passed before commit `98fc0c8`.

## Stage B — Fresh people, membership, and committees

**Files:** `prisma/schema.prisma`; new `prisma/migrations/20261015164000_people_membership_fresh/migration.sql`; `test/database-schema.e2e-spec.ts`; migration helper/tests; runner; performance fixtures; database and governance docs; README and SETUP table counts/fresh-database guidance.

- [x] Write a failing database test for Person/Member defaults, then implement the four core tables with required unique member.person_id, identity defaults, expression email indexes, row checks, and database updated_at triggers.
- [x] Generate a draft diff from the previous Prisma schema without connecting to application databases; inspect and add custom PostgreSQL rules explicitly.
- [x] Inside BEGIN, lock all initial tables and fail with `people_membership_requires_empty_database` if any contains rows, before DROP/ALTER. Fresh empty history is the only supported input.
- [x] Remove User/UserRole and their empty tables. Keep the numeric Role/Permission/RolePermission registries for Stage C; do not invent intermediate role assignments. No current handwritten API consumes UserRole.
- [x] Remove duplicated personal fields from Member. Do not copy users or member values into Person. Person has optional membership; Member requires a unique Person.
- [x] Set new member IDs to start at 10000000. Align the four core identity columns with GENERATED BY DEFAULT AS IDENTITY, allowing explicit IDs as in the source.
- [x] Update dependent identity references listed below. Preserve all twelve registration statuses, QR/history fields, and composite answer FKs; detailed event/incident redesign remains a later stage.
- [x] Update tests, startup preservation fixture, query references, and performance fixture to use distinct Person participants and Member actors.
- [x] Extend the failure injector to recognize quoted SQL bodies/literals without counting their BEGIN/END as outer transaction boundaries; retain alias rejection and fail closed on unsupported/unclosed tokens. Add regression tests before the helper change.
- [x] Test fresh replays, raw SQL defaults/updates, email uniqueness, membership uniqueness, committee codes/hierarchy/roles/delete restrictions, orphan actor references, and rejection/preservation for each populated initial table.
- [x] Run `pnpm check`, `pnpm build`, Prisma validate, schema/startup/performance runners, format and diff checks. Review independently, resolve material findings, and present results before commit.

## Dependent relationships in Stage B

| Old reference | Fresh target |
|---|---|
| users.member_id → member | Removed; member.person_id → person is required and unique |
| events.created_by → users | events.created_by_member_id → member |
| event_registrations.user_id → users | event_registrations.person_id → person; adapt unique/index/query references |
| registration reviewed_by / checked_in_by / excused_by → users | Corresponding *_by_member_id columns → member |
| blacklist resolved_by → users | resolved_by_member_id → member; keep the existing resolution meaning until the incident stage |
| user_roles → users + roles | Removed; member_role is introduced directly with its target shape in Stage C |
| member_committee → member / committee | RESTRICT on deletion, NO ACTION on update; positions limited to Leader/Co-Leader/Member |
| committee parent | Preserve self relation, self-parent check, and source deferred FK behavior |
| registration_answers → registration/question | Preserve both composite FKs through event_id |

All actor references reject non-members. A non-member Person may register. RolePermission remains linked to the existing numeric role registry until Stage C. Event table names and other event fields are not being presented as release 2.3-complete.

## Stage C — Planned, not authorized by Stage B execution

- Create target role/member_role and skill/member_skill structures using the contract above.
- Coordinate role_code with role_permission and permission.code; no old-role transfer or inferred seed values.
- Test partial active-role uniqueness, history dates, skill pairs, and referenced-row deletion restrictions.
- Obtain actual seed names/codes separately; live row counts are not seed definitions.

## Later dependencies and integration boundary

- person is referenced by future permission_grant, attendance_incident, committee_application, account_lock, and account_link_request.
- member is referenced by future event_staff, grant actors, review_window, application/link actors, capacity_override, account_lock actors, announcement, and change_request actors.
- committee is referenced by future committee_permission, committee_application, and permission_grant; role by role_permission; skill by member_skill.
- Views and private guards/provisioning/merge/audit functions depend on the core tables. They are not recreated or verified by this local stage.
- Event title/nullable committee, question types, JSON answers, QR nonce, and attendance_incident changes remain separate work.
- Real-data migration and populated upgrade compatibility are explicitly out of scope. A populated old database is preserved by rejecting the new migration, not by transferring its records.

## Review focus

1. Fresh-only guard covers every old project table and holds locks until commit/rollback.
2. Participant Person IDs never substitute for Member actor IDs.
3. Case/whitespace email conflicts are checked in each email column independently; NULLs remain allowed.
4. PostgreSQL-only behavior (identity start, deferred hierarchy, triggers, CHECK/expression indexes) is tested directly.
5. Dropping old staff columns must not silently remove lifecycle CHECK constraints; restore them with new member column names.

## Source locations

- PDF: `/Users/ammar/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/EDEE9BB8-F92E-4BEF-BA51-CB14C790304E/GDGoC_UJ_Database_Structure_release2_3.pdf`, 14 Oct 2026, 16 pages.
- Supporting SQL: `/Users/ammar/Downloads/GDGoC_UJ_schema_release2_2.sql`, SHA256 `75bb00a0534fcb5bbf4ce8331442d841097104440b4ee05d076548db30784e84`.
- SQL 2.2 anchors: core definitions ~3255, 3535–3654, 3717; expression indexes ~4507–4521; FKs ~5223–5351. Full backend view/access definitions for 2.3 remain outstanding.

## Stage B verification and handoff — 2026-10-15

- Implemented the fresh four-table identity/membership contract with a new empty-only migration. No backfill, matching, retained User columns, or temporary assignment model.
- Independent read-only investigation and review completed. One Important helper finding (END ... AND [NO] CHAIN aliases) was reproduced RED and fixed GREEN, followed by a passing full check/schema run. No Critical or Minor findings remain from that review.
- PASS: Prisma format/validate/generate; `pnpm check` (5 Node helper tests, 12 Vitest tests, lint/typecheck); `pnpm build`; `pnpm test:schema:local` (88 schema tests per fresh replay, 92 e2e tests, each of 13 populated-table rejection cases, initial/latest/probe rollback/recovery/no-op); `pnpm test:startup:local`; `pnpm test:performance:local`; formatting and diff checks.
- Tests ran on disposable PostgreSQL servers. Test containers/networks and the startup image were removed by the runners. The application database was not connected to or changed.
- Initial migration SHA256 and both pre-existing user file hashes remain unchanged. The frontend was not edited.
- Review boundaries: official DBA parity beyond this recorded contract, Supabase/RLS/views/audit/access, Stage C assignments, and production deployment are unverified and intentionally deferred. Independent reviewer inspected code; the implementing agent executed the database/build/startup/performance checks.
- Stage B implementation and verification are complete. The user approved its commit on 2026-10-15 after reviewing the results. No push or PR is authorized; Stage C has not started.
