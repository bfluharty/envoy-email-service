import { SendMessageCommand, SQSClient, type SendMessageCommandInput } from '@aws-sdk/client-sqs';
import { EmailSyncEventMessage } from '../models/email.js';

const sqs = new SQSClient({});

type MessageAttributes = NonNullable<SendMessageCommandInput['MessageAttributes']>;

function requireQueueUrl(): string {
  const queueUrl = (process.env.EMAIL_SYNC_QUEUE_URL ?? '').trim();
  if (!queueUrl) {
    throw new Error('EMAIL_SYNC_QUEUE_URL is not set');
  }

  return queueUrl;
}

export async function publishEmailSyncEvent(message: EmailSyncEventMessage): Promise<void> {
  const queueUrl = requireQueueUrl();
  const messageAttributes: MessageAttributes = {
    provider: {
      DataType: 'String',
      StringValue: message.provider,
    },
    eventType: {
      DataType: 'String',
      StringValue: message.eventType,
    },
  };

  if (message.connectionUuid) {
    messageAttributes.connectionUuid = {
      DataType: 'String',
      StringValue: message.connectionUuid,
    };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: messageAttributes,
    })
  );
}
