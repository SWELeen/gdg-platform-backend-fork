# Backend Testing

## Current status

The repository uses Vitest and Node's test runner. `pnpm check` runs lint, type checking and unit/helper tests; `pnpm build` verifies compilation. `gdg backend test` runs checks and application e2e inside the running backend container. Coverage thresholds, contract-test tooling, CI and production deployment gates remain **TBD**.

For disposable migration, startup and representative SQL checks, follow [Database and Prisma](database-prisma.md#isolated-verification). The automatic runners require host Node.js/pnpm and Docker. They create their own PostgreSQL server and do not use the application database.

## Optional seed: using it versus testing it

| Goal | Command | Database affected |
| --- | --- | --- |
| Add the demo people for local development | `docker compose exec -T backend pnpm seed:dev` | Your running local development database; this is an explicit data change |
| Check the launcher's URL/environment guards | `pnpm check` | No seed is applied to your development database |
| Verify the complete fixture and rollback behavior | `pnpm test:seed:local` | A disposable PostgreSQL server created and removed by the runner |
| Also verify Docker seed execution and ordinary restart behavior | `node test/run-schema-tests.mjs --seed --startup` | Disposable PostgreSQL and backend containers |

Run these commands from the backend repository. The last two require host Node.js/pnpm and Docker. The seed is not required for ordinary application e2e or for starting the backend.

The disposable seed checks verify exact people and relationships, reference-value preservation, repeat execution without duplicates or timestamp changes, restoration of missing expected links, preservation of unrelated links, and complete rollback on conflicts or missing references. The combined startup check also proves a normal restart does not run the seed again. These tests remain as regression checks for future changes.

For adding data and inspecting it in pgAdmin, follow the [setup walkthrough](../SETUP.md#optional-add-the-local-demo-people). Demo records do not provide login accounts or implement authorization.

## Minimum verification expectation

For every change, run the relevant checks that the actual repository exposes and report only those actually run. Where relevant, verify:

- DTO validation and error handling;
- authentication and server-enforced RBAC behavior;
- both allowed and denied cases for every changed sensitive permission;
- service/domain behavior;
- Prisma queries and migration impact against a safe environment;
- API response compatibility with the published contract;
- OpenAPI specification validation and contract compatibility for changed operations;
- build/type/lint checks;
- regression paths for the affected domain.

## Database and integration safety

Never use production credentials or production data as a default test target. Application e2e reads the configured local database; isolated schema tests use a separate guarded target and clean their fixtures. The automatic migration runners remove their own temporary containers/networks. If Docker becomes unavailable during cleanup, runner-named resources may remain; do not use global prune to remove them. External-service sandboxing, AI-evaluation fixtures and production traffic validation remain **TBD**.
