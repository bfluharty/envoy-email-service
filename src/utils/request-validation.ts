import {
  InboxChangesRequest,
  InboxGetMessageRequest,
  InboxListRequest,
  InboxMailbox,
  InboxSearchVendorMessagesRequest,
  SendOnBehalfRequest,
} from '../models/email.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

type RequestRecord = Record<string, unknown>;

function isRequestRecord(value: unknown): value is RequestRecord {
  return typeof value === 'object' && value !== null;
}

function isProvider(value: unknown): value is SendOnBehalfRequest['provider'] {
  return value === 'gmail' || value === 'microsoft';
}

function isMailbox(value: unknown): value is InboxMailbox {
  return value === 'inbox' || value === 'sent' || value === 'all';
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

export function parseBody(raw: string | null | undefined): unknown {
  if (!raw || raw === '') {
    throw new ValidationError('Missing request body');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('Invalid JSON body');
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
    throw new ValidationError('Missing or invalid: provider (gmail|microsoft), accessToken, to, subject, body');
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
    throw new ValidationError('Missing or invalid: provider (gmail|microsoft), accessToken');
  }

  if (typeof body.afterDate === 'string' && !isValidDate(body.afterDate)) {
    throw new ValidationError('Invalid afterDate: must be a valid ISO 8601 date string');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
    afterDate: typeof body.afterDate === 'string' ? body.afterDate : undefined,
    mailbox: isMailbox(body.mailbox) ? body.mailbox : undefined,
  };
}

export function validateInboxGetMessage(body: unknown): InboxGetMessageRequest {
  if (
    !isRequestRecord(body) ||
    !isProvider(body.provider) ||
    typeof body.accessToken !== 'string' ||
    typeof body.messageId !== 'string'
  ) {
    throw new ValidationError('Missing or invalid: provider (gmail|microsoft), accessToken, messageId');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    messageId: body.messageId,
  };
}

export function validateInboxSearchVendorMessages(body: unknown): InboxSearchVendorMessagesRequest {
  if (
    !isRequestRecord(body) ||
    !isProvider(body.provider) ||
    typeof body.accessToken !== 'string' ||
    !Array.isArray(body.vendorEmails) ||
    !body.vendorEmails.every((email) => typeof email === 'string')
  ) {
    throw new ValidationError('Missing or invalid: provider (gmail|microsoft), accessToken, vendorEmails');
  }

  if (typeof body.afterDate === 'string' && !isValidDate(body.afterDate)) {
    throw new ValidationError('Invalid afterDate: must be a valid ISO 8601 date string');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    vendorEmails: body.vendorEmails,
    maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
    afterDate: typeof body.afterDate === 'string' ? body.afterDate : undefined,
  };
}

export function validateInboxChanges(body: unknown): InboxChangesRequest {
  if (!isRequestRecord(body) || !isProvider(body.provider) || typeof body.accessToken !== 'string') {
    throw new ValidationError('Missing or invalid: provider (gmail|microsoft), accessToken');
  }

  return {
    provider: body.provider,
    accessToken: body.accessToken,
    cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
  };
}
