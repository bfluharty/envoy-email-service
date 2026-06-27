import { randomUUID } from 'node:crypto';
import { EmailSyncEventMessage } from '../models/email.js';
import { ValidationError } from '../utils/request-validation.js';
import { verifyMicrosoftClientState } from '../utils/microsoft-client-state.js';
import { logger } from '../utils/logger.js';
import { publishEmailSyncEvent } from './email-sync-event-publisher.js';

interface PubSubPushEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
    publish_time?: string;
  };
}

interface GmailPubSubPayload {
  emailAddress?: string;
  historyId?: string | number;
}

interface MicrosoftGraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  resourceData?: {
    id?: string;
    conversationId?: string;
  };
}

interface MicrosoftGraphWebhookBody {
  value?: MicrosoftGraphNotification[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function decodePubSubData(data: string | undefined): GmailPubSubPayload {
  if (!data) {
    throw new ValidationError('Missing Pub/Sub message data');
  }

  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as GmailPubSubPayload;
  } catch {
    throw new ValidationError('Invalid Pub/Sub message data');
  }
}

export async function handleGmailPubSubWebhook(body: unknown): Promise<{ queued: number }> {
  const envelope = body as PubSubPushEnvelope;
  const payload = decodePubSubData(envelope.message?.data);
  const email = payload.emailAddress;
  const providerCursor = payload.historyId ? String(payload.historyId) : undefined;

  if (!email || !providerCursor) {
    throw new ValidationError('Missing Gmail emailAddress or historyId');
  }

  logger.info('gmail pubsub webhook received', {
    email,
    providerCursor,
    messageId: envelope.message?.messageId ?? envelope.message?.message_id,
  });

  const event: EmailSyncEventMessage = {
    eventId: envelope.message?.messageId ?? envelope.message?.message_id ?? randomUUID(),
    provider: 'gmail',
    eventType: 'gmail_history',
    email,
    providerCursor,
    occurredAt: envelope.message?.publishTime ?? envelope.message?.publish_time ?? new Date().toISOString(),
    rawProviderEvent: payload,
  };

  await publishEmailSyncEvent(event);
  return { queued: 1 };
}

function microsoftEventType(changeType: string | undefined): EmailSyncEventMessage['eventType'] {
  return changeType === 'updated' ? 'microsoft_message_updated' : 'microsoft_message_created';
}

async function publishMicrosoftNotification(notification: MicrosoftGraphNotification): Promise<void> {
  if (!notification.clientState) {
    throw new ValidationError('Missing Microsoft clientState');
  }

  const payload = await verifyMicrosoftClientState(notification.clientState);
  if (!payload) {
    throw new ValidationError('Invalid Microsoft clientState');
  }

  const event: EmailSyncEventMessage = {
    eventId: randomUUID(),
    provider: 'microsoft',
    eventType: microsoftEventType(notification.changeType),
    connectionUuid: payload.connectionUuid,
    providerSubscriptionId: notification.subscriptionId,
    providerMessageId: notification.resourceData?.id,
    providerThreadId: notification.resourceData?.conversationId ?? null,
    occurredAt: new Date().toISOString(),
    rawProviderEvent: notification,
  };

  await publishEmailSyncEvent(event);
}

export async function handleMicrosoftGraphWebhook(body: unknown): Promise<{ queued: number }> {
  const notifications = ((body as MicrosoftGraphWebhookBody).value ?? []).filter(
    (notification): notification is MicrosoftGraphNotification => Boolean(notification)
  );

  logger.info('microsoft graph webhook received', {
    notificationCount: notifications.length,
    subscriptionIds: notifications.map((notification) => notification.subscriptionId).filter(Boolean),
  });

  for (const notification of notifications) {
    await publishMicrosoftNotification(notification);
  }

  return { queued: notifications.length };
}

export async function handleMicrosoftLifecycleWebhook(body: unknown): Promise<{ queued: number }> {
  const notifications = ((body as MicrosoftGraphWebhookBody).value ?? []).filter(
    (notification): notification is MicrosoftGraphNotification => Boolean(notification)
  );

  logger.info('microsoft lifecycle webhook received', {
    notificationCount: notifications.length,
    subscriptionIds: notifications.map((notification) => notification.subscriptionId).filter(Boolean),
  });

  for (const notification of notifications) {
    const payload = await verifyMicrosoftClientState(notification.clientState ?? '');
    if (!payload) {
      throw new ValidationError('Invalid Microsoft clientState');
    }

    await publishEmailSyncEvent({
      eventId: randomUUID(),
      provider: 'microsoft',
      eventType: 'microsoft_subscription_lifecycle',
      connectionUuid: payload.connectionUuid,
      providerSubscriptionId: notification.subscriptionId,
      occurredAt: new Date().toISOString(),
      rawProviderEvent: asRecord(notification),
    });
  }

  return { queued: notifications.length };
}
