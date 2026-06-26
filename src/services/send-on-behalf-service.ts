import { SendOnBehalfRequest, SendOnBehalfResponse } from '../models/email.js';
import { logger } from '../utils/logger.js';
import { getBuiltInEmailProviderAdapter } from './builtin-email-providers.js';

export async function sendOnBehalf(body: SendOnBehalfRequest): Promise<SendOnBehalfResponse> {
  logger.info('sendOnBehalf start', { provider: body.provider, to: body.to, subject: body.subject });
  const adapter = getBuiltInEmailProviderAdapter(body.provider);
  return adapter.sendMessage(body);
}
