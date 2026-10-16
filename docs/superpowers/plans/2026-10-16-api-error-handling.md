# API Response Envelope and Global Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start implementation until the user reviews this plan.

**Goal:** Provide the approved JSON response envelope, a safe global HTTP error filter and shared DTO validation while preserving existing success and startup behavior.

**Architecture:** One contract/helper file, one global error filter and one validation pipe, registered through AppModule. Test the real provider registration with test-only controllers and an overridden PrismaService; keep routine boundary tests independent of PostgreSQL. Future JSON endpoints explicitly use the success helper; no global success interceptor is introduced.

**Tech Stack:** Installed NestJS 12, TypeScript strict mode, class-validator/class-transformer, Vitest, Supertest and the existing disposable Docker startup runner. No new dependencies.

**Spec:** [Approved design](../specs/2026-10-16-api-error-handling-design.md).

**Execution proposal:** Native implementation in this session, one independently tested delivery at a time (1A, 1B, 1C, then 2A, 2B, 2C and Phase 3), with independent read-only review before handoff. The components share a small interface, so separate implementation agents would add coordination without useful isolation. The user may choose a different execution method when reviewing this plan.

## Global constraints

- Contract approved; Phase 1A committed as ee71e3a. Phase 1B committed as ff688e1. Phase 1C committed as 63c17a3. Phase 2A committed as f0ab6a8. Phase 2B committed as fef1444. Phase 2C implemented and verified; the user authorized its commit on 2026-10-16. Phase 3 remains pending; splitting Phase 2 changes the delivery sequence only, not the approved behavior. Present phase results before any separately authorized commit. Do not push, merge, update a PR or deploy as part of this plan without new authorization.
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
| Create `src/common/http/api-validation.pipe.ts` | Field-error conversion in 2A; pipe configuration in 2B |
| Modify `src/app.module.ts` | APP_FILTER in 1C; APP_PIPE in 2C |
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

- [x] **Write failing filter unit tests** using a fake HttpAdapterHost/ArgumentsHost and captured Nest Logger calls. Assert exact four outer keys, null data, false success, code/details and actual status for the cases below:

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

- [x] **Run RED:** `pnpm exec vitest run src/common/http/http-error.filter.spec.ts`. Record the actual missing-filter failure.
- [x] **Implement classification and formatting.** Follow the spec catalog and status/code pairings. VALIDATION_ERROR requires owned metadata and actual status 400. Check headers-sent before response mutation; otherwise explicitly set application/json through the adapter before reply. Never spread exception/getResponse() objects into output.
- [x] **Implement safe diagnostics with Nest Logger.** For 5xx, emit only event `http_request_failed`, category `UNEXPECTED_EXCEPTION`, `HTTP_SERVER_ERROR` or `ADAPTER_ERROR`, approved method, status and public code. Allow GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS; otherwise OTHER. No arbitrary constructor names, raw errors, causes, stack traces or request content.
- [x] **Run GREEN:** `pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts`, then `pnpm check` and `git diff --check`. Inspect the diff and captured diagnostics.
- [x] **Explain and commit gate:** show one mapped error example, how status/code/message differ, what is hidden, and actual checks. State explicitly that global activation is still pending. The user reviewed the results and authorized this commit on 2026-10-16. Commit message: `feat: add safe HTTP error filter`.

**Verification result (2026-10-16):** RED failed on the missing http-error.filter.js module. GREEN passed 55 filter cases and all 15 Phase 1A cases (70 focused tests). `pnpm check` passed lint, TypeScript, 11 Node tests and 82 Vitest tests. `pnpm build`, changed-file Prettier and diff whitespace checks passed. Author review checked the status/code catalog, owned metadata, adapter signature, diagnostic allowlist and sent-header behavior against the spec. AppModule and Phase 1A code remain unchanged; no HTTP/DB/startup tests or commit occurred in this delivery. Global registration and real HTTP verification remain Phase 1C work. The user approved the Phase 1B commit after reviewing these results; Phase 1C explanation only is requested next.

### Phase 1C: Global Registration and HTTP Integration

**Purpose:** Activate the tested filter for the real application and verify that real HTTP requests receive the approved errors while existing success behavior remains unchanged.

**Files:** Modify `src/app.module.ts`, create `test/http-boundary.spec.ts`, and update `docs/api-errors.md` plus the active error-policy link in `docs/api-standards.md` to distinguish implemented error handling from the pending Phase 2 validation pipe.

**Interfaces:** Consume HttpErrorFilter from Phase 1B. Register `{ provide: APP_FILTER, useClass: HttpErrorFilter }` in AppModule, preserving current imports/providers/bootstrap configuration. No APP_PIPE yet.

- [x] **Write failing HTTP integration tests.** Use `/__test/http` fixture controllers only in the test file. Import actual AppModule, add fixture controllers to TestingModule, override PrismaService with a harmless value before compilation, and never install the filter manually in tests. No database connection. Cover:

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

- [x] **Run RED:** `pnpm exec vitest run test/http-boundary.spec.ts`. Record the default Nest error-shape failures before registration; a missing generated Prisma client is setup, not an intended RED failure.
- [x] **Register APP_FILTER in AppModule.** Keep test fixtures out of production source; document that JSON success endpoints opt in through apiSuccess, and DTO validation remains pending.
- [x] **Run GREEN:** `pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts test/http-boundary.spec.ts`, then `pnpm check`, `pnpm build` and `git diff --check`. Require zero failures and confirm production build excludes fixture controllers.
- [x] **Explain and commit gate:** show a real HTTP error result, unchanged root behavior, files and actual checks. The user reviewed the results and authorized this commit on 2026-10-16. Commit message: `feat: enable global HTTP error handling`.

Each delivery ends with passing tests, a scoped diff and a user-visible explanation before its separately confirmed commit. Do not move to the next delivery automatically. No push or database PR changes.

**Verification result (2026-10-16):** Before registration, the HTTP suite failed 14 cases on the default error shapes and passed the root compatibility case. After actual AppModule registration, all 15 HTTP cases and the earlier helper/filter suites passed (85 focused tests). `pnpm check` passed lint, TypeScript, 11 Node tests and 97 Vitest tests; `pnpm build`, changed-file Prettier and diff checks passed. Test-only fixtures are excluded from the production output. PrismaService is overridden before compilation; ConfigService additionally uses unreachable loopback as a safety fallback. No database/Compose/seed/migration change or startup run occurred. The API standards error-format link was updated during activation rather than leaving an implemented policy marked TBD until Phase 3. The user authorized this commit after reviewing the results and requested a Phase 2 explanation before implementation.

## Phase 2: Shared DTO Validation and Field Details

**Goal:** Validate decorated DTO inputs and return stable field addresses/messages through the existing owned validation factory and error filter. Deliver 2A, 2B and 2C separately, each with passing tests and user confirmation before commit.

**Final interfaces in `src/common/http/api-validation.pipe.ts`:**

```ts
export function toValidationDetails(errors: readonly ValidationError[]): ApiErrorDetail[];
export class ApiValidationPipe extends ValidationPipe { constructor(); }
```

Consume ValidationError from installed class-validator and ApiErrorDetail/apiValidationError from Phase 1A. Tests may use apiValidationDetails to inspect owned metadata. No competing envelope types, exception classes, HTTP modules or new dependencies. Keep both units in the existing planned file; do not create extra files merely to split commits.

### Phase 2A: Field Error Conversion and JSON Pointers

**Purpose:** Turn validator errors into public `{ pointer, message }` details. This delivery does not run request validation or change global HTTP behavior.

**Files:** Create `src/common/http/api-validation.pipe.ts` containing only toValidationDetails initially; create `src/common/http/api-validation.pipe.spec.ts`; extend the field-details documentation in `docs/api-errors.md` and keep pipe/activation marked pending.

**Interface:** Produce `toValidationDetails(errors: readonly ValidationError[]): ApiErrorDetail[]` for Phase 2B. Do not export/import ApiValidationPipe until it is implemented in 2B.

- [x] **Write failing converter tests.** Use literal expected details, covering: no errors -> []; email -> `/email`; answers child 0 child value -> `/answers/0/value`; property `a/b~c` -> `/a~1b~0c`; empty property name -> `/`; root error without a property -> empty pointer. Include missing required fields, multiple constraints on one field, parent/child failures and children on nodes without constraints. Return one entry per constraint. Sentinel target/value/contexts must not appear in output.
- [x] **Write deterministic-order cases.** Reverse input nodes and constraint insertion order; assert identical output sorted by encoded pointer and then original constraint key. For one `/email` node with constraints isEmail=`Email must be valid.` and isDefined=`Email is required.`, the required-message entry comes first. Use deterministic lexical comparisons, not locale-dependent sorting.
- [x] **Run RED:** `pnpm exec vitest run src/common/http/api-validation.pipe.spec.ts`. Expect the missing converter; record the observed failure.
- [x] **Implement toValidationDetails.** Traverse property/constraints/children only. Distinguish an absent property from an empty property string. Escape each path segment (`~` -> `~0`, then `/` -> `~1`) before joining; sort as specified and return only pointer/message pairs. Do not alter the input error objects or include target/value/contexts.
- [x] **Run GREEN:** repeat the focused command, then `pnpm check`, changed-file Prettier and `git diff --check`. Require zero failures, including existing Phase 1 tests. Inspect the scoped diff and examples.
- [x] **Explain and commit gate:** show a simple and nested pointer example and actual checks. State that request validation is not active. The user reviewed the results and authorized this commit on 2026-10-16. Commit message: `feat: add validation field error conversion`.

**Verification result (2026-10-16):** RED failed on the missing api-validation.pipe.js module. After implementation all 15 converter tests passed. `pnpm check` passed lint, TypeScript, 11 Node tests and 112 Vitest tests, including the unchanged global HTTP error suite. Changed-file Prettier and diff checks passed. Author review checked segment escaping, empty versus absent property, recursive traversal, global pointer/constraint-key ordering, metadata omission and input preservation. No pipe class, AppModule/HTTP behavior change, database connection, build/startup run, commit or push occurred. The user authorized this commit after reviewing the results; only a Phase 2B explanation is requested next.

### Phase 2B: Shared Validation Pipe in Isolation

**Purpose:** Build the reusable validation pipe and prove its behavior directly, before global activation.

**Files:** Extend `src/common/http/api-validation.pipe.ts` and its spec; update `docs/api-errors.md`. Do not modify AppModule or the HTTP fixture yet.

**Interfaces:** Consume toValidationDetails from 2A and apiValidationError from 1A. Produce `ApiValidationPipe extends ValidationPipe` with a zero-argument constructor for Phase 2C.

**Options:** whitelist=true, forbidNonWhitelisted=true, forbidUnknownValues=true, transform=false, validationError={target:false,value:false}. exceptionFactory returns apiValidationError(toValidationDetails(errors)). Do not enable global implicit conversion. DTO validator messages must be public-safe and must not interpolate `$value`.

- [x] **Write failing pipe tests** using small decorated test-only DTOs and direct calls to `pipe.transform(value, { type: 'body', metatype: TestDto })`. Cover valid input, missing required fields, invalid email format, unexpected properties and submitted-value secrecy. Valid input retains its submitted values; do not assert object identity or automatic primitive conversion. Rejections must be owned native BadRequestExceptions with status 400, code VALIDATION_ERROR and expected pointer/message details, inspected using apiValidationDetails.
- [x] **Run RED:** `pnpm exec vitest run src/common/http/api-validation.pipe.spec.ts`. Expect the missing pipe class; record the observed failure.
- [x] **Implement ApiValidationPipe** using the exact options/factory above and installed Nest ValidationPipe. Reuse the converter; do not introduce real domain DTOs, business rules or a filter import cycle.
- [x] **Run GREEN:** repeat the focused command, then `pnpm check`, changed-file Prettier and `git diff --check`. Require the converter tests and existing Phase 1 suite to remain green.
- [x] **Explain and commit gate:** show how an invalid test DTO becomes owned field details and report actual checks. State that AppModule still has no APP_PIPE registration. The user reviewed the results and authorized this commit on 2026-10-16. Commit message: `feat: add shared DTO validation pipe`.

**Verification result (2026-10-16):** RED showed 8 new cases failing because ApiValidationPipe was not a constructor; all 15 converter tests remained green. The implementation then passed all 23 focused cases. `pnpm check` passed lint, TypeScript, 11 Node tests and 120 Vitest tests. Changed-file Prettier and diff checks passed. Author review confirmed the exact settings, zero-argument injectable provider, existing owned factory/converter reuse and no filter import cycle. AppModule/HTTP fixtures remain unchanged; no global pipe registration, database connection, build/startup run, commit or push occurred. The user authorized this commit after reviewing the results; only a Phase 2C explanation is requested next.

### Phase 2C: Global Validation and HTTP Integration

**Purpose:** Activate the pipe and verify real request rejection through the existing global error filter.

**Files:** Modify `src/app.module.ts`; extend `test/http-boundary.spec.ts`; update `docs/api-errors.md` and the active validation status in `docs/api-standards.md`. Test-only DTOs/controllers remain excluded from production builds.

**Interfaces:** Consume ApiValidationPipe from 2B. Register `{ provide: APP_PIPE, useClass: ApiValidationPipe }` alongside the existing APP_FILTER; preserve current imports/providers and bootstrap settings. Never manually install a pipe in the test harness. Reuse actual AppModule imports and existing pre-compilation PrismaService/ConfigService overrides; no database connection.

- [x] **Write failing HTTP validation cases** with decorated test-only DTOs, a fixture POST handler returning apiSuccess, and Nest's real body parser:

  | Case | Required assertion |
  | --- | --- |
  | Valid DTO body | Handler returns the approved success envelope |
  | Missing required field / invalid format | 400 VALIDATION_ERROR, safe public message and exact pointer |
  | Extra property | 400 VALIDATION_ERROR; rejected rather than silently accepted |
  | Nested DTO/array failures | Stable pointer such as `/answers/0/value` |
  | Multiple failures / reordered input keys | All expected details with identical deterministic ordering |
  | Secret-bearing submitted values | No target/value/body echo in response or diagnostics |
  | Wrong root shape | Safe 400 without crashing; distinguish parser rejection from DTO validation |
  | Malformed JSON / invalid URI encoding | 400 BAD_REQUEST with empty details, not VALIDATION_ERROR |
  | Oversized JSON | 413 HTTP_ERROR with empty details; use about 200,000 characters and leave production limits unchanged |

- [x] **Run RED:** `pnpm exec vitest run test/http-boundary.spec.ts`. Expect validly parsed but invalid DTO input to be accepted before APP_PIPE registration; earlier error/root tests and already-supported parser cases may pass. Record actual failures instead of expecting every new case to fail.
- [x] **Register APP_PIPE in AppModule.** Keep field conversions explicit in owning DTOs/pipes. Do not add production endpoints or change authentication/authorization. Update documentation to mark shared validation active while distinguishing approved framework behavior from each endpoint's domain rules.
- [x] **Run GREEN:** `pnpm exec vitest run src/common/http/api-validation.pipe.spec.ts test/http-boundary.spec.ts`, then `pnpm check`, `pnpm build`, changed-file Prettier and `git diff --check`. Require zero failures and unchanged Phase 1 cases. Inspect responses/diagnostics for the sentinel and confirm production output excludes fixtures.
- [x] **Explain and commit gate:** show an actual HTTP validation result with pointer/message details, report checks and preserved root behavior. The user reviewed the results and authorized this commit on 2026-10-16. Commit message: `feat: enable global DTO validation`.

Each delivery ends with tested working code, a scoped diff and an explanation before its separately confirmed commit. Stop after the requested delivery; do not begin the next one automatically. Docker startup verification remains in Phase 3. This split does not change schema, migrations, seeds, auth or domain requirements.

**Verification result (2026-10-16):** Before registration, 8 invalid-request tests returned 201 instead of 400; 21 existing/happy/parser cases passed. After actual AppModule APP_PIPE registration, all 29 HTTP tests and 23 converter/pipe tests passed (52 focused cases). `pnpm check` passed lint, TypeScript, 11 Node tests and 134 Vitest tests. `pnpm build`, changed-file Prettier and diff checks passed. Author review confirmed actual global registration, test-only decorated DTOs, nested and stable field details, private-value omission, parser/DTO distinction, 413 preservation and unchanged root/error/header behavior. Existing pre-compilation database overrides remain in place. Production output excludes fixtures. No schema/database/startup changes, commit or push occurred; The user authorized this commit after reviewing the results; Phase 3 explanation only is requested next.

## Phase 3: Compatibility, Documentation and Final Verification

**Files:** extend test/http-boundary.spec.ts; finish docs/api-errors.md; update docs/api-standards.md, docs/testing.md and the decision record to distinguish accepted, implemented and deferred behavior. No new runtime component.

**Consumes:** Both earlier phases and actual AppModule provider registration.

- [x] **Write/complete compatibility assertions:** GET / still has status 200, text content and exact Hello World! body; fixture JSON success uses the four-key helper envelope; explicit created status 201 remains 201; successful null/undefined results have data=null; 204 has no body; successful and failing HEAD requests have no body; header and no-double-send tests remain green. All fixture controllers remain in the test file excluded from production builds.
- [x] **Run focused checks:** `pnpm exec vitest run src/common/http/api-response.spec.ts src/common/http/http-error.filter.spec.ts src/common/http/api-validation.pipe.spec.ts test/http-boundary.spec.ts`. Expect zero failures, no PostgreSQL connection and no new production route.
- [x] **Publish contributor documentation locally.** Include success helper usage, full core code/status/message table, error.details pointer/message shape, safe-validator-copy rule, root/bodyless/non-JSON exceptions and frontend error.code-to-translation-key guidance. Explain that domain/auth error additions require an approved catalog entry; do not add endpoints or install Swagger in this task.
- [x] **Run final project checks:** `pnpm check` and `pnpm build`. Record actual counts/results. Run Prettier only on changed TypeScript files and `git diff --check`. Confirm no unintended public fields, untracked fixtures, dependency or database file changes.
- [x] **Run one disposable startup regression:** `pnpm test:startup:local`. It provisions its own PostgreSQL server and checks actual Docker migration-before-startup, unchanged HTTP readiness, restart preservation, schema/application e2e and failed startup on incompatible schema. Existing application e2e also covers unreachable PostgreSQL. Do not run application e2e against the user's configured database or rerun performance/seed graph suites without a new reason.
- [x] **Inspect resource cleanup and preserved files.** Check only runner-owned containers/networks; never globally prune. Verify the pre-existing proposal/frontend lockfile remain unchanged, and schema/migrations/Compose/Prisma config/lockfiles are untouched.
- [x] **Prepare handoff and independent read-only review.** Report the exact envelope, real check output, any findings, lack of new business/auth APIs and the database PR dependency. Fix concrete findings and rerun only checks they affect. Wait for user confirmation before committing; push, PR, merge and deployment are separate actions.

**Verification result (2026-10-16):** Compatibility test-first execution produced 5 expected missing-fixture 404 failures and 32 passes; after adding only fixture handlers, all 37 HTTP tests passed. The four focused HTTP files passed 130 tests. `pnpm check` passed lint, TypeScript, 11 Node tests and 142 Vitest tests (153 total); `pnpm build`, changed-TypeScript Prettier and diff checks passed. Production output excludes fixture controllers/DTOs. One `pnpm test:startup:local` run exited 0: two clean 139-test schema replays, migration preservation/failure/recovery guards, 143 combined schema/application e2e tests, Docker migration-before-readiness, restart data preservation and incompatible-schema startup rejection all passed. Application e2e includes unreachable-database startup rejection. Runner-owned containers, networks and image were removed; preservation hashes match for the existing proposal and frontend lockfile. No schema/migration/seed/Compose/Prisma config/dependency/lockfile changes were made.

**Final independent review:** Read-only review of baseline 9246fde through committed HEAD 823e453 plus Phase 3 working changes found no Critical, Important or Minor issues. No fix pass was needed. Deferred future endpoint message safety remains an endpoint-owner obligation; auth/domain catalog expansion, Swagger publication and the frontend adapter remain separate deliveries. Earlier movement of the active standards link into Phase 1C was accepted. Final status bookkeeping is complete. A fresh read-only integration check still finds database PR #4 open/unmerged at 9246fde, auth branch f107092 and main 4126b30; settle the database dependency before a separate feature PR. Implementation/verification is complete locally. After reviewing the results, the user authorized the Phase 3 commit on 2026-10-16. Push, PR, merge and deployment remain separate actions.

## Plan self-review and planning verification

Checked contract coverage, cross-phase interfaces, review-focus cases, scope and proportions. Phase 1 is split into the response contract (1A), the filter (1B), then real global registration (1C). Phase 2 is split into the converter (2A), isolated pipe (2B), then real global validation (2C). Each has its own test cycle and commit confirmation. Existing scope and final interfaces are unchanged; converter and pipe share the originally planned file, and no new wrapper is introduced. The private validation bridge is established in Phase 1A so the filter never imports a not-yet-created Phase 2 pipe. Global registration is exercised through real AppModule imports; database access is explicitly overridden. Existing scripts and test filename patterns already run the new tests, so package/config changes are unnecessary.

The runtime files, application tests and installed Nest adapter/exception/validation interfaces were inspected. The database PR was rechecked as open at 9246fde; a read-only fetch confirmed the auth branch snapshot remains f107092. Both remain integration inputs to recheck before execution. No implementation tests were run while writing this plan. Planning verification is limited to document consistency, links, examples, commands, Git state and preservation checks.
