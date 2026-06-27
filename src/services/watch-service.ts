import { RenewWatchRequest, StopWatchRequest, WatchResult, WatchSetupRequest } from '../models/email.js';
import { getBuiltInEmailProviderAdapter } from './builtin-email-providers.js';

export function setupWatch(input: WatchSetupRequest): Promise<WatchResult> {
  return getBuiltInEmailProviderAdapter(input.provider).setupWatch(input);
}

export function renewWatch(input: RenewWatchRequest): Promise<WatchResult> {
  return getBuiltInEmailProviderAdapter(input.provider).renewWatch(input);
}

export function stopWatch(input: StopWatchRequest): Promise<void> {
  return getBuiltInEmailProviderAdapter(input.provider).stopWatch(input);
}
