import { EmailProvider } from '../models/email.js';
import { EmailProviderAdapter } from './email-provider-adapter.js';

const providers = new Map<EmailProvider, EmailProviderAdapter>();

export function registerEmailProviderAdapter(adapter: EmailProviderAdapter): void {
  providers.set(adapter.provider, adapter);
}

export function getEmailProviderAdapter(provider: EmailProvider): EmailProviderAdapter {
  const adapter = providers.get(provider);
  if (!adapter) {
    throw new Error(`Email provider adapter is not registered: ${provider}`);
  }
  return adapter;
}

export function listRegisteredEmailProviderAdapters(): EmailProvider[] {
  return [...providers.keys()];
}
