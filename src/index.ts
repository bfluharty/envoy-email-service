import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { inboxGetMessage, inboxList } from './services/inbox-service.js';
import { sendOnBehalf } from './services/send-on-behalf-service.js';
import {
  parseBody,
  validateInboxGetMessage,
  validateInboxList,
  validateSendOnBehalf,
} from './utils/request-validation.js';
import { getDecryptedParameter } from './utils/parameter-store.js';

const API_KEY_PARAMETER_NAME = process.env.EMAIL_SERVICE_API_KEY ?? '';

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

async function getConfiguredApiKey(): Promise<string | null> {
  if (!API_KEY_PARAMETER_NAME.trim()) {
    return null;
  }

  return getDecryptedParameter(API_KEY_PARAMETER_NAME);
}

async function checkAuth(event: APIGatewayProxyEventV2): Promise<void> {
  const apiKey = await getConfiguredApiKey();
  if (!apiKey) {
    return;
  }

  const auth = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== apiKey) {
    throw new UnauthorizedError();
  }
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function getRawBody(event: APIGatewayProxyEventV2): string | null {
  const rawBody = event.body ?? null;
  if (event.isBase64Encoded && rawBody) {
    return Buffer.from(rawBody, 'base64').toString('utf8');
  }

  return rawBody;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const path = event.requestContext?.http?.path ?? event.rawPath ?? '';
  const method = event.requestContext?.http?.method ?? '';

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    await checkAuth(event);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return jsonResponse(401, { error: err.message });
    }

    console.error('Failed to load email service API key from Parameter Store:', err);
    return jsonResponse(500, { error: 'Failed to load email service API key' });
  }

  const rawBody = getRawBody(event);

  try {
    if (path.endsWith('/send-on-behalf')) {
      const body = validateSendOnBehalf(parseBody(rawBody));
      const result = await sendOnBehalf(body);
      return jsonResponse(200, result);
    }

    if (path.endsWith('/inbox/list')) {
      const body = validateInboxList(parseBody(rawBody));
      const result = await inboxList(body);
      const count = result.messages.length;
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
