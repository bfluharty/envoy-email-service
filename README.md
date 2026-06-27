# envoy-email-service

Lambda + HTTP API for inbox, send-on-behalf, and provider push notifications: send email as the customer, list inbox messages, fetch a single message, configure provider watches, and normalize provider webhooks into SQS sync events.

Transactional email is sent by envoy-project-management via Resend, not this service. This service does not contain OpenAI or other AI integration.

## Endpoints

- `POST /send-on-behalf` - send email as the customer
- `POST /inbox/list` - list messages in the connected inbox
- `POST /inbox/message` - get one message body
- `POST /inbox/search-vendor-messages` - search provider mail by vendor email addresses
- `POST /inbox/changes` - fetch changed/provider-referenced messages
- `POST /watches/setup` - configure Gmail Pub/Sub watch or Microsoft Graph subscription
- `POST /watches/renew` - renew an expiring provider watch/subscription
- `POST /watches/stop` - stop a provider watch/subscription
- `POST /webhooks/gmail/pubsub` - receive Gmail Pub/Sub push messages and publish SQS sync events
- `POST /webhooks/microsoft/graph` - receive Microsoft Graph change notifications and publish SQS sync events
- `POST /webhooks/microsoft/lifecycle` - receive Microsoft Graph subscription lifecycle notifications

Internal project-management calls use `Authorization: Bearer <EMAIL_SERVICE_API_KEY>` when `EMAIL_SERVICE_API_KEY` is configured. Provider webhook endpoints are public provider callbacks and do not use that bearer token; Microsoft notifications are verified with signed `clientState`.

## Configuration

- `EMAIL_SERVICE_API_KEY` - SSM Parameter Store name containing the internal bearer token. Leave unset for local unauthenticated internal calls.
- `EMAIL_SYNC_QUEUE_URL` - SQS queue URL for normalized provider sync events.
- `GMAIL_PUBSUB_TOPIC` - full Gmail Pub/Sub topic name, for example `projects/<project>/topics/<topic>`.
- `MICROSOFT_GRAPH_NOTIFICATION_URL` - public HTTPS URL for `/webhooks/microsoft/graph`.
- `MICROSOFT_GRAPH_LIFECYCLE_URL` - optional public HTTPS URL for `/webhooks/microsoft/lifecycle`.
- `MICROSOFT_GRAPH_CLIENT_STATE_SECRET` - stable secret used to sign and verify Graph `clientState`.

The deployed runtime role needs `sqs:SendMessage` for `EMAIL_SYNC_QUEUE_URL`. Provider webhook routes must be reachable by Google Pub/Sub and Microsoft Graph over public HTTPS.

## Local

```bash
npm install
npm start
```

The local HTTP wrapper runs on port `8083` by default. Set `PORT` to override it. Set `EMAIL_SERVICE_API_KEY` to the SSM Parameter Store name that contains the API key to require `Authorization: Bearer <token>` on internal requests. Leave it unset to disable local auth.

When deployed, the runtime role needs `ssm:GetParameter` for that parameter and `kms:Decrypt` if the value is stored as a `SecureString` encrypted with a customer-managed key.

## Build

```bash
npm run build
npm run typecheck
```

Compiled JavaScript is emitted to `dist/`. For Lambda deployment, point the handler at `dist/index.handler` after running `npm run build`.

## Layout

- `src/index.ts` - Lambda entry point and route handling
- `src/local-server.ts` - thin HTTP wrapper for local Docker or direct local development
- `src/services/` - provider adapters, watch setup, webhook handling, and SQS publishing
- `src/models/` - typed request and response contracts
- `src/utils/` - request parsing and validation helpers
