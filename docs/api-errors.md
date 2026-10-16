# API Response Envelopes and Errors

## Implementation status

Phase 1A implements the envelope types, success helper and internal validation-error metadata helpers in `src/common/http/api-response.ts`.

The global error filter (Phase 1B), its AppModule registration (Phase 1C) and shared DTO validation pipe (Phase 2) are pending. The failure examples below describe the approved contract; current application-wide errors still use Nest's default format. No endpoint has been converted in Phase 1A. `GET /` still returns the existing `Hello World!` text.

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

## Approved failure shape — global activation pending

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

The internal `apiValidationError(details)` factory creates a native 400 `BadRequestException` with `errorCode: VALIDATION_ERROR`. `apiValidationDetails(exception)` retrieves only details marked by that factory; arbitrary response objects with matching code/details fields are not trusted. Details are stored as non-enumerable private metadata, outside the native exception response body. These helpers prepare the filter/pipe boundary; they do not activate validation or format HTTP errors by themselves.

## Phase 1A verification

```sh
pnpm exec vitest run src/common/http/api-response.spec.ts
pnpm check
git diff --check
```

The focused tests cover the exact success shape, default/custom messages, null/undefined normalization, falsy values, validation status/code and rejection of unowned metadata. These checks do not require PostgreSQL.
