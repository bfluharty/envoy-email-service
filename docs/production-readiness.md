# Production Readiness

## Usage Catalog

The email service is a Node.js Lambda that acts as a proxy for Gmail operations. It is called exclusively by **envoy-project-management**. It does not send transactional email (that goes through Resend) and has no AI/LLM integration.

| Usage                                | Endpoint               | Who calls it             | When                                                                     |
| ------------------------------------ | ---------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Send email as user                   | `POST /send-on-behalf` | envoy-project-management | User triggers a reply or new outbound email from their connected account |
| List inbox messages                  | `POST /inbox/list`     | envoy-project-management | Polling or on-demand inbox sync for Gmail accounts                       |
| Fetch single message                 | `POST /inbox/message`  | envoy-project-management | Loading full message body after an inbox list                            |
| **Send follow-up email** _(planned)_ | `POST /send-on-behalf` | envoy-project-management | Automatically triggered after a project event to fire a response email   |

### Follow-Up Email Flow (Planned)

envoy-project-management detects an event that requires a follow-up (e.g., a project status change, a deadline, a reply trigger). It invokes this Lambda via its existing `POST /send-on-behalf` endpoint with the user's OAuth access token, recipient, subject, body, and optional `inReplyTo`/`references` headers for thread continuity. The Lambda sends the email through the user's connected Gmail account and returns the `messageId`. No new endpoint is needed - the existing send-on-behalf route already supports reply threading fields.

**What envoy-project-management needs to supply:**

- `provider` - `gmail`
- `accessToken` - the user's current Gmail OAuth token
- `to` - recipient address
- `subject` - email subject
- `body` - email body text
- `inReplyTo` _(optional)_ - `Message-ID` header of the email being replied to
- `references` _(optional)_ - `References` header chain for thread grouping
- `threadId` _(optional)_ - Gmail thread ID to keep the reply in the same thread

---

## Stories with Specs

Each story is self-contained. The **Spec** section points to the exact file and line that must change.

---

### Story 1 - Fix Dockerfile CMD so Lambda actually runs the handler

**Problem:** The production Dockerfile starts `local-server.js`, which is the local dev HTTP wrapper. Lambda container images expect the CMD to resolve to the handler entrypoint. If the Lambda function config does not override CMD, every invocation will try to start an HTTP server and hang until timeout.

**Acceptance criteria:** Deploying the image to Lambda and invoking it returns a valid JSON response. The local dev workflow still works via `Dockerfile.dev` or `npm start`.

**Spec:**

[`Dockerfile:35`](../Dockerfile#L35) - change CMD from:

```dockerfile
CMD ["node", "dist/local-server.js"]
```

to:

```dockerfile
CMD ["dist/index.handler"]
```

The dev Dockerfile ([`Dockerfile.dev`](../Dockerfile.dev)) can keep `local-server.js`. The production image must point at the handler.

---

### Story 2 - Add real tests; `npm test` should exercise behavior, not just types

**Problem:** [`package.json:16`](../package.json#L16) sets `"test": "npm run typecheck"`. There is no behavioral coverage. The CI pipeline passes on every PR regardless of logic regressions.

**Acceptance criteria:** `npm test` runs a test suite that covers request validation, handler routing, and Gmail error paths. CI fails if tests fail.

**Spec:**

- Add `vitest` (or `jest`) to `devDependencies` in [`package.json`](../package.json).
- Update the `"test"` script to run the test suite followed by typecheck.
- Add test files covering:
  - [`src/utils/request-validation.ts`](../src/utils/request-validation.ts) - all three validators, valid and invalid inputs
  - [`src/index.ts`](../src/index.ts) - routing, auth bypass when `EMAIL_SERVICE_API_KEY` is unset, 401 when token is wrong, 405 for non-POST, 404 for unknown path
  - [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) - Gmail dispatch and error handling
- Update [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) `test` step to run `npm test`.

---

### Story 3 - Stop leaking raw error messages to callers in 500 responses

**Problem:** [`src/index.ts:104`](../src/index.ts#L104) returns `err.message` directly in the response body. A Gmail API error like `invalid_grant: Token has been expired or revoked` gets sent to the caller verbatim.

**Acceptance criteria:** Unexpected errors return `{ "error": "Internal error" }` with status 500. Validation errors (400) and auth errors (401) still return descriptive messages. The full error is logged server-side.

**Spec:**

[`src/index.ts:102-106`](../src/index.ts#L102) - replace the catch block with logic that:

1. Checks for known safe error types and returns their messages.
2. Logs unexpected errors with the structured logger.
3. Returns `{ "error": "Internal error" }` with status 500 for anything else.

---

### Story 4 - Log errors in inbox fetch methods instead of swallowing them silently

**Problem:** [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) should not silently convert provider failures into `{ message: null }`. A persistent Gmail failure must be visible in CloudWatch.

**Acceptance criteria:** When a fetch fails due to anything other than a legitimate 404/not-found response from Gmail, the error is logged. Callers still get `{ message: null }` for not-found, and a thrown error for unexpected failures.

**Spec:**

`getGmail` in [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) - inspect the error code. Return null only for genuine 404s; log and rethrow for everything else.

---

### Story 5 - Fix Gmail inbox list N+1 API calls

**Problem:** [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) calls `messages.list` and then `messages.get` for every result. At the default max of 50 messages, that is 51 API calls. This is slow, costs Gmail quota, and risks hitting per-user rate limits.

**Acceptance criteria:** `/inbox/list` for Gmail minimizes API calls while still populating summary fields: from, to, subject, date, and snippet.

**Spec:**

Use `gmail.users.messages.list` with an approach that avoids one full fetch per message when possible, such as metadata fields or batching. Summary fields must remain populated.

---

### Story 6 - Add TTL to SSM parameter cache so key rotations take effect without cold starts

**Problem:** [`src/utils/parameter-store.ts`](../src/utils/parameter-store.ts) caches the API key in a module-level `Map`. If the SSM parameter is rotated, warm Lambda containers should stop using the old key within a bounded window.

**Acceptance criteria:** After rotating the SSM parameter, the Lambda picks up the new value within 10 minutes without requiring a redeploy or forced cold start.

**Spec:**

[`src/utils/parameter-store.ts`](../src/utils/parameter-store.ts) - store cache entries with `value` and `fetchedAt`. On cache hit, check `Date.now() - fetchedAt > TTL_MS` and refetch if expired. Set `TTL_MS` to `10 * 60 * 1000` (10 minutes).

---

### Story 8 - Add structured JSON logging

**Problem:** Logging should be structured so CloudWatch Logs Insights queries can target fields consistently.

**Acceptance criteria:** Every log line is valid JSON with at minimum `level` and `msg`, plus `provider` where applicable. Error logs include `err.message` and `err.stack`.

**Spec:**

Use [`src/utils/logger.ts`](../src/utils/logger.ts) for service logs instead of direct `console.log` or `console.error` calls in request handling and provider code.

---

### Story 9 - Validate `afterDate` format before building Gmail queries

**Problem:** [`src/services/inbox-service.ts`](../src/services/inbox-service.ts) builds the Gmail search query from `body.afterDate`. An invalid date can produce an unintended query or inconsistent behavior.

**Acceptance criteria:** An invalid `afterDate` value returns a 400 with a descriptive error before any API call is made.

**Spec:**

[`src/utils/request-validation.ts`](../src/utils/request-validation.ts) - in `validateInboxList`, when `afterDate` is present, verify it parses to a valid date with `!Number.isNaN(new Date(body.afterDate).getTime())`. Throw a validation error if it does not.

---

## Minor Items (no story required, fix in-place)

| Item                       | File                              | Fix                                                                               |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| Unpinned Docker base image | [`Dockerfile`](../Dockerfile)     | Pin the Node base image to a specific digest                                      |
| No health check endpoint   | [`src/index.ts`](../src/index.ts) | Add `GET /health` returning `200 OK` without auth, useful for connectivity checks |
