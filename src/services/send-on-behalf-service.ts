import { Client, AuthProvider } from '@microsoft/microsoft-graph-client';
import { google } from 'googleapis';
import { SendOnBehalfRequest, SendOnBehalfResponse } from '../models/email.js';

function createMicrosoftClient(accessToken: string) {
  const authProvider: AuthProvider = (done) => {
    done(null, accessToken);
  };

  return Client.init({ authProvider });
}

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

  return { messageId: res.data.id ?? '' };
}

export async function sendViaMicrosoft(body: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  const client = createMicrosoftClient(body.accessToken);
  const message: {
    subject: string;
    body: { contentType: 'Text'; content: string };
    toRecipients: Array<{ emailAddress: { address: string } }>;
    internetMessageHeaders?: Array<{ name: string; value: string }>;
  } = {
    subject: body.subject,
    body: {
      contentType: 'Text',
      content: body.body,
    },
    toRecipients: [
      {
        emailAddress: {
          address: body.to,
        },
      },
    ],
  };

  const headers: Array<{ name: string; value: string }> = [];
  if (body.inReplyTo) headers.push({ name: 'In-Reply-To', value: body.inReplyTo });
  if (body.references) headers.push({ name: 'References', value: body.references });
  if (headers.length > 0) message.internetMessageHeaders = headers;

  await client.api('/me/sendMail').post({ message });
  return { messageId: '' };
}

export async function sendOnBehalf(body: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  console.log('sendOnBehalf: provider=%s to=%s subject=%s', body.provider, body.to, body.subject);

  if (body.provider === 'gmail') {
    return sendViaGmail(body);
  }

  if (body.provider === 'microsoft') {
    return sendViaMicrosoft(body);
  }

  throw new Error(`Unknown provider: ${body.provider}`);
}
