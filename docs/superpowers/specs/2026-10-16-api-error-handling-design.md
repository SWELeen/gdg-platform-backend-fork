# API Error Handling and Response Contract — Design Proposal

**Status:** Response Envelope contract approved by the user on 2026-10-16. Phases 1A/1B/1C/2A are committed (ee71e3a/ff688e1/63c17a3/f0ab6a8). The user authorized 2B implementation/tests with results before commit. ApiValidationPipe is implemented and verified directly with test-only DTOs; the user authorized its commit after reviewing the results. Global validation (2C) and final compatibility/startup handoff (Phase 3) remain pending.
**Owner scope:** Person 1: shared error handling and response conventions.
**Baseline:** Backend `9246fde`; frontend `a00d03e`; inspected authentication branch snapshot `f107092`.
**Working branch:** `feat/api-error-handling`, created from `9246fde`. It currently includes the database work in open PR #4; settle that dependency before preparing a separate implementation PR.

## Goal and evidence

Give backend contributors one predictable way to report HTTP failures and frontend contributors a stable contract for handling them. Preserve the current successful root response and database startup behavior.

Observed repository facts:

- Backend `docs/api-standards.md` explicitly leaves the error envelope and standard error format undecided. The frontend `docs/api-integration.md` requires an approved contract before consuming one.
- No application-wide custom exception filter, validation pipe, response interceptor, API error type or shared frontend HTTP client was found in the inspected application code.
- `GET /` returns the text `Hello World!`. Application e2e and the Docker startup runner depend on that exact response.
- NestJS 12, `class-validator` and `class-transformer` are installed. The installed NestJS `HttpException` supports an `errorCode` option; a new custom exception hierarchy is unnecessary.
- The inspected token verifier returns `null` for invalid tokens and throws infrastructure/configuration failures. It is not registered in AppModule at that snapshot. Authentication decisions and guards remain Person 2's work.

The user asked us to check the repositories for an existing agreement. These findings establish the absence of an implemented/documented envelope in the inspected code, not the absence of an offline team discussion. The user subsequently approved the exact revised envelope shown below.

## Options and selected direction

| Option | Benefit for this project | Cost or limitation | Recommendation |
| --- | --- | --- | --- |
| RFC 9457 errors + explicit success DTOs | Standard error representation; consistent client handling; no global success rewriting | A different outer shape for success and failure | Previously recommended; superseded by the user's envelope preference |
| NestJS default errors + documented conventions | Smallest runtime change; reuses built-in response fields and errorCode | The project must still normalize validation, parser and safe-message behavior | Reasonable fallback if the team prefers the native shape |
| A custom `{ success, message, data, error }` envelope for JSON API responses | Familiar fixed shape with a readable outcome/reason and structured error codes | Project-specific format; needs explicit handling of non-JSON/bodyless responses | Selected by the user |

The user prefers the envelope they already use, including a message that explains failures. Use that direction consistently for success and errors. The revised format is a project-specific JSON contract, not [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html). Keep explicit operation DTOs inside data; pagination belongs to the first real listing contract.

## Approved public response contract

JSON API responses use `Content-Type: application/json` and these four top-level keys:

| Field | Success | Failure |
| --- | --- | --- |
| `success` | `true` | `false` |
| `message` | Safe outcome text; default `OK` | Safe reason from the error catalog |
| `data` | The operation's typed result, or `null` when there is none | `null` |
| `error` | `null` | `{ code, details }` |

The actual HTTP status remains authoritative. A failure is a 4xx/5xx response, never a 200 response containing success=false. The success flag must agree with the HTTP outcome. Empty success responses such as 204 and HEAD remain bodyless.

Illustrative success (200; the example's business fields do not define a new endpoint):

```json
{
  "success": true,
  "message": "OK",
  "data": { "id": 1, "name": "Ammar" },
  "error": null
}
```

Illustrative failure (401):

```json
{
  "success": false,
  "message": "Authentication is required.",
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "details": []
  }
}
```

Core application catalog:

| HTTP status | Code | Public message |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | The request is invalid. |
| 400 | `VALIDATION_ERROR` | Some fields are invalid. |
| 401 | `UNAUTHORIZED` | Authentication is required. |
| 403 | `FORBIDDEN` | You do not have permission to perform this action. |
| 404 | `NOT_FOUND` | The requested resource was not found. |
| 409 | `CONFLICT` | The request conflicts with the current state. |
| 500 | `INTERNAL_ERROR` | An unexpected error occurred. |

- Clients use `error.code` to identify the failure. The message explains the reason to humans; clients must not parse it for application logic. The UI can map codes to its own translations. The error object always has a `details` array; use `[]` when no public field details apply.
- Only DTO validation populates `error.details`, with `{ pointer, message }` entries. Use [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901.html) paths such as `/email` and `/answers/0/value`, including escaping for slash/tilde property names. Return one entry per failed constraint in deterministic order. A missing required field can have a pointer even though that value is absent; clients use it as a field address, not a guarantee they can dereference it. This supports the nested answers used by later tasks.
- Use safe public copy from the catalog. Do not echo arbitrary exception response objects, messages, parser input, Prisma metadata, SQL, stack traces, tokens or submitted field values. DTO validators must use public-safe messages without interpolating submitted values.
- Known HTTP exceptions outside the table retain their valid 4xx/5xx status, with `HTTP_ERROR`, `The request could not be completed.` and empty details. Never turn an intentional 413, 429 or 503 into 400/500.
- New business codes require an explicit documented status and safe message in the catalog. Do not infer business meaning from exception text or automatically map every Prisma duplicate to a publicly visible conflict.

Approved validation example (400):

```json
{
  "success": false,
  "message": "Some fields are invalid.",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      { "pointer": "/email", "message": "Email must be valid." }
    ]
  }
}
```

On 2026-10-16 the user approved this four-key success/failure contract and requested planning before implementation. The prior Problem Details fields/type URI and media type are superseded. No timestamps, request URLs or request IDs are added in this first task.

## Runtime design

### HTTP error boundary

Register one catch-all HTTP filter with `APP_FILTER` in AppModule, using the existing HTTP adapter. Set application/json for writable failure responses; preserve unrelated response headers already set by authentication/rate-limit code, including challenge or retry headers. Respect already-sent responses and bodyless HEAD responses. See [NestJS exception filters](https://docs.nestjs.com/exception-filters).

Resolve explicit catalogued errors from Nest's supported `errorCode` mechanism, with a fixed code/status pairing. A mismatched or unknown supplied code falls back to the actual HTTP status policy; it is not copied blindly. Only the validation factory owns nonempty field details. Unrecognized thrown values become a safe 500 envelope.

Treat supported adapter/parser failures intentionally: malformed JSON and invalid URI encoding remain a generic 400, while oversized JSON remains 413. Do not label every 400 as DTO validation. Do not trust arbitrary thrown objects merely because they contain `statusCode` or `message`.

Record safe diagnostics for server failures using the existing Nest logger: a fixed event name, safe error category, method, status and public code. Never serialize the complete exception/cause, request, body, headers or raw URL. A later observability task can add correlation and reviewed stack redaction without changing the public error contract.

### DTO validation boundary

Register one `APP_PIPE` using the installed ValidationPipe and validator packages. Proposed settings: `whitelist: true`, `forbidNonWhitelisted: true`, `forbidUnknownValues: true`, `transform: false`, `validationError: { target: false, value: false }`. Build the catalogued `VALIDATION_ERROR` through its exception factory. See [NestJS validation](https://docs.nestjs.com/techniques/validation).

Reject extra properties instead of accepting them silently. Keep all field failures so the UI can display them together. Handle nested objects and arrays. Request-field conversions remain explicit in the owning DTO/pipe; do not enable implicit conversion globally. Each future endpoint must supply an actual decorated DTO for these checks to apply.

### Success, startup and ownership boundaries

- Future JSON APIs use an explicit typed success envelope through one small shared helper. The helper accepts the operation result and optional safe message defaulting to `OK`; it does not choose an HTTP status. Publish this usage in the team contract so endpoint authors apply it consistently. No automatic global response interceptor is added.
- Preserve the existing `GET /` text, content type and readiness checks. 204 and HEAD have no response body. Redirects, files and streams are not automatically wrapped. Future success DTOs and any non-JSON behavior are documented per endpoint.
- The existing frontend AuthErrorMessage expects a translation key. A future API integration must map `error.code` to UI keys and treat `message` as fallback copy; it must not pass backend text straight into that translation-key prop. Richer per-field localization identifiers can be added when a real consumer needs them.
- The filter formats failures; it does not authenticate users, evaluate permissions, translate token-verifier `null` results into HTTP responses, or implement domain operations. Preserve an explicitly raised 401/403; infrastructure failures must not be mislabeled as invalid credentials.
- Module initialization and migration errors still prevent startup. An HTTP filter does not repair a failed database connection or report it as a successful HTTP response.
- No schema/migration/seed changes, permission grants, production connections, frontend code changes, Swagger installation or new production endpoints are included.

## Proposed file map

| File | Responsibility |
| --- | --- |
| `src/common/http/api-response.ts` | Discriminated success/failure types, success helper and private validation-error metadata bridge |
| `src/common/http/http-error.filter.ts` | Core error catalog, HTTP failure envelopes, safe fallback and logging |
| `src/common/http/api-validation.pipe.ts` | Validation settings, safe field errors and nested pointers |
| `src/app.module.ts` | Register the filter and pipe through Nest providers |
| `src/common/http/api-response.spec.ts` | Success helper and owned validation-error metadata tests |
| `src/common/http/http-error.filter.spec.ts` | Adapter edge cases, safe fallback and logging tests |
| `src/common/http/api-validation.pipe.spec.ts` | Validation conversion, nested pointers and safe public fields |
| `test/http-boundary.spec.ts` | Real HTTP behavior with test-only controllers and a PrismaService test override; no database connection |
| `docs/api-errors.md` | Stable error catalog and backend/frontend examples |
| `docs/api-standards.md`, `docs/testing.md`, `docs/decision-governance.md` | Record the accepted contract and verification commands after approval |

Use existing dependencies and test scripts. One typed helper and one error filter are sufficient; avoid a new HTTP module, custom exception family, response-wrapper framework or per-controller filters.

## Delivery phases and acceptance evidence

1. **Contract approval — complete.** The user approved the exact four-key success/failure envelope and requested the English implementation plan before starting. See [Implementation Plan](../plans/2026-10-16-api-error-handling.md). Phase 1A was reviewed and authorized separately; further deliveries require their own user instruction. Recheck Git, database PR #4 and the authentication branch at execution time; no merge or push is part of planning.
2. **Global error boundary.** Write failing tests for the typed success helper, status/code catalog and HTTP error filter; implement the smallest formatter and AppModule registration. Include 401, 403, actual unknown-route 404, generic 400, 409, explicit 413/429/503 and unknown 500 cases. Assert the four outer keys, mutually exclusive data/error values, HTTP outcome/success consistency and empty generic details. Verify no secret/message/query reflection, no double response, and preservation of existing headers. Run focused tests and review the change.
3. **Validation boundary.** Write failing HTTP tests for valid input, missing required fields, extra properties, invalid formats, nested arrays, escaped pointers and multiple errors; implement the shared pipe. Test malformed JSON and oversized payloads separately, so transport errors keep their meaning. Check that responses and diagnostics omit submitted values and that JSON Pointer output remains deterministic.
4. **Compatibility and handoff.** Test the unchanged root text, explicit JSON success envelopes/default and custom messages/status, null data for successful no-result operations, 204 and HEAD using test-only controllers. Exercise the actual AppModule registration with PrismaService overridden so shared boundary tests need no database. Publish the catalog, helper usage and examples, and run `pnpm check`, `pnpm build` and one disposable startup check (`pnpm test:startup:local`) for the real app's root/readiness behavior. Report evidence before requesting a commit for this phase.

Unknown, null and non-Error thrown values, malformed parser errors, production-style secret-bearing messages, status/code mismatches, header preservation and bootstrap failures are review priorities. Test controllers stay inside tests; do not ship demo error endpoints. Shared tests are a permanent regression suite.

## Decisions deliberately deferred

Domain-specific error lists, validation rules for real request fields, authentication/authorization flows, pagination, localization transport, request IDs, error monitoring, retry policies and Swagger publication belong to their owning work. Add them when their behavior is approved; do not introduce placeholder infrastructure now.

## Planning verification

Read-only inspection covered the application bootstrap/module/controller, Prisma startup, existing tests, backend/frontend contract documents, frontend error UI and the available auth branch snapshot. Official references and installed NestJS declarations/adapter behavior were checked. No consumer implementing a backend response envelope was found in the inspected paths; frontend validation translation keys are UI behavior, not a server response contract.

This proposal itself requires static review only. No product code, database, dependency, commit, push or PR change is part of this planning step.

An earlier independent read-only review covered the original Problem Details proposal and shared boundary rules. The user subsequently selected and approved Response Envelope; the earlier review is not presented as verification of the revised format. Static checks covered the revised English text, three JSON examples, source links and whitespace. No runtime tests were run for these document-only changes.
