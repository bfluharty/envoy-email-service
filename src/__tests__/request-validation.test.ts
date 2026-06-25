import { describe, it, expect } from 'vitest';
import {
  parseBody,
  validateSendOnBehalf,
  validateInboxList,
  validateInboxGetMessage,
} from '../utils/request-validation.js';

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
    expect(validateSendOnBehalf({ ...valid, provider: 'microsoft' })).toMatchObject({ provider: 'microsoft' });
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
});

describe('validateInboxGetMessage', () => {
  const valid = { provider: 'microsoft', accessToken: 'tok', messageId: 'msg123' };

  it('accepts valid payload', () => {
    expect(validateInboxGetMessage(valid)).toMatchObject(valid);
  });

  it('throws on missing messageId', () => {
    expect(() => validateInboxGetMessage({ provider: 'gmail', accessToken: 'tok' })).toThrow('Missing or invalid');
  });

  it('throws on missing provider', () => {
    expect(() => validateInboxGetMessage({ accessToken: 'tok', messageId: 'msg123' })).toThrow('Missing or invalid');
  });
});
