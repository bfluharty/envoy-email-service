import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient();
const TTL_MS = 10 * 60 * 1000; // 10 minutes — allows key rotations to take effect without a cold start

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const parameterCache = new Map<string, CacheEntry>();

export async function getDecryptedParameter(parameterName: string): Promise<string> {
  const name = parameterName.trim();
  if (!name) {
    throw new Error('Parameter Store name is required.');
  }

  const cached = parameterCache.get(name);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.value;
  }

  const response = await ssm.send(
    new GetParameterCommand({
      Name: name,
      WithDecryption: true,
    })
  );

  const value = response.Parameter?.Value;
  if (!value) {
    throw new Error('Parameter Store value is empty.');
  }

  parameterCache.set(name, { value, fetchedAt: Date.now() });
  return value;
}
