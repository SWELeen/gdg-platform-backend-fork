# Authentication and RBAC

## Approved direction

The user confirmed Supabase Auth as the credential owner on 2026-10-05. NestJS verifies the provider identity and enforces local role-based and committee-based access control. The backend is the authoritative enforcement point. Google OAuth remains a potential provider flow requiring configuration review.

Do not store password hashes locally. The current Person model maps to person and links to Supabase identities through the nullable unique person.auth_user_id UUID. This plain PostgreSQL setup does not install a foreign key to auth.users. Local person records may remain unlinked until invitation/setup completes. Invitation, reset, token verification, and idempotent provider-to-local provisioning must be designed with the authentication owner.

The proposal identifies these user roles: Member, Volunteer, Organizer, Employee/Staff, Admin, and later proposes Alumni. It gives examples of capabilities for Member, Volunteer, Organizer, and Admin.

## Current implementation

Code lives in `src/auth/`.

**Environment** (`.env`, see `.env.example`):

- `SUPABASE_URL`: the Supabase project that issues login tokens. Without it the app still runs, logs a warning, and nobody can log in.
- `SUPABASE_PUBLISHABLE_KEY`: used by `POST /auth/login`. Without it (or `SUPABASE_URL`) the app starts, but login fails with 500.
- `SUPABASE_SECRET_KEY`: admin key, used for invites, setting passwords and undoing a half-finished signup. Keep it in `.env` only.
- `PASSWORD_SETUP_URL`: the frontend page the setup/reset email opens. Must also be listed in Supabase under Authentication > URL Configuration > Redirect URLs, or Supabase sends people to the project's Site URL instead.

**How a request is identified** (`AuthGuard`, runs before every route):

1. Reads `Authorization: Bearer <token>`.
2. Verifies the Supabase token: signature (Supabase's public keys), expiry, issuer, and audience `authenticated`.
3. Finds the `person` whose `auth_user_id` matches the token, plus their `member` row.
4. Sets `request.user = { personId, memberId, email, fromEmailLink }`. `memberId` is `null` unless the person is an active member. `email` is the login email from the token. `fromEmailLink` is `true` when the token came from clicking an invite/reset email (Supabase labels those sign-ins `otp` in the token's `amr` claim) rather than a password login.

The guard never rejects a request. No token, a bad or expired token, an unlinked account or a deactivated person all continue as a visitor with no `request.user`, so public pages keep working. Routes that need a login must return 401 when `request.user` is missing, and each route still checks its own permissions. If Supabase's keys can't be reached, the request fails with 500.

**`GET /me`**: 401 without a login. Otherwise returns `personId`, `memberId`, `fullName`, `email`, `committees` (`code`, `name`, `position`) and `roles` (club roles current today, Saudi date). Inactive members get empty `committees` and `roles`.

**`POST /auth/login`**: body `{ email, password }`. Supabase checks the password; nothing is stored locally. Returns `accessToken`, `refreshToken` and `expiresAt` (Unix seconds). A wrong email or password gets the same 401, so it doesn't reveal which emails exist. Other Supabase failures (including its rate limit) return 500. Login doesn't check the local `person`: an unlinked or deactivated account still gets tokens, but the guard treats it as a visitor, so `/me` and protected routes return 401.

**`POST /auth/check-email`**: body `{ email }`. Always 200 with `{ nextStep }`, which tells the frontend the next screen: `PASSWORD_REQUIRED` (a `person` with this email is linked to a Supabase account → password box), `PASSWORD_SETUP_REQUIRED` (a `person` exists but isn't linked yet → setup link), `SIGNUP_REQUIRED` (no `person` → signup). Looks in `email_personal` and `email_university`, ignoring letter case. Doesn't check `is_active`; a deactivated person can log in but the guard treats them as a visitor.

**`POST /auth/signup`**: body `{ fullName, email, password }` (password 8-72 characters; the frontend checks "confirm password"). If any `person` already has the email in `email_personal` or `email_university`, or Supabase already has the account, returns 409 `EMAIL_ALREADY_EXISTS`. Otherwise creates the Supabase account and a `person` row (`full_name`, the email in `email_personal`, linked `auth_user_id`) and returns 201 with the same tokens as login. It never creates a `member` row or role. If saving the `person` fails, the new Supabase account is deleted again; if that delete fails too, the account id is logged so it can be removed in the Supabase dashboard. Requires "Confirm email" to be off in Supabase; otherwise signup returns 500 and saves no `person`.

**Password setup for existing members** (two steps; the person has to prove they own the email):

1. **`POST /auth/setup-password/request`**: body `{ email }`. 404 if no `person` has the email. If the person isn't linked yet, Supabase creates the account and emails an invite, and the backend links `auth_user_id` immediately (never later by matching emails); if linking fails, the invited account is deleted again. If they're already linked (expired invite or forgotten password), Supabase sends a reset email instead. If a Supabase account with that email exists but isn't linked to the person, returns 409 and needs fixing by hand. Supabase's email limit returns 429. Success: 200, `data: null`.
2. The email link opens Supabase, which redirects to `PASSWORD_SETUP_URL` with a temporary `access_token` in the address (`#access_token=...`).
3. **`POST /auth/setup-password`**: `Authorization: Bearer <that access_token>`, body `{ password }` (8-72 characters). 401 without a valid login; 403 if the token came from a normal password login instead of the email link, so a stolen login token can't change the password. Sets the password and returns 200 with the same tokens as login.

**Testing as a demo person locally**: put a Supabase test user's id in that person's `auth_user_id`, log in as the test user with `POST /auth/login`, and send the returned `accessToken` as `Authorization: Bearer <token>`.

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
- first login for existing members: proposed email invite link instead of choosing a password directly (Backend Workflow section 4), so knowing a member's email isn't enough to claim the account; pending team confirmation;
- signup: proposed Supabase account + `person` row only, no `member` row or role, matching the schema (Backend Workflow section 5 says role MEMBER); pending team confirmation;
- one shared Supabase project for development, so every backend trusts the same logins;
- who sets up Swagger/OpenAPI for the project;
- signup email verification: with "Confirm email" off, anyone can sign up with an email they don't own, which blocks the real owner and sends them our registration emails; decide whether signup must verify the email first;
- optional signup fields from the Backend Workflow form (phone, university/student ID, college/major): not collected until the team says they're required;
- check-email reveals whether an email is registered (part of the email-first login flow); confirm that's acceptable;
- `SIGNUP_REQUIRED` is a proposed name; the task list only names `PASSWORD_REQUIRED` and `PASSWORD_SETUP_REQUIRED`;
- which email column existing members log in with (`email_personal` or `email_university`); check-email and signup look in both for now;
- setup-password uses two routes (`/auth/setup-password/request` + `/auth/setup-password`); the task list names only `POST /auth/setup-password`;
- the real frontend page for `PASSWORD_SETUP_URL`;
- login error code: plain `UNAUTHORIZED` for now; `INVALID_CREDENTIALS` would need adding to the shared error filter's domain codes;
- Supabase limits sign-ins per IP, and every login reaches Supabase from the backend's one IP, so all users share that limit; raise it or find another fix before launch.
