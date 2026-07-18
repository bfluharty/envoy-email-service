# Local Development

This guide covers native local development for Envoy Email Service.

## Prerequisites

- Node.js 20 or newer. Node 22 is used by CI and Docker images.
- npm.
- AWS credentials only when testing SSM Parameter Store or SQS publishing.
- Provider access tokens only when manually testing live Gmail or Microsoft
  calls.
- Optional sibling `envoy-project-management` repo for the full Envoy Docker
  stack.

## Install Dependencies

```bash
npm ci
```

## Environment Setup

Create `.env`:

```bash
cp .env.example .env
```

Important variables:

| Variable                              | Required                       | Purpose                                                                                                         |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                            | Local recommended              | Runtime environment label.                                                                                      |
| `PORT`                                | Optional                       | Local HTTP wrapper port. Defaults to `8083`.                                                                    |
| `EMAIL_SYNC_QUEUE_URL`                | Webhook/SQS testing            | SQS queue URL for normalized provider sync events.                                                              |
| `EMAIL_SERVICE_API_KEY`               | Optional                       | SSM parameter name containing the internal bearer token. Leave blank for local unauthenticated internal routes. |
| `GMAIL_PUBSUB_TOPIC`                  | Gmail watch setup              | Gmail Pub/Sub topic name, or SSM parameter name if it starts with `/`.                                          |
| `MICROSOFT_GRAPH_NOTIFICATION_URL`    | Microsoft watch setup          | Public HTTPS URL for `/webhooks/microsoft/graph`, or local callback URL for tests/tunnels.                      |
| `MICROSOFT_GRAPH_LIFECYCLE_URL`       | Optional Microsoft watch setup | Public HTTPS URL for `/webhooks/microsoft/lifecycle`.                                                           |
| `MICROSOFT_GRAPH_CLIENT_STATE_SECRET` | Microsoft webhooks             | Direct secret or SSM parameter name if it starts with `/`.                                                      |

Do not commit `.env`, provider tokens, secrets, or SSM parameter values.

## Start The Service

Run the local HTTP wrapper:

```bash
npm start
```

The server starts at:

```text
http://localhost:8083
```

`npm start` runs `tsc` and then starts `dist/local-server.js`.

## Build Only

```bash
npm run build
```

Compiled Lambda-ready JavaScript is emitted to `dist/`.

## Local Internal Auth

By default, leave `EMAIL_SERVICE_API_KEY` blank for local work. Internal routes
will not require `Authorization`.

To test bearer auth locally, set `EMAIL_SERVICE_API_KEY` to an SSM parameter
name that contains the expected token. The runtime must have AWS credentials
able to call `ssm:GetParameter` with decryption.

## Full-Stack Local Development

The easiest way to run this service with the rest of Envoy is from the sibling
Project Management repo:

```bash
cd ../envoy-project-management
./run-docker.sh
```

Expected sibling layout:

```text
envoy/
  envoy-project-management/
  reasoning-engine/
  envoy-email-service/
```

Project Management's Compose workflow builds this repo with `Dockerfile.dev` and
exposes the service on `8083`.

## Live Provider Testing

Manual live provider calls require valid OAuth access tokens with appropriate
mail scopes:

- Gmail send/read/watch operations use Gmail API scopes.
- Microsoft send/read/subscription operations use Microsoft Graph mail scopes.

Project Management is responsible for OAuth authorization and token refresh.
For local manual calls, use disposable accounts and avoid logging or committing
tokens.
