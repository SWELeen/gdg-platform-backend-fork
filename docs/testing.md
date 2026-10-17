# Backend Testing

## Current status

The repository uses Vitest and Node's test runner. `pnpm check` runs lint, type checking and unit/helper tests; `pnpm build` verifies compilation. `gdg backend test` runs checks and application e2e inside the running backend container. Coverage thresholds, contract-test tooling, CI and production deployment gates remain **TBD**.

For disposable migration, startup and representative SQL checks, follow [Database and Prisma](database-prisma.md#isolated-verification). The automatic runners require host Node.js/pnpm and Docker. They create their own PostgreSQL server and do not use the application database.

## HTTP envelope and validation checks

Run these from the backend repository:

```sh
# Fast HTTP contract checks; no PostgreSQL or Docker required.
pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts src/common/http/api-validation.pipe.spec.ts test/http-boundary.spec.ts

# Lint, TypeScript and the full unit/helper suite (includes the HTTP checks).
pnpm check
pnpm build

# Separate Docker/startup regression against a disposable PostgreSQL server.
pnpm test:startup:local
```

| Suite | Purpose |
| --- | --- |
| `api-response.spec.ts` | Exact envelope, default/custom messages, null/undefined/falsy values and owned validation metadata |
| `http-error.filter.spec.ts` | Status/code catalog, safe unexpected failures, forged metadata rejection, header/sent-response handling and bounded diagnostics |
| `api-validation.pipe.spec.ts` | Nested/missing field pointers, escaping/order, private metadata omission, decorated DTO validation and explicit conversion policy |
| `http-boundary.spec.ts` | Real Express requests through AppModule's APP_FILTER/APP_PIPE, parser versus DTO failures, root/JSON/status/204/HEAD compatibility and secret omission |

HTTP fixtures replace PrismaService before module compilation and override ConfigService with an unreachable loopback URL as a fallback. They never connect to the configured application database. They do not manually install a filter or pipe, so removing the real global registration breaks their assertions. Test routes and DTOs are excluded from the production build and do not supply business endpoints or login accounts.

The startup command is different: it provisions its own PostgreSQL server, applies committed migrations, runs schema/application e2e, checks Docker migration-before-readiness and restart preservation, and requires incompatible-schema startup to fail. It cleans only its own temporary resources. Plain application e2e uses configured database access; use the isolated runner for this regression. The optional demo seed is not applied by the startup command.

See [API Response Envelopes and Errors](api-errors.md) for contributor rules, the complete catalog and field-error examples. Swagger publication, domain/auth contracts and the frontend adapter remain separate deliveries.

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

## Club-role permission checks

Run `node test/run-schema-tests.mjs --seed` to verify the two approved members.manage links, ADVISOR with no initial permissions, Prisma role/permission navigation, existing-data preservation, duplicate/missing-reference rollback and migration replay/recovery on disposable PostgreSQL. The optional-seed check also follows Leen's and Omar's member_role links to members.manage, verifies Rania's ADVISOR has no permissions and proves committee leadership creates no global assignment. It checks extension of the prior eight-member fixture to ten members without changing existing rows/timestamps, repeat execution, missing roles and atomic rollback on a conflicting advisor. It preserves the eight DATA/PR rules. These checks verify policy data; they do not exercise an implemented API authorization guard.

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
