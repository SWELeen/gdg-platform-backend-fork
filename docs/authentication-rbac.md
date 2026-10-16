# Authentication and RBAC

## Approved direction

The user confirmed Supabase Auth as the credential owner on 2026-10-05. NestJS verifies the provider identity and enforces local role-based and committee-based access control. The backend is the authoritative enforcement point. Google OAuth remains a potential provider flow requiring configuration review.

Do not store password hashes locally. The current Person model maps to person and links to Supabase identities through the nullable unique person.auth_user_id UUID. This plain PostgreSQL setup does not install a foreign key to auth.users. Local person records may remain unlinked until invitation/setup completes. Invitation, reset, token verification, and idempotent provider-to-local provisioning must be designed with the authentication owner.

The proposal identifies these user roles: Member, Volunteer, Organizer, Employee/Staff, Admin, and later proposes Alumni. It gives examples of capabilities for Member, Volunteer, Organizer, and Admin.

## Current local role policy

The current schema and later approved decisions use GROUP_LEADER, GROUP_CO_LEADER and ADVISOR in role; committee positions are Leader, Co-Leader and Member in member_committee. The original proposal's role names above describe historical intent, not current stored codes. GROUP_LEADER and GROUP_CO_LEADER each have only members.manage as their initial role_permission link; ADVISOR has none. This permits management of members, committees and non-leader committee positions, not leadership appointments. is_privileged is not a permission bypass. DATA event creation/ownership and PR registration rules remain separate; these policy rows do not implement NestJS enforcement. See [Database and Prisma](database-prisma.md#approved-club-role-permissions).

## Historical proposal capabilities

These capabilities describe original product intent, not the current role registry or permission grants. Implement authorization using the current local role policy and approved committee rules linked above.

- A user’s role affects the pages and actions available to them.
- Members can access community-facing capabilities such as event viewing/registration and their permitted profile/task information.
- Volunteers extend member capabilities with assigned volunteer work and event participation information.
- Organizers can manage events, registrants, and assigned tasks.
- Admins have broader management authority over members, applications, events, data, roles, teams, content, and system management.
- Recommendation capability is intended for leadership, described as Organizers and Admins, not general Members.
- AI-assisted application evaluation is advisory; an authorized committee makes the final decision.

## Enforcement rules

- Authenticate requests before granting protected access.
- Authorize every protected action server-side according to an approved permission model.
- Do not rely on frontend route guards, hidden controls, or claimed role fields for security.
- Validate OAuth callback configuration and store all client secrets outside source control.
- Do not log tokens, OAuth client secrets, or personally sensitive credentials.
- Use the backend's approved CORS allowlist; do not accept arbitrary browser origins.
- Protect role changes and other sensitive authorization actions with approved audit events once audit logging is implemented.

## TBD before implementation

The following must be confirmed before coding the full auth system:

- any future role additions beyond the approved local registry;
- additional permissions beyond the approved initial club and committee mappings;
- account provisioning, deactivation, alumni transition, and role-change workflow;
- Google OAuth restrictions, consent-screen settings, callback routes, and allowed email domains;
- token transport/storage, expiry, refresh, logout, revocation, and session policy;
- Supabase password/invitation/reset flows and which OAuth providers are enabled;
- audit-log, account-recovery, privacy, and retention requirements.
- CORS allowlist, OAuth redirect allowlist, CSRF policy if cookies are used, and Swagger/OpenAPI access policy.
