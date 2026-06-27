import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// Mock services and parameter store before importing handler
vi.mock('../src/services/inbox-service.js', () => ({
  inboxList: vi.fn().mockResolvedValue({ messages: [] }),
  inboxGetMessage: vi.fn().mockResolvedValue({ message: null }),
  inboxSearchVendorMessages: vi.fn().mockResolvedValue({ messages: [] }),
  inboxChanges: vi.fn().mockResolvedValue({ messages: [] }),
}));

vi.mock('../src/services/send-on-behalf-service.js', () => ({
  sendOnBehalf: vi.fn().mockResolvedValue({ messageId: 'sent-id' }),
}));

vi.mock('../src/services/watch-service.js', () => ({
  setupWatch: vi.fn().mockResolvedValue({ provider: 'gmail', providerCursor: 'history-1' }),
  renewWatch: vi.fn().mockResolvedValue({ provider: 'gmail', providerCursor: 'history-2' }),
  stopWatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/webhook-service.js', () => ({
  handleGmailPubSubWebhook: vi.fn().mockResolvedValue({ queued: 1 }),
  handleMicrosoftGraphWebhook: vi.fn().mockResolvedValue({ queued: 1 }),
  handleMicrosoftLifecycleWebhook: vi.fn().mockResolvedValue({ queued: 1 }),
}));

vi.mock('../src/utils/parameter-store.js', () => ({
  getDecryptedParameter: vi.fn().mockResolvedValue('test-api-key'),
}));

import { handler } from '../src/index.js';
import { inboxChanges, inboxGetMessage, inboxList, inboxSearchVendorMessages } from '../src/services/inbox-service.js';
import { sendOnBehalf } from '../src/services/send-on-behalf-service.js';
import { renewWatch, setupWatch, stopWatch } from '../src/services/watch-service.js';
import { handleGmailPubSubWebhook, handleMicrosoftGraphWebhook } from '../src/services/webhook-service.js';

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'abc',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method: 'POST', path: '/', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

function makeBody(obj: unknown): string {
  return JSON.stringify(obj);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no API key env var means auth is bypassed.
  delete process.env.EMAIL_SERVICE_API_KEY;
});

describe('handler - method guard', () => {
  it('returns 200 for GET /health without auth', async () => {
    process.env.EMAIL_SERVICE_API_KEY = '/some/param';
    const event = makeEvent({
      rawPath: '/health',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'GET', path: '/health', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '{}')).toEqual({ status: 'ok' });
  });

  it('returns 405 for GET', async () => {
    const event = makeEvent({
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'GET', path: '/', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(405);
  });
});

describe('handler - auth', () => {
  beforeEach(() => {
    process.env.EMAIL_SERVICE_API_KEY = '/some/param';
  });

  it('returns 401 when Bearer token is wrong', async () => {
    const event = makeEvent({
      headers: { authorization: 'Bearer wrong-key' },
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok', to: 'a@b.com', subject: 'Hi', body: 'Hi' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 when Bearer token matches', async () => {
    const event = makeEvent({
      headers: { authorization: 'Bearer test-api-key' },
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok', to: 'a@b.com', subject: 'Hi', body: 'Hi' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when no Authorization header', async () => {
    const event = makeEvent({
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok', to: 'a@b.com', subject: 'Hi', body: 'Hi' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });
});

describe('handler - routing', () => {
  it('routes POST /send-on-behalf to sendOnBehalf', async () => {
    const event = makeEvent({
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok', to: 'a@b.com', subject: 'Hi', body: 'Hi' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(sendOnBehalf).toHaveBeenCalledOnce();
    expect(JSON.parse(res.body ?? '{}')).toEqual({ messageId: 'sent-id' });
  });

  it('routes POST /inbox/list to inboxList', async () => {
    const event = makeEvent({
      rawPath: '/inbox/list',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/inbox/list', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(inboxList).toHaveBeenCalledOnce();
    expect(JSON.parse(res.body ?? '{}')).toEqual({ messages: [] });
  });

  it('routes POST /inbox/message to inboxGetMessage', async () => {
    const event = makeEvent({
      rawPath: '/inbox/message',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/inbox/message', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok', messageId: 'msg1' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(inboxGetMessage).toHaveBeenCalledOnce();
  });

  it('routes POST /inbox/search-vendor-messages to inboxSearchVendorMessages', async () => {
    const event = makeEvent({
      rawPath: '/inbox/search-vendor-messages',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/inbox/search-vendor-messages',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({ provider: 'microsoft', accessToken: 'tok', vendorEmails: ['vendor@example.com'] }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(inboxSearchVendorMessages).toHaveBeenCalledOnce();
  });

  it('routes POST /inbox/changes to inboxChanges', async () => {
    const event = makeEvent({
      rawPath: '/inbox/changes',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/inbox/changes',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({ provider: 'microsoft', accessToken: 'tok', messageId: 'msg1' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(inboxChanges).toHaveBeenCalledOnce();
  });

  it('routes POST /watches/setup to setupWatch', async () => {
    const event = makeEvent({
      rawPath: '/watches/setup',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/watches/setup',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({
        provider: 'gmail',
        accessToken: 'tok',
        email: 'customer@example.com',
        connectionUuid: 'connection-1',
      }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(setupWatch).toHaveBeenCalledOnce();
  });

  it('routes POST /watches/renew to renewWatch', async () => {
    const event = makeEvent({
      rawPath: '/watches/renew',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/watches/renew',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({
        provider: 'microsoft',
        accessToken: 'tok',
        email: 'customer@example.com',
        connectionUuid: 'connection-1',
        providerSubscriptionId: 'sub-1',
      }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(renewWatch).toHaveBeenCalledOnce();
  });

  it('routes POST /watches/stop to stopWatch', async () => {
    const event = makeEvent({
      rawPath: '/watches/stop',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/watches/stop',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({ provider: 'microsoft', accessToken: 'tok', providerSubscriptionId: 'sub-1' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(stopWatch).toHaveBeenCalledOnce();
    expect(JSON.parse(res.body ?? '{}')).toEqual({ stopped: true });
  });

  it('answers Microsoft validationToken challenges without internal API auth', async () => {
    process.env.EMAIL_SERVICE_API_KEY = '/some/param';
    const event = makeEvent({
      rawPath: '/webhooks/microsoft/graph',
      rawQueryString: 'validationToken=challenge-token',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/webhooks/microsoft/graph',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/plain');
    expect(res.body).toBe('challenge-token');
  });

  it('routes Gmail Pub/Sub webhooks without internal API auth', async () => {
    process.env.EMAIL_SERVICE_API_KEY = '/some/param';
    const event = makeEvent({
      rawPath: '/webhooks/gmail/pubsub',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/webhooks/gmail/pubsub',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({ message: { data: 'abc' } }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(202);
    expect(handleGmailPubSubWebhook).toHaveBeenCalledOnce();
  });

  it('routes Microsoft Graph webhooks without internal API auth', async () => {
    process.env.EMAIL_SERVICE_API_KEY = '/some/param';
    const event = makeEvent({
      rawPath: '/webhooks/microsoft/graph',
      requestContext: {
        ...makeEvent().requestContext,
        http: {
          method: 'POST',
          path: '/webhooks/microsoft/graph',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test',
        },
      },
      body: makeBody({ value: [] }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(202);
    expect(handleMicrosoftGraphWebhook).toHaveBeenCalledOnce();
  });

  it('returns 404 for unknown path', async () => {
    const event = makeEvent({
      rawPath: '/unknown',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/unknown', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({}),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for missing request body', async () => {
    const event = makeEvent({
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = makeEvent({
      rawPath: '/inbox/list',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/inbox/list', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: '{bad json',
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for validation failure', async () => {
    const event = makeEvent({
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail' }), // missing required fields
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 without leaking error details on unexpected failure', async () => {
    vi.mocked(sendOnBehalf).mockRejectedValueOnce(new Error('Gmail quota exceeded: user rate limit'));
    const event = makeEvent({
      rawPath: '/send-on-behalf',
      requestContext: {
        ...makeEvent().requestContext,
        http: { method: 'POST', path: '/send-on-behalf', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
      },
      body: makeBody({ provider: 'gmail', accessToken: 'tok', to: 'a@b.com', subject: 'Hi', body: 'Hi' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body ?? '{}')).toEqual({ error: 'Internal error' });
  });
});
