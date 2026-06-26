import { EmailProvider } from '../models/email.js';
import { getEmailProviderAdapter, registerEmailProviderAdapter } from './email-provider-registry.js';
import { gmailAdapter } from './providers/gmail-adapter.js';
import { microsoftAdapter } from './providers/microsoft-adapter.js';

let registered = false;

export function registerBuiltInEmailProviderAdapters(): void {
  if (registered) {
    return;
  }

  registerEmailProviderAdapter(gmailAdapter);
  registerEmailProviderAdapter(microsoftAdapter);
  registered = true;
}

export function getBuiltInEmailProviderAdapter(provider: EmailProvider) {
  registerBuiltInEmailProviderAdapters();
  return getEmailProviderAdapter(provider);
}
