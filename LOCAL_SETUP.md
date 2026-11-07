# Local Backend Setup Without Docker

This guide runs the NestJS backend directly on a developer machine and uses a **dedicated Supabase PostgreSQL test project** for database-backed tests. It does not replace or modify either Compose file. Do not use the production or shared development Supabase project for test runs.

## 1. Requirements

- Node.js `>=22.12.0` (the version declared by `package.json`).
- Corepack and pnpm `12.3.4` (the version used by the backend Docker tooling and setup guide).
- Git.
- Network access to the approved Supabase project and, for real auth/email flows, the approved Supabase Auth and SMTP test configuration.

Check versions:

```powershell
node --version
corepack --version
corepack pnpm --version
```

Install dependencies from the backend repository root:

```powershell
corepack enable
corepack prepare pnpm@12.3.4 --activate
pnpm install --frozen-lockfile
pnpm prisma:generate
```

## 2. Configure a local backend runtime

Copy `.env.example` to `.env`. Use a team-approved **development** Supabase project for ordinary local application work; never use production credentials. Fill in the runtime values required by the feature you are developing, including the database URL, Supabase Auth values, frontend origin, and a valid `ATTENDANCE_TOKEN_KEY` for QR issuance.

From Supabase Dashboard, copy a PostgreSQL URI using:

- **Direct connection** on port `5432` if the developer network supports IPv6 or the project has IPv4 connectivity enabled; or
- **Session pooler** on port `5432` if direct connectivity is unavailable on the developer's IPv4-only network.

Use `sslmode=require` and URL-encode special characters in the password. Do not use the transaction pooler on port `6543` for this persistent NestJS process.

Start the backend without applying migrations:

```powershell
pnpm start:dev
```

The current `start:dev` script generates Prisma Client and starts NestJS. The backend reads `DATABASE_URL` from `.env` via `ConfigService`; migrations are a separate operation. Do not run `pnpm prisma:migrate:deploy` against a shared development database unless the database owner has approved that migration.

The optional development seed is not needed for startup and does not create Auth accounts. Do not use it on a shared Supabase database.

## 3. Provision an isolated Supabase test project

Create or obtain a Supabase project reserved only for backend tests. It must be separate from both production and any shared development project. Record the test, production, and shared-development project references from the Supabase Dashboard. The test runner refuses to continue unless the test reference is distinct from the forbidden references.

Copy the safe template:

```powershell
Copy-Item .env.test.example .env.test.local
```

Edit `.env.test.local` and set:

- `SUPABASE_TEST_PROJECT_REF` to the dedicated test project's reference.
- `SUPABASE_FORBIDDEN_PROJECT_REFS` to the production and shared-development project references, comma-separated.
- `SUPABASE_TEST_DATABASE_URL` to the test project's Direct or Session-pooler PostgreSQL URI.

The template contains placeholders only. Never paste a real connection URI into source control, chat, an issue, or a pull request. `.env.test.local` is ignored by Git.

The URI must identify the configured test project, use the `postgres` database, require SSL, and use Direct or Session pooler mode. Transaction pooler URLs are rejected. The script does not print the URI or password.

## 4. Apply migrations to the test project

Only after verifying in Supabase Dashboard that the connection URI belongs to the dedicated test project, run:

```powershell
pnpm test:supabase:migrate
```

This command validates the project reference and then applies committed migrations with `prisma migrate deploy`. It does not reset the database, drop tables, or seed data. It is safe to rerun to apply later committed migrations to the same dedicated test project.

Do not use `prisma migrate reset`, `prisma db push`, or `pnpm seed:dev` for this workflow.

## 5. Run tests

The regular `pnpm test` script runs the unit/helper suite; it does not include `*.e2e-spec.ts` files. Database-facing unit fixtures use test doubles. For the database-backed API E2E suite, use the guarded command:

```powershell
pnpm test:supabase
```

`pnpm test:supabase` validates the isolated project target, then runs the existing helper/unit suite and selected HTTP/database E2E specs against that same test project. It does not apply migrations automatically. The E2E specs create synthetic fixture rows; use only the dedicated test project and expect test data to remain there between runs. The legacy `pnpm test:e2e` command does not load `.env.test.local`; use the Supabase wrapper for remote database tests.

Run lint, type checking, the full test suite against Supabase, and the build with the guarded check command:

```powershell
pnpm check:supabase
```

The regular `pnpm test` / `pnpm check` unit suite does not include the database E2E specs. Use `pnpm test:supabase` or `pnpm check:supabase` for database-backed E2E work; do not run the unguarded `pnpm test:e2e` against a shared or production database.

## 6. Which URL is used?

The repository uses one connection URL today:

| Setting | Current use |
|---|---|
| `DATABASE_URL` | Runtime `PrismaService` and Prisma CLI via `prisma7.config.ts`. The test runner sets it to the dedicated test URL for child processes. |
| `TEST_DATABASE_URL` | Existing test-only override consumed by database E2E specs. The guarded runner sets it to the same dedicated test URL. |
| `DIRECT_URL` | Not read by this repository's Prisma 7 config or runtime service; adding it to `.env` has no effect. |

Prisma ORM 7 configures the CLI URL in `prisma7.config.ts`; the old `datasource.directUrl` property is removed in Prisma 7. This project currently points both runtime and migrations at `DATABASE_URL`, so provide a Direct or Session-pooler URL suitable for both rather than a transaction-pooler URL. Do not add a second URL variable without a separately reviewed config change.

## 7. Existing Docker workflows

`docker-compose.yml`, `docker-compose.test.yml`, and `compose.platform.yml` are retained unchanged. The Docker workflows remain available to members who use Docker. The automatic schema/startup/performance runners (`pnpm test:schema:local`, `pnpm test:startup:local`, and `pnpm test:performance:local`) create disposable PostgreSQL containers and therefore still require Docker; use the Supabase E2E path above when Docker is unavailable.

## Safety checklist

- [ ] The Supabase test project is dedicated to tests, not shared development or production.
- [ ] Test project reference differs from every reference listed in `SUPABASE_FORBIDDEN_PROJECT_REFS`.
- [ ] `.env.test.local` is not staged or committed.
- [ ] `pnpm test:supabase:migrate` and `pnpm test:supabase` are used instead of generic migration/test commands for the remote test target.
- [ ] No reset, drop, or seed command is run against a shared database.
- [ ] Test identities and fixture data are synthetic.
