# envoy-email-service

Lambda + HTTP API for inbox and send-on-behalf only: send email as the customer, list inbox messages, and fetch a single message.

Transactional email is sent by envoy-project-management via Resend, not this service. This service does not contain OpenAI or other AI integration.

## Endpoints

- `POST /send-on-behalf` - send email as the customer with Gmail or Microsoft Graph
- `POST /inbox/list` - list messages in the connected inbox
- `POST /inbox/message` - get one message body

## Local

```bash
npm install
npm start
```

The local HTTP wrapper runs on port `3000` by default. Set `PORT` to override it. Set `EMAIL_SERVICE_API_KEY` to the SSM Parameter Store name that contains the API key to require `Authorization: Bearer <token>` on requests. Leave it unset to disable local auth.

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
- `src/services/` - Gmail and Microsoft Graph integration logic
- `src/models/` - typed request and response contracts
- `src/utils/` - request parsing and validation helpers
