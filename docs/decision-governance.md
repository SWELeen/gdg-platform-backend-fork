# Decision and Source Governance

## Purpose

This document prevents product, technical, and task sources from being silently mixed or overridden. It applies to all backend changes.

## Terminology

GDG on Campus UJ is a **group**, not a club. Use “group” in documentation and participant-facing copy, as clarified by the user on 2026-10-07. Membership means group membership.

## Source Authority by Domain

- **Approved decisions** define the current accepted direction only when they explicitly supersede an older decision or document. Record material architecture and product decisions here.
- **Notion tasks** define the requirements and Definition of Done for the assigned task. They do not define unrelated architecture or current implementation details unless explicitly approved as a decision.
- **Swagger/OpenAPI** defines the current frontend-backend API contract: routes, methods, request and response schemas, authentication requirements, documented errors, and compatibility expectations.
- **Repository code, tests, configuration, Prisma schema, and committed migrations** define current implemented behavior. If implementation materially differs from documentation, report the discrepancy; do not silently reconcile it.
- **Unified Platform Proposal** defines original product intent, platform goals, major product domains, and high-level user journeys. It is not a source for current low-level implementation details.
- **Web Doc Final** defines the approved technical baseline unless a later approved decision explicitly supersedes it. The current baseline is Next.js, React, TypeScript, Tailwind CSS, Framer Motion, and GSAP for frontend; NestJS, Node.js, and TypeScript for backend; MySQL and Prisma for persistence; NestJS Auth, JWT, Google OAuth, and RBAC for authentication and authorization; and Swagger/OpenAPI for the API contract.

## Conflict handling

Do not silently choose one source when sources conflict. First identify the conflict's domain, then apply the authority for that domain. If documented authority cannot resolve it, mark it `TBD` and request team clarification. Record material architecture or product decisions here. Do not change product behavior merely to make sources appear consistent.

## Current binding decisions

| Decision | Status |
| --- | --- |
| Frontend and backend are separate repositories | Approved |
| Next.js is frontend only | Approved |
| NestJS is the authoritative backend | Approved |
| Local development/testing uses PostgreSQL and Prisma | Approved by user on 2026-10-05; supersedes the local MySQL baseline |
| Authentication uses NestJS Auth, JWT, Google OAuth, and backend-enforced RBAC | Approved direction |
| Swagger/OpenAPI is the authoritative frontend-backend contract | Approved |

## Decision record minimum

Each new decision should record: date, owner/approver, status, context, decision, affected repositories, source links, and migration or rollback implications. Link the exact Notion task for task-scoped work.

## Legacy-source clarification

Web Doc Final describes some Next.js full-stack capabilities, including Server Actions. For this platform's backend responsibilities, that guidance is superseded by the approved separate-repository architecture: Next.js is frontend only and NestJS is authoritative.

## 2026-10-05 Local PostgreSQL development

- Owner/approver: project user in the current Codex chat.
- Status: approved for local development and testing.
- Context: backend developers need a shared schema on private local databases before the Database committee provides the official PostgreSQL database.
- Decision: use local PostgreSQL, pgAdmin for inspection, and committed Prisma schema/migrations for reproducible setup. Keep credentials in ignored `.env` files.
- Affected repository: backend; frontend continues to consume the NestJS API.
- Source: user's local-database instructions and authorization to begin setup in this chat; no external source URL supplied.
- Migration/rollback: the current Prisma schema contains no models or migrations. Use a separate PostgreSQL Docker volume; do not delete or transfer any existing MySQL data. Official database migration/transfer remains a later coordinated task.

## 2026-10-05 Supabase authentication ownership

- Owner/approver: project user in the current Codex chat.
- Status: approved direction; implementation remains pending.
- Decision: Supabase Auth owns credentials. NestJS verifies provider identity and enforces local roles, permissions, membership, and committee scope. Do not store password hashes in local users.
- Source: user explicitly stated “اعتمد الsupabase auth” during the schema review.
- Schema implication: proposed nullable unique users.auth_user_id UUID links pre-existing local records to provider identities. No cross-database foreign key is assumed.
- Supersedes: the supplied workflow's local password-hash ownership; the first-login invitation/reset workflow must be adapted with the auth owner before implementation.
- Migration/rollback: no auth columns or migrations have been applied. No existing accounts or passwords are transferred by this decision.

## 2026-10-05 PR registration scope and QR attendance

- Owner/approver: project user in the current Codex chat.
- Status: approved workflow direction; schema implementation pending.
- Source: supplied Backend Workflow sections 19–20, clarified by the user; the user's subsequent QR attendance requirements.
- Decision: authorized PR staff see events requiring registration management without a separate event-assignment step. Event ownership/editing remains a separate authorization rule.
- QR decision: acceptance precedes confirmation; issue the registration-specific secure QR only after user confirmation, show the same QR in the platform and confirmation email, and permit a single backend-validated check-in by authorized staff.
- Schema impact: plan token identity and check-in metadata tied to registrations, including non-member registrations; no event-to-PR assignment table. No personal data in the QR.
- Migration/rollback: no schema or migration has been applied; exact token storage and check-in lifecycle constraints remain proposed in the design review.

## 2026-10-07 Registration lifecycle approval

- Owner/approver: project user in this chat; explicit approval: “ok done, take the approve”.
- Status: approved behavior; implementation pending.
- Decision: use the original eleven categorized registration statuses (superseded by the 2026-10-09 update below) documented in the core database design. DECLINED includes voluntary waitlist withdrawal; remaining waitlisted users become NOT_SELECTED at event start, without a warning or later promotion.
- Confirmation: authorized admin sets the event window (default 24 hours); existing approval deadlines remain unchanged when it is edited.
- Cancellation: at least two hours before start uses CANCELLED; cancellation within the final two hours uses LATE_CANCELLATION. EXPIRED and LATE_CANCELLATION create incident warnings visible to PR, without blocking registration.
- Excuse: PR may set EXCUSED and resolve the corresponding incident warning while preserving history; other unresolved warnings remain visible.
- Source: subsequent user clarifications/approval in this chat supersede the original registration-state allocation. Full transition rules and remaining event-time edge cases are recorded in the core design document.
- Migration/rollback: documentation only; no migration, seed, or database operation performed. Warning storage expands the original 12-table core and remains a proposed schema detail.

## 2026-10-07 Full registration and attendance decision approval

- Owner/approver: project user; explicit “approved” annotation on the full decision summary.
- Status: approved business behavior; implementation pending.
- Decision: new confirmation deadlines are capped at event start; admin window edits affect future approvals only. The initial PENDING/WAITLISTED cleanup proposal is superseded by the 2026-10-09 transition contract below.
- Check-in: opens one hour before start and closes at event end. CONFIRMED with no recorded check-in at end creates a NO_CHECK_IN blacklist incident; actual attendance remains separate from registration status.
- Questions: questions/options cannot be changed or deleted after the first registration.
- Blacklist: EXPIRED, LATE_CANCELLATION and NO_CHECK_IN create informational incidents, never registration blocks. PR may excuse an incident, preserving history and unrelated incidents. Participant wording is Attendance notice; Blacklist is internal/database terminology.
- Scope: all other approved authentication, group membership, PR scope, capacity, QR, cancellation, waitlist remain in force; the status set is superseded by the 2026-10-09 update below. See the core database design's Full business decision approval section.
- Source/precedence: the user's approved full summary supersedes older open questions about these workflows; it does not approve unspecified physical-schema or cryptographic choices.
- Migration/rollback: documentation only; no code, schema, database migration, commit, push or deployment performed by this approval-recording task.

## 2026-10-09 Twelve-status schema planning update

- Owner/approver: project user; latest approved status and Reject Remaining clarifications in this chat.
- Status: approved workflow; schema/migration implementation pending.
- Status set: PENDING, WAITLISTED, AWAITING_CONFIRMATION, CONFIRMED, DECLINED, CANCELLED, LATE_CANCELLATION, NOT_SELECTED, REJECTED, EXPIRED, NO_CHECK_IN, EXCUSED. Default PENDING.
- EXPIRED: PR accepted but the user missed confirmation; create a blacklist incident.
- NO_CHECK_IN: confirmed user with no recorded scan at event end transitions from CONFIRMED to NO_CHECK_IN; create a blacklist incident and preserve confirmation history. This supersedes leaving the registration CONFIRMED after missing check-in.
- Selection: explicit Reject Remaining changes only PENDING to REJECTED. At event start, remaining WAITLISTED become NOT_SELECTED without a warning. This supersedes automatic PENDING-to-NOT_SELECTED cleanup; no new rule is inferred for forgotten PENDING applications.
- Attendance: successful check-in keeps CONFIRMED and sets checked_in_at/checked_in_by. PR may excuse an incident without deleting history or releasing a seat twice.
- Affected repository: backend design and decision documentation; no API or database migration applied.
- Source: user's approvals and request to update the plan with twelve statuses. Exact transitions are in the core design's Current transition contract section.


## 2026-10-09 Physical schema implementation proposal

- Status: proposed for review, not a new approved business decision or applied schema.
- Context: translate the approved twelve-status workflow into reproducible migrations.
- Proposal: thirteen tables including registration-linked blacklist history; required starts_at/ends_at instants support multi-day camps; canonical unique login email; JSONB choice options and JSON-encoded checkbox answers. Exact columns, constraints and mapping are in the core database design.
- Execution checklist: [Database Schema Migrations Implementation Plan](superpowers/plans/2026-10-09-database-schema-migrations.md). Permission seeds and feature endpoints remain separate.
- Migration/rollback: planning only. Future verification uses dedicated disposable databases, preserving the active developer database and Docker volumes.

## 2026-10-15 Fresh local people and membership schema

- Owner/approver: project user in this chat; explicitly requested a fresh start with no links between old/new records and authorized the next implementation stage.
- Status: approved direction for local development/testing; this does not authorize a production deployment or commit without the separate stage confirmation.
- Decision: implement person/member/committee/member_committee directly from the documented DBA release 2.3 shape, excluding Coordinator. No backfill, inferred identity matching, or temporary legacy identity bridges.
- Migration: preserve the initial committed migration. A new transactional migration must lock all thirteen initial project tables and reject any populated table before changing their structure. Use a separate empty database; do not delete or reset an existing application database.
- Dependencies: participant registrations reference Person; creators/reviewers/check-in/excuse/resolution actors reference Member. Remove User/UserRole; role assignments land as member_role in Stage C, while the existing role/permission registries remain temporarily unchanged.
- Source: the user's fresh-start clarification and authorization in this chat; target columns are recorded in the English people/membership plan and sourced from the DBA release 2.3 structure PDF, with SQL 2.2 as supporting evidence only.
- Remaining limits: the official Supabase auth FK, RLS/guards/audit, views, permissions and other event/incident structures are not verified or claimed complete here. Existing populated databases are rejected and preserved, not automatically upgraded.
- Supersedes: the original people/membership expansion/backfill proposal and User/Member proposal where they conflict with this fresh-start scope.

## 2026-10-15 Role registry and initial values approval

- Owner/approver: project user in this chat; explicitly approved implementing role with ADVISOR, GROUP_LEADER and GROUP_CO_LEADER.
- Scope: role_code text primary key, optional description, is_privileged default true; initial descriptions are Club advisor, Club (group) leader and Club (group) co-leader. All three approved values have is_privileged=true. These are initial definitions, not member assignments or automatic authorization.
- Necessary dependency: change only the role side of existing role_permissions from numeric role_id to role_code, keeping numeric permission IDs and the current link table until the separately approved permission step. Referenced roles cannot be deleted.
- Preservation: new transactional migration rejects populated old roles or role_permissions before DDL, without transferring or deleting their records. Other tables are preserved. Earlier migrations are unchanged.
- Approval does not cover permission seeds/distribution, member_role, skills, deployment, commit, push or PR. Production data is reference evidence only; the repository remains the implementation authority.

## 2026-10-15 Member-role assignment table approval

- Owner/approver: project user explicitly approved member_role without initial assignments.
- Scope: the eight columns from the approved people/membership contract: id, member_id, role_code, starts_on, ends_on, assigned_by, notes and created_at. Dates, assigner and notes remain optional; no new required-start or inferred assignment rule is introduced.
- Constraints: one open-ended assignment per member/role (ends_on IS NULL), repeated ended history allowed, end not before start when both exist, required recipient/role FKs and optional assigning-member FK with delete RESTRICT/update NO ACTION.
- Migration is additive and transactional; preserve existing people, memberships, roles and permissions, with no seed assignments, transfers or changes to earlier migrations.
- Does not approve authorization endpoints, automatic expiry, permission distribution, skills, deployment or commit. Commit requires separate user confirmation.

## 2026-10-15 Skill registry and production reference values approval

- Owner/approver: project user explicitly approved skill with the 32 production values reviewed in this chat, without linking any members.
- Scope: skill_id integer BY DEFAULT identity primary key and skill_name required unique varchar(255). Preserve the reviewed reference IDs 1–32 and their exact names as initial definitions. Automatic IDs start at 1000, matching the supporting SQL 2.2 and observed Supabase identity definition; explicit reference IDs do not advance this sequence.
- Source: the user-approved production snapshot is embedded in the new local migration and asserted by test/fixtures/approved-skills.json. Production remains read-only reference evidence, not an automatic synchronization source or implementation authority.
- Preservation: additive transactional migration, no changes to prior records or migrations, no member_skill table/links, no inferred personal data or assignments. No extra name normalization or domain constraints beyond the approved shape.
- Commit requires separate confirmation. Member linking, permission redesign, APIs, Supabase deployment, push and PR remain outside this authorization.

## 2026-10-15 Member-skill junction approval and conditional commit

- Owner/approver: project user approved the reviewed three-column member_skill design and explicitly requested a commit if the implementation is good. This authorizes implementing this step and committing after passing verification and review, without a further approval question.
- Scope: generated integer identity id, required member_id and skill_id, unique member/skill pair, delete RESTRICT/update NO ACTION FKs and a skill lookup index. Start empty, with no initial member selections or proficiency fields.
- Preservation: additive transactional migration, unchanged earlier migrations and existing data. Removing a link does not remove its member or skill; referenced members/skills cannot be deleted until unlinked.
- Commit is authorized for this step only. Selection APIs, authorization, permission redesign, deployment, push and PR remain outside scope.

## 2026-10-15 Permission registry design acceptance

- Owner/approver: project user accepted the reviewed five-column permission design in this chat after discussing its suitability.
- Scope: code text primary key, required description/scope, optional grant_permission self-reference, is_sensitive default false. Scope is global/event/committee; codes contain one literal dot between lowercase/underscore segments. Grant references use delete/update NO ACTION.
- Necessary dependency: replace numeric permission_id with code in the existing role_permissions link, retaining its surrogate ID/plural name until that table's separate step. Preserve unique pairs and restrictive deletion; no permission definitions or distribution are implicitly approved by accepting the table.
- New migration locks and rejects either populated old permission table before any DDL; no backfill, inferred matching or deletion of old records. Earlier migrations and unrelated rows remain unchanged.
- Commit requires separate user confirmation. Permission seeds/distribution, final role_permission shape, authorization enforcement, deployment, push and PR are outside this step.

## 2026-10-15 Final role-permission table approval

- Owner/approver: project user explicitly approved role_permission without initial links, requesting test results before any commit.
- Scope: required role_code and code text columns, composite primary key, no surrogate ID, delete RESTRICT/update NO ACTION FKs and retained reverse code lookup index. No permission definitions or distribution is approved by this structural change.
- Preservation: lock/reject a populated legacy role_permissions table before renaming it and dropping its unused ID. No data transfer, row deletion, inferred links or seed assignments. Other data and earlier migrations remain unchanged.
- Verification is isolated. Commit requires separate confirmation; authorization enforcement, permission seeds/distribution, deployment, push and PR remain outside scope.

## 2026-10-15 Optional local development seed approval

- Owner/approver: project user supplied four people and their email/committee/global-role details, delegated a fictional fifth person and skill selection, accepted mixed current/alumni examples with the club leader current, confirmed Web/Cyber under Development with PM/PR independent, and explicitly approved the English seed plan for implementation and tests before commit.
- Scope: optional pnpm seed:dev command, 5 people/members, 5 committees, 8 committee memberships, 1 GROUP_LEADER assignment and 15 selections from the approved skill registry. The exact fixture is recorded in the local seed plan; Mohmmad is the alumni example and Sara the fictional fifth member. No extra global roles are inferred from committee leadership.
- Separate from migrations and Docker startup. Local loopback/Compose-db targets only, non-production mode, one transaction, generated IDs, compatible-row reuse and conflict rejection. Preserve unrelated records, optional details and additional links; never reset/delete or overwrite conflicts.
- No Supabase data transfer, Auth accounts, password seeding, outgoing messages, permission definitions/distribution, event fixtures or automatic startup seeding. These demo records do not implement login/authorization.
- Commit requires separate user confirmation after verification results. Push, PR and deployment remain unauthorized.

## 2026-10-16 Shared HTTP response envelope approval

- Owner/approver: project user explicitly approved the displayed response shape and requested an English implementation plan with phases and tests before execution.
- Contract: JSON API responses use success/message/data/error. Success has success=true and error=null; failure has success=false, data=null and error={code,details}. Details is always an array; only DTO validation adds pointer/message entries. Real HTTP statuses remain authoritative.
- Public error messages come from the reviewed catalog; no raw exception/SQL/token/input values are exposed. Existing root text/readiness behavior and bodyless responses are preserved. Authentication/authorization decisions remain with their owner.
- Source: [Approved design](superpowers/specs/2026-10-16-api-error-handling-design.md); [implementation plan](superpowers/plans/2026-10-16-api-error-handling.md). This decision supersedes the earlier unapproved Problem Details proposal for this task.
- After reviewing the split plan, the user authorized Phase 1A only: envelope types, success helper, owned validation metadata, tests and documentation, with results before commit. Global error-filter implementation/activation and shared validation remain pending. Commits, push, PR and deployment require separate authorization. No schema, migration, seed, frontend or authentication change is approved here.

- After reviewing Phase 1A results, the user explicitly authorized its commit on 2026-10-16 and requested an explanation of Phase 1B before implementation. The user subsequently authorized Phase 1B implementation and tests with results before commit. Phase 1C activation, further commits, push, PR and deployment require separate authorization.

- After reviewing Phase 1B results, the user authorized its commit on 2026-10-16 and requested the Phase 1C explanation before implementation. That commit/explanation request did not authorize Phase 1C runtime work, push, PR or deployment.

- The user subsequently authorized Phase 1C implementation/tests with results before commit: register the tested filter through APP_FILTER in AppModule, verify real HTTP behavior with PrismaService replaced before compilation, and document the active error contract. DTO validation, final compatibility/startup verification and any commit/push/PR/deployment remain separate steps.

- After reviewing Phase 1C results and global filter registration, the user authorized its commit on 2026-10-16 and requested the Phase 2 explanation. Phase 2 execution, further commits, push, PR and deployment require separate authorization.

- The user reviewed the Phase 2 split and authorized 2A implementation/tests with results before commit: convert class-validator errors into pointer/message details with stable ordering, private metadata omission and input preservation. Shared pipe construction (2B), global validation (2C), commits, push, PR and deployment remain separate steps.

- After reviewing Phase 2A results, the user authorized its commit on 2026-10-16 and requested the Phase 2B explanation before implementation. Phase 2B execution, further commits, push, PR and deployment require separate authorization.

- The user subsequently authorized Phase 2B implementation/tests with results before commit: build the shared validation pipe using the reviewed settings and existing owned factory/converter, and verify direct test-only DTO validation. AppModule registration/global validation (2C), commits, push, PR and deployment remain separate steps.

- After reviewing Phase 2B results, the user authorized its commit on 2026-10-16 and requested the Phase 2C explanation before implementation. Phase 2C execution, further commits, push, PR and deployment require separate authorization.

- After the Phase 2C explanation and discussion of frontend/backend validation responsibilities, the user asked to complete the current task. This authorizes Phase 2C implementation/tests: register APP_PIPE with the reviewed ApiValidationPipe, verify decorated test-only DTO requests through the real AppModule without database access, and document the active validation policy. Standing results-before-commit approval remains in force; Phase 3, commit, push, PR and deployment remain separate steps.

- After reviewing Phase 2C results, the user authorized its commit on 2026-10-16 and requested the Phase 3 explanation before implementation. Phase 3 execution, further commits, push, PR and deployment require separate authorization.
