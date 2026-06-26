import { describe, it, expect } from 'vitest';
import {
  parseBody,
  validateInboxChanges,
  validateSendOnBehalf,
  validateInboxList,
  validateInboxGetMessage,
  validateInboxSearchVendorMessages,
} from '../src/utils/request-validation.js';

describe('parseBody', () => {
  it('throws on null', () => {
    expect(() => parseBody(null)).toThrow('Missing request body');
  });

  it('throws on empty string', () => {
    expect(() => parseBody('')).toThrow('Missing request body');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBody('{bad json')).toThrow('Invalid JSON body');
  });

  it('parses valid JSON', () => {
    expect(parseBody('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('validateSendOnBehalf', () => {
  const valid = {
    provider: 'gmail',
    accessToken: 'tok',
    to: 'a@b.com',
    subject: 'Hi',
    body: 'Hello',
  };

  it('accepts a valid gmail payload', () => {
    expect(validateSendOnBehalf(valid)).toMatchObject(valid);
  });

  it('accepts a valid microsoft payload', () => {
    const body = { ...valid, provider: 'microsoft' };
    expect(validateSendOnBehalf(body)).toMatchObject(body);
  });

  it('throws on missing provider', () => {
    expect(() => validateSendOnBehalf({ ...valid, provider: undefined })).toThrow('Missing or invalid');
  });

  it('throws on unknown provider', () => {
    expect(() => validateSendOnBehalf({ ...valid, provider: 'yahoo' })).toThrow('Missing or invalid');
  });

  it('throws on missing accessToken', () => {
    expect(() => validateSendOnBehalf({ ...valid, accessToken: undefined })).toThrow('Missing or invalid');
  });

  it('throws on missing to', () => {
    expect(() => validateSendOnBehalf({ ...valid, to: undefined })).toThrow('Missing or invalid');
  });

  it('throws on missing subject', () => {
    expect(() => validateSendOnBehalf({ ...valid, subject: undefined })).toThrow('Missing or invalid');
  });

  it('throws on missing body', () => {
    expect(() => validateSendOnBehalf({ ...valid, body: undefined })).toThrow('Missing or invalid');
  });

  it('includes optional reply fields when present', () => {
    const result = validateSendOnBehalf({
      ...valid,
      inReplyTo: '<abc@mail>',
      references: '<abc@mail>',
      threadId: 'thread123',
    });
    expect(result.inReplyTo).toBe('<abc@mail>');
    expect(result.references).toBe('<abc@mail>');
    expect(result.threadId).toBe('thread123');
  });

  it('omits optional fields when not present', () => {
    const result = validateSendOnBehalf(valid);
    expect(result.inReplyTo).toBeUndefined();
    expect(result.references).toBeUndefined();
    expect(result.threadId).toBeUndefined();
  });
});

describe('validateInboxList', () => {
  const valid = { provider: 'gmail', accessToken: 'tok' };

  it('accepts valid payload', () => {
    expect(validateInboxList(valid)).toMatchObject(valid);
  });

  it('accepts valid microsoft payload', () => {
    const body = { ...valid, provider: 'microsoft' };
    expect(validateInboxList(body)).toMatchObject(body);
  });

  it('throws on missing provider', () => {
    expect(() => validateInboxList({ accessToken: 'tok' })).toThrow('Missing or invalid');
  });

  it('throws on missing accessToken', () => {
    expect(() => validateInboxList({ provider: 'gmail' })).toThrow('Missing or invalid');
  });

  it('accepts valid afterDate', () => {
    const result = validateInboxList({ ...valid, afterDate: '2024-01-01T00:00:00Z' });
    expect(result.afterDate).toBe('2024-01-01T00:00:00Z');
  });

  it('throws on invalid afterDate', () => {
    expect(() => validateInboxList({ ...valid, afterDate: 'not-a-date' })).toThrow('Invalid afterDate');
  });

  it('ignores afterDate when not a string', () => {
    const result = validateInboxList({ ...valid, afterDate: 12345 });
    expect(result.afterDate).toBeUndefined();
  });

  it('accepts maxResults', () => {
    const result = validateInboxList({ ...valid, maxResults: 10 });
    expect(result.maxResults).toBe(10);
  });

  it('accepts mailbox', () => {
    const result = validateInboxList({ ...valid, mailbox: 'sent' });
    expect(result.mailbox).toBe('sent');
  });
});

describe('validateInboxGetMessage', () => {
  const valid = { provider: 'gmail', accessToken: 'tok', messageId: 'msg123' };

  it('accepts valid payload', () => {
    expect(validateInboxGetMessage(valid)).toMatchObject(valid);
  });

  it('accepts valid microsoft payload', () => {
    const body = { ...valid, provider: 'microsoft' };
    expect(validateInboxGetMessage(body)).toMatchObject(body);
  });

  it('throws on missing messageId', () => {
    expect(() => validateInboxGetMessage({ provider: 'gmail', accessToken: 'tok' })).toThrow('Missing or invalid');
  });

  it('throws on missing provider', () => {
    expect(() => validateInboxGetMessage({ accessToken: 'tok', messageId: 'msg123' })).toThrow('Missing or invalid');
  });
});

describe('validateInboxSearchVendorMessages', () => {
  const valid = { provider: 'microsoft', accessToken: 'tok', vendorEmails: ['vendor@example.com'] };

  it('accepts valid payload', () => {
    expect(validateInboxSearchVendorMessages(valid)).toMatchObject(valid);
  });

  it('accepts maxResults and afterDate', () => {
    const result = validateInboxSearchVendorMessages({
      ...valid,
      maxResults: 25,
      afterDate: '2024-01-01T00:00:00Z',
    });
    expect(result.maxResults).toBe(25);
    expect(result.afterDate).toBe('2024-01-01T00:00:00Z');
  });

  it('throws when vendorEmails is missing', () => {
    expect(() => validateInboxSearchVendorMessages({ provider: 'gmail', accessToken: 'tok' })).toThrow(
      'Missing or invalid'
    );
  });

  it('throws when vendorEmails contains non-strings', () => {
    expect(() =>
      validateInboxSearchVendorMessages({ provider: 'gmail', accessToken: 'tok', vendorEmails: [123] })
    ).toThrow('Missing or invalid');
  });
});

describe('validateInboxChanges', () => {
  const valid = { provider: 'gmail', accessToken: 'tok' };

  it('accepts valid payload with cursor and messageId', () => {
    const result = validateInboxChanges({ ...valid, cursor: 'cursor-1', messageId: 'message-1' });
    expect(result).toMatchObject({ ...valid, cursor: 'cursor-1', messageId: 'message-1' });
  });

  it('accepts microsoft payload', () => {
    const result = validateInboxChanges({ provider: 'microsoft', accessToken: 'tok', messageId: 'message-1' });
    expect(result.provider).toBe('microsoft');
  });

  it('throws on missing accessToken', () => {
    expect(() => validateInboxChanges({ provider: 'gmail' })).toThrow('Missing or invalid');
  });
});
