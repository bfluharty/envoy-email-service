import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { inboxGetMessage, inboxList } from './services/inbox-service.js';
import { sendOnBehalf } from './services/send-on-behalf-service.js';
import {
  parseBody,
  validateInboxGetMessage,
  validateInboxList,
  validateSendOnBehalf,
  ValidationError,
} from './utils/request-validation.js';
import { getDecryptedParameter } from './utils/parameter-store.js';
import { logger } from './utils/logger.js';

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

async function getConfiguredApiKey(): Promise<string | null> {
  const paramName = (process.env.EMAIL_SERVICE_API_KEY ?? '').trim();
  if (!paramName) {
    return null;
  }

  return getDecryptedParameter(paramName);
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

    logger.error('Failed to load email service API key from Parameter Store', { err, path });
    return jsonResponse(500, { error: 'Internal error' });
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
      logger.info('/inbox/list complete', { provider: body.provider, count: result.messages.length });
      return jsonResponse(200, result);
    }

    if (path.endsWith('/inbox/message')) {
      const body = validateInboxGetMessage(parseBody(rawBody));
      const result = await inboxGetMessage(body);
      return jsonResponse(200, result);
    }

    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(400, { error: err.message });
    }

    logger.error('Unhandled error in handler', { err, path });
    return jsonResponse(500, { error: 'Internal error' });
  }
}
