# People and Membership Release 2.3 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this chat. Steps use checkbox (`- [ ]`) syntax. Present each completed stage and its verification to the user; commit only after their explicit confirmation. Do not dispatch implementation agents by default.

**Goal:** Prepare the local `person`, `member`, `committee`, `member_committee`, `role`, `member_role`, `skill`, and `member_skill` structures while preserving data and defining the transition for every dependent relationship.

**Architecture:** PostgreSQL + Prisma in NestJS. Expand, backfill, then switch references; preserve the initial migration and legacy fields/tables throughout this stage. Completing the core tables does not establish complete application integration or parity with official DBA protections.

**Tech Stack:** PostgreSQL 17, Prisma 7.10.0, Node >=22.12.0, pnpm 12.3.4, Vitest.

**Spec:** `GDGoC_UJ_Database_Structure_release2_3.pdf`, pages 3–5 for core tables and 6–15 for dependencies; `GDGoC_UJ_schema_release2_2.sql` as supporting DDL evidence only. Both paths were recovered from the previous chat (`01a10c7c-2f56-7a52-985b-9a768368839b`), then the original files were read. The chat summary was not treated as SQL authority.

## Global Constraints

- Stage A implementation was authorized by the user on 2026-10-15, including read-only agent investigation/review. Stages B/C remain planned; commits still require separate confirmation.
- Target release 2.3 design; available SQL is release 2.2. Backend view definitions and release 2.3 permissions have not arrived. Do not claim complete official parity.
- Do not execute the supplied SQL directly; it contains Supabase schemas, RLS, functions, triggers, and ACLs outside this stage.
- No `reset`, `db push`, data deletion, or changes to applied/shared migrations. Commit only after confirmation; no push or PR.
- Test on a separate disposable PostgreSQL server provisioned by the runner, never the application or official database. Do not start the regular compose backend for verification.
- Preserve `docs/user-member-proposal.md` and the frontend `package-lock.json` without editing or staging them.
- Both repositories' AGENTS files were read. Referenced policies were found at `/Users/ammar/Projects/adev/policies/{orchestration,memory}.md`, outside the GDG repositories. Their general guidance was used where consistent with GDG instructions.
- Persistent memory retrieval or storage is unnecessary: repository evidence and original sources suffice; task details can be preserved in Git.

## Baseline — observed on 2026-10-15

| Repository | Branch / HEAD | Pre-existing changes |
|---|---|---|
| Backend | `feat/database-schema-migrations` / `9c10697` | Only the untracked proposal noted above |
| Frontend | `main` / `a00d03e` | Only the untracked lockfile |

- 13 tables, 6 enums, one migration: `20261009173345_initial_core`, wrapped in `BEGIN/COMMIT`, with 16 additional CHECK constraints.
- Initial migration SHA256: `83998bf07328d4a21151f957dcaca58729c36665fcd33bf482da9d3997fe0085`; recheck after each stage.
- `prisma7.config.ts` specifies the schema and migrations paths and reads `DATABASE_URL`. New tables require no config change.
- `docker-compose.yml` automatically runs `migrate deploy` before NestJS. Do not point it at the official DBA database. No change is needed for this local table stage.
- There are no entity services or controllers yet; `PrismaService` connects and runs `SELECT 1`. Actual consumers are schema tests, SQL fixtures, and the runner. No API or frontend change is required for this stage.
- `User.memberId` is optional and unique; personal data is duplicated between `users` and `member`. Members without Users and Users without membership are both currently allowed.
- `docs/user-member-proposal.md` is an unimplemented proposal using `users/user_roles`; it differs from the DBA target `person/member_role` and is not an approved decision.

## Target contract — documented, not implemented

Names below are PostgreSQL names. `?` means nullable; all other fields are NOT NULL. All identity columns are integer and `BY DEFAULT` according to SQL 2.2. Source timestamps use `timestamptz` without restricting precision to 3. SQL foreign keys default to `ON UPDATE NO ACTION`; represent this explicitly in Prisma. Preserve legacy IDs.

| Table | Target columns and constraints |
|---|---|
| `person` | `person_id` identity PK; `auth_user_id? uuid` UNIQUE; `full_name varchar(255)` nonempty after btrim; `email_university?`, `email_personal? varchar(255)`; `phone_number? varchar(50)`; `university?`, `major? varchar(255)`; `branch? varchar(100)`; `gender? varchar(20)`; `profile_image_url? text`; `bio? varchar(1000)`; `is_active=true`; `created_at`, `updated_at timestamptz DEFAULT now()` |
| `member` | `member_id` identity PK, next generated ID starts at `max(10000000, max(existing_id)+1)`; `person_id` UNIQUE FK → person RESTRICT; `member_type text DEFAULT 'current'` CHECK current/alumni; `join_date? date`; `is_active=true`; created/updated DEFAULT now() |
| `committee` | Identity PK; `committee_name varchar(255)` UNIQUE; `committee_code varchar(20)` UNIQUE and CHECK `^[A-Z0-9_]{1,20}$`; `parent_committee_id?` self FK RESTRICT and DEFERRABLE INITIALLY DEFERRED according to SQL 2.2; CHECK preventing self-parenting |
| `member_committee` | Identity PK; member/committee FKs RESTRICT; UNIQUE(member_id, committee_id); `role varchar(100) DEFAULT 'Member'` with CHECK Leader/Co-Leader/Member; created_at DEFAULT now() |
| `role` | `role_code text` PK and CHECK `^[A-Z][A-Z_]*$`; `description? text`; `is_privileged=true` |
| `member_role` | Identity PK; member_id and role_code FKs RESTRICT; `assigned_by?` FK → member RESTRICT; `starts_on?`, `ends_on? date`; `notes? varchar(500)`; created_at DEFAULT now(); CHECK end>=start when both exist; UNIQUE(member_id,role_code) **WHERE ends_on IS NULL** only |
| `skill` | Identity PK; `skill_name varchar(255)` UNIQUE; SQL 2.2 starts identity at 1000 (not specified by the PDF; record its source) |
| `member_skill` | Identity PK; member/skill FKs RESTRICT; UNIQUE(member_id,skill_id) |

- The two email columns have independent indexes: `UNIQUE lower(btrim(email_*)) WHERE email_* IS NOT NULL`. This enforces neither cross-column uniqueness nor lowercase storage. Do not substitute plain `@unique` for an expression index.
- Supabase owns login email and `isVerified/lastLogin`; these are not target person columns. Preserve legacy copies during this stage.
- The official `person.auth_user_id → auth.users.id ON DELETE SET NULL` FK is documented, but cannot be installed on the current local PostgreSQL instance without auth.users. Local proposal: a nullable unique UUID, with the difference documented and uniqueness tested; do not build a substitute Supabase system. Completing the FK and testing SET NULL requires a separate Supabase integration environment.
- Added timestamps use DEFAULT now(); updated_at requires database-level updates matching source triggers, tested through raw SQL. `@updatedAt` alone does not reproduce source behavior.
- Reference indexes: committee parent; member_committee committee_id; member_role(role_code) WHERE ends_on IS NULL; member_skill skill_id. UNIQUE(member_id,committee_id) supports member lookup; do not add a duplicate member_id index merely because the dump has one. Other new indexes require a concrete query justification.
- “Every member belongs to a committee” is a previous proposal; no general constraint enforcing it appeared in the reviewed DDL. Do not invent a general trigger; accepting a committee application has its own commit check in a later application stage.
- Do not restrict global role codes to PDF examples or derive seed values from official row counts. Actual reference names and codes are still unavailable as seed data.

## Dependency inventory

| Current relationship | Target / stage action |
|---|---|
| users.member_id → member | Add member.person_id → person; retain the old link temporarily as a migration bridge, not the final design |
| user_roles → users + roles(role_id) | member_role → member + role(role_code); do not transfer a non-member account's role or derive role_code from its name automatically |
| role_permissions.role_id → roles | Required dependency of the role PK transition. Retain legacy structures during expansion; final conversion to role_permission(role_code,code) also needs permission_id → code mapping in the permissions stage |
| committee.parent_committee_id | Preserve IDs and hierarchy; add code pattern and deferrability; do not infer hierarchy from committee names |
| member_committee.member_id CASCADE | Change to RESTRICT; preserve relationships; Coordinator requires an explicit migration decision before enforcing the new CHECK |
| events.committee_id → committee | Preserve FK; making it nullable and other event changes belong to the event stage |
| events.created_by → users | Target event.created_by_member_id → member RESTRICT. Map through users.member_id, never numeric coincidence; a non-member creator blocks the final switch |
| event_registrations.user_id → users | Target event_registration.person_id → person RESTRICT; transfer UNIQUE(event_id,user_id), its index, and owner queries to person |
| reviewed_by / checked_in_by → users | Target reviewed_by_member_id / checked_in_by_member_id → member RESTRICT; preserve NULL, and never erase an existing non-member actor or automatically grant membership |
| event_registrations.excused_by → users | Target attendance_incident.excused_by_member_id; preserve the old field until the incidents stage |
| registration_blacklist_entries.resolved_by → users | Assess migration to excused_by_member_id in the incidents stage; resolution does not necessarily mean excuse, so avoid a blind rename |
| registration_answers → registration + question through event_id | Indirect dependency; preserve composite FKs preventing cross-event answers, and review their retargeting when replacing tables in the next stage |
| blacklist → registration → user | Indirect dependency; preserve incident history, QR data, and answers during the identity transition |

Official dependencies absent from the current schema are inventoried, not created in the eight-table stage:

- person: `permission_grant.person_id`, `attendance_incident.person_id`, `committee_application.person_id`, `account_lock.person_id` (RESTRICT), and `account_link_request.person_id` (CASCADE).
- member: `event_staff.member_id/assigned_by_member_id`; `permission_grant.granted_by_member_id/cyber_approved_by_member_id`; `review_window.created_by_member_id`; `committee_application.decided_by_member_id/resulting_member_id`; `account_link_request.reviewed_by_member_id`; all member actor stamps in capacity_override, account_lock, announcement, and change_request; all RESTRICT in the source.
- committee: `committee_permission.committee_id` and `committee_application.committee_id` RESTRICT; `permission_grant.committee_id` CASCADE.
- role: `role_permission.role_code` RESTRICT; skill has no references outside member_skill in reviewed sources.
- Views: `v_member`, `v_member_committee`, `v_club_role`, `v_member_skill`, `committee_member_view`, `application_view`, `link_request_view`, `registrant_view`, `audit_log_view`. RLS, guards, audit, auth provisioning, and merge helpers also read the core tables; local table tests do not verify these components.
- `ops.email_outbox.person_id` and `audit.audit_log.actor_person_id` are identity fields in the document; do not assume undocumented FKs.

## Review Focus

1. Conflicting User/Member records for one person, or a Member without a User: no name/email-based merging or field loss.
2. Emails colliding after lower/btrim, blank names, bio exceeding 1000 characters, or invalid committee codes: fail clearly before persistent changes, without silent truncation or normalization.
3. Coordinator, roles without approved codes, or non-member role holders: stop migration without reassigning permissions or creating memberships.
4. Upgrade a database containing events, answers, and incident history: preserve IDs, content, row counts, and references; failure leaves the previous stage intact.
5. Partial/expression indexes, identity, deferrable FKs, and updated_at: verify directly in PostgreSQL; Prisma validation alone is insufficient evidence.

## Stages and verification gates

### Stage A — Support multiple migrations in the runner without domain schema changes

**Files:** `test/run-schema-tests.mjs`; a small assert-based test for extracted logic only if the runner needs a helper; `docs/database-prisma.md`.

- [x] Sort migration directories explicitly; copy the entire history to scratch. Remove the single-migration assertion while retaining rollback coverage.
- [x] Retain initial-migration rollback verification on an empty database. Add failure in the **last migration under test** after applying its predecessors; inject the error before COMMIT in the scratch copy, never the real file.
- [x] Compare schema dumps and fixtures before/after failure; previous migrations and data remain intact, with no changes leaking from the failed stage. Check finished/rolled_back history per migration name rather than expecting one total row.
- [x] Recover only on the disposable database: resolve the injected migration after verifying rollback; restore the original file, deploy, and test retry and no-op behavior.
- [x] Replace hardcoded `13` counts with an explicit expected-table manifest for each tested snapshot; check cleanup for every table. Do not derive expected tables from the actual query, which could hide a missing table.
- [x] Preserve target protection in `test/schema-test-target.ts` and tests rejecting the application target. Add assertions for sorting, failed-migration selection, and multiple-migration history.
- [x] Run `pnpm check` and `pnpm test:schema:local`. The existing single migration should pass now; Stage B exercises the added migration path. Present results and await commit confirmation.

### Stage B — Expand identity, membership, and committees with conservative migration

**Files:** `prisma/schema.prisma`; a new migration after initial (proposed name `people_membership_expand`); `test/database-schema.e2e-spec.ts`; new upgrade fixture `test/fixtures/legacy-people.sql`; runner; `test/schema-performance.sql` if membership fixtures require changes; `docs/database-prisma.md` and `docs/decision-governance.md`.

- [ ] Before writing backfill SQL, record a mapping matrix for duplicated fields. Proposal for review: retain user_id as person_id for each User; link Members only through users.member_id; create a separate Person for every unlinked Member; never guess account links. Conflicting nonempty personal values require an explicit decision, not COALESCE hiding the difference. Do not automatically copy users.email to email_personal when it conflicts with the existing email's value or meaning.
- [ ] Create a synthetic fixture under the initial schema: linked member, member without account, non-member account registered for an event, matching/conflicting fields, and review/check-in/incident history. Do not copy real data or print personal values in diagnostics.
- [ ] Write success/failure tests for Review Focus 1–2 and 4 before backfill; the upgrade test applies initial, populates it, then applies remaining migrations, in addition to empty replay.
- [ ] Add Person and nullable Member.personId in the first expansion if mapping decisions remain unresolved. Preserve all old columns and User links with their behavior intact. Expansion is not a completed transition; do not falsely declare NOT NULL in Prisma.
- [ ] After mapping approval, use a separate subsequent migration to backfill and enforce UNIQUE/NOT NULL on member.person_id, and add member created/updated timestamps. Move branch to person without imposing the four legacy values there; represent member_type as text + CHECK. Retain legacy personal columns until a later authorized contract stage.
- [ ] Widen committee_name and constrain code after preflight. No automatic uppercase conversion or truncation. Convert committee role to varchar + the new CHECK after resolving Coordinator; preserve its original value before an approved conversion. Change the member_committee FK to RESTRICT and add created_at.
- [ ] New DEFAULT now() timestamps represent migration time when no historical source exists; do not invent join_date or assigned_by. Limit updated_at triggers to new/changed tables without importing private guards.
- [ ] Start member identity at the safe bound above and person identity after the highest migrated ID. Test an explicit legacy ID followed by an automatically generated insert without collision. Document any serial→identity conversion in SQL rather than assuming autoincrement generates identical DDL.
- [ ] Update Member.personId test fixtures when enforcing NOT NULL, and update the CHECK manifest (16 is no longer fixed after additions). Retain all 12 registration-status tests and composite answer constraints.
- [ ] Pass two paths: two empty replays and initial→synthetic populated database→upgrade; test no-op and rollback/failure/retry. Run `pnpm check`, `pnpm build`, `prisma validate`, `test:schema:local`, and `test:startup:local`; run performance checks when related fixtures/queries change. Present results and obtain commit confirmation at each independently testable stage boundary.

### Stage C — Role history and skills

**Files:** schema; new `member_roles_skills` migration; schema tests; upgrade fixture; runner; database/decision documentation.

- [ ] Create `role`, `member_role`, `skill`, and `member_skill` using the contract above. Temporarily name the new Prisma model `ClubRole @@map("role")` if needed to preserve legacy `Role @@map("roles")` without breaking UserRole/RolePermission before their transition; this does not introduce a public API.
- [ ] Preserve legacy roles/user_roles/role_permissions and their data. Transfer roles only with an explicit approved role_id→role_code and role holder→member_id mapping; otherwise leave them untransferred with a documented gap and do not claim complete RBAC migration. Do not invent permission seeds.
- [ ] Legacy assigned_at timestamps cannot become starts_on dates without an approved timezone. Do not invent assigned_by or privileged classifications for migrated roles; resolve them in the role mapping before activation. Empty new tables can be created independently.
- [ ] Test orphan FK rejection; duplicate member-skill rejection; deletion restrictions on referenced member/skill/role; default committee role; multiple committees; concurrent duplicate active-role writes allowing only one success; two ended historical rows allowed; ends_on<starts_on rejected while permitted NULL values remain allowed.
- [ ] Test email expression indexes through raw SQL, including case/whitespace variants and multiple NULLs; inspect the partial active-role predicate in pg_catalog. Do not use an unconditional @@unique that prevents legitimate history.
- [ ] Run all Stage B checks and update the table manifest. With legacy structures retained, the stages add five tables to the existing 13 (person + role + member_role + skill + member_skill = 18); do not imply all eight targets fully replaced their predecessors.
- [ ] Present the diff, SQL, risks, and verification results, then obtain commit confirmation.

### Later boundary — Dependent transitions and removal outside this stage

- Switch event/registration actor FKs only after proving the member mapping for every creator/reviewer/check-in operator/excuse actor. Do not manufacture memberships to satisfy FKs. A participant remains a Person even without membership.
- Convert role_permissions alongside permission.code and the permission mapping. Only then switch RBAC consumers and finalize the Prisma Role model name.
- Event/questions/answers/QR/incidents stages have separate migrations and tests; preserve historical QR data and do not automatically treat resolution as excuse.
- Removing User and legacy tables/fields is a later contract stage requiring explicit approval for deletion/archival and proof that no legacy consumers remain; exclude it from this stage's SQL.
- Views, RLS, guards, audit, Supabase FK, DBA deployment, and official seeds await definitions/environments. Do not change official startup behavior as part of local table work; before connecting to an official environment, approve a startup path that does not automatically apply backend migrations there.

## Verification recorded for this planning task

- PASS: `pnpm check` — lint, typecheck, 2 test files / 12 tests.
- PASS: `pnpm build`; `pnpm exec prisma validate --config prisma7.config.ts`.
- PASS: `node test/startup-command.test.mjs` — compose command inspection only; this does not prove NestJS startup or migration execution.
- BLOCKED: Docker daemon unavailable (`docker version` could not connect). No schema/startup/performance integration suites, migrations, or queries against the application database were run.
- Reviewed all nine requested files, relevant SQL 2.2 definitions, and the complete release 2.3 PDF, including visual inspection of pages 3–5. This was not a comprehensive audit of every SQL function and permission.
- No commit, push, or PR was created; no schema, migration, or pre-existing user file was modified.

## Source locations

- PDF 2.3: `/Users/ammar/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/EDEE9BB8-F92E-4BEF-BA51-CB14C790304E/GDGoC_UJ_Database_Structure_release2_3.pdf`, dated 14 Oct 2026, 16 pages.
- SQL 2.2: `/Users/ammar/Downloads/GDGoC_UJ_schema_release2_2.sql`, SHA256 `75bb00a0534fcb5bbf4ce8331442d841097104440b4ee05d076548db30784e84`.
- SQL anchors: committee ~3255; member/member_committee/member_role/member_skill ~3534–3654; person ~3735; role/role_permission/skill ~3821–3865; indexes ~4395–4521; FKs ~4935–5391; triggers ~4654–4682. The version difference between SQL and the document is intentional and documented; it does not establish complete release 2.3 parity.

## Stage A execution result — 2026-10-15

- Implemented on the existing `feat/database-schema-migrations` branch; HEAD remains `9c10697` because no commit has been authorized.
- Sorted migration discovery and prefix copying are covered by real-filesystem helper tests, now included in `pnpm test`.
- Replaced table counts with explicit initial/current manifests, and added schema/domain-row snapshots plus per-migration failure/recovery history assertions.
- Initial rollback remains covered. A scratch-only later probe proves predecessor preservation, rollback of a populated sentinel, recovery, and no-op deployment even with only one committed migration. Actual latest-migration checks run separately when repository history grows.
- Independent read-only investigation and review completed. Review found that transaction aliases and quoted comment markers could bypass the initial guard. A regression test failed, then passed after a fail-closed guard fix. No deferred minor findings.
- Ruling: run Stage A only and keep commits pending, as explicitly requested. Use a scratch-only probe instead of waiting for Stage B to exercise multiple migrations; the cost is extra disposable-test runtime without application schema changes.
- Review boundary: populated real-domain upgrades and Stage B/C mappings remain outside this stage; the sentinel proves transactional DML rollback, not production migration compatibility. Integration execution and cleanup were verified by the implementing agent, not rerun by the read-only reviewer.
- PASS: `pnpm check` (4 Node helper tests, 12 Vitest tests, lint, typecheck); `pnpm test:schema:local` (71 schema tests per clean replay, failure/recovery/no-op scenarios, 75 e2e tests); `pnpm test:startup:local`; `pnpm test:performance:local`; script syntax, formatting, and diff whitespace checks.
- Docker was started successfully for disposable verification. Test containers, their network, and the temporary startup image were cleaned up by the runner.
- The domain schema and committed migration files remain unchanged. SHA256 values for the initial migration and both pre-existing user files match intake.
- Remaining limit: the conservative injector supports simple explicit transactions and full-line comments. SQL bodies or embedded transaction keywords require manual review before extending support. It does not provide general SQL parsing or verify release 2.3 permissions/views.
- The user approved the Stage A commit on 2026-10-15 after reviewing the result. Stages B/C have not started.
