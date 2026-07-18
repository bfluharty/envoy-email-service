import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const gmailClient = {
    users: {
      messages: {
        get: vi.fn(),
        list: vi.fn(),
        send: vi.fn(),
      },
      history: {
        list: vi.fn(),
      },
      watch: vi.fn(),
      stop: vi.fn(),
    },
  };
  const setCredentials = vi.fn();

  return {
    gmailClient,
    gmailFactory: vi.fn(() => gmailClient),
    oauth2Factory: vi.fn(function OAuth2(this: { setCredentials: typeof setCredentials }) {
      this.setCredentials = setCredentials;
    }),
    setCredentials,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: mocks.oauth2Factory,
    },
    gmail: mocks.gmailFactory,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: mocks.logger,
}));

import { gmailAdapter } from '../src/services/providers/gmail-adapter.js';

function gmailNotFoundError(): Error & { code: number } {
  return Object.assign(new Error('Requested entity was not found.'), { code: 404 });
}

describe('gmailAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips changed messages that Gmail no longer returns', async () => {
    mocks.gmailClient.users.history.list.mockResolvedValueOnce({
      data: {
        history: [
          {
            messagesAdded: [{ message: { id: 'missing-message' } }, { message: { id: 'message-1' } }],
          },
        ],
      },
    });
    mocks.gmailClient.users.messages.get.mockImplementation(({ id }: { id: string }) => {
      if (id === 'missing-message') {
        return Promise.reject(gmailNotFoundError());
      }

      return Promise.resolve({
        data: {
          threadId: 'thread-1',
          snippet: 'Hello',
          payload: {
            headers: [
              { name: 'From', value: 'vendor@example.com' },
              { name: 'To', value: 'customer@example.com' },
              { name: 'Subject', value: 'Estimate' },
              { name: 'Date', value: 'Fri, 26 Jun 2026 12:00:00 +0000' },
            ],
          },
        },
      });
    });

    const result = await gmailAdapter.listChangedMessages({
      provider: 'gmail',
      accessToken: 'access-token',
      cursor: '100',
    });

    expect(result.messages).toEqual([
      {
        id: 'message-1',
        threadId: 'thread-1',
        from: 'vendor@example.com',
        to: 'customer@example.com',
        subject: 'Estimate',
        date: 'Fri, 26 Jun 2026 12:00:00 +0000',
        snippet: 'Hello',
      },
    ]);
    expect(mocks.gmailClient.users.messages.get).toHaveBeenCalledTimes(2);
    expect(mocks.logger.warn).toHaveBeenCalledWith('gmail message not found while summarizing', {
      provider: 'gmail',
      messageId: 'missing-message',
    });
  });

  it('still throws non-404 Gmail summary failures', async () => {
    mocks.gmailClient.users.messages.get.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 429 }));

    await expect(
      gmailAdapter.listChangedMessages({
        provider: 'gmail',
        accessToken: 'access-token',
        messageId: 'message-1',
      })
    ).rejects.toThrow('quota');
  });
});
