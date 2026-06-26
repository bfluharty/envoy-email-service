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
});
