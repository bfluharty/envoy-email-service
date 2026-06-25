import { Client, AuthProvider } from '@microsoft/microsoft-graph-client';
import { gmail_v1, google } from 'googleapis';
import {
  InboxGetMessageRequest,
  InboxGetMessageResponse,
  InboxListRequest,
  InboxListResponse,
  InboxMessageSummary,
} from '../models/email.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX = 50;

interface MicrosoftEmailAddress {
  address?: string;
}

interface MicrosoftRecipient {
  emailAddress?: MicrosoftEmailAddress;
}

interface MicrosoftMessageHeader {
  name?: string;
  value?: string;
}

interface MicrosoftMessage {
  id?: string;
  from?: {
    emailAddress?: MicrosoftEmailAddress;
  };
  toRecipients?: MicrosoftRecipient[];
  ccRecipients?: MicrosoftRecipient[];
  subject?: string;
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: {
    content?: string;
  };
  internetMessageHeaders?: MicrosoftMessageHeader[];
}

interface MicrosoftListResponse {
  value?: MicrosoftMessage[];
}

function createMicrosoftClient(accessToken: string) {
  const authProvider: AuthProvider = (done) => done(null, accessToken);
  return Client.init({ authProvider });
}

function getGmailHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((header) => (header.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
}

function getMicrosoftHeader(headers: MicrosoftMessageHeader[] | undefined, name: string): string {
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

async function listGmail(body: InboxListRequest): Promise<InboxListResponse> {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: body.accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const maxResults = Math.min(body.maxResults ?? DEFAULT_MAX, 100);
  const q = ['in:inbox'];

  if (body.afterDate) {
    const ts = Math.floor(new Date(body.afterDate).getTime() / 1000);
    if (!Number.isNaN(ts)) q.push(`after:${ts}`);
  }

  const list = await gmail.users.messages.list({ userId: 'me', maxResults, q: q.join(' ') });
  const messages = list.data.messages ?? [];

  // Fetch metadata only (no body) concurrently — avoids downloading full message payloads
  const items = await Promise.all(
    messages.map(async (message): Promise<InboxMessageSummary | null> => {
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
        threadId: message.threadId ?? '',
        from: getGmailHeader(headers, 'From'),
        to: getGmailHeader(headers, 'To'),
        subject: getGmailHeader(headers, 'Subject'),
        date: getGmailHeader(headers, 'Date'),
        snippet: meta.data.snippet || undefined,
      };
    })
  );

  return {
    messages: items.filter((message): message is InboxMessageSummary => message !== null),
  };
}

async function listMicrosoft(body: InboxListRequest): Promise<InboxListResponse> {
  const client = createMicrosoftClient(body.accessToken);
  const top = Math.min(body.maxResults ?? DEFAULT_MAX, 100);
  let request = client
    .api('/me/mailFolders/inbox/messages')
    .top(top)
    .orderby('receivedDateTime desc')
    .select('id,from,toRecipients,subject,receivedDateTime,bodyPreview');

  if (body.afterDate) {
    request = request.filter(`receivedDateTime ge ${body.afterDate}`);
  }

  const res = (await request.get()) as MicrosoftListResponse;
  const value = res.value ?? [];
  const messages = value.map((message) => ({
    id: message.id ?? '',
    threadId: message.id ?? '',
    from: message.from?.emailAddress?.address ?? '',
    to: (message.toRecipients ?? [])
      .map((recipient) => recipient.emailAddress?.address)
      .filter(Boolean)
      .join(', '),
    subject: message.subject ?? '',
    date: message.receivedDateTime ?? '',
    snippet: message.bodyPreview,
  }));

  return { messages };
}

export async function inboxList(body: InboxListRequest): Promise<InboxListResponse> {
  let result: InboxListResponse;

  if (body.provider === 'gmail') {
    result = await listGmail(body);
  } else if (body.provider === 'microsoft') {
    result = await listMicrosoft(body);
  } else {
    throw new Error(`Unknown provider: ${body.provider}`);
  }

  logger.info('inbox list complete', { provider: body.provider, count: result.messages.length });
  return result;
}

async function getGmail(body: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: body.accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const res = await gmail.users.messages.get({ userId: 'me', id: body.messageId });
  const payload = res.data.payload;
  if (!payload) return { message: null };

  const headers = payload.headers;
  const dateHeader = getGmailHeader(headers, 'Date');
  const messageIdHeader = getGmailHeader(headers, 'Message-ID');
  const referencesHeader = getGmailHeader(headers, 'References');

  return {
    message: {
      id: res.data.id ?? '',
      from: getGmailHeader(headers, 'From'),
      to: getGmailHeader(headers, 'To'),
      cc: getGmailHeader(headers, 'Cc') || undefined,
      subject: getGmailHeader(headers, 'Subject'),
      body: getGmailBodyText(payload),
      date: dateHeader ? toIsoDateOrNow(dateHeader) : new Date().toISOString(),
      messageId: messageIdHeader || undefined,
      references: referencesHeader || undefined,
    },
  };
}

async function getMicrosoft(body: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
  const client = createMicrosoftClient(body.accessToken);

  const message = (await client
    .api(`/me/messages/${body.messageId}`)
    .select('id,from,toRecipients,ccRecipients,subject,body,receivedDateTime,internetMessageHeaders')
    .get()) as MicrosoftMessage;

  const from = message.from?.emailAddress?.address ?? '';
  const to = (message.toRecipients ?? [])
    .map((recipient) => recipient.emailAddress?.address)
    .filter(Boolean)
    .join(', ');
  const cc =
    (message.ccRecipients ?? [])
      .map((recipient) => recipient.emailAddress?.address)
      .filter(Boolean)
      .join(', ') || undefined;
  const messageIdHeader = getMicrosoftHeader(message.internetMessageHeaders, 'Message-ID');
  const referencesHeader = getMicrosoftHeader(message.internetMessageHeaders, 'References');

  return {
    message: {
      id: message.id ?? '',
      from,
      to,
      cc,
      subject: message.subject ?? '',
      body: message.body?.content ?? '',
      date: message.receivedDateTime ? toIsoDateOrNow(message.receivedDateTime) : new Date().toISOString(),
      messageId: messageIdHeader || undefined,
      references: referencesHeader || undefined,
    },
  };
}

export async function inboxGetMessage(body: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
  if (body.provider === 'gmail') {
    try {
      return await getGmail(body);
    } catch (err) {
      const status =
        (err as { code?: number; status?: number })?.code ?? (err as { code?: number; status?: number })?.status;
      if (status === 404) return { message: null };
      logger.error('gmail getMessage failed', { provider: 'gmail', messageId: body.messageId, err });
      throw err;
    }
  }

  if (body.provider === 'microsoft') {
    try {
      return await getMicrosoft(body);
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) return { message: null };
      logger.error('microsoft getMessage failed', { provider: 'microsoft', messageId: body.messageId, err });
      throw err;
    }
  }

  throw new Error(`Unknown provider: ${body.provider}`);
}
