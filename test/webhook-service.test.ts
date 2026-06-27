import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/email-sync-event-publisher.js', () => ({
  publishEmailSyncEvent: vi.fn().mockResolvedValue(undefined),
}));

import { publishEmailSyncEvent } from '../src/services/email-sync-event-publisher.js';
import { handleGmailPubSubWebhook, handleMicrosoftGraphWebhook } from '../src/services/webhook-service.js';
import { createMicrosoftClientState } from '../src/utils/microsoft-client-state.js';

describe('webhook-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MICROSOFT_GRAPH_CLIENT_STATE_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.MICROSOFT_GRAPH_CLIENT_STATE_SECRET;
  });

  it('publishes normalized Gmail history events from Pub/Sub envelopes', async () => {
    const data = Buffer.from(
      JSON.stringify({ emailAddress: 'customer@example.com', historyId: 'history-1' }),
      'utf8'
    ).toString('base64');

    const result = await handleGmailPubSubWebhook({
      message: {
        data,
        messageId: 'pubsub-message-1',
        publishTime: '2026-06-26T12:00:00Z',
      },
    });

    expect(result).toEqual({ queued: 1 });
    expect(publishEmailSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'pubsub-message-1',
        provider: 'gmail',
        eventType: 'gmail_history',
        email: 'customer@example.com',
        providerCursor: 'history-1',
      })
    );
  });

  it('publishes normalized Microsoft message events from Graph notifications', async () => {
    const clientState = await createMicrosoftClientState('connection-uuid', 123);

    const result = await handleMicrosoftGraphWebhook({
      value: [
        {
          subscriptionId: 'subscription-1',
          clientState,
          changeType: 'created',
          resourceData: { id: 'message-1' },
        },
      ],
    });

    expect(result).toEqual({ queued: 1 });
    expect(publishEmailSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'microsoft',
        eventType: 'microsoft_message_created',
        connectionUuid: 'connection-uuid',
        providerSubscriptionId: 'subscription-1',
        providerMessageId: 'message-1',
      })
    );
  });
});
