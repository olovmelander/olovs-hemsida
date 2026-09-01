function normalizeCrlf(bytes) {
  let count = 0;
  for (let index = 0; index + 1 < bytes.length; index++) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) count++;
  }
  if (!count) return bytes;
  const normalized = new Uint8Array(bytes.length - count);
  let target = 0;
  for (let source = 0; source < bytes.length; source++) {
    if (bytes[source] === 13 && bytes[source + 1] === 10) continue;
    normalized[target++] = bytes[source];
  }
  return normalized;
}

async function sha256Hex(bytes, cryptoImpl) {
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/* Git and EditorConfig retain canonical LF descriptors, but a Windows editor
   can still rewrite JSON whitespace as CRLF before a dev-server request. Treat
   only that byte-for-byte line-ending equivalent as the reviewed descriptor;
   every semantic byte remains covered by the pinned SHA-256. */
export async function verifyJsonDescriptorIntegrity(bytes, expectedSha256, cryptoImpl, label) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '') || !cryptoImpl?.subtle?.digest) {
    throw new Error(`${label} expected descriptor SHA-256 is invalid or unavailable`);
  }
  const actual = await sha256Hex(bytes, cryptoImpl);
  if (actual === expectedSha256) return actual;
  const normalized = normalizeCrlf(bytes);
  if (normalized !== bytes && await sha256Hex(normalized, cryptoImpl) === expectedSha256) {
    return expectedSha256;
  }
  throw new Error(`${label} descriptor integrity mismatch: ${actual} != ${expectedSha256}`);
}

