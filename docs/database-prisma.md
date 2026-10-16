# Database and Prisma

## Start here

For first-time setup, follow [Backend Local Setup](../SETUP.md). Docker provides PostgreSQL, pgAdmin, Node.js and pnpm; teammates do not need host Node.js/pnpm for the Docker workflow below.

The repository currently defines sixteen project tables and twelve registration statuses. `prisma/schema.prisma` defines the models; `prisma/migrations/` contains the versioned SQL, including PostgreSQL checks that Prisma models cannot express. `prisma7.config.ts` points Prisma to both paths. Keep all three in sync when changing the database. Never edit a migration that has already been applied or shared.

Each developer has a separate local database and data. The same committed migrations produce the same structure; they do not copy another developer's records or create Supabase accounts, global member-role assignments or sample events; the registry migrations insert the three approved role definitions, 32 approved skill definitions and 30 approved permission definitions. The committee migration also installs DATA/PR references and eight committee policy rules without adding people. The club-role migration installs members.manage for GROUP_LEADER and GROUP_CO_LEADER; ADVISOR has no initial links. Connecting to the official database later requires a separately reviewed deployment/data-transfer procedure.

## Fresh people/membership setup

The `20261015164000_people_membership_fresh` migration is for a **separate empty database**. It replays after the original migration, locks all thirteen original project tables, and refuses to continue if any contains records. It does not migrate, match, or delete old records. Keep an existing database and its volume intact; provision a different empty database and configure its connection separately. Do not point the regular backend startup at a populated old database expecting an automatic upgrade.

The fresh schema replaces users with person, makes member.person_id required and unique, and restricts committee positions to Leader, Co-Leader, and Member. Registrants reference Person; event creators and review/check-in/excuse/resolution actors reference Member. UserRole is removed; member_role now stores assignments of global roles to members without any initial assignments. The registries now use role_code and permission.code; role_permission now uses the role_code/code pair as its primary key, without a surrogate ID.

The official `person.auth_user_id → auth.users.id ON DELETE SET NULL` link is not installed in this plain PostgreSQL local setup: auth_user_id is a unique nullable UUID only. Release 2.3 views, RLS, guards, audit, and access rules are not reproduced. Event/incident details still follow the previous local implementation except for their identity references. This is not a complete official schema export.

## Role registry step

`20261015190000_role_registry` replaces the empty numeric `roles` registry with `role(role_code text PRIMARY KEY, description text NULL, is_privileged boolean NOT NULL DEFAULT true)`. Codes must match `^[A-Z][A-Z_]*$`; the three initial values are seeds, not an exhaustive CHECK list. It updates only the role side of `role_permissions` to required `role_code`, with delete RESTRICT/update NO ACTION. Permission IDs, the link's existing surrogate ID, and permission-side behavior remain unchanged until the permission step.

The migration locks both old role tables and rejects records in either with `role_registry_requires_empty_role_tables`. No old roles or assignments are copied or deleted. Other populated tables from the people/membership stage can be preserved. Preserve a rejected database and review it; do not delete records or bypass the guard. The migration is transactional, has no automatic down migration, and is verified only on disposable PostgreSQL. It does not deploy to Supabase, assign roles to members, implement authorization, or introduce member_role/skills.

## Member-role assignments

`20261015200000_member_role` adds `member_role` without inserts, updates or deletes of existing domain records. It leaves the three approved role definitions unchanged and creates no member assignments. Earlier migrations remain immutable.

Columns: integer BY DEFAULT identity `id`; required member_id and role_code; optional DATE starts_on/ends_on, optional assigning member assigned_by, optional notes varchar(500), and created_at timestamptz DEFAULT now(). Recipient, role and assigner FKs use delete RESTRICT/update NO ACTION, including ended history. Dates must satisfy ends_on >= starts_on when both are present; a missing date is allowed.

Custom SQL enforces UNIQUE(member_id, role_code) WHERE ends_on IS NULL and a role_code lookup index with the same predicate. The predicate means open-ended, regardless of whether the start is past or future. Ended history can repeat; this does not prevent overlaps between dated assignments. These partial indexes and the date CHECK are documented in Prisma and tested directly; do not replace them with an unconditional @@unique. Use the assignment id for Prisma unique operations.

The table stores assignments only. Expiry evaluation, authorized assignment endpoints, privilege enforcement, Supabase RLS/audit and data transfer are separate work. Verification uses disposable PostgreSQL; no application or production database is modified. The migration is transactional and additive; there is no automatic down migration deleting assignment history.

## Skill registry

`20261015210000_skill_registry` adds `skill(skill_id integer PRIMARY KEY, skill_name varchar(255) NOT NULL UNIQUE)` and the 32 production reference definitions explicitly approved by the user. The migration fixes their names and IDs 1–32 as a local snapshot; it does not fetch Supabase data during setup. `test/fixtures/approved-skills.json` records the approved values for independent exact-value tests.

skill_id is GENERATED BY DEFAULT AS IDENTITY START WITH 1000, following the supporting release 2.2 SQL and observed Supabase identity definition. The explicit seed IDs do not advance that sequence: later automatically generated IDs begin at 1000. Names use ordinary case-sensitive uniqueness; no normalization, additional CHECK or enum restriction is introduced.

The migration is additive and transactional. It changes no existing records and creates no member_skill table, member links or member-role assignments. Tests verify exact seed preservation on clean/no-op replay, identity/defaults, required/length-limited names, duplicate rejection, upgrade data preservation and failure rollback. There is no automatic down migration deleting the reference list. Member selection/linking, APIs and Supabase integration are later steps.

## Member-skill selections

`20261015220000_member_skill` adds an empty member_skill junction table: integer BY DEFAULT identity id primary key, required member_id and required skill_id. Both FKs use delete RESTRICT/update NO ACTION. The member_id/skill_id pair is unique: a member can select several skills and each skill can be selected by several members, with no duplicate selection.

The pair index supports lookup by member; the skill_id index supports listing members for a skill. No redundant member_id index is added. Unlinking a selection removes only its junction row; deleting a referenced member or skill is rejected until their links are removed.

The additive transactional migration inserts no selections and preserves all prior records, including the 32 approved skills and three role definitions. It adds no selection APIs, authorization, proficiency levels or member data transfer. No application/Supabase database is changed by isolated verification, and there is no automatic down migration deleting selections.

## Permission registry

`20261015230000_permission_registry` replaces the empty numeric permissions registry with permission: required text code primary key, required text description and scope, optional grant_permission referencing permission.code, and is_sensitive boolean NOT NULL DEFAULT false. Codes match `^[a-z_]+[.][a-z_]+$` (one literal dot); scope is global, event or committee. The optional grant reference uses delete/update NO ACTION, as in the supporting DBA DDL.

The permission-registry migration changes only the required permission side of role_permissions from numeric permission_id to text code. The subsequent role-permission migration below finalizes its name and primary key. Links retain unique(role_code, code), a code lookup index and delete RESTRICT/update NO ACTION foreign keys. No permission definitions or role-permission assignments are seeded in this step.

The migration locks permissions and role_permissions, and rejects either populated table with permission_registry_requires_empty_permission_tables before DDL. It does not infer mappings or delete old records. Other existing data, including member roles/selections and all approved registry seeds, is preserved. A rejected database must be preserved for review; do not delete records or bypass the guard. The migration is transactional and has no automatic down migration.

These columns describe permissions; they do not enforce API access, validate a user's event/committee scope, grant/revoke access, audit sensitive reads or evaluate delegation. Those behaviors and permission distribution remain separate work. The later reference-values migration below installs the approved definitions only. No application or Supabase database is modified by isolated verification.

## Approved permission reference values

`20261016220000_permission_reference_values` adds the 30 production definitions approved by the user on 2026-10-16. It preserves the exact code, description, scope, grant_permission and is_sensitive values captured in `test/fixtures/approved-permissions.json`: 19 global, 8 event and 3 committee definitions, including 6 sensitive flags and 4 grant references. The single multi-row INSERT resolves the existing self-reference constraint within the statement. No Prisma model, table, column or constraint changes are needed.

This is a versioned reference-data migration, applied by normal migration startup, not the optional people seed. Its explicit transaction inserts all definitions or none. Any existing approved code, including an identical definition, fails with permission_pkey; existing metadata is never overwritten or silently accepted. Keep the database and records intact and inspect the collision with the schema owner before a reviewed recovery. Unrelated permission definitions, existing role_permission links and all other records are preserved. A repeat migrate deploy after success is a no-op; do not rerun migration SQL manually.

The migration creates no role_permission or member_role assignments. That migration leaves role_permission unchanged; the later approved club-role migration below installs two links on fresh setup. Scope, sensitivity and grant_permission describe future access rules; they do not implement authentication, temporary grants, committee/event checks or delegation. The 21 production role links are not imported. Supabase was used as a read-only reference; remote deployment and further role distribution require separate approval. There is no automatic down migration deleting reference records.

The disposable runner checks exact fresh metadata and Prisma grant relations, upgrade preservation with existing unrelated permissions/role links, atomic rejection of identical/conflicting codes and latest-migration rollback/recovery. `pnpm test:seed:local` also verifies that the optional people seed preserves these definitions and creates no permission links. Tests never target the configured application database.

## Role-permission links

`20261015233000_role_permission` finalizes role_permission with exactly two required text columns: role_code references role.role_code and code references permission.code. The pair is its primary key, without an id column. Both FKs use delete RESTRICT/update NO ACTION. The primary key supports role lookup; the existing code index is retained for reverse permission lookup.

The migration locks the old role_permissions table and rejects any existing link with role_permission_requires_empty_link_table before renaming or dropping its surrogate ID. No link rows are copied, inferred or seeded. Other records, including existing permissions, role assignments, members and skill definitions, are preserved. Preserve a rejected database for review; do not delete records or bypass the guard.

Prisma composite-key operations use roleCode_code. Unlinking a pair removes only the junction row; referenced roles and permissions cannot be deleted while links exist. This table describes assignments and does not implement API authorization. The separately approved initial distribution is documented below. Verification uses disposable PostgreSQL; there is no production deployment or automatic down migration.

## Approved club-role permissions

`20261016233000_club_role_permissions` adds exactly two rows to role_permission: GROUP_LEADER -> members.manage and GROUP_CO_LEADER -> members.manage. ADVISOR receives no initial permissions. `test/fixtures/approved-role-permissions.json` records this separately approved local policy; the broader production mapping is not imported.

The explicit transaction inserts both pairs or none. Existing-pair collisions fail with role_permission_pkey, including an identical pair; missing role/permission references fail their foreign key. Do not delete existing links or manually rerun SQL to bypass a failure: preserve the database and review its policy before recovery. Unrelated links, existing member roles, committee rules, reference definitions and all other records remain unchanged. Normal migrate deploy applies it once; later deploys are a no-op. No schema/model changes, earlier migration edits, automatic down migration, member assignments or demo people are introduced.

members.manage describes management of members, committees and non-leader committee positions. It does not authorize appointment of committee leadership. These rows add no event creation/editing, PR review, temporary-grant or account-suspension permissions. DATA leadership and event creator ownership, and PR registration rules, remain separate. is_privileged is metadata, not an automatic grant. NestJS must still implement authentication, active/date-valid membership checks and authorization with the authentication owner; this migration changes no API behavior.

The optional seed preserves these links. Leen's GROUP_LEADER and Omar's GROUP_CO_LEADER assignments match members.manage through person -> member -> member_role -> role_permission; Rania's ADVISOR assignment has no permissions. Committee positions add no global role. The two later demo role assignments are documented below; no login accounts are created. Disposable tests check the exact fresh pairs, empty ADVISOR permissions, Prisma navigation, upgrade preservation, duplicate/missing-reference rollback, repeat deploy and optional demo joins. Configured application databases and Supabase are untouched.

## Committee permission rules

`20261016230000_committee_permissions` creates committee_permission with six columns: id integer BY DEFAULT identity PK; nullable committee_id; required text committee_role, code and applies_to; include_sub_committees boolean NOT NULL DEFAULT false. Committee and permission FKs restrict deletion and use update NO ACTION. Positions are Leader/Co-Leader/Member, scope is own/all, and a NULL committee is valid only with own. The unique expression index uses COALESCE(committee_id,0), committee_role, code and applies_to, including NULL-template uniqueness; changing include_sub_committees does not create a distinct rule. Normal committee/position lookup and permission-code indexes complement it. Prisma exposes CommitteePermission and reverse Committee.permissions/Permission.committees relations; SQL remains authoritative for expression uniqueness and CHECKs.

The migration inserts exactly eight explicitly scoped rules from test/fixtures/approved-committee-permissions.json: DATA Leader/Co-Leader get events.create/own; PR Leader/Co-Leader/Member each get registrants.view/all and registrations.review/all. All eight disable sub-committee inclusion; none uses a NULL committee. DATA is code DATA/name Data and PR is code PR/name Public Relations, both roots. Both references must exist without the optional seed, so the migration creates either missing committee and reuses compatible existing IDs by code. It never copies production IDs or modifies existing committee definitions. A code with a different name/parent fails with committee_permission_requires_matching_committees; a competing committee name or missing permission also fails. The explicit transaction rolls back the table/reference rows/rules on failure. Other records, memberships, role assignments and permission definitions remain unchanged. No automatic down migration deletes these records.

These rows describe access policy, not an implemented authorization engine. NestJS must authenticate active members and compare the position on the matching member_committee row. own limits the target committee and its events; it does not replace creator-ownership checks. The approved PR workflow crosses creating committees without a per-event assignment step. all must apply only to the corresponding permission; PR registration access does not authorize event editing. role_permission remains for separately approved club-wide policies and receives no rows here. No APIs, Supabase functions/RLS or official deployment are implemented by this migration.

The user also approved three optional fictional DATA examples: Noura Demo (Leader), Faisal Demo (Co-Leader) and Hala Demo (Member), with example.test emails, no global roles and no additional skills. They extend the original five-person graph without changing existing people. The seed reuses references and preserves the eight policy rows. Disposable tests verify exact metadata, identity/defaults, required fields, role/scope/NULL checks, expression uniqueness, restrictive FKs, Prisma relations, compatible IDs, conflict/missing-reference rollback, clean/no-op replay and optional membership-to-policy joins. No live API allow/deny behavior is claimed.

## Apply migrations — teammates

Run these commands from the backend clone after pulling the team's merged updates. Preserve your existing `.env`.

```bash
gdg backend run
```

The backend container runs `pnpm prisma:migrate:deploy` before starting NestJS. This applies pending SQL files once, in order, and records their results in `_prisma_migrations`. A repeat run with no new migrations makes no schema changes. Migration failure prevents NestJS startup. The launcher rebuilds/recreates the backend as needed; host watch mode alone does not apply new SQL migrations.

Startup does not reset the database or remove its named volume. Future migrations can still change or remove data if their SQL does so; review them before applying. Do not use `prisma migrate reset`, `prisma db push`, or `docker compose down -v` as routine setup/update steps.

## Verify success

```bash
gdg backend status
docker compose exec -T backend pnpm exec prisma migrate status --config prisma7.config.ts
```

The services should be healthy and Prisma should report that the database schema is up to date. Open `http://localhost:3001`; `Hello World!` confirms NestJS started after migration and its connection check. `migrate status` checks migration history; it does not prove that nobody changed tables manually.

In pgAdmin, expand **GDG Local PostgreSQL → Databases → gdg_platform → Schemas → public → Tables** and refresh **Tables**. Use your `POSTGRES_DB` value if you changed the default database name.

Expect these sixteen project tables, plus `_prisma_migrations`:

| Area | Tables |
| --- | --- |
| People and access registries | `person`, `role`, `skill`, `permission`, `role_permission` |
| Group membership | `member`, `committee`, `member_committee`, `member_role`, `member_skill`, `committee_permission` |
| Events and applications | `events`, `event_questions`, `event_registrations`, `registration_answers` |
| Attendance incidents | `registration_blacklist_entries` |

Fresh role contains ADVISOR, GROUP_LEADER and GROUP_CO_LEADER with their approved descriptions and is_privileged=true. Skill contains the 32 user-approved production reference values. Permission contains the 30 approved definitions described above. Committee contains DATA and PR references; committee_permission contains eight approved rules. Role_permission contains the two approved members.manage links for GROUP_LEADER and GROUP_CO_LEADER; ADVISOR has none. Other project tables, including all memberships, are empty on fresh setup. These definitions grant no member any role or permission. Do not create tables manually or insert privileged accounts to test authentication.

## Optional development seed

> **Optional and local only:** Docker startup never invokes the seed. For the complete beginner workflow, expected rows, pgAdmin inspection and conflict handling, follow [Add the local demo people](../SETUP.md#optional-add-the-local-demo-people).

Migrations install the three approved roles, 32 skill definitions and 30 permission definitions; DATA/PR references and eight committee rules are also installed. The demo graph is a separate opt-in command, not migration history. After migrations finish:

```bash
docker compose exec -T backend pnpm seed:dev
# Or, with a host-local DATABASE_URL:
pnpm seed:dev
```

Successful execution prints `Local development seed completed.`. The command runs the fixture against your configured local database; testing it separately uses `pnpm test:seed:local` below. Stopping Docker preserves the data. Pulling code or restarting the backend does not add or restore the fixture; rerun the explicit command only when needed.

The fixture is in prisma/seed-development.sql and is launched by scripts/seed-development.mjs through the installed Prisma CLI. No dependencies, Prisma config hooks or Compose startup changes are required. Only PostgreSQL URLs on localhost, 127.0.0.1, ::1 or the Compose db hostname are accepted, with an optional single schema=public query parameter. NODE_ENV=production, remote hosts and unexpected connection options are rejected before Prisma runs; credentials and database output are not printed. An explicitly supplied DATABASE_URL takes precedence over env files; dotenv override mode is disabled in the launcher and removed from the child environment so Prisma uses the checked target.

On a fresh migrated database it adds 10 person, 10 member, 4 additional committee, 11 member_committee, 3 member_role and 15 member_skill rows. DATA/PR are reused, yielding 6 committees total. The person/member IDs are generated, not fixed. The 3 role and 32 skill definitions are reused; permission, role_permission, committee_permission and event tables remain unchanged by the seed. The original names, supplied personal emails and relationships follow the approved [local seed plan](superpowers/plans/2026-10-15-optional-local-development-seed.md); the three DATA extensions follow the [committee plan](superpowers/plans/2026-10-16-committee-permissions.md). Sara, the three DATA examples and the two later club-role examples are fictional. Nine members are current; Mohmmad is alumni. Leen stays current and holds GROUP_LEADER without a committee assignment. All have is_active=true; auth_user_id and unspecified optional fields remain NULL when created. No Auth identities, passwords, messages or login functionality are created.

The later club-role examples are Omar Demo / club.coleader@example.test / GROUP_CO_LEADER and Rania Demo / club.advisor@example.test / ADVISOR. Both are current members with no committee positions or skill selections. They add only person/member/member_role rows; the existing two role_permission links and eight committee rules remain unchanged. Re-run the optional seed to extend an existing compatible eight-member fixture to ten; existing records and timestamps are preserved. Conflicting fixture records fail instead of being overwritten.

The whole graph is transactional and concurrent seed invocations serialize on one advisory transaction lock. Personal email matching uses lower(btrim(email_personal)); committee code and exact skill names resolve existing IDs. Compatible existing rows are reused without updates. Re-running leaves rows/timestamps unchanged and restores missing expected links while preserving additional links. Existing optional details are not erased. A missing registry definition or conflicting name/type/active state/auth link/committee parent/position/open-role metadata fails atomically; the command never overwrites those records or deletes rows to force success.

Failure codes include development_seed_conflict_person, development_seed_conflict_member, development_seed_conflict_committee, development_seed_conflict_position, development_seed_conflict_role, development_seed_missing_role and development_seed_missing_skill. Inspect the local data before correcting a conflict; do not reset or bypass validation. Ordinary Docker startup never invokes the seed and never repairs a removed demo link automatically.

Verify without using your development database:

```bash
pnpm test:seed:local
```

This extends the existing disposable schema runner with exact graph/count/default checks, normalized-email reuse, reference/sentinel preservation, repeated-run equality, missing-link repair, extra-link preservation and conflict/late-failure rollback. Guard tests are included in pnpm check. The combined author verification `node test/run-schema-tests.mjs --seed --startup` also executes the public seed command inside the isolated backend container and proves a subsequent ordinary restart does not rerun it.

## If migration fails

Run `gdg logs backend` to read the error; press Ctrl+C to stop following logs. Keep `.env` and connection strings private when sharing an error.

| Symptom | Next step |
| --- | --- |
| Connection refused / authentication failed | Check Docker, the database service and your local credentials. Editing `.env` alone does not change an existing PostgreSQL user's password. |
| P3005 / database is not empty | The initial migration expects an empty project schema. If you already created tables manually, stop and ask the schema owner to inspect them and plan preservation/transfer. Do not reset or baseline them yourself. |
| people_membership_requires_empty_database | Preserve the populated database; provision a separate empty one. Do not delete records or mark this migration applied to bypass its precondition. Prisma may record a failed attempt even though domain DDL rolled back. |
| role_registry_requires_empty_role_tables | Preserve the old role tables and request review; do not delete records or bypass the guard. |
| permission_registry_requires_empty_permission_tables | Preserve old permissions/role links for review; do not delete rows or bypass the guard. |
| role_permission_requires_empty_link_table | Preserve existing role links for review; do not delete rows or bypass the guard. |
| permission_pkey during permission-reference migration | Preserve existing definitions and links; inspect the duplicate code and failed migration state before any reviewed recovery. Do not overwrite/delete the existing definition or skip the migration. |
| committee_permission_requires_matching_committees | Preserve DATA/PR definitions and memberships; inspect the differing name/parent before a reviewed recovery. No definitions are overwritten. |
| P3009 / a previous migration failed | Stop and ask the schema owner to inspect migration history and the actual database state. Do not delete `_prisma_migrations` or blindly mark a migration applied/rolled back. |
| Backend is healthy but tables are missing in pgAdmin | Refresh **Tables** and verify you opened the same database/server that Docker uses. Then check migration status above. |

The initial migration wraps domain DDL in a transaction. Its tested failure case rolls back tables/enums, but Prisma still records failed migration history. The schema owner must verify rollback before any `migrate resolve --rolled-back` recovery. Future migration failures need their own state inspection; do not assume all changes rolled back.

## Optional host development

Host development requires Node.js >=22.12.0 (`package.json`) and pnpm 12.3.4 (the Docker tooling version). Configure the ignored `.env` with your local host `DATABASE_URL`. Docker uses the internal `db:5432` hostname automatically; host commands use `localhost` and `POSTGRES_PORT` instead.

From the backend folder:

```bash
pnpm install --frozen-lockfile
docker compose stop backend
docker compose up -d db --wait
pnpm prisma:migrate:deploy
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm start:dev
```

The host backend uses port 3001 by default, so stop the Docker backend first. `pnpm prisma:generate` only updates the ignored TypeScript client; it does not create or update PostgreSQL tables.

## Schema authors only

Teammates apply committed files using `migrate deploy`; they do not generate their own migration for the same change.

1. Review the approved requirement, relationships, constraints, indexes and data impact. Edit `prisma/schema.prisma` as needed.
2. Use a separate disposable local authoring database with the existing migration history applied. Point the authoring environment's `DATABASE_URL` to it before running migration commands; never use a shared/official database. Prisma's development command also needs a separate disposable shadow database or local permission to create one.
3. Validate and create a draft using the repository's actual config filename:

   ```bash
   pnpm exec prisma format --schema prisma/schema.prisma
   pnpm exec prisma validate --config prisma7.config.ts
   pnpm exec prisma migrate dev --create-only --name describe_change --config prisma7.config.ts
   ```

   `--create-only` creates a draft instead of applying the new migration, but the development command still connects to databases and may request a reset on drift. Stop if it asks to reset; inspect the mismatch first.
4. Inspect the SQL, including data loss/locking and custom PostgreSQL checks. Do not assume Prisma generates custom CHECK constraints. Update the isolated test fixtures/expectations for the new migration. The runner sorts migration directories and verifies rollback/recovery for the initial migration and the latest migration after its predecessors. Keep each tested migration inside one explicit `BEGIN;` / standalone final `COMMIT;` transaction; the failure injector masks SQL comments, quoted literals/identifiers, and dollar-quoted bodies before checking outer transaction boundaries; it rejects unsupported transaction layouts and incomplete tokens for manual review. Update the explicit `initialTables` and `expectedTables` manifests in `test/run-schema-tests.mjs` only for their respective schema snapshots, and update fixtures when adding migrations.
5. Run the checks below, review the final diff, and commit the schema, migration and relevant tests/docs together. Keep `.env`, real data and generated client files out of Git. Test and review official deployment separately.

## Isolated verification

With host Node.js/pnpm installed and Docker running, use:

```bash
pnpm check
pnpm build
pnpm test:schema:local
pnpm test:startup:local
pnpm test:performance:local
```

The three `:local` runners create their own disposable PostgreSQL server with random credentials and remove their test resources afterwards. They never use your application database. Schema checks cover integrity, two clean replays, explicit expected-table names, fixture cleanup, repeat deploy, failure/recovery, and rejection of each independently populated original table without changing its schema, records, or migration history. The nonempty fixtures temporarily disable FK triggers only inside the runner-owned test server to isolate one table at a time; application/migration code never disables these guards. Failure checks compare the schema and domain rows, preserve a synthetic sentinel, and inspect history per migration before resolving only the injected failure. A scratch-only probe migration exercises populated multi-migration rollback even when the repository has only its initial migration; it is never added to committed history. `pnpm check` also runs the migration-helper tests without Docker. Startup checks add the actual container command, HTTP readiness, restart preservation and failure protection. Performance checks add synthetic 100/400/800-registration events and 40,000 historical registrations; these are SQL query measurements, not API traffic guarantees.

For an explicitly provisioned disposable target only, `pnpm test:schema` requires `TEST_DATABASE_URL` pointing to a separate local `gdg_schema_test_*` database with the migrated schema. The command refuses missing/unsafe targets; it does not provision or migrate that database. Prefer the automatic `:local` runner. Normal application e2e skips schema cases when `TEST_DATABASE_URL` is absent.

## NestJS integration and remaining work

`PrismaModule` exports `PrismaService`, using the generated ESM client and `@prisma/adapter-pg`. It reads credentials through `ConfigService`, verifies connectivity with `SELECT 1` on initialization, and disconnects on shutdown. Build/start/typecheck/test commands generate the client automatically.

Storage constraints do not implement server permissions, state transitions, seat locking, QR issuance/scanning or scheduled expiry. Those require later NestJS features and tests. Official hosting, deployment approval, backup/restore and retention procedures remain to be agreed.
