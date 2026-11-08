# GDG Backend — Local Testing Setup

For members who do not use Docker, follow [LOCAL_SETUP.md](LOCAL_SETUP.md). It configures a dedicated Supabase test project and guarded test/migration commands. Never use the production or shared-development Supabase project for tests.

The Docker procedure in this document is optional and remains separate. `.env.test.example` now documents the Supabase test target; do not use it as a Docker connection template.

## 1. Environment overview

Each developer runs their own test database on their own machine.

| Environment | Local port | Purpose |
|---|---:|---|
| Development PostgreSQL | 5432 | Normal local development |
| Test PostgreSQL | 5433 | Automated tests only |
| Dedicated Supabase test project | Remote | Database E2E tests without Docker |
| Production or shared development Supabase | Remote | Never use as an automated test target |

The test database is separate from the existing `docker-compose.yml` development database. Do not change the existing development database configuration for this setup.

## 2. Prerequisites

Install and start Docker Desktop. In PowerShell, verify:

```powershell
docker --version
docker compose version
```

Also make sure the project prerequisites are installed (the repository's supported Node.js and pnpm versions).

## 3. Get the latest backend code

From the backend repository root:

```powershell
git pull
```

All commands in this guide should be run from the backend repository root unless stated otherwise.

## 4. Start the local test database

This repository includes `docker-compose.test.yml`, a standalone Compose file that starts only the test PostgreSQL service.

```powershell
docker compose -f docker-compose.test.yml up -d
```

Check its status:

```powershell
docker compose -f docker-compose.test.yml ps
```

Wait until the service reports healthy. You can inspect its logs with:

```powershell
docker compose -f docker-compose.test.yml logs test-db
```

The database is available from the developer's machine at:

```text
postgresql://gdg_test:gdg_test_local_only@localhost:5433/gdg_test?schema=public
```

The database data is stored in a Docker volume named `gdg_test_data`. Stopping the container does not delete this data.

### Stop the test database

```powershell
docker compose -f docker-compose.test.yml stop
```

### Start it again

```powershell
docker compose -f docker-compose.test.yml start
```

### Remove the test database and all its data

Only do this when you intentionally want a completely fresh test database:

```powershell
docker compose -f docker-compose.test.yml down -v
```

This deletes the test database volume. Do not run this command against the development Compose project.

## 5. Configure the test database connection

For the no-Docker Supabase workflow, use the steps in `LOCAL_SETUP.md`. The remaining instructions in this section apply only to the optional Docker database. Do not copy the Supabase `.env.test.example` template for this local Docker path.

The supplied Compose service creates `gdg_test`. The backend E2E guard requires its fixture database to have a `gdg_schema_test_*` name, so create a second database inside this **test-only** PostgreSQL container:

```powershell
docker compose -f docker-compose.test.yml exec test-db psql -U gdg_test -d gdg_test -c "CREATE DATABASE gdg_schema_test_local"
```

Set a base URL and a separate E2E target in the current PowerShell session:

```powershell
$env:DATABASE_URL = "postgresql://gdg_test:gdg_test_local_only@localhost:5433/gdg_test?schema=public"
$env:TEST_DATABASE_URL = "postgresql://gdg_test:gdg_test_local_only@localhost:5433/gdg_schema_test_local?schema=public"
```

Keep both values pointed at the test-only Compose database server. Never use a production or shared Supabase URL for this Docker workflow.

## 6. Prepare the test database schema

With the test database running, temporarily set Prisma's `DATABASE_URL` to the E2E target and apply the existing migrations:

```powershell
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm prisma:migrate:deploy
$env:DATABASE_URL = "postgresql://gdg_test:gdg_test_local_only@localhost:5433/gdg_test?schema=public"
```

Generate Prisma Client:

```powershell
pnpm prisma:generate
```

These scripts use the repository's existing `prisma7.config.ts`. `prisma:migrate:deploy` applies migrations only to `gdg_schema_test_local`; `pnpm test:e2e` also uses that target through `TEST_DATABASE_URL`. The base `gdg_test` database remains isolated from the development Compose project.

Do not use `prisma migrate reset`, `prisma db push`, or seed scripts unless the task specifically requires them and the database target has been verified.

## 7. Run the existing test commands

The repository currently defines these scripts:

| Command | Purpose |
|---|---|
| `pnpm test` | Runs the migration/seed Node tests, generates Prisma Client, then runs Vitest |
| `pnpm test:watch` | Runs Vitest in watch mode |
| `pnpm test:cov` | Runs Vitest with coverage |
| `pnpm test:e2e` | Runs the Vitest suite using `vitest.config.e2e.ts` |
| `pnpm test:schema` | Runs the schema-focused Vitest configuration |
| `pnpm check` | Runs lint, typecheck, and the main test command |

Start with the main suite:

```powershell
pnpm test
```

Run the E2E suite when the task or team plan calls for it:

```powershell
pnpm test:e2e
```

Run coverage when requested:

```powershell
pnpm test:cov
```

**Test classification note:** the script name `test:e2e` does not by itself prove that it tests the full browser-to-database user journey. Check the tests included by `vitest.config.e2e.ts` before describing them as full UI E2E tests. Supertest-based HTTP tests are commonly API/integration tests.

## 8. Test-writing expectations

For each test, follow the Arrange → Act → Assert pattern:

1. Arrange: create the required synthetic test data and mocks.
2. Act: call the function or HTTP endpoint being tested.
3. Assert: check the response, permissions, state transitions, and database changes where relevant.
4. Cleanup: remove test data when the test setup does not already isolate or clean it.

Never use real member data, production credentials, or production services for local automated tests.

### Integration/API test examples for this project

Prioritize tests that verify backend behavior across controllers, services, Prisma, and PostgreSQL:

- Creating an event registration persists the expected record.
- Duplicate registration is rejected.
- Unauthorized users cannot perform staff-only actions.
- An authorized reviewer can approve or reject a registration.
- Confirmation and waitlist transitions update the correct records.
- QR validation rejects invalid, expired, or already-used tokens according to the implemented rules.
- Check-in is persisted and duplicate check-in is rejected.

Use the existing test utilities, authentication test middleware, fixtures, and cleanup patterns where available. Do not replace existing authentication tests or introduce real Supabase credentials just to run local tests.

### Unit test examples

Unit tests should focus on isolated business rules, using mocks for dependencies when appropriate:

- Registration eligibility rules.
- Permission checks.
- Valid and invalid state transitions.
- Confirmation deadline calculations.
- QR validation decisions.

## 9. Pull request checklist

Before opening or updating a pull request:

- [ ] Test database is running locally.
- [ ] `DATABASE_URL` points to `localhost:5433/gdg_test`.
- [ ] Required migrations are applied.
- [ ] Relevant tests pass.
- [ ] No real user data or secrets were added.
- [ ] `.env.test.local` is not staged or committed.
- [ ] The pull request description lists the tests run and their results.

## 10. Safety rules

- Never run automated tests against Production or the main Supabase project.
- Never commit `.env`, `.env.test.local`, or credentials.
- Never assume a command is safe based only on its name; verify `DATABASE_URL` first.
- Do not run destructive Prisma commands unless the target is confirmed to be the local test database.
- Do not delete Docker volumes unless you intend to erase the local test database.

## Troubleshooting

### Port 5433 is already in use

Another process or container is using port 5433. Stop that process or change the host-side port in `docker-compose.test.yml`, then update the connection string in `.env.test.local` and the PowerShell command to match.

### Docker says the container is unhealthy

Inspect logs:

```powershell
docker compose -f docker-compose.test.yml logs test-db
```

### Prisma cannot connect

Check that the container is healthy:

```powershell
docker compose -f docker-compose.test.yml ps
```

Then verify:

```powershell
$env:DATABASE_URL
```

It should point to `localhost:5433/gdg_test`.

### A test fails because of external services

Some tests may mock Supabase, email, Google OAuth, or other external dependencies. Follow the existing test setup; do not add production credentials to make a local test pass.
