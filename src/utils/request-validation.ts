import { InboxGetMessageRequest, InboxListRequest, SendOnBehalfRequest } from '../models/email.js';

type RequestRecord = Record<string, unknown>;

function isRequestRecord(value: unknown): value is RequestRecord {
  return typeof value === 'object' && value !== null;
}

function isProvider(value: unknown): value is SendOnBehalfRequest['provider'] {
  return value === 'gmail' || value === 'microsoft';
}

export function parseBody(raw: string | null | undefined): unknown {
  if (!raw || raw === '') {
    throw new Error('Missing request body');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export function validateSendOnBehalf(body: unknown): SendOnBehalfRequest {
  if (
    !isRequestRecord(body) ||
    !isProvider(body.provider) ||
    typeof body.accessToken !== 'string' ||
    typeof body.to !== 'string' ||
    typeof body.subject !== 'string' ||
    typeof body.body !== 'string'
  ) {
    throw new Error('Missing or invalid: provider (gmail|microsoft), accessToken, to, subject, body');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    to: body.to,
    subject: body.subject,
    body: body.body,
    inReplyTo: typeof body.inReplyTo === 'string' ? body.inReplyTo : undefined,
    references: typeof body.references === 'string' ? body.references : undefined,
    threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
  };
}

export function validateInboxList(body: unknown): InboxListRequest {
  if (!isRequestRecord(body) || !isProvider(body.provider) || typeof body.accessToken !== 'string') {
    throw new Error('Missing or invalid: provider (gmail|microsoft), accessToken');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
    afterDate: typeof body.afterDate === 'string' ? body.afterDate : undefined,
  };
}

export function validateInboxGetMessage(body: unknown): InboxGetMessageRequest {
  if (
    !isRequestRecord(body) ||
    !isProvider(body.provider) ||
    typeof body.accessToken !== 'string' ||
    typeof body.messageId !== 'string'
  ) {
    throw new Error('Missing or invalid: provider (gmail|microsoft), accessToken, messageId');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    messageId: body.messageId,
  };
}
