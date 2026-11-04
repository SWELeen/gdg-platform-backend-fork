# Event Registration, Review and Waitlist

Members browse events, register, then confirm or decline an offered seat. PR reviews registrations, keeps an ordered waitlist, and the backend refills freed seats automatically.

## Status flow

```
PENDING ──accept──► AWAITING_CONFIRMATION ──member confirms──► CONFIRMED
   │                      ├── member declines ──► DECLINED ─┐
   │                      └── deadline passes ──► EXPIRED  ─┴─► waitlist #1 promoted
   ├──reject──► REJECTED
   └──waitlist──► WAITLISTED (waitlist_position 1..n)
```

- Accepting sets `approved_at`, `reviewed_by_member_id` and `confirmation_deadline = now + events.confirmation_window_hours` (default 24), capped at the event start. No acceptance or promotion after the event starts (`EVENT_STARTED`).
- An expired confirmation also records a `CONFIRMATION_EXPIRED` attendance notice (`registration_blacklist_entries`); notices never block registration.
- Seats held = `AWAITING_CONFIRMATION + CONFIRMED`. Accepting when held ≥ capacity fails with `CAPACITY_REACHED`.
- Every seat or waitlist change locks the event row (`SELECT … FOR UPDATE`) inside a transaction, so concurrent reviewers cannot oversell the last seat.
- Emails are sent only after the transaction commits. A failed email is logged and never undoes the change.

## Access

The auth layer sets `request.user = { personId, memberId? }` (see `src/auth/current-user.ts`); until it exists protected routes answer 401. Member routes need `personId`; PR routes need a `memberId` whose permissions come from `committee_permission`:

| Route | Permission | Granted to |
| --- | --- | --- |
| `GET /events/:eventId/registrations` | `registrants.view` | PR Leader, Co-Leader |
| `GET /registrations/blacklist` | `registrations.review` | PR Leader, Co-Leader |
| `POST /registrations/blacklist/:entryId/resolve` | PR `Leader` / `Co-Leader` position | PR Leader, Co-Leader |
| `PATCH /registrations/:registrationId` | `registrations.review` | PR Leader, Co-Leader |
| `PUT /events/:eventId/waitlist` | `registrations.review` | PR Leader, Co-Leader |
| `POST /events/:eventId/check-in` | `registrations.review` | PR Leader, Co-Leader |

Anyone else receives 403 `FORBIDDEN`.

## Member endpoints

| Route | Auth | Behavior |
| --- | --- | --- |
| `GET /events` | none | Published events with `registrationOpen` |
| `GET /events/:eventId` | optional | Published event, its questions, `registrationOpen`, and `myRegistration` when signed in |
| `POST /events/:eventId/registrations` | required | Body `{ "discoverySource": "WHATSAPP", "answers": [{ "questionId": 1, "answer": "text" }] }`; `discoverySource` is required and must be one of `WHATSAPP`, `X`, `LINKEDIN`, `ME_QR`, `LUMA_FEED`, `GOOGLE`, `INSTAGRAM`, or `TECH`. Checkbox answers are a list of options. Creates a `PENDING` registration; capacity never blocks it |
| `GET /my/registrations` | required | All my registrations with `secondsToConfirm`, `canConfirm`, `canDecline`, and `attendanceToken` (QR payload) once confirmed |
| `POST /registrations/:id/confirm` | owner | `AWAITING_CONFIRMATION` before the deadline → `CONFIRMED`, issues the QR token |
| `POST /registrations/:id/decline` | owner | `AWAITING_CONFIRMATION` → `DECLINED` and promotes waitlist #1; `WAITLISTED` → `DECLINED` and renumbers |

Answers are stored as text; checkbox choices as a JSON array string. The QR token is random and contains no personal data: the database keeps its SHA-256 hash and an AES-256-GCM copy keyed by `ATTENDANCE_TOKEN_KEY` (set it in `.env`).

## PR endpoints

### GET /events/:eventId/registrations

Query: `page` (default 1), `pageSize` (1–100, default 20), `search` (name or email, case-insensitive), `status` (a registration status).

`data` contains `event`, `summary` (`accepted`, `capacity`, `confirmed`, `awaitingConfirmation`, `waitlisted`, `pending`), `items` (`registrationId`, `name`, `email`, `blacklisted`, `status`, `registeredAt`, `waitlistPosition`, `confirmationDeadline`, `discoverySource`, `answers[]`) and `pagination` (`page`, `pageSize`, `total`, `totalPages`). `discoverySource` is the attendee's required answer to “Where did you hear about this event?”. `blacklisted` is true when the person has any unresolved blacklist entry from any event; it is informational only, so blacklisted people still register and appear here like everyone else. Items are ordered by registration time.

### PATCH /registrations/:registrationId

Body: `{ "status": "ACCEPTED" }` or `{ "status": "REJECTED" }`. Only `PENDING` or `WAITLISTED` registrations can be reviewed. An accepted registration is returned with status `AWAITING_CONFIRMATION`. Reviewing a waitlisted person removes them from the waitlist and closes the gap.

### POST /events/:eventId/check-in

Body: `{ "token": "<value read from the QR>" }`. PR staff (`registrations.review`) scan a confirmed guest's QR on the attendance page. The backend matches the token's SHA-256 hash, then requires the same event, status `CONFIRMED`, no earlier check-in, and the approved window (one hour before start until the event ends). Success records `checked_in_at` / `checked_in_by_member_id` once and returns `registrationId`, `name`, `checkedInAt`. Errors: `INVALID_QR_CODE` (400; unknown token, other event, or not confirmed), `ALREADY_CHECKED_IN` (409), `CHECK_IN_CLOSED` (409).

The registrants list also reports attendance: `summary.checkedIn`, `summary.notCheckedIn`, and each item's `checkedInAt`.

### GET /registrations/blacklist

Query: `page` (default 1), `pageSize` (1–100, default 20). Returns paginated open (unresolved) attendance incidents with their reason (`NO_CHECK_IN`, `CONFIRMATION_EXPIRED`, or `LATE_CANCELLATION`), creation/resolution timestamps, attendee name/email, registration status, and event details. Requires `registrations.review`. `data.canResolve` is true only for the PR Leader or Co-Leader.

### POST /registrations/blacklist/:entryId/resolve

Body (optional): `{ "reason": "text up to 500 characters" }`. PR committee Leader or Co-Leader only (Members receive 403). Resolves every unresolved entry of the person behind `entryId` (sets `resolved_at`, `resolved_by_member_id`, `resolution_reason`); the person then leaves the blacklist and is no longer flagged; rows are kept in the database as history. Returns `{ entryId, resolvedEntries }`. Unknown entry: 404 `BLACKLIST_ENTRY_NOT_FOUND`.

### PUT /events/:eventId/waitlist

Body: `{ "registrationIds": [12, 7, 33] }` — the complete waitlist in order; positions become 1..n. Listed registrations must belong to the event and be `PENDING` or `WAITLISTED`. Waitlisted people missing from the list return to `PENDING`. An empty list clears the waitlist.

## Data committee guest reports

The active Data committee Leader and Co-Leader can download guest lists for every non-draft event, regardless of which committee created it. Members and leaders of other committees receive 403. The API returns only name, email, registration status/timestamps, and the stored `discoverySource` answer.

- `GET /data/event-reports/events` lists reportable events and counts.
- `GET /data/event-reports/events/:eventId?group=all|going|checked-in` returns one event's rows. `all` includes every registration, `going` means `CONFIRMED`, and `checked-in` means `checked_in_at IS NOT NULL`.

The frontend exports these rows as UTF-8 CSV files that Excel can open. No database schema change is required; `discovery_source` is already stored on event registrations.
## Errors

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` / `BAD_REQUEST` | Invalid body, query or id |
| 401 | `UNAUTHORIZED` | No authenticated member |
| 403 | `FORBIDDEN` | Missing PR permission |
| 404 | `EVENT_NOT_FOUND`, `REGISTRATION_NOT_FOUND` | Unknown event, or registration not in the event |
| 409 | `CAPACITY_REACHED` | No seat left |
| 409 | `INVALID_STATUS_TRANSITION` | The registration's status does not allow this action |
| 409 | `EVENT_STARTED` | Accept/promote after the event started |
| 409 | `REGISTRATION_CLOSED` | Registration deadline passed |
| 409 | `ALREADY_REGISTERED` | Second registration for the same event |
| 409 | `CONFIRMATION_EXPIRED` | Confirm/decline after the confirmation deadline |
| 503 | `REGISTRATION_BUSY` | Too many simultaneous changes to one event (queued over 10 s); nothing changed, retry |

Domain codes are allow-listed in `src/common/http/http-error.filter.ts` (`DOMAIN_ERROR_CODES`).

## Automatic promotion

`RegistrationReviewService.promoteNextFromWaitlist(eventId)` gives waitlist #1 a seat when one is free, renumbers the rest and sends the promotion email. The member decline flow calls it after a decline; `RegistrationsModule` exports the service.

`ConfirmationExpiryJob` runs every minute: overdue `AWAITING_CONFIRMATION` rows become `EXPIRED`, then each freed seat is offered to waitlist #1. A row only expires if it is still awaiting confirmation once the event is locked, so overlapping runs never promote the same person twice.

The same job marks a still-confirmed registration `NO_CHECK_IN` once the event has ended for 24 hours without a recorded scan, and creates a `NO_CHECK_IN` blacklist entry. Cancelled events are excluded. Both transitions are conditional and idempotent.

## Tests

`test/event-registrations.e2e-spec.ts` (members) and `test/registrations.e2e-spec.ts` (PR) run against a separate database:

```sh
TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5433/gdg_schema_test_registrations?schema=public" \
  pnpm exec vitest run --config ./vitest.config.e2e.ts test/event-registrations.e2e-spec.ts test/registrations.e2e-spec.ts
```

Create that database once and apply migrations to it with `DATABASE_URL` pointing at it.

## TBD

- Email provider and templates (`RegistrationEmailService` currently only logs).
- Remaining WAITLISTED → `NOT_SELECTED` at event start, and CONFIRMED cancellation (`CANCELLED`/`LATE_CANCELLATION`): approved rules not in either task.
- Attendance token cryptography is an implementation choice to review.
- Check-in uses `registrations.review`; the unassigned `attendance.record` permission could replace it once granted.
- The confirmation email with the QR waits for the email provider.
- Swagger/OpenAPI publication for these routes.
- Shared pagination format (this module uses `page`/`pageSize`).
