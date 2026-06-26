import { google } from 'googleapis';
import { SendOnBehalfRequest, SendOnBehalfResponse } from '../models/email.js';
import { logger } from '../utils/logger.js';
import { UnsupportedProviderOperationError } from './email-provider-adapter.js';

export async function sendViaGmail(body: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: body.accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const lines = [
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body.body,
  ];

  if (body.inReplyTo) {
    lines.splice(2, 0, `In-Reply-To: ${body.inReplyTo}`);
  }

  if (body.references) {
    lines.splice(2, 0, `References: ${body.references}`);
  }

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
  const requestBody = body.threadId ? { raw, threadId: body.threadId } : { raw };
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  const messageId = res.data.id ?? '';
  logger.info('gmail send complete', { provider: 'gmail', to: body.to, messageId });
  return { messageId };
}

export async function sendOnBehalf(body: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  logger.info('sendOnBehalf start', { provider: body.provider, to: body.to, subject: body.subject });
  if (body.provider !== 'gmail') {
    throw new UnsupportedProviderOperationError(body.provider, 'sendMessage');
  }
  return sendViaGmail(body);
}
