# Optional Local Development Seed Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for implementation and an independent read-only review before handoff. Execute only after the user reviews this plan. Steps use checkbox syntax.

**Goal:** Provide one optional local command that inserts the five agreed people and their membership, committee, role and skill relationships without duplicating or overwriting existing data.

**Architecture:** Keep the fixture outside migration history in a transactional PostgreSQL script, invoked by a small Node.js launcher through the installed Prisma CLI. Docker startup continues to apply migrations only. Reuse existing role/skill definitions and generate person/member/link IDs normally.

**Tech Stack:** PostgreSQL 17, Prisma 7.10.0, Node.js >=22.12.0, pnpm, existing Docker Compose setup. No new dependencies.

**Spec:** User decisions collected in this chat on 2026-10-15; current `prisma/schema.prisma`, committed migrations and `test/fixtures/approved-skills.json` define storage contracts.

## Global Constraints

- Local development only; optional explicit command, never automatic Docker/NestJS startup.
- No Supabase Dev/Production connection, remote targets, migration edits, resets, row deletions or inferred legacy identity matching.
- This is a named local demo fixture. The first four names/emails were supplied by the user; the fifth is fictional. Do not create Auth identities, passwords or send messages.
- Do not add permission definitions, role_permission links, events, or extra people.
- Keep `auth_user_id` NULL. These records do not enable login or implement authorization.
- Preserve unrelated records and links. Do not silently correct conflicting existing names, member types, committee structures or positions.
- Keep `docs/user-member-proposal.md` and the frontend lockfile unchanged.
- Implementation and commit need separate user confirmation; no push, PR or deployment.

## Proposed Fixture for Review

Emails are stored as email_personal; matching uses the existing case/whitespace-insensitive email index semantics. Preserve the supplied spelling of names and emails.

| Person | Personal email | Member type | Committee positions | Global role | Skill IDs from approved registry |
| --- | --- | --- | --- | --- | --- |
| Ammar Babaset | babaset99@gmail.com | current | WEB: Leader; PM: Member | None | 2, 3, 10 |
| Leen Alghamdi | LeenAlghamdi@gmail.com | current | None | GROUP_LEADER | 3, 4, 5 |
| Abdullah Misar | AbdullahMisar@gmail.com | current | DEV: Leader; WEB: Member | None | 3, 8, 10 |
| Mohmmad Alamri | MohmmadAlamri@gmail.com | alumni | CYBER: Member; PR: Member | None | 4, 6, 28 |
| Sara Alqahtani | sara.alqahtani@example.test | current | WEB: Co-Leader; PM: Member | None | 1, 2, 10 |

The user delegated skill selection and selection of an alumni example. Mohmmad is the alumni example; Leen remains current. Committee leadership does not create a club-level member_role. All five keep the schema's is_active=true default; alumni is a member type, not an inferred account suspension.

| Code | Committee name | Parent |
| --- | --- | --- |
| DEV | Development | None |
| WEB | Web | DEV |
| CYBER | Cyber Security | DEV |
| PM | Project Management | None |
| PR | Public Relations | None |

Skill IDs above refer to these exact existing names; resolve by name rather than assuming IDs on an arbitrary target:

| Reference ID | Skill name |
| --- | --- |
| 1 | Time Management & Organization |
| 2 | Project Planning & Scheduling |
| 3 | Team Leadership & Task Distribution |
| 4 | Critical Thinking & Decision Making |
| 5 | Reporting & Progress Tracking |
| 6 | Quality Assurance & Attention to Detail |
| 8 | Using Management Tools (Trello, Notion, ClickUp) |
| 10 | Effective Communication Skills |
| 28 | Research & Analysis |

Unspecified optional personal fields, join dates and role dates/assigner/notes remain NULL. Creation timestamps and IDs use database defaults. No fabricated university, phone number or authentication UUID.

On a freshly migrated target, the fixture adds exactly 5 person, 5 member, 5 committee, 8 member_committee, 1 member_role and 15 member_skill rows. Existing 3 roles and 32 skills stay unchanged; permission and role_permission stay empty. Re-running the command produces no additional rows or changed timestamps.

## Review Focus

- Wrong environment: reject production mode, missing/malformed URLs and nonlocal database hosts before spawning Prisma; never print credentials.
- Existing email: compare normalized email and expected name/type; reject incompatible records without changing them.
- Existing committee: match unique code, then validate expected name and parent; reject conflicts rather than overwrite.
- Partial or repeated fixture: reuse compatible rows, add only missing links, and leave additional unrelated links alone.
- Late failure: missing required role/skill or conflicting position must roll back every insertion, not leave half a graph.

## File Map and Interface

- Create `prisma/seed-development.sql`: exact fixture, preflight checks, one transaction, graph inserts and repeat-run behavior.
- Create `scripts/seed-development.mjs`: dotenv loading, exported `localSeedTarget(value, nodeEnv)` validation, and guarded CLI invocation when run directly. Pass the validated URL explicitly to the child environment; sanitize failures.
- Create `test/development-seed.test.mjs`: Node unit tests for target validation and import without executing the CLI.
- Modify `package.json`: add `seed:dev`, `test:seed:local`, and include the new guard tests in `test`.
- Modify `test/run-schema-tests.mjs`: opt-in `--seed` verification using a new runner-owned disposable database; keep normal clean-schema manifests unchanged.
- Modify `README.md`, `SETUP.md`, `docs/development-workflow.md`, `docs/testing.md`, `docs/database-prisma.md` and `docs/decision-governance.md`: optional command, complete local workflow, expected data, fixture ownership/conflict behavior and integration limits.
- Do not modify Docker Compose, Prisma config, schema or migration SQL.

### Task 1: Optional Seed Command and Verified Relationship Graph

**Consumes:** Existing migrated schema, approved role/skill definitions, fixture tables above.

**Produces:** `pnpm seed:dev`; Docker usage `docker compose exec -T backend pnpm seed:dev`; verification `pnpm test:seed:local`.

- [x] Write guard tests for accepted loopback PostgreSQL URLs and the Compose `db` hostname, rejected remote/Supabase URLs, missing/malformed input, non-PostgreSQL schemes, unexpected connection query options and `NODE_ENV=production`. Allow only the optional single `schema=public` query parameter, and reject fragments. Importing the module must not execute the seed. Return the validated URL without logging it.
- [x] Run `node --test test/development-seed.test.mjs`; expect a missing-module/export failure before implementation.
- [x] Implement the launcher with no new dependency. After target validation, execute `pnpm exec prisma db execute --file prisma/seed-development.sql --config prisma7.config.ts` with the checked DATABASE_URL. Existing dotenv and Prisma CLI are installed; `db execute --file/--config` was confirmed through local CLI help. Do not use shell interpolation of URLs or fixture values.
- [x] Add a `--seed` branch to the existing disposable runner. Create `gdg_schema_test_seed`, apply committed migrations, insert an unrelated sentinel person and record snapshots. Invoke the seed through the public launcher with that runner-owned URL. Assert the exact named fixture graph/counts above and unchanged reference registries/sentinel.
- [x] Implement the exact SQL fixture in one BEGIN/COMMIT transaction. Serialize concurrent seed invocations with one transaction advisory lock. Resolve personal email with lower(btrim(...)); resolve committees by code, skills by exact name and Leen's global role by code. Verify compatible existing rows before reuse; never overwrite conflicts or store hardcoded member IDs. A compatible open GROUP_LEADER assignment is reused, not duplicated; no other global roles are assigned. Committee and skill pairs are reused through their existing unique keys.
- [x] Assert repeat execution preserves complete domain-row snapshots, including timestamps. Delete only one runner-owned synthetic link, run again, and assert that link is restored without duplicate owners. Preserve additional unrelated links.
- [x] Exercise separate disposable conflict cases: same email/different name or member type, conflicting committee name/parent, conflicting committee position, and missing required role/skill. Each must fail clearly and leave all domain rows unchanged. Verify missing-parent/late failures roll back newly inserted graph rows. Do not remove existing personal records to force the seed to succeed.
- [x] Wire `seed:dev` and `test:seed:local` scripts and document that migrations run first; optional seeding is a second explicit command. Re-running ordinary Compose startup must not recreate a removed demo link.
- [x] Run `pnpm check`, `pnpm build`, `pnpm test:seed:local`, and the isolated startup check. Expected: unit/guard tests, graph/idempotency/conflict/rollback checks and startup preservation all pass; cleanup removes only test resources. Review the diff and verify no migrations/schema/Compose or preserved files changed.
- [x] Prepare exact fixture counts, commands and checks after independent read-only review for the user handoff.
- [x] Commit only after separate user confirmation and fresh passing verification.

## Planning Verification and Status

Inspected repository instructions, Git state, schema, package scripts, Compose startup, test runner and approved skill names. Confirmed the installed Prisma db execute CLI supports the planned file/config invocation. No seed scripts, data mutations, tests, commit or environment connections were performed while writing this plan. The user subsequently approved this plan for implementation, with test results before commit.

## Implementation Verification — 2026-10-15

- Added the optional SQL fixture/guarded launcher, seed:dev and test:seed:local commands, six guard tests and isolated graph tests. Compose, schema, migrations, Prisma config and dependency lockfiles are unchanged. scripts/ is now included in lint.
- Exact fresh fixture verified: 5 people, 5 members, 5 committees, 8 committee memberships, 1 GROUP_LEADER assignment for Leen and 15 skill selections. Existing 3 roles/32 skills and unrelated sentinel data stay unchanged; permission/role_permission/events remain empty. All five auth_user_id values and new optional join dates remain NULL. No login accounts are created.
- Guard RED→GREEN: launcher initially absent; five guard tests passed after implementation. SQL RED→GREEN: public command initially failed without the seed file; exact graph, normalized-email reuse, timestamp-preserving no-op, missing-link repair, unrelated/extra-link preservation, six conflict cases and fresh-database missing-role/skill/parent-conflict rollback cases passed.
- Final self-review found dotenv override mode could replace an explicit target both before validation and in Prisma's config. Added a unit regression and isolated child-target regression; observed both fail, then fixed by loading dotenv with override=false and removing DOTENV_CONFIG_OVERRIDE from the child environment. Both regressions pass; explicit targets now take precedence even with custom env-file paths.
- PASS on final code: pnpm check (11 Node tests including six seed guard tests, 12 Vitest tests, lint/typecheck), pnpm build, Prettier and git diff checks. Final node test/run-schema-tests.mjs --seed --startup passed seed/conflict/rollback tests, 139 schema tests per clean replay, 143 e2e tests, historical migration preservation/failure/recovery/no-op, real container seed execution and startup restart/failure checks. An earlier pnpm test:seed:local pass was followed by this combined final run after the dotenv regression fix.
- Proved ordinary startup does not rerun the optional seed: the container seed was run explicitly, one demo link was removed, and restart preserved the missing link and all remaining data. Disposable resources were cleaned up. No application, Supabase Dev or Production database was modified.
- Independent read-only review found no actionable findings before the final dotenv self-review fix; that fix was verified RED→GREEN and through the complete final suite. No deferred minor findings. Runtime checks were executed by the parent agent.
- Rulings: reused the existing suitable feature checkout to preserve user workspace/plan; tested a conflicting ordered parent and late failures rather than an unreachable missing-parent state; used db only as an alias inside the disposable network to test the same Docker command. These do not change the approved fixture or real Compose configuration.
- Preserved proposal/frontend lockfile hashes are unchanged. At implementation handoff, no commit, push or PR was performed. Performance/API/login/authorization testing is outside this seed task.

## Documentation and Commit Follow-up

- User requested a clear educational workflow. README, setup, development, database and testing guides now explain startup/migration verification, explicit optional seeding, expected people/relationships/counts, pgAdmin inspection, repeat execution, conflict handling and daily stop/restart behavior. Docker startup never invokes the seed; demo rows create no login accounts or permission grants.
- User subsequently authorized a commit after fresh verification and specifically requested verification of data relationships. Re-run checks compare the joined per-member graph against the approved fixture, not counts alone. The final independent read-only review found no actionable issues in those relationships, target guards, preservation behavior or documentation.
- Fresh pre-commit verification passed: `pnpm check` (11 Node tests and 12 Vitest tests, lint/typecheck), `pnpm build`, formatting, startup-command test, documentation link/anchor and command checks, and `node test/run-schema-tests.mjs --seed --startup` (exact relationship graph, repeat/repair/conflicts/rollback, 139 schema tests per replay, 143 e2e tests, migration preservation/recovery, actual container seed and restart behavior). All runtime checks used disposable resources; no application or Supabase database was modified.
