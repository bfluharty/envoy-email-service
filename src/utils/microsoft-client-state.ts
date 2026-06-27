import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfiguredParameterValue } from './configured-parameter.js';

export interface MicrosoftClientStatePayload {
  connectionUuid: string;
  issuedAt: number;
}

function base64Url(input: Buffer): string {
  return input.toString('base64url');
}

async function signatureFor(payload: string): Promise<string> {
  const secret = await getConfiguredParameterValue('MICROSOFT_GRAPH_CLIENT_STATE_SECRET');
  return base64Url(createHmac('sha256', secret).update(payload).digest().subarray(0, 16));
}

export async function createMicrosoftClientState(
  connectionUuid: string,
  issuedAt = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload = `m:${connectionUuid}:${issuedAt}`;
  return `${payload}:${await signatureFor(payload)}`;
}

export async function verifyMicrosoftClientState(clientState: string): Promise<MicrosoftClientStatePayload | null> {
  const parts = clientState.split(':');
  if (parts.length !== 4 || parts[0] !== 'm') {
    return null;
  }

  const [marker, connectionUuid, issuedAtText, signature] = parts;
  const payload = `${marker}:${connectionUuid}:${issuedAtText}`;
  const expected = await signatureFor(payload);
  const actualBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');

  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  const issuedAt = Number(issuedAtText);
  if (!Number.isFinite(issuedAt)) {
    return null;
  }

  return { connectionUuid, issuedAt };
}
