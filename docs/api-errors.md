# API Response Envelopes and Errors

## Implementation status

Phase 1A implements the envelope types, success helper and internal validation-error metadata helpers in `src/common/http/api-response.ts`.

Phase 1B implements and unit-tests `HttpErrorFilter` in `src/common/http/http-error.filter.ts`. Phase 1C registers it through APP_FILTER in AppModule, so HTTP failures now use the envelope below. Real HTTP tests import AppModule and replace PrismaService before compilation; they verify global registration without connecting to a database. The shared DTO validation pipe (Phase 2) remains pending.

Success envelopes are opt-in through apiSuccess; there is no global success interceptor. `GET /` still returns the existing `Hello World!` text. New test routes exist only in `test/http-boundary.spec.ts` and are excluded from production builds.

See the [approved design](superpowers/specs/2026-10-16-api-error-handling-design.md) and [implementation plan](superpowers/plans/2026-10-16-api-error-handling.md).

## Response fields

JSON envelopes have exactly four top-level fields:

| Field | Success | Failure |
| --- | --- | --- |
| `success` | `true` | `false` |
| `message` | Public outcome text, default `OK` | Safe public reason |
| `data` | Typed operation result, or `null` | `null` |
| `error` | `null` | `{ code, details }` |

`ApiSuccess<T>` and `ApiFailure` describe the two shapes. `ApiResponse<T>` is their union, distinguished by `success`.

Actual HTTP status codes remain authoritative. A failure must use a 4xx/5xx status, never HTTP 200. The helper does not set a status or content type. Empty 204/HEAD responses remain bodyless; existing text, files, streams and redirects are not automatically wrapped. The JSON envelope uses `application/json` and is a project-specific format.

## Success helper

Future JSON endpoint handlers can import `apiSuccess` from `src/common/http/api-response.ts`, using the relative `.js` import path from their source file:

```ts
return apiSuccess({ id: 1, name: 'Ammar' });
```

Result:

```json
{
  "success": true,
  "message": "OK",
  "data": { "id": 1, "name": "Ammar" },
  "error": null
}
```

The business fields illustrate usage and do not introduce a new endpoint. Pass a second argument for a safe operation message, such as `apiSuccess(null, 'Completed.')`. Both `null` and `undefined` results become `data: null`; `0`, `false` and the empty string remain unchanged. The helper wraps only the data explicitly supplied; endpoint authors must choose public response DTOs and omit secrets.

## Active HTTP failure shape

Example with actual HTTP status 401:

```json
{
  "success": false,
  "message": "Authentication is required.",
  "data": null,
  "error": { "code": "UNAUTHORIZED", "details": [] }
}
```

Use `error.code` for client logic and translation keys; do not parse English message text. `error.details` is always an array. Generic errors use `[]`; DTO validation uses public `{ pointer, message }` entries. The future frontend adapter must map codes to its UI translation keys rather than pass backend text into a translation-key prop.

Example DTO validation failure with actual HTTP status 400, once Phase 2 is enabled:

```json
{
  "success": false,
  "message": "Some fields are invalid.",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "pointer": "/email", "message": "Email must be valid." }]
  }
}
```

`pointer` addresses the affected field; nested array examples include `/answers/0/value`. Public messages must not include submitted values, tokens, SQL, stack traces or raw exception contents. Validator messages must not interpolate `$value`.

The internal `apiValidationError(details)` factory creates a native 400 `BadRequestException` with `errorCode: VALIDATION_ERROR`. `apiValidationDetails(exception)` retrieves only details marked by that factory; arbitrary response objects with matching code/details fields are not trusted. Details are stored as non-enumerable private metadata, outside the native exception response body. The filter accepts them only with status 400 and code VALIDATION_ERROR. These helpers prepare the filter/pipe boundary; they do not activate validation by themselves.

## Error catalog

| HTTP status | Code | Public message |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | The request is invalid. |
| 400 | `VALIDATION_ERROR` | Some fields are invalid. |
| 401 | `UNAUTHORIZED` | Authentication is required. |
| 403 | `FORBIDDEN` | You do not have permission to perform this action. |
| 404 | `NOT_FOUND` | The requested resource was not found. |
| 409 | `CONFLICT` | The request conflicts with the current state. |
| 500 | `INTERNAL_ERROR` | An unexpected error occurred. |
| Other known 4xx/5xx | `HTTP_ERROR` | The request could not be completed. |

Generic malformed requests use BAD_REQUEST. Field validation uses VALIDATION_ERROR only through the owned factory; the shared DTO pipe that will call it remains pending. Matching HTTP statuses can therefore share a general category while codes distinguish the reason.

The filter accepts native Nest `HttpException` statuses only when they are integers from 400 through 599. The status determines the fixed catalog entry; unknown or mismatched supplied codes cannot override that entry. VALIDATION_ERROR additionally requires the owned metadata described above. Known statuses outside the core catalog retain their HTTP status, including 413, 429 and 503.

Adapter errors must be Error instances with an integer statusCode from 400 through 599, an equal status and a boolean expose property. Even expose=true does not make raw text public. Objects carrying only statusCode/message are not trusted. Unknown thrown values and invalid/nonfailure exception statuses become safe 500 INTERNAL_ERROR responses. The filter does not infer domain errors from Prisma messages or codes.

## Response safety and diagnostics

The filter constructs a fresh four-key response; it never copies the exception's response body, raw message, cause or extra properties. It sets application/json on writable failures and preserves unrelated headers, including WWW-Authenticate and Retry-After. Fixture tests do not define authentication or retry policy. If headers were already sent, it ends through the adapter without setting status, replacing headers or sending another body.

For 5xx failures, Nest Logger receives only these fields:

```json
{
  "event": "http_request_failed",
  "category": "UNEXPECTED_EXCEPTION",
  "method": "GET",
  "status": 500,
  "code": "INTERNAL_ERROR"
}
```

Categories are UNEXPECTED_EXCEPTION, HTTP_SERVER_ERROR (a valid native HTTP exception) or ADAPTER_ERROR (a recognized adapter error). Methods are limited to GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS; anything else becomes OTHER. Client errors are not logged by this filter. Diagnostics omit request URLs, headers, bodies, submitted values, constructor names, raw exception messages, causes and stack traces. Correlation and richer diagnostics belong to a later reviewed observability change.

The filter formats errors; authentication, authorization, domain decisions and bootstrap/database failures remain with their existing owners. New public business codes require an approved catalog entry. Phase 1C activates the filter globally and verifies it through real HTTP requests.

## Phase 1A verification

```sh
pnpm exec vitest run src/common/http/api-response.spec.ts
pnpm check
git diff --check
```

The focused tests cover the exact success shape, default/custom messages, null/undefined normalization, falsy values, validation status/code and rejection of unowned metadata. These checks do not require PostgreSQL.

## Phase 1B verification

```sh
pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts
pnpm check
pnpm build
git diff --check
```

The filter unit tests use an adapter/context double to inspect actual output status, body, headers and diagnostics. They cover the catalog, owned/unowned validation, invalid statuses, strict adapter classification, safe 500 fallbacks, preservation of headers, already-sent responses and bounded diagnostics. They require no PostgreSQL. AppModule was unchanged during Phase 1B; global activation is implemented in Phase 1C.

## Phase 1C verification

```sh
pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts test/http-boundary.spec.ts
pnpm check
pnpm build
git diff --check
```

The HTTP suite exercises actual AppModule registration and the Express adapter. It does not install a test-only filter. PrismaService is replaced with a harmless value before compilation; ConfigService also points to an unreachable loopback target as a safety fallback. No application or temporary database is needed for this suite.

Checks cover core 400/401/403/404/409/500 statuses, preserved 413/429/503 statuses, a real unknown-route 404, unowned validation/code mismatch, safe unexpected 500 diagnostics, challenge/retry header preservation, replacement of stale content types, and unchanged successful root text. Fixture routes are not business endpoints or authentication implementations. Validation, additional bodyless/success compatibility tests and disposable Docker startup verification remain assigned to later phases.
