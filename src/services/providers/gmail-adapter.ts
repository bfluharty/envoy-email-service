import { gmail_v1, google } from 'googleapis';
import {
  InboxChangesRequest,
  InboxGetMessageRequest,
  InboxGetMessageResponse,
  InboxListRequest,
  InboxListResponse,
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
import { getConfiguredParameterValue } from '../../utils/configured-parameter.js';
import { extractLatestEmailBody } from '../../utils/email-body.js';

const DEFAULT_MAX = 50;

function getGmailHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((header) => (header.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeGmailBody(data: string): string {
  return Buffer.from(data, 'base64').toString('utf8');
}

function getGmailBodyText(payload: gmail_v1.Schema$MessagePart): string {
  if (payload.body?.data) {
    return decodeGmailBody(payload.body.data);
  }

  if (!payload.parts) {
    return '';
  }

  let htmlBody = '';
  for (const part of payload.parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeGmailBody(part.body.data);
    }

    if (part.mimeType === 'text/html' && part.body?.data && !htmlBody) {
      htmlBody = decodeGmailBody(part.body.data);
    }
  }

  return htmlBody;
}

function toIsoDateOrNow(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function gmailClient(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function getGmailPubSubTopic(): Promise<string> {
  return getConfiguredParameterValue('GMAIL_PUBSUB_TOPIC');
}

function gmailExpirationToIso(expiration: string | number | null | undefined): string | undefined {
  if (!expiration) return undefined;

  const value = Number(expiration);
  if (!Number.isFinite(value)) return undefined;

  return new Date(value).toISOString();
}

function mailboxQuery(mailbox: InboxListRequest['mailbox']): string[] {
  if (mailbox === 'sent') return ['in:sent'];
  if (mailbox === 'all') return [];
  return ['in:inbox'];
}

function appendAfterDateQuery(q: string[], afterDate: string | undefined): void {
  if (!afterDate) return;

  const ts = Math.floor(new Date(afterDate).getTime() / 1000);
  if (!Number.isNaN(ts)) q.push(`after:${ts}`);
}

async function getMessageSummary(
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message
): Promise<InboxMessageSummary | null> {
  if (!message.id) return null;

  const meta = await gmail.users.messages.get({
    userId: 'me',
    id: message.id,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Date'],
  });
  const headers = meta.data.payload?.headers;

  return {
    id: message.id,
    threadId: message.threadId ?? meta.data.threadId ?? null,
    from: getGmailHeader(headers, 'From'),
    to: getGmailHeader(headers, 'To'),
    subject: getGmailHeader(headers, 'Subject'),
    date: getGmailHeader(headers, 'Date'),
    snippet: meta.data.snippet || undefined,
  };
}

async function listGmailMessages(input: InboxListRequest, extraQuery: string[] = []): Promise<InboxListResponse> {
  const gmail = gmailClient(input.accessToken);
  const maxResults = Math.min(input.maxResults ?? DEFAULT_MAX, 100);
  const q = [...mailboxQuery(input.mailbox), ...extraQuery];

  appendAfterDateQuery(q, input.afterDate);

  const list = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: q.join(' ') || undefined,
  });
  const messages = list.data.messages ?? [];

  const items = await Promise.all(messages.map((message) => getMessageSummary(gmail, message)));

  return {
    messages: items.filter((message): message is InboxMessageSummary => message !== null),
  };
}

async function getGmailMessage(input: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
  const gmail = gmailClient(input.accessToken);

  const res = await gmail.users.messages.get({ userId: 'me', id: input.messageId });
  const payload = res.data.payload;
  if (!payload) return { message: null };

  const headers = payload.headers;
  const dateHeader = getGmailHeader(headers, 'Date');
  const messageIdHeader = getGmailHeader(headers, 'Message-ID');
  const inReplyToHeader = getGmailHeader(headers, 'In-Reply-To');
  const referencesHeader = getGmailHeader(headers, 'References');

  return {
    message: {
      id: res.data.id ?? '',
      from: getGmailHeader(headers, 'From'),
      to: getGmailHeader(headers, 'To'),
      cc: getGmailHeader(headers, 'Cc') || undefined,
      subject: getGmailHeader(headers, 'Subject'),
      body: extractLatestEmailBody(getGmailBodyText(payload)),
      date: dateHeader ? toIsoDateOrNow(dateHeader) : new Date().toISOString(),
      messageId: messageIdHeader || undefined,
      inReplyTo: inReplyToHeader || undefined,
      references: referencesHeader || undefined,
      threadId: res.data.threadId ?? null,
    },
  };
}

async function sendGmailMessage(input: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  const gmail = gmailClient(input.accessToken);
  const lines = [
    `To: ${headerValue(input.to)}`,
    `Subject: ${headerValue(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    input.body,
  ];

  if (input.inReplyTo) {
    lines.splice(2, 0, `In-Reply-To: ${headerValue(input.inReplyTo)}`);
  }

  if (input.references) {
    lines.splice(2, 0, `References: ${headerValue(input.references)}`);
  }

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
  const requestBody = input.threadId ? { raw, threadId: input.threadId } : { raw };
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  const messageId = res.data.id ?? '';
  logger.info('gmail send complete', { provider: 'gmail', to: input.to, messageId });
  return { messageId, threadId: res.data.threadId ?? input.threadId ?? null };
}

async function setupGmailWatch(input: WatchSetupRequest): Promise<WatchResult> {
  const gmail = gmailClient(input.accessToken);
  const topicName = await getGmailPubSubTopic();
  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
    },
  });

  logger.info('gmail watch setup complete', {
    provider: 'gmail',
    email: input.email,
    connectionUuid: input.connectionUuid,
    historyId: res.data.historyId,
  });

  return {
    provider: 'gmail',
    providerCursor: res.data.historyId ?? undefined,
    expiresAt: gmailExpirationToIso(res.data.expiration),
  };
}

async function stopGmailWatch(input: StopWatchRequest): Promise<void> {
  const gmail = gmailClient(input.accessToken);
  await gmail.users.stop({ userId: 'me' });
  logger.info('gmail watch stopped', { provider: 'gmail' });
}

export const gmailAdapter: EmailProviderAdapter = {
  provider: 'gmail',

  listMessages(input: InboxListRequest) {
    return listGmailMessages(input);
  },

  searchVendorMessages(input: InboxSearchVendorMessagesRequest) {
    const vendorQueries = input.vendorEmails.flatMap((email) => [`from:${email}`, `to:${email}`]);
    const query = vendorQueries.length > 0 ? [`(${vendorQueries.join(' OR ')})`] : [];
    return listGmailMessages({ ...input, mailbox: 'all' }, query);
  },

  async listChangedMessages(input: InboxChangesRequest) {
    const gmail = gmailClient(input.accessToken);

    if (input.messageId) {
      const summary = await getMessageSummary(gmail, { id: input.messageId });
      return { messages: summary ? [summary] : [] };
    }

    if (input.cursor) {
      const history = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: input.cursor,
        historyTypes: ['messageAdded'],
      });
      const seenIds = new Set<string>();
      const messages =
        history.data.history?.flatMap((item) => item.messagesAdded?.map((added) => added.message) ?? []) ?? [];
      const uniqueMessages = messages.filter((message): message is gmail_v1.Schema$Message => {
        if (!message?.id || seenIds.has(message.id)) return false;
        seenIds.add(message.id);
        return true;
      });
      const summaries = await Promise.all(uniqueMessages.map((message) => getMessageSummary(gmail, message)));
      return { messages: summaries.filter((summary): summary is InboxMessageSummary => summary !== null) };
    }

    return listGmailMessages({ ...input, mailbox: 'all' });
  },

  async getMessage(input: InboxGetMessageRequest) {
    try {
      return await getGmailMessage(input);
    } catch (err) {
      const status =
        (err as { code?: number; status?: number })?.code ?? (err as { code?: number; status?: number })?.status;
      if (status === 404) return { message: null };
      logger.error('gmail getMessage failed', { provider: 'gmail', messageId: input.messageId, err });
      throw err;
    }
  },

  sendMessage(input: SendOnBehalfRequest) {
    return sendGmailMessage(input);
  },

  setupWatch(input: WatchSetupRequest): Promise<WatchResult> {
    return setupGmailWatch(input);
  },

  renewWatch(input: RenewWatchRequest): Promise<WatchResult> {
    return setupGmailWatch(input);
  },

  stopWatch(input: StopWatchRequest): Promise<void> {
    return stopGmailWatch(input);
  },
};
