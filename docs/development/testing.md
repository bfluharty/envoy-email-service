# Testing Guide

Email Service uses Vitest for unit tests.

## Test Commands

Run all tests:

```bash
npm test
```

Run lint and typecheck:

```bash
npm run lint
npm run typecheck
```

Build compiled output:

```bash
npm run build
```

## Test Coverage Areas

Tests live under `test/`.

Current coverage areas:

| File                             | Purpose                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `handler.test.ts`                | Route selection, method guards, optional bearer auth, public webhook bypass, validation failures, and error mapping. |
| `request-validation.test.ts`     | Body parsing and request validation for send, inbox, search, changes, and watch contracts.                           |
| `webhook-service.test.ts`        | Gmail Pub/Sub normalization and Microsoft Graph notification normalization.                                          |
| `microsoft-client-state.test.ts` | Microsoft `clientState` signing and verification.                                                                    |
| `microsoft-adapter.test.ts`      | Microsoft adapter request/response behavior.                                                                         |
| `email-body.test.ts`             | Latest-message body extraction and quoted-text cleanup.                                                              |

## CI Coverage

`.github/workflows/ci.yml` runs on pull requests. It currently executes:

```bash
npm ci
npm run lint
npm run typecheck
```

CI does not currently run `npm test`. Run tests locally before opening a PR with
behavior changes.

## What To Test

Add or update tests with every behavior change:

- Request field changes need validation tests.
- Route, auth, status-code, or error-mapping changes need handler tests.
- Gmail or Microsoft adapter changes need provider-adapter tests with mocked
  provider calls.
- Webhook changes need normalized SQS event tests.
- Microsoft subscription/clientState changes need clientState tests.
- Email body cleanup changes need body extraction tests.
- SSM/configuration behavior should be tested with mocked AWS SDK clients or
  helper-level tests.

Avoid tests that require real Gmail, Microsoft, SSM, or SQS by default. Use
manual/live testing only with disposable accounts and non-production queues.

## Local Verification Checklist

For most PRs:

```bash
npm run lint
npm run typecheck
npm test
```

For deployment or Docker changes:

```bash
npm run build
docker build -t envoy-email-service .
docker build -f Dockerfile.dev -t envoy-email-service-dev .
```
