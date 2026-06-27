import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { inboxChanges, inboxGetMessage, inboxList, inboxSearchVendorMessages } from './services/inbox-service.js';
import { sendOnBehalf } from './services/send-on-behalf-service.js';
import { renewWatch, setupWatch, stopWatch } from './services/watch-service.js';
import {
  handleGmailPubSubWebhook,
  handleMicrosoftGraphWebhook,
  handleMicrosoftLifecycleWebhook,
} from './services/webhook-service.js';
import {
  parseBody,
  validateInboxChanges,
  validateInboxGetMessage,
  validateInboxList,
  validateInboxSearchVendorMessages,
  validateSendOnBehalf,
  validateWatchRenew,
  validateWatchSetup,
  validateWatchStop,
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

function textResponse(statusCode: number, body: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain' },
    body,
  };
}

function getRawBody(event: APIGatewayProxyEventV2): string | null {
  const rawBody = event.body ?? null;
  if (event.isBase64Encoded && rawBody) {
    return Buffer.from(rawBody, 'base64').toString('utf8');
  }

  return rawBody;
}

function providerAuthFailureStatus(err: unknown): 401 | 403 | null {
  const status =
    (err as { code?: number; status?: number })?.code ?? (err as { code?: number; status?: number })?.status;
  if (status === 401 || status === 403) {
    return status;
  }

  const message = err instanceof Error ? err.message : '';
  if (message.endsWith(': 401')) return 401;
  if (message.endsWith(': 403')) return 403;

  return null;
}

function getQueryParam(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const direct = event.queryStringParameters?.[name];
  if (direct) {
    return direct;
  }

  if (!event.rawQueryString) {
    return undefined;
  }

  return new URLSearchParams(event.rawQueryString).get(name) ?? undefined;
}

async function handlePublicWebhook(
  path: string,
  work: () => Promise<unknown>
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    return jsonResponse(202, await work());
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(400, { error: err.message });
    }

    logger.error('Unhandled error in public webhook handler', { err, path });
    return jsonResponse(500, { error: 'Internal error' });
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const path = event.requestContext?.http?.path ?? event.rawPath ?? '';
  const method = event.requestContext?.http?.method ?? '';
  const rawBody = getRawBody(event);

  if (method === 'GET' && path.endsWith('/health')) {
    return jsonResponse(200, { status: 'ok' });
  }

  if (path.endsWith('/webhooks/microsoft/graph') || path.endsWith('/webhooks/microsoft/lifecycle')) {
    const validationToken = getQueryParam(event, 'validationToken');
    if (validationToken) {
      return textResponse(200, validationToken);
    }
  }

  if (path.endsWith('/webhooks/gmail/pubsub')) {
    if (method !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    return handlePublicWebhook(path, () => handleGmailPubSubWebhook(parseBody(rawBody)));
  }

  if (path.endsWith('/webhooks/microsoft/graph')) {
    if (method !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    return handlePublicWebhook(path, () => handleMicrosoftGraphWebhook(parseBody(rawBody)));
  }

  if (path.endsWith('/webhooks/microsoft/lifecycle')) {
    if (method !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    return handlePublicWebhook(path, () => handleMicrosoftLifecycleWebhook(parseBody(rawBody)));
  }

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

    if (path.endsWith('/inbox/search-vendor-messages')) {
      const body = validateInboxSearchVendorMessages(parseBody(rawBody));
      const result = await inboxSearchVendorMessages(body);
      logger.info('/inbox/search-vendor-messages complete', {
        provider: body.provider,
        count: result.messages.length,
      });
      return jsonResponse(200, result);
    }

    if (path.endsWith('/inbox/changes')) {
      const body = validateInboxChanges(parseBody(rawBody));
      const result = await inboxChanges(body);
      logger.info('/inbox/changes complete', { provider: body.provider, count: result.messages.length });
      return jsonResponse(200, result);
    }

    if (path.endsWith('/watches/setup')) {
      const body = validateWatchSetup(parseBody(rawBody));
      const result = await setupWatch(body);
      return jsonResponse(200, result);
    }

    if (path.endsWith('/watches/renew')) {
      const body = validateWatchRenew(parseBody(rawBody));
      const result = await renewWatch(body);
      return jsonResponse(200, result);
    }

    if (path.endsWith('/watches/stop')) {
      const body = validateWatchStop(parseBody(rawBody));
      await stopWatch(body);
      return jsonResponse(200, { stopped: true });
    }

    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(400, { error: err.message });
    }

    const authStatus = providerAuthFailureStatus(err);
    if (authStatus) {
      return jsonResponse(authStatus, { error: 'Provider authorization failed' });
    }

    logger.error('Unhandled error in handler', { err, path });
    return jsonResponse(500, { error: 'Internal error' });
  }
}
