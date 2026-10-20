# Permission Reference Values Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single delivery. Results must be reviewed before a separately authorized commit.

**Goal:** Add the 30 user-approved production permission definitions locally without granting permissions to any role or member.
**Architecture:** One additive transactional Prisma migration; retain the existing five-column table and exact reference metadata. Snapshot the approved values for database assertions, and extend the existing disposable runner.
**Tech Stack:** Prisma/PostgreSQL, Node test runner, Vitest, Docker; no dependency changes.
**Spec:** User approval on 2026-10-16 and the exact values in `test/fixtures/approved-permissions.json`; the governance record documents scope.
**Branch:** `feat/permission-reference-values`, from `7851a71`; existing HTTP/database branch history remains an integration dependency.

## Constraints and review focus

- Preserve all existing migrations, schemas, unrelated records and user-owned files. Never target Supabase or configured application databases for verification.
- Copy code, description, scope, grant_permission and is_sensitive exactly: 19 global, 8 event, 3 committee; 6 sensitive definitions and 4 grant references.
- Insert definitions only; role_permission and member_role remain untouched. Metadata does not implement authorization or temporary grants.
- A collision with any approved code must fail atomically without overwriting existing metadata, even if the existing row is identical. Preserve unrelated permission definitions and links.
- Keep ordinary Docker migration startup and the optional demo seed working; update all current-data assertions and contributor instructions, without rewriting historical decisions.

## Task 1: Add and verify permission reference definitions

**Files:** Create `prisma/migrations/20261016220000_permission_reference_values/migration.sql` and `test/fixtures/approved-permissions.json`; modify `test/database-schema.e2e-spec.ts`, `test/run-schema-tests.mjs`, `README.md`, `SETUP.md`, `docs/database-prisma.md` and `docs/decision-governance.md`.
**Interfaces:** Consume the existing permission schema/self-FK. Produce 30 committed reference rows on fresh migration replay, no new tables/columns or role assignments.

- [x] Write database assertions for the exact approved metadata and Prisma grant relations; adapt fresh replay and optional-seed baseline expectations.
- [x] Run `pnpm test:schema:local` and observe the missing definitions fail on a runner-owned PostgreSQL server.
- [x] Add one BEGIN/INSERT/COMMIT migration. Extend staged upgrade checks to preserve unrelated records/links, reject code collisions atomically and verify transaction rollback through the existing latest-migration failure/recovery harness.
- [x] Run `pnpm test:seed:local` (includes two full schema replays, no-op deploy, upgrade guards, migration failure/recovery and schema/application e2e). Require exact approved rows, unchanged role grants and zero failures.
- [x] Run `pnpm check`, `pnpm build`, changed-file Prettier, diff/preservation/resource-cleanup checks. Update current contributor docs and this result record.
- [x] Obtain one independent read-only review of the baseline-to-working-tree patch; fix concrete defects and rerun affected checks. Report results before commit; no push/PR/deployment.

## Verification result — 2026-10-16

- Before implementation, the disposable schema run failed the two new reference assertions (2 failed, 138 passed), proving the definitions and grant relations were absent.
- `pnpm test:seed:local` passed: 140 schema tests on each of two clean replays; 144 combined schema/application e2e tests; exact optional-seed graph and reference preservation; no-op deploy; staged upgrade preservation with existing unrelated definitions and role links; identical/conflicting code collisions rejected atomically; injected latest-migration failure rolled back and recovered successfully.
- `pnpm check` passed lint, TypeScript, 11 Node tests and 142 Vitest tests (153 unit/helper tests total). `pnpm build`, changed-file Prettier and diff checks passed.
- One independent read-only review found no Critical, Important or Minor issues; no fix pass was needed. The parent verified production provenance via read-only plugin queries and matched the previously approved snapshot. Authorization enforcement/pre-existing HTTP runtime remain outside this metadata delivery. The unrelated proposal and frontend lockfile retain their original hashes. Final result bookkeeping is complete.
- All eight existing migration SQL files, Prisma schema/config, application code, optional seed SQL/launcher, Compose files and dependencies are unchanged. Runner containers/networks were removed. The configured application database and both Supabase environments were not modified.
- Migration/source/tests/documentation are ready locally on `feat/permission-reference-values`. After reviewing the results, the user authorized the reference-definition commit on 2026-10-16. No push, PR, deployment or application-database migration was performed. Docker startup/performance suites were not repeated: this delivery changes reference rows only, and the combined disposable seed/schema/application suite covers the affected migration paths. The earlier HTTP-stage Docker startup check remains prior evidence, not a new run.
