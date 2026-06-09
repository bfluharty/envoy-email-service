import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';

const DEFAULT_MAX = 50;

function listGmail(body) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: body.accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const maxResults = Math.min(body.maxResults ?? DEFAULT_MAX, 100);
  const q = ['in:inbox'];
  if (body.afterDate) {
    const ts = Math.floor(new Date(body.afterDate).getTime() / 1000);
    if (!Number.isNaN(ts)) q.push(`after:${ts}`);
  }
  return gmail.users.messages
    .list({ userId: 'me', maxResults, q: q.join(' ') })
    .then((list) => {
      const messages = list.data.messages || [];
      return Promise.all(
        messages.map((m) => {
          if (!m.id) return Promise.resolve(null);
          return gmail.users.messages.get({ userId: 'me', id: m.id }).then((full) => {
            const headers = full.data.payload?.headers || [];
            const getHeader = (name) =>
              headers.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
            return {
              id: m.id,
              threadId: m.threadId || '',
              from: getHeader('From'),
              to: getHeader('To'),
              subject: getHeader('Subject'),
              date: getHeader('Date'),
              snippet: full.data.snippet || undefined,
            };
          });
        })
      );
    })
    .then((items) => ({
      messages: items.filter((m) => m !== null),
    }));
}

function listMicrosoft(body) {
  const client = Client.init({
    authProvider: (done) => done(null, body.accessToken),
  });
  const top = Math.min(body.maxResults ?? DEFAULT_MAX, 100);
  let request = client
    .api('/me/mailFolders/inbox/messages')
    .top(top)
    .orderby('receivedDateTime desc')
    .select('id,from,toRecipients,subject,receivedDateTime,bodyPreview');
  if (body.afterDate) {
    request = request.filter(`receivedDateTime ge ${body.afterDate}`);
  }
  return request.get().then((res) => {
    const value = res.value || [];
    const messages = value.map((m) => ({
      id: m.id,
      threadId: m.id,
      from: m.from?.emailAddress?.address || '',
      to: (m.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(', '),
      subject: m.subject || '',
      date: m.receivedDateTime || '',
      snippet: m.bodyPreview,
    }));
    return { messages };
  });
}

export async function inboxList(body) {
  let result;
  if (body.provider === 'gmail') result = await listGmail(body);
  else if (body.provider === 'microsoft') result = await listMicrosoft(body);
  else throw new Error(`Unknown provider: ${body.provider}`);
  const count = Array.isArray(result?.messages) ? result.messages.length : 0;
  console.log(`inbox list: ${body.provider} returned ${count} messages`);
  return result;
}

function getGmail(body) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: body.accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  return gmail.users.messages
    .get({ userId: 'me', id: body.messageId })
    .then((res) => {
      const payload = res.data.payload;
      if (!payload) return { message: null };
      const headers = payload.headers || [];
      const getHeader = (name) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
      let bodyText = '';
      if (payload.body?.data) {
        bodyText = Buffer.from(payload.body.data, 'base64').toString('utf8');
      } else if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyText = Buffer.from(part.body.data, 'base64').toString('utf8');
            break;
          }
          if (part.mimeType === 'text/html' && part.body?.data && !bodyText) {
            bodyText = Buffer.from(part.body.data, 'base64').toString('utf8');
          }
        }
      }
      const dateHeader = getHeader('Date');
      let date = new Date().toISOString();
      if (dateHeader) {
        const parsed = new Date(dateHeader);
        if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString();
      }
      const messageIdHeader = getHeader('Message-ID');
      const referencesHeader = getHeader('References');
      return {
        message: {
          id: res.data.id,
          from: getHeader('From'),
          to: getHeader('To'),
          cc: getHeader('Cc') || undefined,
          subject: getHeader('Subject'),
          body: bodyText,
          date,
          messageId: messageIdHeader || undefined,
          references: referencesHeader || undefined,
        },
      };
    })
    .catch(() => ({ message: null }));
}

function getMicrosoft(body) {
  const client = Client.init({
    authProvider: (done) => done(null, body.accessToken),
  });
  return client
    .api(`/me/messages/${body.messageId}`)
    .select('id,from,toRecipients,ccRecipients,subject,body,receivedDateTime,internetMessageHeaders')
    .get()
    .then((m) => {
      const from = m.from?.emailAddress?.address || '';
      const toRecipients = m.toRecipients || [];
      const to = toRecipients.map((r) => r.emailAddress?.address).filter(Boolean).join(', ');
      const ccRecipients = m.ccRecipients || [];
      const cc =
        ccRecipients.map((r) => r.emailAddress?.address).filter(Boolean).join(', ') || undefined;
      const bodyContent = m.body?.content || '';
      const date = m.receivedDateTime
        ? new Date(m.receivedDateTime).toISOString()
        : new Date().toISOString();
      const headers = m.internetMessageHeaders || [];
      const getHeader = (name) =>
        headers.find((h) => (h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
      const messageIdHeader = getHeader('Message-ID');
      const referencesHeader = getHeader('References');
      return {
        message: {
          id: m.id,
          from,
          to,
          cc,
          subject: m.subject || '',
          body: bodyContent,
          date,
          messageId: messageIdHeader || undefined,
          references: referencesHeader || undefined,
        },
      };
    })
    .catch(() => ({ message: null }));
}

export async function inboxGetMessage(body) {
  if (body.provider === 'gmail') return getGmail(body);
  if (body.provider === 'microsoft') return getMicrosoft(body);
  throw new Error(`Unknown provider: ${body.provider}`);
}
