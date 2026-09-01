import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyJsonDescriptorIntegrity } from './descriptor-integrity.mjs';

async function sha256(bytes) {
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('JSON descriptor integrity', () => {
  it('accepts the reviewed LF bytes and their CRLF-only Windows equivalent', async () => {
    const encoder = new TextEncoder();
    const reviewed = encoder.encode('{\n  "ready": true\n}\n');
    const windows = encoder.encode('{\r\n  "ready": true\r\n}\r\n');
    const expected = await sha256(reviewed);
    await expect(verifyJsonDescriptorIntegrity(reviewed, expected, webcrypto, 'fixture')).resolves.toBe(expected);
    await expect(verifyJsonDescriptorIntegrity(windows, expected, webcrypto, 'fixture')).resolves.toBe(expected);
  });

  it('still rejects any semantic descriptor change', async () => {
    const encoder = new TextEncoder();
    const reviewed = encoder.encode('{"ready":true}\n');
    const changed = encoder.encode('{"ready":false}\r\n');
    await expect(verifyJsonDescriptorIntegrity(
      changed, await sha256(reviewed), webcrypto, 'fixture',
    )).rejects.toThrow(/descriptor integrity mismatch/);
  });
});

