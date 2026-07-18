# Contracts And Provider Behavior

Email Service is a stateless provider-contract service. Project Management owns
users, inbox connections, OAuth refresh, token encryption, conversations, and
message persistence. Email Service receives access tokens and returns normalized
provider results.

Source files:

- `src/models/email.ts`
- `src/utils/request-validation.ts`
- `src/services/email-provider-adapter.ts`
- `src/services/providers/gmail-adapter.ts`
- `src/services/providers/microsoft-adapter.ts`
- `src/services/webhook-service.ts`

## Providers

Supported provider codes:

```ts
type EmailProvider = 'gmail' | 'microsoft';
```

Supported mailboxes:

```ts
type InboxMailbox = 'inbox' | 'sent' | 'all';
```

Provider adapters must implement:

```ts
interface EmailProviderAdapter {
  provider: EmailProvider;
  listMessages(input: InboxListRequest): Promise<InboxListResponse>;
  searchVendorMessages(input: InboxSearchVendorMessagesRequest): Promise<InboxListResponse>;
  listChangedMessages(input: InboxChangesRequest): Promise<InboxListResponse>;
  getMessage(input: InboxGetMessageRequest): Promise<InboxGetMessageResponse>;
  sendMessage(input: SendOnBehalfRequest): Promise<SendOnBehalfResponse>;
  setupWatch(input: WatchSetupRequest): Promise<WatchResult>;
  renewWatch(input: RenewWatchRequest): Promise<WatchResult>;
  stopWatch(input: StopWatchRequest): Promise<void>;
}
```

## Send Contract

```ts
interface SendOnBehalfRequest {
  provider: EmailProvider;
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
}

interface SendOnBehalfResponse {
  messageId: string | null;
  threadId?: string | null;
}
```

Provider behavior:

- Gmail sends MIME content through `gmail.users.messages.send`, supports
  `In-Reply-To`, `References`, and Gmail thread IDs, and returns Gmail message
  and thread IDs.
- Microsoft sends base64 MIME content through `/me/sendMail`, supports reply
  headers in the MIME content, and returns `messageId: null` because Graph
  `sendMail` does not return a message resource.

Project Management records outbound message state and later reconciles provider
IDs during sync.

## Inbox Summary Contract

```ts
interface InboxMessageSummary {
  id: string;
  threadId: string | null;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet?: string;
}

interface InboxListResponse {
  messages: InboxMessageSummary[];
}
```

Provider behavior:

- Gmail summary dates come from the `Date` header.
- Microsoft summary dates prefer received, sent, or created timestamps and are
  normalized to ISO strings.
- Both adapters cap `maxResults` at 100 and default to 50.

## Full Message Contract

```ts
interface InboxMessage {
  id: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  date: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string | null;
}

interface InboxGetMessageResponse {
  message: InboxMessage | null;
}
```

`body` is normalized with `extractLatestEmailBody`, which strips common HTML,
quoted reply text, blockquotes, and original-message separators.

Missing provider messages return `{ message: null }`.

## Search Contract

```ts
interface InboxSearchVendorMessagesRequest {
  provider: EmailProvider;
  accessToken: string;
  vendorEmails: string[];
  maxResults?: number;
  afterDate?: string;
}
```

Provider behavior:

- Gmail builds a query with `from:<email>` and `to:<email>` clauses and searches
  all mail.
- Microsoft combines Graph `$search` over participants with a recent message
  scan, then applies exact sender, recipient, CC, and date matching in the
  service.
- Empty Microsoft vendor-email searches return an empty message list.

## Changes Contract

```ts
interface InboxChangesRequest {
  provider: EmailProvider;
  accessToken: string;
  cursor?: string;
  messageId?: string;
}
```

Provider behavior:

- Gmail with `messageId` returns that message summary.
- Gmail with `cursor` calls Gmail history with `startHistoryId`.
- Gmail with neither lists all mail.
- Microsoft with `messageId` fetches that message summary.
- Microsoft without `messageId` lists all mail.

## Watch Contract

```ts
interface WatchSetupRequest {
  provider: EmailProvider;
  accessToken: string;
  email: string;
  connectionUuid: string;
  callbackUrl?: string;
}

interface RenewWatchRequest extends WatchSetupRequest {
  providerSubscriptionId?: string;
}

interface StopWatchRequest {
  provider: EmailProvider;
  accessToken: string;
  providerSubscriptionId?: string;
}

interface WatchResult {
  provider: EmailProvider;
  providerCursor?: string;
  providerSubscriptionId?: string;
  subscriptionClientState?: string;
  expiresAt?: string;
}
```

Gmail:

- `setupWatch` and `renewWatch` both call Gmail `users.watch`.
- Requires `GMAIL_PUBSUB_TOPIC`.
- Returns the Gmail history ID as `providerCursor`.
- `stopWatch` calls Gmail `users.stop`.

Microsoft:

- `setupWatch` creates a Graph subscription on
  `me/mailFolders('Inbox')/messages`.
- Requires `MICROSOFT_GRAPH_NOTIFICATION_URL` or request `callbackUrl`.
- Uses `MICROSOFT_GRAPH_LIFECYCLE_URL` when configured.
- Signs `clientState` with `MICROSOFT_GRAPH_CLIENT_STATE_SECRET`.
- Uses a 2-day subscription TTL.
- `renewWatch` requires `providerSubscriptionId`.
- `stopWatch` deletes the subscription when `providerSubscriptionId` is present.

## Microsoft Client State

Microsoft `clientState` format:

```text
m:<connectionUuid>:<issuedAtUnixSeconds>:<signature>
```

The signature is an HMAC-SHA256 over the payload, truncated to 16 bytes and
encoded as base64url. Verification uses `timingSafeEqual`.

The verified payload returns:

```ts
interface MicrosoftClientStatePayload {
  connectionUuid: string;
  issuedAt: number;
}
```

Webhook notifications with missing or invalid client state are rejected with
validation errors.

## SQS Sync Event Contract

```ts
type EmailSyncEventType =
  | 'gmail_history'
  | 'microsoft_message_created'
  | 'microsoft_message_updated'
  | 'microsoft_subscription_lifecycle';

interface EmailSyncEventMessage {
  eventId: string;
  provider: EmailProvider;
  eventType: EmailSyncEventType;
  occurredAt: string;
  email?: string;
  connectionUuid?: string;
  providerCursor?: string;
  providerMessageId?: string;
  providerThreadId?: string | null;
  providerSubscriptionId?: string;
  rawProviderEvent?: unknown;
}
```

Published SQS message attributes:

- `provider`
- `eventType`
- `connectionUuid` when available

`EMAIL_SYNC_QUEUE_URL` is required to publish events. Missing queue configuration
causes webhook handling to fail with an internal error after logging.

## Configuration Contract

Parameter behavior:

- `EMAIL_SERVICE_API_KEY` is interpreted as an SSM parameter name containing the
  internal bearer token.
- `GMAIL_PUBSUB_TOPIC` can be a direct topic string or an SSM parameter name
  when the value starts with `/`.
- `MICROSOFT_GRAPH_CLIENT_STATE_SECRET` can be a direct secret or an SSM
  parameter name when the value starts with `/`.

SSM reads use `WithDecryption: true` and cache values for 10 minutes.

## Ownership Rules

- Do not persist provider messages in this service.
- Do not refresh, encrypt, or store OAuth tokens here.
- Do not use this service for transactional application email.
- Keep provider access tokens out of logs.
- Keep Project Management as the source of truth for connection UUIDs,
  provider cursors, subscription IDs, conversations, and message records.
