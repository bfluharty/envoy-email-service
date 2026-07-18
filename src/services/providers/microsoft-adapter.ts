import {
  InboxChangesRequest,
  InboxGetMessageRequest,
  InboxGetMessageResponse,
  InboxListRequest,
  InboxListResponse,
  InboxMessage,
  InboxMessageSummary,
  InboxSearchVendorMessagesRequest,
  SendOnBehalfRequest,
  SendOnBehalfResponse,
  RenewWatchRequest,
  StopWatchRequest,
  WatchResult,
  WatchSetupRequest,
} from '../../models/email.js';
import { EmailProviderAdapter } from '../email-provider-adapter.js';
import { logger } from '../../utils/logger.js';
import { createMicrosoftClientState } from '../../utils/microsoft-client-state.js';
import { extractLatestEmailBody } from '../../utils/email-body.js';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const DEFAULT_MAX = 50;
const MICROSOFT_VENDOR_SEARCH_FETCH_MULTIPLIER = 5;
const MICROSOFT_SUBSCRIPTION_TTL_MS = 2 * 24 * 60 * 60 * 1000;

interface GraphRecipient {
  emailAddress?: {
    name?: string;
    address?: string;
  };
}

interface GraphInternetMessageHeader {
  name?: string;
  value?: string;
}

interface GraphMessage {
  id?: string;
  conversationId?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  createdDateTime?: string;
  bodyPreview?: string;
  body?: {
    contentType?: string;
    content?: string;
  };
  internetMessageId?: string;
  internetMessageHeaders?: GraphInternetMessageHeader[];
}

interface GraphListResponse {
  value?: GraphMessage[];
}

interface GraphSubscription {
  id?: string;
  expirationDateTime?: string;
  clientState?: string;
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function recipientToString(recipient: GraphRecipient | undefined): string {
  const address = recipient?.emailAddress?.address ?? '';
  const name = recipient?.emailAddress?.name ?? '';
  return name && address ? `${name} <${address}>` : address;
}

function recipientsToString(recipients: GraphRecipient[] | undefined): string {
  return recipients?.map(recipientToString).filter(Boolean).join(', ') ?? '';
}

function recipientAddress(recipient: GraphRecipient | undefined): string {
  return recipient?.emailAddress?.address?.trim().toLowerCase() ?? '';
}

function graphDate(message: GraphMessage): string {
  const value = message.receivedDateTime ?? message.sentDateTime ?? message.createdDateTime;
  if (!value) return new Date().toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function getGraphHeader(headers: GraphInternetMessageHeader[] | undefined, name: string): string {
  return headers?.find((header) => (header.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
}

function toSummary(message: GraphMessage): InboxMessageSummary {
  return {
    id: message.id ?? '',
    threadId: message.conversationId ?? null,
    from: recipientToString(message.from),
    to: recipientsToString(message.toRecipients),
    subject: message.subject ?? '',
    date: graphDate(message),
    snippet: message.bodyPreview || undefined,
  };
}

function toInboxMessage(message: GraphMessage): InboxMessage {
  const headers = message.internetMessageHeaders;
  const inReplyTo = getGraphHeader(headers, 'In-Reply-To');
  const references = getGraphHeader(headers, 'References');

  return {
    id: message.id ?? '',
    from: recipientToString(message.from),
    to: recipientsToString(message.toRecipients),
    cc: recipientsToString(message.ccRecipients) || undefined,
    subject: message.subject ?? '',
    body: extractLatestEmailBody(message.body?.content ?? ''),
    date: graphDate(message),
    messageId: message.internetMessageId || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
    threadId: message.conversationId ?? null,
  };
}

function mailboxPath(mailbox: InboxListRequest['mailbox']): string {
  if (mailbox === 'sent') return '/me/mailFolders/sentitems/messages';
  if (mailbox === 'all') return '/me/messages';
  return '/me/mailFolders/inbox/messages';
}

function mailboxDateField(mailbox: InboxListRequest['mailbox']): 'receivedDateTime' | 'sentDateTime' {
  return mailbox === 'sent' ? 'sentDateTime' : 'receivedDateTime';
}

function buildGraphUrl(path: string, params?: URLSearchParams): string {
  const query = params?.toString();
  return `${GRAPH_ROOT}${path}${query ? `?${query}` : ''}`;
}

async function graphRequest<T>(
  accessToken: string,
  path: string,
  input: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    params?: URLSearchParams;
  } = {}
): Promise<T> {
  const res = await fetch(buildGraphUrl(path, input.params), {
    method: input.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...input.headers,
    },
    body: input.body,
  });

  if (res.status === 202 || res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const body = await res.text();
    logger.error('Microsoft Graph request failed', { status: res.status, path, body });
    throw new Error(`Microsoft Graph request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

function maxResults(value: number | undefined): number {
  return Math.min(value ?? DEFAULT_MAX, 100);
}

function vendorSearchFetchSize(value: number | undefined): number {
  return Math.min(maxResults(value) * MICROSOFT_VENDOR_SEARCH_FETCH_MULTIPLIER, 1000);
}

function graphListParams(input: InboxListRequest): URLSearchParams {
  const dateField = mailboxDateField(input.mailbox);
  const params = new URLSearchParams({
    $top: String(maxResults(input.maxResults)),
    $select:
      'id,conversationId,from,toRecipients,subject,receivedDateTime,sentDateTime,createdDateTime,bodyPreview,internetMessageId',
    $orderby: `${dateField} desc`,
  });

  if (input.afterDate) {
    params.set('$filter', `${dateField} ge ${new Date(input.afterDate).toISOString()}`);
  }

  return params;
}

async function listMicrosoftMessages(input: InboxListRequest): Promise<InboxListResponse> {
  const result = await graphRequest<GraphListResponse>(input.accessToken, mailboxPath(input.mailbox), {
    params: graphListParams(input),
  });

  return { messages: (result.value ?? []).map(toSummary).filter((message) => message.id) };
}

function normalizeVendorEmails(vendorEmails: string[]): string[] {
  return Array.from(new Set(vendorEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)));
}

function escapeMicrosoftSearchClauseValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function vendorSearchQuery(vendorEmails: string[]): string {
  return vendorEmails.map((email) => `"participants:${escapeMicrosoftSearchClauseValue(email)}"`).join(' OR ');
}

function recipientListMatchesVendor(recipients: GraphRecipient[] | undefined, vendorEmails: Set<string>): boolean {
  return recipients?.some((recipient) => vendorEmails.has(recipientAddress(recipient))) ?? false;
}

function messageMatchesVendor(message: GraphMessage, vendorEmails: Set<string>): boolean {
  return (
    vendorEmails.has(recipientAddress(message.from)) ||
    recipientListMatchesVendor(message.toRecipients, vendorEmails) ||
    recipientListMatchesVendor(message.ccRecipients, vendorEmails)
  );
}

function messageMatchesAfterDate(message: GraphMessage, afterDate: string | undefined): boolean {
  if (!afterDate) return true;

  const after = new Date(afterDate).getTime();
  if (Number.isNaN(after)) return true;

  const value = message.receivedDateTime ?? message.sentDateTime ?? message.createdDateTime;
  if (!value) return false;

  const messageDate = new Date(value).getTime();
  return !Number.isNaN(messageDate) && messageDate >= after;
}

async function searchMicrosoftVendorMessages(input: InboxSearchVendorMessagesRequest): Promise<InboxListResponse> {
  const vendorEmails = normalizeVendorEmails(input.vendorEmails);
  if (vendorEmails.length === 0) {
    return { messages: [] };
  }

  const params = new URLSearchParams({
    $top: String(vendorSearchFetchSize(input.maxResults)),
    $search: vendorSearchQuery(vendorEmails),
    $select:
      'id,conversationId,from,toRecipients,ccRecipients,subject,receivedDateTime,sentDateTime,createdDateTime,bodyPreview,internetMessageId',
  });

  const result = await graphRequest<GraphListResponse>(input.accessToken, '/me/messages', { params });
  const vendorEmailSet = new Set(vendorEmails);
  return {
    messages: (result.value ?? [])
      .filter((message) => messageMatchesVendor(message, vendorEmailSet))
      .filter((message) => messageMatchesAfterDate(message, input.afterDate))
      .map(toSummary)
      .filter((message) => message.id)
      .slice(0, maxResults(input.maxResults)),
  };
}

async function getMicrosoftGraphMessage(accessToken: string, messageId: string): Promise<GraphMessage | null> {
  try {
    return await graphRequest<GraphMessage>(accessToken, `/me/messages/${encodeURIComponent(messageId)}`, {
      params: new URLSearchParams({
        $select:
          'id,conversationId,from,toRecipients,ccRecipients,subject,receivedDateTime,sentDateTime,createdDateTime,body,bodyPreview,internetMessageId,internetMessageHeaders',
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.message.endsWith(': 404')) {
      return null;
    }

    throw err;
  }
}

function parseRecipients(to: string): GraphRecipient[] {
  return to
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function buildMimeMessage(input: SendOnBehalfRequest): string {
  const lines = [
    `To: ${headerValue(input.to)}`,
    `Subject: ${headerValue(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];

  if (input.inReplyTo) {
    lines.push(`In-Reply-To: ${headerValue(input.inReplyTo)}`);
  }

  if (input.references) {
    lines.push(`References: ${headerValue(input.references)}`);
  }

  lines.push('', input.body);
  return lines.join('\r\n');
}

async function sendMicrosoftMessage(input: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  const mime = buildMimeMessage(input);

  if (parseRecipients(input.to).length === 0) {
    throw new Error('At least one recipient is required');
  }

  await graphRequest<void>(input.accessToken, '/me/sendMail', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: Buffer.from(mime, 'utf8').toString('base64'),
  });

  logger.info('microsoft send complete', { provider: 'microsoft', to: input.to });
  return { messageId: null, threadId: input.threadId ?? null };
}

function microsoftSubscriptionExpiration(): string {
  return new Date(Date.now() + MICROSOFT_SUBSCRIPTION_TTL_MS).toISOString();
}

function requireMicrosoftNotificationUrl(input: WatchSetupRequest): string {
  const url = (input.callbackUrl ?? process.env.MICROSOFT_GRAPH_NOTIFICATION_URL ?? '').trim();
  if (!url) {
    throw new Error('MICROSOFT_GRAPH_NOTIFICATION_URL is not set');
  }

  return url;
}

async function setupMicrosoftWatch(input: WatchSetupRequest): Promise<WatchResult> {
  const notificationUrl = requireMicrosoftNotificationUrl(input);
  const lifecycleNotificationUrl = (process.env.MICROSOFT_GRAPH_LIFECYCLE_URL ?? '').trim() || undefined;
  const clientState = await createMicrosoftClientState(input.connectionUuid);
  const expirationDateTime = microsoftSubscriptionExpiration();

  const subscription = await graphRequest<GraphSubscription>(input.accessToken, '/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      lifecycleNotificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime,
      clientState,
    }),
  });

  if (!subscription.id) {
    throw new Error('Microsoft Graph subscription response did not include an id');
  }

  logger.info('microsoft watch setup complete', {
    provider: 'microsoft',
    email: input.email,
    connectionUuid: input.connectionUuid,
    providerSubscriptionId: subscription.id,
  });

  return {
    provider: 'microsoft',
    providerSubscriptionId: subscription.id,
    subscriptionClientState: subscription.clientState ?? clientState,
    expiresAt: subscription.expirationDateTime ?? expirationDateTime,
  };
}

async function renewMicrosoftWatch(input: RenewWatchRequest): Promise<WatchResult> {
  if (!input.providerSubscriptionId) {
    throw new Error('providerSubscriptionId is required to renew a Microsoft watch');
  }

  const expirationDateTime = microsoftSubscriptionExpiration();
  const subscription = await graphRequest<GraphSubscription>(
    input.accessToken,
    `/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expirationDateTime }),
    }
  );

  logger.info('microsoft watch renewed', {
    provider: 'microsoft',
    providerSubscriptionId: input.providerSubscriptionId,
  });

  return {
    provider: 'microsoft',
    providerSubscriptionId: subscription.id ?? input.providerSubscriptionId,
    subscriptionClientState: subscription.clientState,
    expiresAt: subscription.expirationDateTime ?? expirationDateTime,
  };
}

async function stopMicrosoftWatch(input: StopWatchRequest): Promise<void> {
  if (!input.providerSubscriptionId) {
    return;
  }

  await graphRequest<void>(input.accessToken, `/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`, {
    method: 'DELETE',
  });
  logger.info('microsoft watch stopped', {
    provider: 'microsoft',
    providerSubscriptionId: input.providerSubscriptionId,
  });
}

export const microsoftAdapter: EmailProviderAdapter = {
  provider: 'microsoft',

  listMessages(input: InboxListRequest) {
    return listMicrosoftMessages(input);
  },

  searchVendorMessages(input: InboxSearchVendorMessagesRequest) {
    return searchMicrosoftVendorMessages(input);
  },

  async listChangedMessages(input: InboxChangesRequest) {
    if (input.messageId) {
      const message = await getMicrosoftGraphMessage(input.accessToken, input.messageId);
      return { messages: message ? [toSummary(message)] : [] };
    }

    return listMicrosoftMessages({ ...input, mailbox: 'all' });
  },

  async getMessage(input: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
    const message = await getMicrosoftGraphMessage(input.accessToken, input.messageId);
    return { message: message ? toInboxMessage(message) : null };
  },

  sendMessage(input: SendOnBehalfRequest) {
    return sendMicrosoftMessage(input);
  },

  setupWatch(input: WatchSetupRequest): Promise<WatchResult> {
    return setupMicrosoftWatch(input);
  },

  renewWatch(input: RenewWatchRequest): Promise<WatchResult> {
    return renewMicrosoftWatch(input);
  },

  stopWatch(input: StopWatchRequest): Promise<void> {
    return stopMicrosoftWatch(input);
  },
};
