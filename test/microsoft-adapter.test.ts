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

  it('searches vendor messages with Microsoft search instead of unsupported recipient filters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'message-1',
              conversationId: 'conversation-1',
              from: { emailAddress: { name: 'Vendor', address: 'Vendor@Example.com' } },
              toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
              ccRecipients: [],
              subject: 'Estimate',
              receivedDateTime: '2026-06-26T12:00:00Z',
              bodyPreview: 'Hello',
            },
            {
              id: 'message-2',
              conversationId: 'conversation-2',
              from: { emailAddress: { address: 'customer@example.com' } },
              toRecipients: [{ emailAddress: { address: 'vendor@example.com' } }],
              ccRecipients: [],
              subject: 'Reply',
              receivedDateTime: '2026-06-25T12:00:00Z',
            },
            {
              id: 'message-3',
              conversationId: 'conversation-3',
              from: { emailAddress: { address: 'someone@example.com' } },
              toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
              ccRecipients: [],
              subject: 'Search false positive',
              receivedDateTime: '2026-06-26T12:00:00Z',
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.searchVendorMessages({
      provider: 'microsoft',
      accessToken: 'access-token',
      vendorEmails: ['vendor@example.com'],
      maxResults: 10,
      afterDate: '2026-06-26T00:00:00Z',
    });

    const searchUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const recentUrl = new URL(String(fetchMock.mock.calls[1][0]));

    expect(searchUrl.pathname).toBe('/v1.0/me/messages');
    expect(searchUrl.searchParams.get('$search')).toBe('"participants:vendor@example.com"');
    expect(searchUrl.searchParams.get('$filter')).toBeNull();
    expect(searchUrl.searchParams.get('$orderby')).toBeNull();
    expect(searchUrl.searchParams.get('$top')).toBe('50');
    expect(searchUrl.searchParams.get('$select')).toContain('ccRecipients');
    expect(recentUrl.pathname).toBe('/v1.0/me/messages');
    expect(recentUrl.searchParams.get('$search')).toBeNull();
    expect(recentUrl.searchParams.get('$filter')).toBe('receivedDateTime ge 2026-06-26T00:00:00.000Z');
    expect(recentUrl.searchParams.get('$orderby')).toBe('receivedDateTime desc');
    expect(result.messages).toEqual([
      {
        id: 'message-1',
        threadId: 'conversation-1',
        from: 'Vendor <Vendor@Example.com>',
        to: 'customer@example.com',
        subject: 'Estimate',
        date: '2026-06-26T12:00:00.000Z',
        snippet: 'Hello',
      },
    ]);
  });

  it('falls back to recent Microsoft messages when vendor search misses a new reply', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'message-1',
              conversationId: 'conversation-1',
              from: { emailAddress: { name: 'Vendor', address: 'vendor@example.com' } },
              toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
              ccRecipients: [],
              subject: 'Reply',
              receivedDateTime: '2026-06-26T12:00:00Z',
              bodyPreview: 'Hello',
            },
          ],
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.searchVendorMessages({
      provider: 'microsoft',
      accessToken: 'access-token',
      vendorEmails: ['vendor@example.com'],
      maxResults: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.messages).toEqual([
      {
        id: 'message-1',
        threadId: 'conversation-1',
        from: 'Vendor <vendor@example.com>',
        to: 'customer@example.com',
        subject: 'Reply',
        date: '2026-06-26T12:00:00.000Z',
        snippet: 'Hello',
      },
    ]);
  });

  it('falls back to recent Microsoft messages when Graph vendor search returns 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'ErrorInvalidUrlQueryFilter',
              message: 'The query filter contains one or more invalid nodes.',
            },
          },
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'message-1',
              conversationId: 'conversation-1',
              from: { emailAddress: { address: 'customer@example.com' } },
              toRecipients: [{ emailAddress: { address: 'vendor@example.com' } }],
              ccRecipients: [],
              subject: 'Outbound',
              sentDateTime: '2026-06-26T12:00:00Z',
            },
          ],
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.searchVendorMessages({
      provider: 'microsoft',
      accessToken: 'access-token',
      vendorEmails: ['vendor@example.com'],
      maxResults: 10,
    });

    expect(result.messages).toEqual([
      {
        id: 'message-1',
        threadId: 'conversation-1',
        from: 'customer@example.com',
        to: 'vendor@example.com',
        subject: 'Outbound',
        date: '2026-06-26T12:00:00.000Z',
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

  it('strips quoted HTML history from message bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'message-1',
        conversationId: 'conversation-1',
        from: { emailAddress: { address: 'vendor@example.com' } },
        toRecipients: [{ emailAddress: { address: 'customer@example.com' } }],
        subject: 'Reply',
        receivedDateTime: '2026-06-26T12:00:00Z',
        body: {
          content:
            '<html><body><div>thanks for your message</div><br><div class="gmail_quote">On Sat, Jun 27, 2026 at 3:22 PM Customer wrote:<blockquote>test</blockquote></div></body></html>',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await microsoftAdapter.getMessage({
      provider: 'microsoft',
      accessToken: 'access-token',
      messageId: 'message-1',
    });

    expect(result.message?.body).toBe('thanks for your message');
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
