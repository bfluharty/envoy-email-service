# API Reference

Email Service exposes a Lambda/API Gateway-style HTTP API. `src/local-server.ts`
provides the same routes locally by adapting Node HTTP requests into API Gateway
v2 events.

## Conventions

- Internal routes are `POST` only, except `GET /health`.
- Request bodies must be non-empty JSON.
- Responses are JSON unless Microsoft Graph sends a `validationToken`
  challenge, which returns plain text.
- Internal routes can require `Authorization: Bearer <token>` when
  `EMAIL_SERVICE_API_KEY` is configured.
- Provider webhook routes do not use the internal bearer token.
- Provider auth failures from Gmail/Microsoft are mapped to `401` or `403` with
  `Provider authorization failed`.
- Unexpected errors are logged and returned as `{ "error": "Internal error" }`
  to avoid leaking provider details.

Common status codes:

| Status | Meaning                                                                    |
| ------ | -------------------------------------------------------------------------- |
| `200`  | Successful internal operation or Microsoft validation challenge.           |
| `202`  | Public webhook accepted and queued normalized sync events.                 |
| `400`  | Missing body, invalid JSON, validation error, or invalid webhook payload.  |
| `401`  | Missing/incorrect internal bearer token or provider authorization failure. |
| `403`  | Provider authorization failure.                                            |
| `404`  | Unknown route.                                                             |
| `405`  | Unsupported method.                                                        |
| `500`  | Unexpected service, provider, SSM, or SQS error.                           |

## Authentication

When `EMAIL_SERVICE_API_KEY` is unset or blank, internal bearer auth is disabled.
This is useful for local development.

When configured, `EMAIL_SERVICE_API_KEY` must be the name of an SSM Parameter
Store value containing the expected bearer token. Internal callers must send:

```text
Authorization: Bearer <token-from-ssm>
```

The service loads the parameter with decryption and caches it in memory for 10
minutes.

Public webhook routes bypass this bearer check because they are called by
provider infrastructure.

## Route Summary

| Method | Path                            | Auth                            | Purpose                                                     |
| ------ | ------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `GET`  | `/health`                       | None                            | Liveness check.                                             |
| `POST` | `/send-on-behalf`               | Internal bearer when configured | Send email as the connected customer.                       |
| `POST` | `/inbox/list`                   | Internal bearer when configured | List message summaries.                                     |
| `POST` | `/inbox/message`                | Internal bearer when configured | Fetch a single message.                                     |
| `POST` | `/inbox/search-vendor-messages` | Internal bearer when configured | Search all provider mail by vendor email addresses.         |
| `POST` | `/inbox/changes`                | Internal bearer when configured | Fetch changed or provider-referenced messages.              |
| `POST` | `/watches/setup`                | Internal bearer when configured | Create Gmail watch or Microsoft Graph subscription.         |
| `POST` | `/watches/renew`                | Internal bearer when configured | Renew Gmail watch or Microsoft Graph subscription.          |
| `POST` | `/watches/stop`                 | Internal bearer when configured | Stop Gmail watch or Microsoft Graph subscription.           |
| `POST` | `/webhooks/gmail/pubsub`        | Public provider callback        | Accept Gmail Pub/Sub push event.                            |
| `POST` | `/webhooks/microsoft/graph`     | Public provider callback        | Accept Microsoft Graph message notification.                |
| `POST` | `/webhooks/microsoft/lifecycle` | Public provider callback        | Accept Microsoft Graph subscription lifecycle notification. |

## Health

```text
GET /health
```

Response:

```json
{
  "status": "ok"
}
```

## Send On Behalf

```text
POST /send-on-behalf
```

Request:

```json
{
  "provider": "gmail",
  "accessToken": "provider-access-token",
  "to": "vendor@example.com",
  "subject": "Project quote request",
  "body": "Hello...",
  "inReplyTo": "<optional-message-id>",
  "references": "<optional-references>",
  "threadId": "optional-provider-thread-id"
}
```

Validation:

| Field         | Rule                              |
| ------------- | --------------------------------- |
| `provider`    | Required; `gmail` or `microsoft`. |
| `accessToken` | Required string.                  |
| `to`          | Required string.                  |
| `subject`     | Required string.                  |
| `body`        | Required string.                  |
| `inReplyTo`   | Optional string.                  |
| `references`  | Optional string.                  |
| `threadId`    | Optional string.                  |

Response:

```json
{
  "messageId": "provider-message-id-or-null",
  "threadId": "provider-thread-id-or-null"
}
```

Gmail usually returns both message and thread IDs. Microsoft `/me/sendMail`
returns no message ID, so `messageId` is `null` and `threadId` is preserved from
the request when supplied.

## Inbox List

```text
POST /inbox/list
```

Request:

```json
{
  "provider": "gmail",
  "accessToken": "provider-access-token",
  "maxResults": 50,
  "afterDate": "2026-01-01T00:00:00.000Z",
  "mailbox": "inbox"
}
```

Validation:

| Field         | Rule                                                             |
| ------------- | ---------------------------------------------------------------- |
| `provider`    | Required; `gmail` or `microsoft`.                                |
| `accessToken` | Required string.                                                 |
| `maxResults`  | Optional number; adapters cap at 100.                            |
| `afterDate`   | Optional valid date string.                                      |
| `mailbox`     | Optional; `inbox`, `sent`, or `all`. Defaults to inbox behavior. |

Response:

```json
{
  "messages": [
    {
      "id": "provider-message-id",
      "threadId": "provider-thread-id-or-null",
      "from": "Sender <sender@example.com>",
      "to": "Recipient <recipient@example.com>",
      "subject": "Subject",
      "date": "2026-01-01T00:00:00.000Z",
      "snippet": "Optional preview"
    }
  ]
}
```

## Inbox Message

```text
POST /inbox/message
```

Request:

```json
{
  "provider": "microsoft",
  "accessToken": "provider-access-token",
  "messageId": "provider-message-id"
}
```

Response:

```json
{
  "message": {
    "id": "provider-message-id",
    "from": "Sender <sender@example.com>",
    "to": "Recipient <recipient@example.com>",
    "cc": "CC <cc@example.com>",
    "subject": "Subject",
    "body": "Latest message body",
    "date": "2026-01-01T00:00:00.000Z",
    "messageId": "<internet-message-id@example.com>",
    "inReplyTo": "<prior-message-id@example.com>",
    "references": "<references>",
    "threadId": "provider-thread-id"
  }
}
```

If the provider message is not found, `message` is `null`.

## Search Vendor Messages

```text
POST /inbox/search-vendor-messages
```

Request:

```json
{
  "provider": "gmail",
  "accessToken": "provider-access-token",
  "vendorEmails": ["vendor@example.com"],
  "maxResults": 50,
  "afterDate": "2026-01-01T00:00:00.000Z"
}
```

`vendorEmails` must be an array of strings. The response shape is the same as
`/inbox/list`.

Provider behavior:

- Gmail searches all mail with `from:` and `to:` query clauses.
- Microsoft searches `/me/messages` with Microsoft Graph `$search` over message
  participants, then applies exact sender, recipient, CC, and date matching in
  the service.

## Inbox Changes

```text
POST /inbox/changes
```

Request:

```json
{
  "provider": "gmail",
  "accessToken": "provider-access-token",
  "cursor": "provider-cursor",
  "messageId": "provider-message-id"
}
```

`cursor` and `messageId` are optional strings, but at least one is normally used
by callers.

Provider behavior:

- Gmail with `messageId` fetches a summary for that message.
- Gmail with `cursor` uses Gmail history from `startHistoryId`.
- Gmail with neither falls back to listing all mail.
- Microsoft with `messageId` fetches a summary for that message.
- Microsoft without `messageId` lists all mail.

The response shape is the same as `/inbox/list`.

## Watch Setup

```text
POST /watches/setup
```

Request:

```json
{
  "provider": "microsoft",
  "accessToken": "provider-access-token",
  "email": "customer@example.com",
  "connectionUuid": "connection-uuid",
  "callbackUrl": "https://example.com/webhooks/microsoft/graph"
}
```

Validation:

| Field            | Rule                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| `provider`       | Required; `gmail` or `microsoft`.                                                      |
| `accessToken`    | Required string.                                                                       |
| `email`          | Required string.                                                                       |
| `connectionUuid` | Required string.                                                                       |
| `callbackUrl`    | Optional string. Microsoft can use this instead of `MICROSOFT_GRAPH_NOTIFICATION_URL`. |

Response:

```json
{
  "provider": "microsoft",
  "providerCursor": "gmail-history-id",
  "providerSubscriptionId": "microsoft-subscription-id",
  "subscriptionClientState": "signed-client-state",
  "expiresAt": "2026-01-03T00:00:00.000Z"
}
```

Gmail returns `providerCursor` and `expiresAt`. Microsoft returns
`providerSubscriptionId`, `subscriptionClientState`, and `expiresAt`.

## Watch Renew

```text
POST /watches/renew
```

Request:

```json
{
  "provider": "microsoft",
  "accessToken": "provider-access-token",
  "email": "customer@example.com",
  "connectionUuid": "connection-uuid",
  "providerSubscriptionId": "subscription-id"
}
```

Gmail renewals call setup again and do not require `providerSubscriptionId`.
Microsoft renewals require `providerSubscriptionId`.

Response shape is the same as watch setup.

## Watch Stop

```text
POST /watches/stop
```

Request:

```json
{
  "provider": "gmail",
  "accessToken": "provider-access-token",
  "providerSubscriptionId": "optional-microsoft-subscription-id"
}
```

Response:

```json
{
  "stopped": true
}
```

Gmail calls `users.stop`. Microsoft deletes the Graph subscription only when a
subscription ID is provided.

## Gmail Pub/Sub Webhook

```text
POST /webhooks/gmail/pubsub
```

Request:

```json
{
  "message": {
    "data": "base64-json",
    "messageId": "pubsub-message-id",
    "publishTime": "2026-01-01T00:00:00Z"
  }
}
```

Decoded `message.data` must contain:

```json
{
  "emailAddress": "customer@example.com",
  "historyId": "history-id"
}
```

Response:

```json
{
  "queued": 1
}
```

The webhook publishes a `gmail_history` SQS event.

## Microsoft Graph Webhook

```text
POST /webhooks/microsoft/graph
```

Microsoft validation challenge:

```text
POST /webhooks/microsoft/graph?validationToken=abc123
```

returns `200` plain text:

```text
abc123
```

Notification request:

```json
{
  "value": [
    {
      "subscriptionId": "subscription-id",
      "clientState": "signed-client-state",
      "changeType": "created",
      "resourceData": {
        "id": "message-id",
        "conversationId": "thread-id"
      }
    }
  ]
}
```

Response:

```json
{
  "queued": 1
}
```

The webhook verifies `clientState` and publishes either
`microsoft_message_created` or `microsoft_message_updated`.

## Microsoft Lifecycle Webhook

```text
POST /webhooks/microsoft/lifecycle
```

This endpoint also handles `validationToken` challenges as plain text.

Notification request shape matches Microsoft Graph webhook notifications. The
webhook verifies `clientState` and publishes
`microsoft_subscription_lifecycle`.
