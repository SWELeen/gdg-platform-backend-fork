# API Response Envelope and Global Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start implementation until the user reviews this plan.

**Goal:** Provide the approved JSON response envelope, a safe global HTTP error filter and shared DTO validation while preserving existing success and startup behavior.

**Architecture:** One contract/helper file, one global error filter and one validation pipe, registered through AppModule. Test the real provider registration with test-only controllers and an overridden PrismaService; keep routine boundary tests independent of PostgreSQL. Future JSON endpoints explicitly use the success helper; no global success interceptor is introduced.

**Tech Stack:** Installed NestJS 12, TypeScript strict mode, class-validator/class-transformer, Vitest, Supertest and the existing disposable Docker startup runner. No new dependencies.

**Spec:** [Approved design](../specs/2026-10-16-api-error-handling-design.md).

**Execution proposal:** Native implementation in this session, one independently tested delivery at a time (1A, 1B, 1C, then Phases 2 and 3), with independent read-only review before handoff. The components share a small interface, so separate implementation agents would add coordination without useful isolation. The user may choose a different execution method when reviewing this plan.

## Global constraints

- Contract approved; Phase 1A implemented and verified; the user authorized its commit on 2026-10-16. Phases 1B/1C/2/3 remain pending. Present phase results before any separately authorized commit. Do not push, merge, update a PR or deploy as part of this plan without new authorization.
- Work on `feat/api-error-handling`, based on `9246fde`. At planning time database PR #4 is open against main at that same head. Recheck its state and the auth branch at execution time; do not merge/rebase just to start this task. Settle the database PR dependency before proposing a separate feature PR.
- Preserve `docs/user-member-proposal.md`, the frontend's `package-lock.json`, ignored local settings and unrelated changes.
- Every JSON envelope has exactly `success`, `message`, `data`, `error`. Success uses true/error=null; failure uses false/data=null/error={code,details}. Use application/json and actual HTTP status codes, not HTTP 200 for failures.
- Copy the catalog messages/status pairings from the spec. Failure details is always an array; only the owned DTO-validation factory supplies nonempty pointer/message entries. Native errorCode is not arbitrary public text.
- Preserve `GET /` as `Hello World!`, existing readiness checks, successful non-JSON responses, 204/HEAD bodies and existing headers. No production error-demo routes.
- No schema/migration/seed, production database, dependency, frontend, auth-flow, Swagger, pagination, monitoring or request-ID changes. Auth checks and domain-specific rules remain with their owners.
- No submitted values, raw exceptions/causes, SQL, tokens, request headers, raw URLs or stack traces in public errors or this filter's diagnostics. Public validator messages must not interpolate submitted values.
- At execution, ensure locked dependencies are available; generate the ignored Prisma client with `pnpm prisma:generate` before the first focused AppModule test if it is absent. Generation does not connect to a database. Do not treat a missing generated client as the intended RED failure.

## File map

| Create/modify | Responsibility |
| --- | --- |
| Create `src/common/http/api-response.ts` | Envelope types, success helper and owned validation-exception metadata |
| Create `src/common/http/http-error.filter.ts` | Safe catalog, classification, HTTP error formatting and diagnostics |
| Create `src/common/http/api-validation.pipe.ts` | Pipe configuration and nested field-error conversion |
| Modify `src/app.module.ts` | APP_FILTER in Phase 1; APP_PIPE in Phase 2 |
| Create `src/common/http/api-response.spec.ts` | Helper and validation-metadata ownership tests |
| Create `src/common/http/http-error.filter.spec.ts` | Filter adapter/fallback/logging edge cases |
| Create `src/common/http/api-validation.pipe.spec.ts` | Validation conversion and JSON Pointer cases |
| Create `test/http-boundary.spec.ts` | HTTP fixtures using actual AppModule globals, with PrismaService overridden |
| Create `docs/api-errors.md` | Accepted shapes, full core catalog, safe-message rules and contributor examples |
| Modify `docs/api-standards.md`, `docs/testing.md`, `docs/decision-governance.md` | Describe implemented behavior, commands and ownership after checks |

Keep source units focused; no new CommonModule, exception hierarchy, generic response framework or per-controller filters.

## Review focus

1. **Forgotten global registration:** tests import actual AppModule without manually installing pipes/filters; Phase 1 covers real unknown routes and Phase 2 covers real DTO rejection.
2. **Misclassified failures:** malformed JSON is BAD_REQUEST, DTO errors are VALIDATION_ERROR, parser overflow remains 413, explicit 429/503 are preserved, and unknown values become 500; Phases 1–2 pin each case.
3. **Data disclosure or forged validation metadata:** secret-bearing errors/query strings/extra response properties are never copied; details comes only from the owned factory and catalogued status/code pairs; Phase 1 covers forged metadata and safe diagnostics, Phase 2 covers target/value omission.
4. **Nested/missing fields:** deterministic pointers handle arrays, slash/tilde keys and missing fields, including the empty pointer for a root-level validation error; Phase 2 has exact examples.
5. **Response compatibility:** preserve falsy success data, null-normalize undefined, retain headers, stop on sent headers, and preserve root/204/HEAD/JSON success statuses; Phases 1 and 3 cover these separately.

## Phase 1: Typed Envelopes and Global HTTP Error Boundary

**Files:** api-response.ts/spec.ts, http-error.filter.ts/spec.ts, AppModule and test/http-boundary.spec.ts from the file map; start docs/api-errors.md with the core catalog.

**Interfaces produced in `api-response.ts`:**

```ts
export interface ApiErrorDetail { pointer: string; message: string; }
export interface ApiSuccess<T> {
  success: true; message: string; data: T | null; error: null;
}
export interface ApiFailure {
  success: false; message: string; data: null;
  error: { code: string; details: readonly ApiErrorDetail[] };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
export function apiSuccess<T>(data: T | null | undefined, message?: string): ApiSuccess<T>;
export function apiValidationError(details: readonly ApiErrorDetail[]): BadRequestException;
export function apiValidationDetails(exception: unknown): readonly ApiErrorDetail[] | undefined;
```

The last two functions form the internal bridge consumed by Phase 2. Use one private non-enumerable Symbol on the native BadRequestException for owned details. This avoids a filter/pipe import cycle and avoids copying arbitrary response payloads. Native status=400/errorCode=VALIDATION_ERROR alone does not establish ownership. No custom exception class or external metadata store is needed.

**Filter interface:** `HttpErrorFilter implements ExceptionFilter`, constructor receives HttpAdapterHost; `catch(exception: unknown, host: ArgumentsHost): void`. Register with `{ provide: APP_FILTER, useClass: HttpErrorFilter }` in AppModule. Preserve current module imports/providers and bootstrap configuration.

### Phase 1A: Response Contract and Success Helper

**Purpose:** Define what a successful JSON response looks like and establish the owned validation metadata consumed by the error filter. This delivery does not change live HTTP behavior.

**Files:** Create `src/common/http/api-response.ts`, `src/common/http/api-response.spec.ts` and the contract/examples section of `docs/api-errors.md`. Include the reviewed spec, plan and approval decision record in this first implementation commit if they remain uncommitted; preserve the unrelated proposal file.

**Interfaces:** Produce all interfaces and helper functions declared above. Phase 1B consumes them; Phase 2 later supplies DTO validation details through the owned factory.

- [x] **Write failing helper/metadata tests.** Name cases `wraps success`, `preserves falsy data`, `normalizes absent data`, `uses the supplied public message`, and `recognizes only owned validation details`. Pin these assertions:

  ```ts
  expect(apiSuccess({ id: 1 })).toEqual({
    success: true, message: 'OK', data: { id: 1 }, error: null,
  });
  expect(apiSuccess(undefined).data).toBeNull();
  expect(apiSuccess(0).data).toBe(0);
  expect(apiSuccess(false).data).toBe(false);
  expect(apiSuccess('').data).toBe('');
  expect(apiSuccess(null, 'Completed.').message).toBe('Completed.');
  const details = [{ pointer: '/email', message: 'Email must be valid.' }];
  expect(apiValidationDetails(apiValidationError(details))).toEqual(details);
  expect(apiValidationDetails(new BadRequestException(
    { details }, { errorCode: 'VALIDATION_ERROR' },
  ))).toBeUndefined();
  ```

- [x] **Run RED:** `pnpm exec vitest run src/common/http/api-response.spec.ts`. Record the actual missing-helper failure.
- [x] **Implement the declared types/helpers.** Default message is OK; normalize with nullish handling, preserving 0/false/empty string. Store owned validation details using the private non-enumerable Symbol described above. Document exact success/failure examples and mark the filter and global activation as pending.
- [x] **Run GREEN:** repeat the focused command, then `pnpm check` and `git diff --check`. Require zero failures and inspect the scoped diff.
- [x] **Explain and commit gate:** show the user the four envelope fields, helper purpose, exact files and actual checks. The user reviewed the results and authorized this commit on 2026-10-16. Commit message: `feat: add API response envelope helpers`.

**Verification result (2026-10-16):** Focused RED failed because api-response.js did not exist; after implementation, all 15 focused cases passed. `pnpm check` passed lint, TypeScript, 11 Node tests and all 27 Vitest tests (including the 15 new cases). Changed TypeScript files passed Prettier; document examples/links and whitespace were checked. Existing Vite plugin and Prisma update notices were informational. The editor follow-up corrected an unsaved ApiSucgcess typo to ApiSuccess and confirmed No Problems. A subsequent `pnpm build` and repeated `pnpm check` passed. No database connection, HTTP activation, startup run or push occurred. The user subsequently authorized the Phase 1A commit; Phase 1B has not started.

### Phase 1B: Error Filter and Safe Diagnostics

**Purpose:** Implement how failures become safe, predictable envelopes, without enabling the filter globally yet.

**Files:** Create `src/common/http/http-error.filter.ts` and `src/common/http/http-error.filter.spec.ts`; extend `docs/api-errors.md` with the core catalog and safe-message rules. Do not modify AppModule in this delivery.

**Interfaces:** Consume the Phase 1A types and validation metadata functions. Produce the HttpErrorFilter interface declared above for registration in Phase 1C.

- [ ] **Write failing filter unit tests** using a fake HttpAdapterHost/ArgumentsHost and captured Nest Logger calls. Assert exact four outer keys, null data, false success, code/details and actual status for the cases below:

  | Case | Required assertion |
  | --- | --- |
  | Native 400/401/403/404/409/500 exceptions | Approved core code/message; raw supplied text is absent |
  | Explicit 413/429/503 HttpException | Original status; HTTP_ERROR with the spec's generic message |
  | Native unknown or mismatched errorCode | Safe status fallback; FORBIDDEN on status 400 becomes BAD_REQUEST |
  | Owned validation metadata at status 400 | VALIDATION_ERROR with the owned pointer/message details |
  | Unowned VALIDATION_ERROR/details fields | BAD_REQUEST with empty details |
  | Error with secret-bearing message/cause, strings, null, plain objects | 500 INTERNAL_ERROR; no supplied values in body or diagnostics |
  | Only statusCode/message on an object or Error | Not a trusted adapter error; 500 |
  | Valid http-errors adapter signature | Require Error instance, integer statusCode in 400–599, equal status and boolean expose; preserve status, never its message |
  | HttpException with invalid/nonfailure status | 500 fallback, including attempted status 200 |
  | Writable response with pre-set content type and unrelated headers | Explicit application/json; existing unrelated headers retained |
  | Already-sent headers | No new status/header/body write or reply; end through adapter |
  | 5xx diagnostic event | Only fixed event/category, allowlisted method, status and public code; secret sentinel absent |

- [ ] **Run RED:** `pnpm exec vitest run src/common/http/http-error.filter.spec.ts`. Record the actual missing-filter failure.
- [ ] **Implement classification and formatting.** Follow the spec catalog and status/code pairings. VALIDATION_ERROR requires owned metadata and actual status 400. Check headers-sent before response mutation; otherwise explicitly set application/json through the adapter before reply. Never spread exception/getResponse() objects into output.
- [ ] **Implement safe diagnostics with Nest Logger.** For 5xx, emit only event `http_request_failed`, category `UNEXPECTED_EXCEPTION`, `HTTP_SERVER_ERROR` or `ADAPTER_ERROR`, approved method, status and public code. Allow GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS; otherwise OTHER. No arbitrary constructor names, raw errors, causes, stack traces or request content.
- [ ] **Run GREEN:** `pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts`, then `pnpm check` and `git diff --check`. Inspect the diff and captured diagnostics.
- [ ] **Explain and commit gate:** show one mapped error example, how status/code/message differ, what is hidden, and actual checks. State explicitly that global activation is still pending. Wait for confirmation before committing. Suggested message: `feat: add safe HTTP error filter`.

### Phase 1C: Global Registration and HTTP Integration

**Purpose:** Activate the tested filter for the real application and verify that real HTTP requests receive the approved errors while existing success behavior remains unchanged.

**Files:** Modify `src/app.module.ts`, create `test/http-boundary.spec.ts`, and update `docs/api-errors.md` to distinguish implemented error handling from the pending Phase 2 validation pipe.

**Interfaces:** Consume HttpErrorFilter from Phase 1B. Register `{ provide: APP_FILTER, useClass: HttpErrorFilter }` in AppModule, preserving current imports/providers/bootstrap configuration. No APP_PIPE yet.

- [ ] **Write failing HTTP integration tests.** Use `/__test/http` fixture controllers only in the test file. Import actual AppModule, add fixture controllers to TestingModule, override PrismaService with a harmless value before compilation, and never install the filter manually in tests. No database connection. Cover:

  | Case | Required assertion |
  | --- | --- |
  | Native 400/401/403/404/409/500 fixtures | Exact approved JSON envelope, actual status and JSON content type |
  | Real unknown route with `?token=never-echo` | 404 NOT_FOUND; no raw path/query/token in body or diagnostics |
  | Explicit 413/429/503 fixtures | Original status with HTTP_ERROR |
  | Unowned validation details and code/status mismatch | Catalog fallback with empty details |
  | Unexpected error carrying secret text/cause | Safe 500 INTERNAL_ERROR with no disclosure |
  | Pre-set WWW-Authenticate / Retry-After | Headers retained; fixture values do not define an auth policy |
  | Pre-set non-JSON Content-Type on failure | Replaced with application/json; unrelated headers retained |
  | GET / | Exact existing Hello World! text, status 200 and text content type |

- [ ] **Run RED:** `pnpm exec vitest run test/http-boundary.spec.ts`. Record the default Nest error-shape failures before registration; a missing generated Prisma client is setup, not an intended RED failure.
- [ ] **Register APP_FILTER in AppModule.** Keep test fixtures out of production source; document that JSON success endpoints opt in through apiSuccess, and DTO validation remains pending.
- [ ] **Run GREEN:** `pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts test/http-boundary.spec.ts`, then `pnpm check`, `pnpm build` and `git diff --check`. Require zero failures and confirm production build excludes fixture controllers.
- [ ] **Explain and commit gate:** show a real HTTP error result, unchanged root behavior, files and actual checks. Wait for confirmation before committing. Suggested message: `feat: enable global HTTP error handling`.

Each delivery ends with passing tests, a scoped diff and a user-visible explanation before its separately confirmed commit. Do not move to the next delivery automatically. No push or database PR changes.

## Phase 2: Shared DTO Validation and Field Details

**Files:** api-validation.pipe.ts/spec.ts, AppModule, extend test/http-boundary.spec.ts and document validation in docs/api-errors.md.

**Consumes:** ApiErrorDetail, apiValidationError and apiValidationDetails from Phase 1; do not create competing response types or validation exception classes.

**Interfaces produced:**

```ts
export function toValidationDetails(errors: readonly ValidationError[]): ApiErrorDetail[];
export class ApiValidationPipe extends ValidationPipe { constructor(); }
```

Use ValidationError from the installed class-validator package. Configure whitelist=true, forbidNonWhitelisted=true, forbidUnknownValues=true, transform=false, validationError={target:false,value:false}. exceptionFactory calls the shared owned factory with converted details. Add `{ provide: APP_PIPE, useClass: ApiValidationPipe }` to AppModule; never install a separate pipe only in the test harness.

- [ ] **Write failing conversion tests.** Assert exact pointer/message pairs: email -> `/email`; answers child 0 child value -> `/answers/0/value`; property `a/b~c` -> `/a~1b~0c`; an empty property name -> `/`; a root error without a property -> empty pointer. Missing required fields still have addresses. Read only property/constraints/children; target, value and contexts must not appear. Sort by encoded pointer, then original constraint key, using deterministic lexical ordering. Return one detail per constraint.
- [ ] **Write failing HTTP validation cases** with test-only decorated DTOs and Nest's real body parser:

  | Case | Required assertion |
  | --- | --- |
  | Valid DTO body | Handler executes and returns the approved success helper result |
  | Missing required field / invalid format | 400 VALIDATION_ERROR, safe message and exact field pointer |
  | Extra property | 400 VALIDATION_ERROR; property is rejected, not silently accepted |
  | Nested DTO/array failures | Stable pointer to the affected array entry and field |
  | Multiple failures / reordered input keys | All expected details, with identical deterministic ordering |
  | Secret-bearing submitted values | No target/value/body echo in response or diagnostics |
  | Wrong root shape | Safe 400 without crashing; distinguish parser rejection from DTO validation |
  | Malformed JSON / invalid URI encoding | 400 BAD_REQUEST and empty details, not VALIDATION_ERROR |
  | JSON body exceeding the existing limit | 413 HTTP_ERROR, empty details, no body echo; use about 200,000 characters, not a changed production limit |

- [ ] **Run RED checks:** `pnpm exec vitest run src/common/http/api-validation.pipe.spec.ts test/http-boundary.spec.ts`. Expect missing pipe/converter or validation requests incorrectly accepted. Record the actual failure.
- [ ] **Implement toValidationDetails, ApiValidationPipe and APP_PIPE registration.** Escape each JSON Pointer segment (`~` -> `~0`, then `/` -> `~1`) before joining. Keep primitive conversions explicit in future DTOs/pipes; do not enable global implicit conversion or introduce real request-field rules here.
- [ ] **Run GREEN checks:** repeat the Phase 2 focused command, then `pnpm check`. Require zero failures and unchanged Phase 1 cases. Inspect responses and captured diagnostics for the sentinel value.
- [ ] **Review/commit gate.** Report Phase 2 results and actual checks before any separately confirmed commit.

## Phase 3: Compatibility, Documentation and Final Verification

**Files:** extend test/http-boundary.spec.ts; finish docs/api-errors.md; update docs/api-standards.md, docs/testing.md and the decision record to distinguish accepted, implemented and deferred behavior. No new runtime component.

**Consumes:** Both earlier phases and actual AppModule provider registration.

- [ ] **Write/complete compatibility assertions:** GET / still has status 200, text content and exact Hello World! body; fixture JSON success uses the four-key helper envelope; explicit created status 201 remains 201; successful null/undefined results have data=null; 204 has no body; successful and failing HEAD requests have no body; header and no-double-send tests remain green. All fixture controllers remain in the test file excluded from production builds.
- [ ] **Run focused checks:** `pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts src/common/http/api-validation.pipe.spec.ts test/http-boundary.spec.ts`. Expect zero failures, no PostgreSQL connection and no new production route.
- [ ] **Publish contributor documentation locally.** Include success helper usage, full core code/status/message table, error.details pointer/message shape, safe-validator-copy rule, root/bodyless/non-JSON exceptions and frontend error.code-to-translation-key guidance. Explain that domain/auth error additions require an approved catalog entry; do not add endpoints or install Swagger in this task.
- [ ] **Run final project checks:** `pnpm check` and `pnpm build`. Record actual counts/results. Run Prettier only on changed TypeScript files and `git diff --check`. Confirm no unintended public fields, untracked fixtures, dependency or database file changes.
- [ ] **Run one disposable startup regression:** `pnpm test:startup:local`. It provisions its own PostgreSQL server and checks actual Docker migration-before-startup, unchanged HTTP readiness, restart preservation, schema/application e2e and failed startup on incompatible schema. Existing application e2e also covers unreachable PostgreSQL. Do not run application e2e against the user's configured database or rerun performance/seed graph suites without a new reason.
- [ ] **Inspect resource cleanup and preserved files.** Check only runner-owned containers/networks; never globally prune. Verify the pre-existing proposal/frontend lockfile remain unchanged, and schema/migrations/Compose/Prisma config/lockfiles are untouched.
- [ ] **Prepare handoff and independent read-only review.** Report the exact envelope, real check output, any findings, lack of new business/auth APIs and the database PR dependency. Fix concrete findings and rerun only checks they affect. Wait for user confirmation before committing; push, PR, merge and deployment are separate actions.

## Plan self-review and planning verification

Checked contract coverage, cross-phase interfaces, review-focus cases, scope and proportions. Phase 1 is split into three independently testable deliveries: the response contract (1A), the filter (1B), then real global registration (1C). Existing scope and interfaces are unchanged. The private validation bridge is established in Phase 1A so the filter never imports a not-yet-created Phase 2 pipe. Global registration is exercised through real AppModule imports; database access is explicitly overridden. Existing scripts and test filename patterns already run the new tests, so package/config changes are unnecessary.

The runtime files, application tests and installed Nest adapter/exception/validation interfaces were inspected. The database PR was rechecked as open at 9246fde; a read-only fetch confirmed the auth branch snapshot remains f107092. Both remain integration inputs to recheck before execution. No implementation tests were run while writing this plan. Planning verification is limited to document consistency, links, examples, commands, Git state and preservation checks.
