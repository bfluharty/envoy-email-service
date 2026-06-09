import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';

export async function sendViaGmail(body) {
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

export async function sendViaMicrosoft(body) {
  const client = Client.init({
    authProvider: (done) => {
      done(null, body.accessToken);
    },
  });
  const message = {
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
  const headers = [];
  if (body.inReplyTo) headers.push({ name: 'In-Reply-To', value: body.inReplyTo });
  if (body.references) headers.push({ name: 'References', value: body.references });
  if (headers.length > 0) message.internetMessageHeaders = headers;
  await client.api('/me/sendMail').post({ message });
  return { messageId: '' };
}

export async function sendOnBehalf(body) {
  console.log('sendOnBehalf: provider=%s to=%s subject=%s', body.provider, body.to, body.subject);
  if (body.provider === 'gmail') {
    return sendViaGmail(body);
  }
  if (body.provider === 'microsoft') {
    return sendViaMicrosoft(body);
  }
  throw new Error(`Unknown provider: ${body.provider}`);
}
