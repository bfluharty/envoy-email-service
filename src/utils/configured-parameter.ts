import { getDecryptedParameter } from './parameter-store.js';

export async function getConfiguredParameterValue(envName: string): Promise<string> {
  const configured = (process.env[envName] ?? '').trim();
  if (!configured) {
    throw new Error(`${envName} is not set`);
  }

  if (configured.startsWith('/')) {
    return getDecryptedParameter(configured);
  }

  return configured;
}
