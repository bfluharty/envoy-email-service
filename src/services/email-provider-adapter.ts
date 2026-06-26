import {
  EmailProvider,
  InboxChangesRequest,
  InboxGetMessageRequest,
  InboxGetMessageResponse,
  InboxListRequest,
  InboxListResponse,
  InboxSearchVendorMessagesRequest,
  SendOnBehalfRequest,
  SendOnBehalfResponse,
  WatchResult,
  WatchSetupRequest,
} from '../models/email.js';

export interface RenewWatchRequest extends WatchSetupRequest {
  providerSubscriptionId?: string;
}

export interface StopWatchRequest {
  provider: EmailProvider;
  accessToken: string;
  providerSubscriptionId?: string;
}

export interface EmailProviderAdapter {
  provider: EmailProvider;
  listMessages(input: InboxListRequest): Promise<InboxListResponse>;
  searchVendorMessages(input: InboxSearchVendorMessagesRequest): Promise<InboxListResponse>;
  listChangedMessages(input: InboxChangesRequest): Promise<InboxListResponse>;
  getMessage(input: InboxGetMessageRequest): Promise<InboxGetMessageResponse>;
  sendMessage(input: SendOnBehalfRequest): Promise<SendOnBehalfResponse>;
  setupWatch(input: WatchSetupRequest): Promise<WatchResult>;
  renewWatch(input: RenewWatchRequest): Promise<WatchResult>;
  stopWatch(input: StopWatchRequest): Promise<void>;
}

export class UnsupportedProviderOperationError extends Error {
  constructor(provider: EmailProvider, operation: string) {
    super(`${provider} ${operation} is not implemented yet`);
    this.name = 'UnsupportedProviderOperationError';
  }
}
