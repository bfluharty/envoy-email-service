import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMicrosoftClientState, verifyMicrosoftClientState } from '../src/utils/microsoft-client-state.js';

describe('Microsoft clientState signing', () => {
  beforeEach(() => {
    process.env.MICROSOFT_GRAPH_CLIENT_STATE_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.MICROSOFT_GRAPH_CLIENT_STATE_SECRET;
  });

  it('creates a compact verifiable clientState', async () => {
    const clientState = await createMicrosoftClientState('connection-uuid', 123);
    expect(clientState.length).toBeLessThan(128);
    await expect(verifyMicrosoftClientState(clientState)).resolves.toEqual({
      connectionUuid: 'connection-uuid',
      issuedAt: 123,
    });
  });

  it('rejects tampered clientState values', async () => {
    const clientState = await createMicrosoftClientState('connection-uuid', 123);
    await expect(
      verifyMicrosoftClientState(clientState.replace('connection-uuid', 'other-connection'))
    ).resolves.toBeNull();
  });
});
