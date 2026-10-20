# Backend Architecture

## Responsibility

This repository is the authoritative backend for the GDG Main Platform.

```
Next.js frontend -> NestJS API -> Prisma -> PostgreSQL
```

The NestJS API owns server-side authentication, RBAC enforcement, input validation, domain logic, persistence, and approved external-service integration. The separate frontend renders the user experience and consumes documented API endpoints.

## Approved stack

| Layer | Technology |
| --- | --- |
| Runtime | Host Node.js >=22.12.0; Docker uses 24.20.0 |
| Backend | NestJS with TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Authentication direction | Supabase Auth owns credentials; NestJS verifies provider identity. Google OAuth configuration remains TBD; see [Authentication and RBAC](authentication-rbac.md). |
| Authorization | RBAC |

The technical guide also identifies potential external services for file storage, email, error monitoring, analytics, and AI evaluation. Specific providers, configuration, implementation timing, and ownership are **TBD** unless an approved task confirms them.

The Web Doc Final describes some Next.js full-stack capabilities, including Server Actions. Those descriptions are superseded for platform backend responsibilities by the approved separate-repository architecture: NestJS is the authoritative backend, and Next.js is frontend only.

## Product domains

The proposal describes these platform concepts: users/members, applications, events, event registrations, teams, tasks, recommendations, announcements, attendance, roles and permissions, organizational information, and directory communication. It also describes alumni accounts and AI-assisted application evaluation.

Current implemented fields, relationships, constraints and stored statuses are defined by the Prisma schema and committed migrations; see [Database and Prisma](database-prisma.md). Approved business decisions and initial club/committee permission mappings are recorded in [Decision and Source Governance](decision-governance.md). Domain APIs, authentication/authorization enforcement and their published OpenAPI contracts remain unimplemented; unspecified behavior and release priorities remain **TBD**.

## Boundaries

- The database is accessed through backend-owned Prisma code, never directly by the frontend.
- The backend must enforce authorization even if the frontend hides an action.
- The games platform is a separately deployed legacy subsystem in the current technical guide. Its future subdomain or route placement, identity integration, and data-sharing contract require an explicit approved decision.
- AI evaluation is an integration point. This backend may send approved input and store approved results, but it must not invent evaluation criteria or replace the responsible committee’s final decision.
