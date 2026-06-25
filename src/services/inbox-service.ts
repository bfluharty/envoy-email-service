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

  // Fetch metadata only (no body) concurrently to avoid downloading full message payloads.
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

export async function inboxList(body: InboxListRequest): Promise<InboxListResponse> {
  const result = await listGmail(body);
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

export async function inboxGetMessage(body: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
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
