import {
  InboxChangesRequest,
  InboxGetMessageRequest,
  InboxGetMessageResponse,
  InboxListRequest,
  InboxListResponse,
  InboxSearchVendorMessagesRequest,
} from '../models/email.js';
import { logger } from '../utils/logger.js';
import { getBuiltInEmailProviderAdapter } from './builtin-email-providers.js';

export async function inboxList(body: InboxListRequest): Promise<InboxListResponse> {
  const adapter = getBuiltInEmailProviderAdapter(body.provider);
  const result = await adapter.listMessages(body);
  logger.info('inbox list complete', { provider: body.provider, count: result.messages.length });
  return result;
}

export async function inboxSearchVendorMessages(body: InboxSearchVendorMessagesRequest): Promise<InboxListResponse> {
  const adapter = getBuiltInEmailProviderAdapter(body.provider);
  const result = await adapter.searchVendorMessages(body);
  logger.info('inbox vendor search complete', {
    provider: body.provider,
    vendorCount: body.vendorEmails.length,
    count: result.messages.length,
  });
  return result;
}

export async function inboxChanges(body: InboxChangesRequest): Promise<InboxListResponse> {
  const adapter = getBuiltInEmailProviderAdapter(body.provider);
  const result = await adapter.listChangedMessages(body);
  logger.info('inbox changes complete', { provider: body.provider, count: result.messages.length });
  return result;
}

export async function inboxGetMessage(body: InboxGetMessageRequest): Promise<InboxGetMessageResponse> {
  const adapter = getBuiltInEmailProviderAdapter(body.provider);
  return adapter.getMessage(body);
}
