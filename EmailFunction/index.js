import { sendOnBehalf } from './sendOnBehalf.js';
import { inboxList, inboxGetMessage } from './inbox.js';

const API_KEY = process.env.EMAIL_SERVICE_API_KEY ?? '';

function parseBody(raw) {
  if (!raw || raw === '') {
    throw new Error('Missing request body');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function checkAuth(event) {
  if (!API_KEY || API_KEY === '') {
    return;
  }
  const auth = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_KEY) {
    throw new Error('Unauthorized');
  }
}

function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function validateSendOnBehalf(body) {
  const b = body;
  if (
    (b?.provider !== 'gmail' && b?.provider !== 'microsoft') ||
    typeof b?.accessToken !== 'string' ||
    typeof b?.to !== 'string' ||
    typeof b?.subject !== 'string' ||
    typeof b?.body !== 'string'
  ) {
    throw new Error('Missing or invalid: provider (gmail|microsoft), accessToken, to, subject, body');
  }
  return {
    provider: b.provider,
    accessToken: b.accessToken,
    to: b.to,
    subject: b.subject,
    body: b.body,
    inReplyTo: typeof b.inReplyTo === 'string' ? b.inReplyTo : undefined,
    references: typeof b.references === 'string' ? b.references : undefined,
    threadId: typeof b.threadId === 'string' ? b.threadId : undefined,
  };
}

function validateInboxList(body) {
  const b = body;
  if ((b?.provider !== 'gmail' && b?.provider !== 'microsoft') || typeof b?.accessToken !== 'string') {
    throw new Error('Missing or invalid: provider (gmail|microsoft), accessToken');
  }
  return {
    provider: b.provider,
    accessToken: b.accessToken,
    maxResults: typeof b.maxResults === 'number' ? b.maxResults : undefined,
    afterDate: typeof b.afterDate === 'string' ? b.afterDate : undefined,
  };
}

function validateInboxGetMessage(body) {
  const b = body;
  if (
    (b?.provider !== 'gmail' && b?.provider !== 'microsoft') ||
    typeof b?.accessToken !== 'string' ||
    typeof b?.messageId !== 'string'
  ) {
    throw new Error('Missing or invalid: provider (gmail|microsoft), accessToken, messageId');
  }
  return {
    provider: b.provider,
    accessToken: b.accessToken,
    messageId: b.messageId,
  };
}

export async function handler(event) {
  const path = event.requestContext?.http?.path ?? event.rawPath ?? '';
  const method = event.requestContext?.http?.method ?? '';

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    checkAuth(event);
  } catch (err) {
    return jsonResponse(401, { error: err instanceof Error ? err.message : 'Unauthorized' });
  }

  let rawBody = event.body ?? null;
  if (event.isBase64Encoded && rawBody) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  try {
    if (path.endsWith('/send-on-behalf')) {
      const body = validateSendOnBehalf(parseBody(rawBody));
      const result = await sendOnBehalf(body);
      return jsonResponse(200, result);
    }
    if (path.endsWith('/inbox/list')) {
      const body = validateInboxList(parseBody(rawBody));
      const result = await inboxList(body);
      const count = Array.isArray(result?.messages) ? result.messages.length : 0;
      console.log(`/inbox/list returning ${count} messages (provider: ${body.provider})`);
      return jsonResponse(200, result);
    }
    if (path.endsWith('/inbox/message')) {
      const body = validateInboxGetMessage(parseBody(rawBody));
      const result = await inboxGetMessage(body);
      return jsonResponse(200, result);
    }
    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message === 'Unauthorized' ? 401 : message === 'Not Found' ? 404 : 500;
    return jsonResponse(status, { error: message });
  }
}
