# Backend Development Workflow

## Before implementation

1. Identify the approved product outcome, exact Notion task, linked decision, affected domain, access control, and data impact.
2. Inspect the existing NestJS modules, API contract, Prisma schema, migrations, and tests once source code exists.
3. Record any unknown request fields, lifecycle rule, permission, external integration behavior, or acceptance criterion as `TBD`.
4. Coordinate contract changes that affect the separate frontend before implementing incompatible behavior.

## During implementation

- Keep controllers, services, DTO validation, authorization, and persistence responsibilities clear according to NestJS conventions established in the repository.
- Validate external input at the API boundary.
- Enforce roles and permissions on the server for every protected action.
- Use Prisma schema changes and migrations for persistent data changes; never modify a deployed database manually as a substitute for a reviewed migration.
- Keep secrets out of source code, logs, error responses, and commits.
- Keep product decision-making outside code when its criteria or owner are not approved; label the dependency `TBD`.

## Before handoff

1. Run relevant checks: `pnpm check`, `pnpm build`, and application/database checks as appropriate. Use the [testing guide](testing.md) to select the commands and required environment.
2. For API changes, update and validate the Swagger/OpenAPI contract; assess compatibility and communicate any frontend action required. Domain APIs and the published Swagger route are not implemented yet.
3. Document API, auth/RBAC, schema, migration, and environment impacts.
4. Report checks actually run and unresolved `TBD` items.

## Local development baseline

Follow [Backend Local Setup](../SETUP.md) once, including the local `.env` and pgAdmin connection. Then use this workflow:

1. Pull the reviewed backend changes using your team's Git process and keep your existing `.env`.
2. Run `gdg backend run`. Startup applies pending committed migrations, then starts the backend at `http://localhost:3001`.
3. Verify migration status using the command in the setup guide. A migration failure must be resolved before continuing; preserve existing data and ask the schema owner for help.
4. **Optional:** from the backend folder, run `docker compose exec -T backend pnpm seed:dev` when you want the five demo members and their relationships. Follow the [seed walkthrough](../SETUP.md#optional-add-the-local-demo-people) for expected rows and conflict handling.
5. Develop with the source watcher, inspect local tables in pgAdmin, and run the checks relevant to your change. `gdg backend test` runs checks/application e2e inside the running container.
6. Run `gdg backend stop` when finished. Data remains available next time.

Migrations provide the structure, approved reference values, eight committee rules and two club role links (members.manage for GROUP_LEADER and GROUP_CO_LEADER; none for ADVISOR). The optional seed provides local demo people; it never runs on startup, creates no Auth identities and does not modify role_permission or committee_permission. Its Leen GROUP_LEADER assignment matches members.manage in the policy data; API enforcement remains separate. Restarting keeps existing demo rows without rerunning the seed. Each developer's database is independent; sharing code does not synchronize its rows.

Teammates apply committed migrations through startup. Only schema authors create new migrations, following [Database and Prisma](database-prisma.md#schema-authors-only). For a host process instead of the Docker backend, use the [host development instructions](database-prisma.md#optional-host-development).

Branch naming, commits, PRs, review ownership, CI, Swagger route, release process, and deployment process are **TBD** and intentionally not invented here.
