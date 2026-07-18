# Architecture Overview

Envoy Email Service is a stateless TypeScript service deployed as an AWS Lambda
container image and runnable locally through a thin Node HTTP wrapper. It owns
the Gmail and Microsoft provider boundary for customer-authorized inbox actions.

## Runtime Shape

The runtime is organized around a Lambda-first handler:

- `src/index.ts` exports `handler`, accepts API Gateway v2 events, selects the
  route, validates request bodies, enforces optional internal bearer auth, and
  maps errors to HTTP responses.
- `src/local-server.ts` creates a local HTTP server, converts incoming requests
  into API Gateway v2-style events, invokes `handler`, and writes the returned
  response.
- `src/services/` contains the application service layer for send, inbox, watch,
  webhook, SQS, and provider registry behavior.
- `src/services/providers/` contains concrete Gmail and Microsoft Graph
  adapters.
- `src/utils/` contains validation, configured-parameter loading, SSM access,
  Microsoft `clientState` signing, email body normalization, and JSON logging.

The service has no database. Project Management owns users, inbox connection
records, OAuth refresh, token encryption, conversations, and message
persistence.

## Request Flow

```text
API Gateway or local HTTP request
  -> handler
  -> path/method detection
  -> public webhook bypass or internal auth check
  -> JSON body parsing
  -> request validation
  -> service method
  -> provider adapter or SQS publisher
  -> JSON response
```

Internal Project Management calls can require:

```text
Authorization: Bearer <token>
```

That token is enabled when `EMAIL_SERVICE_API_KEY` is configured. The value of
`EMAIL_SERVICE_API_KEY` is an SSM Parameter Store name, not the raw token.

Provider webhook routes are public callbacks and bypass internal bearer auth:

- `/webhooks/gmail/pubsub`
- `/webhooks/microsoft/graph`
- `/webhooks/microsoft/lifecycle`

Microsoft webhook notifications are verified with signed `clientState` values.

## Provider Adapter Boundary

All provider-specific behavior lives behind `EmailProviderAdapter`:

```text
sendMessage
listMessages
searchVendorMessages
listChangedMessages
getMessage
setupWatch
renewWatch
stopWatch
```

Built-in adapters:

| Provider    | Adapter                                       | External API                     |
| ----------- | --------------------------------------------- | -------------------------------- |
| `gmail`     | `src/services/providers/gmail-adapter.ts`     | Gmail API through `googleapis`.  |
| `microsoft` | `src/services/providers/microsoft-adapter.ts` | Microsoft Graph through `fetch`. |

The registry in `email-provider-registry.ts` lets services select adapters by
provider code.

## Inbox And Send Flow

Project Management passes a provider access token to Email Service for each
operation. Email Service uses the token directly and does not refresh or store
it.

Send flow:

```text
Project Management
  -> POST /send-on-behalf
  -> provider adapter sendMessage
  -> Gmail users.messages.send or Microsoft /me/sendMail
  -> provider message/thread result
```

Inbox flow:

```text
Project Management
  -> POST /inbox/list, /inbox/message, /inbox/search-vendor-messages, or /inbox/changes
  -> provider adapter
  -> normalized message summaries or full message
```

Message body extraction strips common quoted text and HTML wrappers so Project
Management receives the latest reply body rather than the full quoted thread.

## Watch And Webhook Flow

Watch setup creates provider push subscriptions:

- Gmail uses `users.watch` and requires `GMAIL_PUBSUB_TOPIC`.
- Microsoft creates a Graph subscription against
  `me/mailFolders('Inbox')/messages` and requires a public notification URL.

Webhook callbacks normalize provider events into `EmailSyncEventMessage`
payloads and publish them to SQS using `EMAIL_SYNC_QUEUE_URL`.

```text
Provider webhook
  -> webhook handler
  -> provider payload validation
  -> normalized EmailSyncEventMessage
  -> SQS SendMessage
  -> Project Management email sync worker consumes event
```

Gmail event type:

- `gmail_history`

Microsoft event types:

- `microsoft_message_created`
- `microsoft_message_updated`
- `microsoft_subscription_lifecycle`

## Configuration And Secrets

Configuration comes from environment variables. Some values can be direct values
or SSM Parameter Store names:

- `EMAIL_SERVICE_API_KEY` is always treated as an SSM parameter name.
- `GMAIL_PUBSUB_TOPIC` and `MICROSOFT_GRAPH_CLIENT_STATE_SECRET` are loaded by
  `getConfiguredParameterValue`, so values beginning with `/` are resolved from
  SSM and other values are used directly.

SSM values are fetched with decryption and cached in memory for 10 minutes.

## Deployment

The production Dockerfile builds an AWS Lambda Node 22 image:

- Builder stage installs dependencies and runs `npm run build`.
- Production dependencies are installed separately.
- Final stage uses `public.ecr.aws/lambda/nodejs:22`.
- Lambda handler is `dist/index.handler`.

GitHub Actions deployment:

- Pull requests run CI.
- Same-repo, non-draft PR updates deploy to dev after CI passes.
- Pushes to `master` deploy to production.
- Deploy workflows build and push ECR images, then update the Lambda function
  image.
