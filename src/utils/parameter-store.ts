import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient();
const parameterCache = new Map<string, Promise<string>>();

export async function getDecryptedParameter(parameterName: string): Promise<string> {
  const name = parameterName.trim();
  if (!name) {
    throw new Error('Parameter Store name is required.');
  }

  const cached = parameterCache.get(name);
  if (cached) {
    return cached;
  }

  const parameterPromise = ssm
    .send(
      new GetParameterCommand({
        Name: name,
        WithDecryption: true,
      })
    )
    .then((response) => {
      const value = response.Parameter?.Value;
      if (!value) {
        throw new Error('Parameter Store value is empty.');
      }

      return value;
    })
    .catch((err) => {
      parameterCache.delete(name);
      throw err;
    });

  parameterCache.set(name, parameterPromise);
  return parameterPromise;
}
