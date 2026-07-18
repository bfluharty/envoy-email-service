# Contributing Guide

Email Service is a provider-boundary service. Changes must keep Project
Management contracts stable and avoid leaking provider tokens or sensitive email
content.

## Before Changing Code

Read the relevant handler route, validator, service, provider adapter, model
contract, and tests before editing. Prefer the existing adapter pattern over
branching provider behavior throughout route handlers.

Do not add persistence to this repo. Project Management owns inbox connections,
OAuth refresh, conversations, message records, and sync worker state.

## Test Requirements

Every behavior change needs tests.

Expected coverage by change type:

| Change type                    | Expected tests                                         |
| ------------------------------ | ------------------------------------------------------ |
| Request validation             | `request-validation.test.ts`.                          |
| Route, auth, or error behavior | `handler.test.ts`.                                     |
| Gmail adapter behavior         | Provider-adapter test with mocked Gmail API calls.     |
| Microsoft adapter behavior     | `microsoft-adapter.test.ts` or equivalent.             |
| Webhook event normalization    | `webhook-service.test.ts`.                             |
| Microsoft clientState behavior | `microsoft-client-state.test.ts`.                      |
| Email body cleanup             | `email-body.test.ts`.                                  |
| Build/runtime behavior         | `npm run build` and Docker build checks when relevant. |

Run before review:

```bash
npm run lint
npm run typecheck
npm test
```

## Provider Adapter Rules

Keep provider-specific behavior inside adapters under `src/services/providers/`.
Shared route handlers and services should call the `EmailProviderAdapter`
interface.

When changing provider behavior:

- Normalize results into the DTOs in `src/models/email.ts`.
- Keep provider access tokens out of logs.
- Preserve provider-specific IDs needed by Project Management reconciliation.
- Do not expose raw provider payloads from internal inbox endpoints unless the
  contract intentionally changes.
- Add tests for provider-specific query construction, response mapping, and
  error handling.

## Webhook And SQS Rules

Webhook routes are public provider callbacks. Keep validation strict:

- Gmail Pub/Sub payloads must include decodable message data with
  `emailAddress` and `historyId`.
- Microsoft notifications must include valid signed `clientState`.
- Microsoft lifecycle notifications must also verify `clientState`.
- Normalized SQS events should include enough provider identifiers for Project
  Management workers to fetch and reconcile messages.

Do not require the internal bearer token for provider webhooks.

## Configuration And Security

Configuration changes should update `.env.example`, docs, and deployment
configuration together.

Important rules:

- `EMAIL_SERVICE_API_KEY` is an SSM parameter name, not the raw token.
- Direct provider access tokens are request data and must not be logged.
- SSM parameters are read with decryption and cached for 10 minutes.
- The Lambda runtime role needs `ssm:GetParameter` for configured parameters and
  `sqs:SendMessage` for the sync queue.
- If SSM SecureString values use a customer-managed KMS key, the runtime role
  also needs `kms:Decrypt`.

## Documentation Requirements

Update documentation in the same PR when changing:

- Routes, request fields, response fields, auth behavior, or status codes.
- Provider adapter behavior or normalized message shapes.
- Webhook payloads, Microsoft clientState behavior, or SQS event contracts.
- Environment variables, SSM/IAM requirements, Docker behavior, or deployment
  flow.
- Test commands or local/full-stack setup.

## Pull Request Checklist

Before requesting review:

- Code is scoped to the requested behavior.
- Tests were added or updated for all behavior changes.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm test` passes locally.
- Docs and `.env.example` are updated when needed.
- No secrets, `.env` files, provider tokens, `dist/`, dependency folders, or
  local artifacts are included.
