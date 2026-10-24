# Membership requests API

## Current registration and approval contract

New browser registrations are submitted to `POST /auth/signup`; the full verified registration payload is held server-side until email checks finish. The browser must not create a request by reposting profile details from session storage. The signup payload contains `registrationType: "MEMBER" | "NON_MEMBER"`, `applicationData`, and (for members) `committees` plus optional `requestedGlobalRoles` (`ADVISOR`, `DEVELOPER_COMMITTEES_LEADER`). Personal email is required; university email is optional. Every provided email must be verified before data is finalized.

The backend then stores non-members in `non_member_registration`, or creates one pending `membership_request` with independent committee/global-role decisions. Member rows, committee positions, and global roles are created only after the responsible approval. Members can choose multiple committees. `Leader`/`Co-Leader` requests for Automation, Data Analysis, Web Development, AI, IoT/Robotics, and Cybersecurity require `DEVELOPER_COMMITTEES_LEADER`; other committee leadership and global role requests require `GROUP_LEADER` or `GROUP_CO_LEADER`. Ordinary member requests go to the selected committee's Leader/Co-Leader. Every decision rejects self-approval.

Leadership review endpoints:

- `GET /membership-requests/leadership?scope=DEVELOPER_COMMITTEES` — Developer Committees Leader only.
- `GET /membership-requests/leadership?scope=CLUB` — Group Leader/Co-Leader only.
- `PATCH /membership-requests/:requestId/leadership/committees/:committeeCode` — approve/reject a routed committee leadership request.
- `PATCH /membership-requests/:requestId/leadership/global-roles/:roleCode` — Group Leader/Co-Leader approve/reject Advisor or Developer Committees Leader applications.
- `GET /developer-committees/dashboard` — role-checked aggregate committee counts for the Developer Committees Leader dashboard.

All routes derive the acting person/member from a verified Supabase token in the HttpOnly session cookie (or a supported bearer integration); client-supplied actor IDs, reviewer IDs, granted roles, and approval scope are never used as authority. The submitted decision is validated and accepted only after backend permission and request-scope checks. The migration is authored, not applied. Existing descriptions below describe the legacy committee-only endpoint and are retained for compatibility context.

All routes below use the existing Supabase Auth bearer token. `POST` additionally asks Supabase Auth to confirm the token's email is verified before saving a request. Applicant identity comes from the token's `sub` mapped to `person.auth_user_id`; request bodies cannot supply a person or member ID.

## Submit an application

`POST /membership-requests`

```json
{
  "applicationData": {
    "phoneNumber": "+966500000000",
    "universityEmail": "applicant@example.test",
    "university": "University of Jeddah",
    "college": "College of Computer Science and Engineering",
    "major": "Computer Science",
    "level": "Level 4",
    "gender": "female"
  },
  "committees": [
    { "committeeCode": "DATA", "requestedRole": "Member" },
    { "committeeCode": "PR", "requestedRole": "Member" }
  ]
}
```

The initial request and each committee decision are `PENDING`. Repeated submissions for the same authenticated person return the existing request; they do not overwrite its application or duplicate committee rows.

## List requests for a committee

`GET /membership-requests?committeeCode=DATA`

Requires an active committee member who holds `applications.decide` for the requested committee. The migration grants that permission to DATA and PR Leaders and Co-Leaders only. Pending committee decisions are returned first. Applicant contact details and application data are returned only to authorized leaders.

## Decide for one committee

`PATCH /membership-requests/:requestId/committees/:committeeCode`

```json
{ "decision": "APPROVED" }
```

`decision` is `APPROVED` or `REJECTED`. A decision is immutable and a repeated decision returns `409`. Approval adds the applicant to that committee with the least-privileged `Member` position; the requested role is retained only as application information. Other committee decisions are unchanged. The overall request stays `PENDING` while any committee is pending, becomes `APPROVED` when all are decided and at least one approved, or `REJECTED` when all rejected.

Unauthenticated requests return `401`; authenticated users without the committee permission return `403`.

The migration is authored but must be applied separately after approval. No database has been migrated by this feature work.
