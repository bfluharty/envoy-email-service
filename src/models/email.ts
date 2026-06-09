export type EmailProvider = 'gmail' | 'microsoft';

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
  messageId: string;
}

export interface InboxListRequest {
  provider: EmailProvider;
  accessToken: string;
  maxResults?: number;
  afterDate?: string;
}

export interface InboxMessageSummary {
  id: string;
  threadId: string;
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
  references?: string;
}

export interface InboxGetMessageResponse {
  message: InboxMessage | null;
}
