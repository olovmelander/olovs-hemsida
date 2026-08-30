export class HttpStatusError extends Error {
  constructor(status, url) {
    super(`v2 asset fetch ${status} for ${url}`);
    this.name = 'HttpStatusError';
    this.status = status;
    /* Removal/auth/client responses are authoritative; transient throttling,
       timeout and server failures may use a previously verified offline root. */
    this.allowCachedFallback = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

function decodedPath(relative) {
  let decoded;
  try { decoded = decodeURIComponent(relative); }
  catch { throw new Error('v2 asset URL contains invalid percent encoding'); }
  if (decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') || decoded.includes('://')) {
    throw new Error('v2 asset URL contains a forbidden encoded delimiter');
  }
  return decoded;
}

export function resolveV2AssetUrl(relative, baseUrl) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') ||
      relative.includes('\\') || relative.includes('?') || relative.includes('#') ||
      relative.includes('://')) {
    throw new Error('v2 asset URL must be a query-free relative application URL');
  }
  if (decodedPath(relative).split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('v2 asset URL contains an empty or traversal segment');
  }
  const base = new URL(baseUrl);
  if (base.search || base.hash || !base.pathname.endsWith('/')) {
    throw new Error('v2 application base must be a query-free directory URL');
  }
  const resolved = new URL(relative, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new Error('v2 asset URL escapes the application base');
  }
  return resolved.href;
}

export function createHttpByteFetcher(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  return async (url, { signal, expectedBytes } = {}) => {
    let response;
    try { response = await fetchImpl(url, { signal }); }
    catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new Error(`v2 asset fetch failed for ${url}: ${error?.message || error}`, { cause: error });
    }
    if (!response.ok) throw new HttpStatusError(response.status, url);
    const data = new Uint8Array(await response.arrayBuffer());
    if (expectedBytes !== undefined && data.byteLength !== expectedBytes) {
      const error = new Error(
        `v2 asset ${url} has ${data.byteLength} bytes; manifest declares ${expectedBytes}`,
      );
      error.allowCachedFallback = false;
      throw error;
    }
    return data;
  };
}
