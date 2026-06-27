import { afterEach, describe, expect, it, vi } from 'vitest';
import { microsoftAdapter } from '../src/services/providers/microsoft-adapter.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('microsoftAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MICROSOFT_GRAPH_NOTIFICATION_URL;
    delete process.env.MICROSOFT_GRAPH_LIFECYCLE_URL;
    delete process.env.MICROSOFT_GRAPH_CLIENT_STATE_SECRET;
  });

  it('lists inbox messages through Graph and normalizes summaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        value: [
          {
            id: 'message-1',
            conversationId: 'conversation-1',
            from: { emailAddress: { name: 'Vendor', address: 'vendor@example.com' } },
            toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
            subject: 'Estimate',
            receivedDateTime: '2026-06-26T12:00:00Z',
            bodyPreview: 'Hello',
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.listMessages({
      provider: 'microsoft',
      accessToken: 'access-token',
      mailbox: 'inbox',
      maxResults: 10,
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain('/me/mailFolders/inbox/messages');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
    });
    expect(result.messages).toEqual([
      {
        id: 'message-1',
        threadId: 'conversation-1',
        from: 'Vendor <vendor@example.com>',
        to: 'customer@example.com',
        subject: 'Estimate',
        date: '2026-06-26T12:00:00.000Z',
        snippet: 'Hello',
      },
    ]);
  });

  it('gets a message and maps internet reply headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'message-1',
        conversationId: 'conversation-1',
        from: { emailAddress: { address: 'vendor@example.com' } },
        toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
        subject: 'Reply',
        receivedDateTime: '2026-06-26T12:00:00Z',
        body: { content: 'Message body' },
        internetMessageId: '<message-1@example.com>',
        internetMessageHeaders: [
          { name: 'In-Reply-To', value: '<previous@example.com>' },
          { name: 'References', value: '<root@example.com> <previous@example.com>' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.getMessage({
      provider: 'microsoft',
      accessToken: 'access-token',
      messageId: 'message-1',
    });

    expect(result.message).toMatchObject({
      id: 'message-1',
      threadId: 'conversation-1',
      body: 'Message body',
      messageId: '<message-1@example.com>',
      inReplyTo: '<previous@example.com>',
      references: '<root@example.com> <previous@example.com>',
    });
  });

  it('sends MIME mail through Graph sendMail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.sendMessage({
      provider: 'microsoft',
      accessToken: 'access-token',
      to: 'vendor@example.com',
      subject: 'Project',
      body: 'Can we talk?',
      inReplyTo: '<previous@example.com>',
      references: '<root@example.com>',
      threadId: 'conversation-1',
    });

    const request = fetchMock.mock.calls[0][1];
    const decodedBody = Buffer.from(String(request?.body), 'base64').toString('utf8');

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'Content-Type': 'text/plain',
    });
    expect(decodedBody).toContain('To: vendor@example.com');
    expect(decodedBody).toContain('In-Reply-To: <previous@example.com>');
    expect(result).toEqual({ messageId: null, threadId: 'conversation-1' });
  });

  it('creates Microsoft Graph mail subscriptions', async () => {
    process.env.MICROSOFT_GRAPH_NOTIFICATION_URL = 'https://example.com/webhooks/microsoft/graph';
    process.env.MICROSOFT_GRAPH_LIFECYCLE_URL = 'https://example.com/webhooks/microsoft/lifecycle';
    process.env.MICROSOFT_GRAPH_CLIENT_STATE_SECRET = 'test-secret';
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'subscription-1',
        expirationDateTime: '2026-06-28T12:00:00Z',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.setupWatch({
      provider: 'microsoft',
      accessToken: 'access-token',
      email: 'customer@example.com',
      connectionUuid: 'connection-uuid',
    });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(request?.body));

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://graph.microsoft.com/v1.0/subscriptions');
    expect(request?.method).toBe('POST');
    expect(body).toMatchObject({
      changeType: 'created',
      notificationUrl: 'https://example.com/webhooks/microsoft/graph',
      lifecycleNotificationUrl: 'https://example.com/webhooks/microsoft/lifecycle',
      resource: "me/mailFolders('Inbox')/messages",
    });
    expect(body.clientState.length).toBeLessThan(128);
    expect(result.providerSubscriptionId).toBe('subscription-1');
    expect(result.expiresAt).toBe('2026-06-28T12:00:00Z');
  });

  it('renews Microsoft Graph mail subscriptions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'subscription-1',
        expirationDateTime: '2026-06-28T12:00:00Z',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.renewWatch({
      provider: 'microsoft',
      accessToken: 'access-token',
      email: 'customer@example.com',
      connectionUuid: 'connection-uuid',
      providerSubscriptionId: 'subscription-1',
    });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(request?.body));

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://graph.microsoft.com/v1.0/subscriptions/subscription-1');
    expect(request?.method).toBe('PATCH');
    expect(body.expirationDateTime).toBeTruthy();
    expect(result.providerSubscriptionId).toBe('subscription-1');
  });

  it('stops Microsoft Graph mail subscriptions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await microsoftAdapter.stopWatch({
      provider: 'microsoft',
      accessToken: 'access-token',
      providerSubscriptionId: 'subscription-1',
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://graph.microsoft.com/v1.0/subscriptions/subscription-1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
