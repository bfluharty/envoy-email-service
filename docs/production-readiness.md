# Production Readiness

## Usage Catalog

The email service is a Node.js Lambda that acts as a proxy for Gmail and Microsoft Graph operations. It is called exclusively by **envoy-project-management**. It does not send transactional email (that goes through Resend) and has no AI/LLM integration.

| Usage                                | Endpoint               | Who calls it             | When                                                                     |
| ------------------------------------ | ---------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Send email as user                   | `POST /send-on-behalf` | envoy-project-management | User triggers a reply or new outbound email from their connected account |
| List inbox messages                  | `POST /inbox/list`     | envoy-project-management | Polling or on-demand inbox sync for Gmail or Microsoft accounts          |
| Fetch single message                 | `POST /inbox/message`  | envoy-project-management | Loading full message body after an inbox list                            |
| **Send follow-up email** _(planned)_ | `POST /send-on-behalf` | envoy-project-management | Automatically triggered after a project event to fire a response email   |

### Follow-Up Email Flow (Planned)

envoy-project-management detects an event that requires a follow-up (e.g., a project status change, a deadline, a reply trigger). It invokes this Lambda via its existing `POST /send-on-behalf` endpoint with the user's OAuth access token, recipient, subject, body, and optional `inReplyTo`/`references` headers for thread continuity. The Lambda sends the email through the user's connected Gmail or Microsoft account and returns the `messageId`. No new endpoint is needed — the existing send-on-behalf route already supports reply threading fields.

**What envoy-project-management needs to supply:**

- `provider` — `gmail` or `microsoft`
- `accessToken` — the user's current OAuth token for that provider
- `to` — recipient address
- `subject` — email subject
- `body` — email body text
- `inReplyTo` _(optional)_ — `Message-ID` header of the email being replied to
- `references` _(optional)_ — `References` header chain for thread grouping
- `threadId` _(optional, Gmail only)_ — Gmail thread ID to keep the reply in the same thread

---

## Stories with Specs

Each story is self-contained. The **Spec** section points to the exact file and line that must change.

---

### Story 1 — Fix Dockerfile CMD so Lambda actually runs the handler

**Problem:** The production Dockerfile starts `local-server.js`, which is the local dev HTTP wrapper. Lambda container images expect the CMD to resolve to the handler entrypoint. If the Lambda function config does not override CMD, every invocation will try to start an HTTP server and hang until timeout.

**Acceptance criteria:** Deploying the image to Lambda and invoking it returns a valid JSON response. The local dev workflow still works via `Dockerfile.dev` or `npm start`.

**Spec:**

[`Dockerfile:35`](../Dockerfile#L35) — change CMD from:

```dockerfile
CMD ["node", "dist/local-server.js"]
```

to:

```dockerfile
CMD ["dist/index.handler"]
```

The dev Dockerfile ([`Dockerfile.dev`](../Dockerfile.dev)) can keep `local-server.js`. The production image must point at the handler.

---

### Story 2 — Add real tests; `npm test` should exercise behavior, not just types

**Problem:** [`package.json:16`](../package.json#L16) sets `"test": "npm run typecheck"`. There is no behavioral coverage. The CI pipeline passes on every PR regardless of logic regressions.

**Acceptance criteria:** `npm test` runs a test suite that covers request validation, handler routing, and error paths for both providers. CI fails if tests fail.

**Spec:**

- Add `vitest` (or `jest`) to `devDependencies` in [`package.json`](../package.json).
- Update the `"test"` script to run the test suite followed by typecheck.
- Add test files covering:
  - [`src/utils/request-validation.ts`](../src/utils/request-validation.ts) — all three validators, valid and invalid inputs
  - [`src/index.ts`](../src/index.ts) — routing (correct endpoint dispatches to correct service), auth bypass when `EMAIL_SERVICE_API_KEY` is unset, 401 when token is wrong, 405 for non-POST, 404 for unknown path
  - [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) — provider dispatch, unknown provider throws
- Update [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) `test` step to run `npm test`.

---

### Story 3 — Stop leaking raw error messages to callers in 500 responses

**Problem:** [`src/index.ts:104`](../src/index.ts#L104) returns `err.message` directly in the response body. A Google or Microsoft API error like `invalid_grant: Token has been expired or revoked` gets sent to the caller verbatim.

**Acceptance criteria:** Unexpected errors return `{ "error": "Internal error" }` with status 500. Validation errors (400) and auth errors (401) still return descriptive messages. The full error is logged server-side.

**Spec:**

[`src/index.ts:102-106`](../src/index.ts#L102) — replace the catch block:

```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : 'Internal error';
  const status = message === 'Unauthorized' ? 401 : message === 'Not Found' ? 404 : 500;
  return jsonResponse(status, { error: message });
}
```

with logic that:

1. Checks for known safe error types (validation errors, not-found) and returns their messages.
2. Logs unexpected errors with `console.error`.
3. Returns `{ error: 'Internal error' }` with status 500 for anything else.

---

### Story 4 — Log errors in inbox fetch methods instead of swallowing them silently

**Problem:** [`src/services/inbox-service.ts:204`](../src/services/inbox-service.ts#L204) and [`:244`](../src/services/inbox-service.ts#L244) catch all errors and return `{ message: null }` with no logging. A persistent provider failure is invisible in CloudWatch.

**Acceptance criteria:** When a fetch fails due to anything other than a legitimate 404/not-found response from the provider, the error is logged. Callers still get `{ message: null }` for not-found, and a thrown error for unexpected failures.

**Spec:**

Both `getGmail` and `getMicrosoft` in [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) — update the catch blocks to inspect the error code. Return null only for genuine 404s; log and rethrow for everything else.

---

### Story 5 — Fix Gmail inbox list N+1 API calls

**Problem:** [`src/services/inbox-service.ts:103-126`](../src/services/inbox-service.ts#L103) calls `messages.list` (1 call) then `messages.get` for every result (up to 100 calls) in `Promise.all`. At the default max of 50 messages, that's 51 API calls. This is slow, costs Gmail quota (each `messages.get` costs 5 quota units), and risks hitting per-user rate limits.

**Acceptance criteria:** `/inbox/list` for Gmail makes exactly 1 API call. Summary fields (from, to, subject, date, snippet) are populated.

**Spec:**

[`src/services/inbox-service.ts:103`](../src/services/inbox-service.ts#L103) — replace the `list` + per-message `get` pattern with a single `list` call using `format: 'metadata'` and `metadataHeaders`:

```typescript
const list = await gmail.users.messages.list({
  userId: 'me',
  maxResults,
  q: q.join(' '),
  // remove this and add the fields below:
});
```

Use `gmail.users.messages.list` with additional fields via the `fields` param, or switch to the batch API. The metadata format returns `From`, `To`, `Subject`, `Date` headers inline alongside the snippet, eliminating all per-message fetches.

---

### Story 6 — Add TTL to SSM parameter cache so key rotations take effect without cold starts

**Problem:** [`src/utils/parameter-store.ts:4`](../src/utils/parameter-store.ts#L4) caches the API key in a module-level `Map` that is never cleared. If the SSM parameter is rotated, warm Lambda containers keep using the old key until they are recycled.

**Acceptance criteria:** After rotating the SSM parameter, the Lambda picks up the new value within 10 minutes without requiring a redeploy or forced cold start.

**Spec:**

[`src/utils/parameter-store.ts`](../src/utils/parameter-store.ts) — change `parameterCache` from `Map<string, Promise<string>>` to `Map<string, { value: Promise<string>; fetchedAt: number }>`. On cache hit, check `Date.now() - fetchedAt > TTL_MS` and refetch if expired. Set `TTL_MS` to `10 * 60 * 1000` (10 minutes).

---

### Story 7 — Gate prod deploys on CI passing

**Problem:** [`.github/workflows/deploy-prod.yml`](../.github/workflows/deploy-prod.yml) triggers directly on push to `master` with no dependency on the CI test job. A direct push to master deploys without lint or typecheck running.

**Acceptance criteria:** A push to master that would fail lint or typecheck does not reach the Lambda update step.

**Spec:**

Option A (recommended): Add a branch protection rule on `master` requiring the `test` CI job to pass before merging. No workflow changes needed.

Option B: Add a `test` job to [`deploy-prod.yml`](../.github/workflows/deploy-prod.yml) that mirrors the steps in [`ci.yml`](../.github/workflows/ci.yml) and add `needs: test` to the `deploy` job.

---

### Story 8 — Add structured JSON logging

**Problem:** All logging uses unstructured `console.log` strings across [`src/index.ts`](../src/index.ts), [`src/services/inbox-service.ts`](../src/services/inbox-service.ts), and [`src/services/send-on-behalf-service.ts`](../src/services/send-on-behalf-service.ts). CloudWatch Logs Insights queries against string fields are fragile.

**Acceptance criteria:** Every log line is valid JSON with at minimum `level`, `msg`, and `provider` fields where applicable. Error logs include `err.message` and `err.stack`.

**Spec:**

Add a small logger utility (e.g., `src/utils/logger.ts`) that wraps `console.log`/`console.error` and serializes to JSON. Replace all direct `console.log` calls in the service files with structured calls. No third-party logging dependency is needed.

---

### Story 9 — Validate `afterDate` format before forwarding to Microsoft Graph

**Problem:** [`src/services/inbox-service.ts:139`](../src/services/inbox-service.ts#L139) inserts `body.afterDate` directly into an OData filter string without format validation. An invalid date causes a Microsoft Graph API error that surfaces as a raw 500 (see Story 3).

**Acceptance criteria:** An invalid `afterDate` value returns a 400 with a descriptive error before any API call is made.

**Spec:**

[`src/utils/request-validation.ts:49-60`](../src/utils/request-validation.ts#L49) — in `validateInboxList`, when `afterDate` is present, verify it parses to a valid date with `!isNaN(new Date(body.afterDate).getTime())`. Throw a validation error if it does not.

---

## Minor Items (no story required, fix in-place)

| Item                                            | File                                                                                         | Fix                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Unpinned Docker base image                      | [`Dockerfile:2,19`](../Dockerfile#L2)                                                        | Pin `node:22-bookworm-slim` to a specific digest                                                                     |
| Microsoft send always returns empty `messageId` | [`src/services/send-on-behalf-service.ts:72`](../src/services/send-on-behalf-service.ts#L72) | Make `messageId` optional in `SendOnBehalfResponse`, document that Microsoft Graph `/sendMail` does not return an ID |
| No health check endpoint                        | [`src/index.ts`](../src/index.ts)                                                            | Add `GET /health` returning `200 OK` without auth, useful for connectivity checks                                    |
