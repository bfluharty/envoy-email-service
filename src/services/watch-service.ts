import { RenewWatchRequest, StopWatchRequest, WatchResult, WatchSetupRequest } from '../models/email.js';
import { getBuiltInEmailProviderAdapter } from './builtin-email-providers.js';
import { logger } from '../utils/logger.js';

export async function setupWatch(input: WatchSetupRequest): Promise<WatchResult> {
  logger.info('watch setup requested', {
    provider: input.provider,
    email: input.email,
    connectionUuid: input.connectionUuid,
  });
  const result = await getBuiltInEmailProviderAdapter(input.provider).setupWatch(input);
  logger.info('watch setup completed', {
    provider: input.provider,
    connectionUuid: input.connectionUuid,
    expiresAt: result.expiresAt,
    hasProviderSubscriptionId: Boolean(result.providerSubscriptionId),
  });
  return result;
}

export async function renewWatch(input: RenewWatchRequest): Promise<WatchResult> {
  logger.info('watch renewal requested', {
    provider: input.provider,
    email: input.email,
    connectionUuid: input.connectionUuid,
    hasProviderSubscriptionId: Boolean(input.providerSubscriptionId),
  });
  const result = await getBuiltInEmailProviderAdapter(input.provider).renewWatch(input);
  logger.info('watch renewal completed', {
    provider: input.provider,
    connectionUuid: input.connectionUuid,
    expiresAt: result.expiresAt,
    hasProviderSubscriptionId: Boolean(result.providerSubscriptionId),
  });
  return result;
}

export async function stopWatch(input: StopWatchRequest): Promise<void> {
  logger.info('watch stop requested', {
    provider: input.provider,
    hasProviderSubscriptionId: Boolean(input.providerSubscriptionId),
  });
  await getBuiltInEmailProviderAdapter(input.provider).stopWatch(input);
  logger.info('watch stop completed', { provider: input.provider });
}
