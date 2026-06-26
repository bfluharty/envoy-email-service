export type EmailProvider = 'gmail' | 'microsoft';

export type InboxMailbox = 'inbox' | 'sent' | 'all';

export interface SendOnBehalfRequest {
  provider: EmailProvider;
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
}

export interface SendOnBehalfResponse {
  messageId: string | null;
  threadId?: string | null;
}

export interface InboxListRequest {
  provider: EmailProvider;
  accessToken: string;
  maxResults?: number;
  afterDate?: string;
  mailbox?: InboxMailbox;
}

export interface InboxMessageSummary {
  id: string;
  threadId: string | null;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet?: string;
}

export interface InboxListResponse {
  messages: InboxMessageSummary[];
}

export interface InboxGetMessageRequest {
  provider: EmailProvider;
  accessToken: string;
  messageId: string;
}

export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  date: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string | null;
}

export interface InboxGetMessageResponse {
  message: InboxMessage | null;
}

export interface InboxSearchVendorMessagesRequest {
  provider: EmailProvider;
  accessToken: string;
  vendorEmails: string[];
  maxResults?: number;
  afterDate?: string;
}

export interface InboxChangesRequest {
  provider: EmailProvider;
  accessToken: string;
  cursor?: string;
  messageId?: string;
}

export interface WatchSetupRequest {
  provider: EmailProvider;
  accessToken: string;
  email: string;
  connectionUuid: string;
  callbackUrl?: string;
}

export interface WatchResult {
  provider: EmailProvider;
  providerCursor?: string;
  providerSubscriptionId?: string;
  subscriptionClientState?: string;
  expiresAt?: string;
}
