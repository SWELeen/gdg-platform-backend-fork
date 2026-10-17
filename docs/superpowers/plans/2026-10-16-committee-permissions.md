# Committee Permissions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single approved delivery. Report verification before a separately authorized commit.

**Goal:** Add committee_permission and the eight approved DATA/PR rules, with reproducible local committee references.
**Architecture:** One additive transactional Prisma migration, the six-column Prisma model and relations, an approved test fixture, existing disposable database verification and contributor documentation. No authorization runtime, endpoints or Supabase deployment.
**Tech Stack:** Prisma/PostgreSQL, Vitest, Node and Docker; existing dependencies only.
**Spec:** User approval of the displayed six-column production structure and eight proposed rules on 2026-10-16; exact local definitions in test/fixtures/approved-committee-permissions.json. The governance record captures scope.
**Branch:** feat/committee-permissions from 8f4807a; existing database/HTTP/reference branch history remains an integration dependency.

## Constraints and review focus

1. Preserve all previous migrations and data. Create DATA/Data and prerequisite PR/Public Relations as root committees only when missing; reuse compatible rows by code with locally generated IDs. Conflicting name/parent/code definitions must fail atomically without overwrite.
2. Preserve the approved six columns: id BY DEFAULT identity PK; nullable committee_id; required committee_role/code/applies_to; include_sub_committees default false. Restrictive FKs; allowed roles Leader/Co-Leader/Member; applies_to own/all; NULL committee requires own. Match the production COALESCE(committee_id,0)/role/code/applies_to uniqueness and add normal FK/lookup indexes.
3. Seed exactly two DATA events.create/own rules and six PR registrants.view or registrations.review/all rules, all with include_sub_committees=false and explicit resolved committee IDs. No NULL/wildcard policy seed rules, person/member records, member assignments or global role_permission rows in the migration. The user additionally approved three fictional DATA members/positions in the optional seed only (Leader, Co-Leader, Member), with example.test emails, no global roles and no invented skill selections; preserve the original five people.
4. DATA own scope does not replace event ownership checks. Approved PR scope crosses creating committees without per-event assignment. Store metadata only; NestJS enforcement remains with the auth owner. Do not claim full DBA release conformity.
5. Adapt current fresh-manifest and optional-seed expectations, including eight demo people, six committees, eleven memberships, fifteen existing skill selections, one existing global member-role assignment and eight preserved policy rows after optional seeding. Older migration-stage manifests must remain accurate.

## Task 1: Implement and verify the committee policy registry

**Files:** Create prisma/migrations/20261016230000_committee_permissions/migration.sql and test/fixtures/approved-committee-permissions.json; modify prisma/schema.prisma, test/database-schema.e2e-spec.ts, test/run-schema-tests.mjs, README.md, SETUP.md, docs/database-prisma.md and docs/decision-governance.md and prisma/seed-development.sql.
**Interfaces:** Consume existing committee, permission and member_committee. Produce CommitteePermission and reverse Prisma relations, two reference committees, eight policy rows; retain existing demo people unchanged and add only the three user-approved optional DATA examples.

- [x] Add raw database reference/shape assertions and run pnpm test:schema:local RED before creating the table/model.
- [x] Add model/relations and one transactional migration. Validate compatible committee reuse, generate IDs locally and fail on conflicts; insert the eight rules without changing existing memberships or permissions.
- [x] Extend constraints/defaults/identity/NULL uniqueness/FK/Prisma relation tests; update staged manifests, fresh cleanup assertions and optional-seed reference preservation. Add staged upgrade cases for name/parent conflicts, missing permission rollback and compatible IDs unrelated to production.
- [x] Run pnpm test:seed:local via the existing script (two schema replays, no-op deploy, upgrade preservation, optional seed, migration failure/recovery and application e2e); require zero failures and cleaned runner resources.
- [x] Run one combined disposable `node test/run-schema-tests.mjs --seed --startup` regression to exercise the optional seed inside Docker and preserved restart state.
- [x] Update English contributor docs and decision record. Run pnpm check, pnpm build, prisma validate, changed-file formatting, diff and preservation checks.
- [x] Obtain one independent read-only review, fix concrete defects, report actual results before commit. No push/PR/deployment/configured application database changes. Review found that performance fixtures used committee ID 1; add a real-fixture database regression (observe duplicate committee_pkey), resolve its generated committee ID by SYNTHETIC code, and run pnpm test:performance:local.

**Review adjustment:** The new reference committees exposed a fixed-ID assumption in test/schema-performance.sql. Its committee INSERT and event FK now resolve generated fixture IDs. The added database regression failed on committee_pkey before the fix. The performance runner also verifies all 103 events reference the synthetic committee; run its full verification after this fix. The same authorized documentation pass corrects the skill-count wording for the three DATA examples.

## Verification result — 2026-10-16

- Core RED: 3 missing reference/table assertions failed with 140 existing cases passing before model/migration. Optional seed RED: expected DATA examples absent before extending the seed.
- Initial pnpm test:seed:local passed both 165-test schema replays and 169 schema/application e2e cases, including reference preservation, exact optional graph, membership-to-policy joins, conflict rollback, generated-ID reuse and latest-migration failure/recovery/no-op checks.
- Independent read-only review found one Important regression (performance fixture assumed committee ID 1) and one Minor outdated skill-count description. Both were corrected in scope. A new real-fixture database regression failed on committee_pkey before the fix, then passed. pnpm test:performance:local exited 0: both 166-test schema replays, 170 schema/application e2e cases, 41,300 synthetic registrations, all 103 synthetic events linked by generated committee ID and representative query plans passed. This measures query plans, not API capacity.
- The initial in-flight Docker verification encountered the same intentionally failing regression before its fixture was corrected. The final corrected node test/run-schema-tests.mjs --seed --startup run exited 0, including the full optional graph checks, two 166-test schema replays, 170 schema/application e2e cases, seed execution inside Docker, migration-before-readiness, restart preservation without reseeding and fail-closed incompatible-schema startup. The startup-command check also passed.
- Final pnpm check passed lint, TypeScript, 11 Node tests and 142 Vitest tests (153 unit/helper tests); pnpm build, Prisma validate, changed-file Prettier and diff checks passed after the fix.
- Prior migration bytes, application code/config/Compose/dependencies and both unrelated user-file hashes are unchanged. New document links resolve. Runner containers/networks/startup image were cleaned. No configured application or Supabase database was modified.
- Final review limits: future Nest authorization remains outside this delivery; approved PR cross-committee scope is retained; approved COALESCE zero/NULL uniqueness is preserved; no full DBA/Supabase deployment conformity is claimed; unrelated proposal remains untouched. These limits do not leave any known defect in this approved metadata/seed change.
- Local changes are ready on feat/committee-permissions, based on 8f4807a. After reviewing the results, the user authorized this delivery commit on 2026-10-16. Push, PR, merge and deployment remain separate actions.
