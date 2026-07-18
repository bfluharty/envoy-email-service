# Envoy Email Service

Envoy Email Service is the provider-integration boundary for customer inboxes.
Project Management calls it to send email on behalf of a connected customer,
list and fetch provider messages, search inbox history for vendor
conversations, configure provider watches, and receive provider push
notifications that become normalized SQS sync events.

This service is not the transactional email system for Envoy. Password reset,
account, and application notification mail is sent by Project Management through
Resend. This service is only for customer-authorized Gmail and Microsoft inbox
operations.

## Table Of Contents

- [Purpose](#purpose)
- [Repository Layout](#repository-layout)
- [Documentation Index](#documentation-index)
- [Local Setup](#local-setup)
- [Running The Service](#running-the-service)
- [Testing](#testing)
- [Docker](#docker)
- [Contributing](#contributing)

## Purpose

Email Service owns the provider API boundary for:

- Sending email as the customer through Gmail or Microsoft Graph.
- Listing inbox, sent, or all-mail summaries from a connected provider account.
- Fetching one message body and headers.
- Searching provider mail by vendor email addresses.
- Fetching changed or provider-referenced messages for inbox sync workers.
- Creating, renewing, and stopping Gmail watches or Microsoft Graph
  subscriptions.
- Receiving Gmail Pub/Sub and Microsoft Graph webhook callbacks.
- Publishing normalized email sync events to SQS for Project Management workers.

It does not own users, projects, contacts, conversations, inbox connection
records, OAuth refresh, token encryption, or persisted messages. Project
Management owns those records and passes provider access tokens into this
service for each operation.

## Repository Layout

| Path                      | Purpose                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/`      | CI plus dev/prod Lambda image deployment workflows for GitHub Actions, ECR, and AWS Lambda.                           |
| `.husky/`                 | Git hooks. The pre-commit hook runs lint-staged.                                                                      |
| `docs/`                   | Project documentation and development guides. Start with [docs/README.md](docs/README.md).                            |
| `src/index.ts`            | Lambda handler, route selection, auth check, validation, and error mapping.                                           |
| `src/local-server.ts`     | Local HTTP wrapper that adapts Node HTTP requests into API Gateway v2 events.                                         |
| `src/models/`             | TypeScript email, inbox, watch, webhook, and SQS event contracts.                                                     |
| `src/services/`           | Send, inbox, watch, webhook, SQS publisher, provider registry, and provider adapters.                                 |
| `src/services/providers/` | Gmail and Microsoft Graph adapter implementations.                                                                    |
| `src/utils/`              | Request validation, SSM/configured parameter helpers, Microsoft clientState signing, logging, and email body cleanup. |
| `test/`                   | Vitest unit tests for handler routing, validation, provider behavior, webhook behavior, and utility logic.            |

Generated or local-only paths such as `dist/`, `node_modules/`, and `.env` are
not source documentation.

## Documentation Index

Core development docs:

- [Documentation home](docs/README.md)
- [Architecture overview](docs/architecture.md)
- [API reference](docs/api.md)
- [Contracts and provider behavior](docs/contracts.md)
- [Local development](docs/development/local-development.md)
- [Docker workflows](docs/development/docker.md)
- [Testing guide](docs/development/testing.md)
- [Contributing guide](docs/development/contributing.md)

## Local Setup

Prerequisites:

- Node.js 20 or newer. CI and Docker use Node 22.
- npm.
- AWS credentials only when testing SSM Parameter Store or SQS publishing
  directly.
- Valid Gmail or Microsoft access tokens only when testing live provider calls.

Install dependencies:

```bash
npm ci
```

Create local environment variables:

```bash
cp .env.example .env
```

Important local values:

```text
PORT=8083
EMAIL_SYNC_QUEUE_URL=...
EMAIL_SERVICE_API_KEY=
GMAIL_PUBSUB_TOPIC=
MICROSOFT_GRAPH_NOTIFICATION_URL=http://127.0.0.1:8083/webhooks/microsoft/graph
MICROSOFT_GRAPH_LIFECYCLE_URL=http://127.0.0.1:8083/webhooks/microsoft/lifecycle
MICROSOFT_GRAPH_CLIENT_STATE_SECRET=...
```

Leave `EMAIL_SERVICE_API_KEY` empty for unauthenticated local internal calls. In
deployed environments it is the SSM Parameter Store name containing the bearer
token expected from Project Management.

See [Local development](docs/development/local-development.md) for full
environment details.

## Running The Service

Run the local HTTP wrapper:

```bash
npm start
```

The local server defaults to:

```text
http://localhost:8083
```

Useful endpoints:

```text
GET  /health
POST /send-on-behalf
POST /inbox/list
POST /inbox/message
POST /inbox/search-vendor-messages
POST /inbox/changes
POST /watches/setup
POST /watches/renew
POST /watches/stop
POST /webhooks/gmail/pubsub
POST /webhooks/microsoft/graph
POST /webhooks/microsoft/lifecycle
```

Build compiled Lambda output:

```bash
npm run build
```

Compiled JavaScript is emitted to `dist/`; the Lambda image handler is
`dist/index.handler`.

## Testing

Run tests:

```bash
npm test
```

Run quality checks:

```bash
npm run lint
npm run typecheck
```

CI currently runs lint and typecheck on pull requests. Run `npm test` locally
for behavior changes.

See [Testing guide](docs/development/testing.md) for test coverage areas and
provider-boundary guidance.

## Docker

Build the Lambda production image:

```bash
docker build -t envoy-email-service .
```

Build the development image:

```bash
docker build -f Dockerfile.dev -t envoy-email-service-dev .
```

Run the development image locally:

```bash
docker run --rm -p 8083:8083 --env-file .env envoy-email-service-dev
```

Project Management's full-stack Docker workflow builds this repo from
`Dockerfile.dev` and exposes it on port `8083`.

See [Docker workflows](docs/development/docker.md) for Lambda image behavior,
local container usage, and Compose integration.

## Contributing

Before opening a PR:

- Keep changes scoped to the requested behavior.
- Add or update tests for every behavior change.
- Include validation tests for request contract changes.
- Include handler tests for route, auth, status-code, or error-mapping changes.
- Include provider-adapter tests for Gmail or Microsoft API behavior changes.
- Include webhook/SQS tests for provider callback changes.
- Run `npm run lint`, `npm run typecheck`, and `npm test`.
- Update README/docs when commands, contracts, provider behavior, webhooks,
  environment variables, or operational expectations change.
- Never commit `.env`, secrets, `dist/`, dependency folders, local artifacts, or
  provider access tokens.

See the full [Contributing guide](docs/development/contributing.md) for test,
contract, provider, security, and documentation expectations.
