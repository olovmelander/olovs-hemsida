function cleanSecret(value, name) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/\r|\n|\0/.test(value)) throw new Error(`${name} contains a forbidden control character`);
  return value;
}

export function lantmaterietCredentials(env = process.env) {
  const bearer = cleanSecret(env.LANTMATERIET_BEARER_TOKEN, 'LANTMATERIET_BEARER_TOKEN');
  const username = cleanSecret(env.LANTMATERIET_USERNAME, 'LANTMATERIET_USERNAME');
  const password = cleanSecret(env.LANTMATERIET_PASSWORD, 'LANTMATERIET_PASSWORD');
  if (bearer) return { type: 'bearer', bearer };
  if (username || password) {
    if (!username || !password) {
      throw new Error('LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD must be supplied together');
    }
    return { type: 'basic', username, password };
  }
  return null;
}

export function skogsstyrelsenCredentials(env = process.env) {
  const username = cleanSecret(env.SKOGSSTYRELSEN_USERNAME, 'SKOGSSTYRELSEN_USERNAME');
  const password = cleanSecret(env.SKOGSSTYRELSEN_PASSWORD, 'SKOGSSTYRELSEN_PASSWORD');
  if (!username && !password) return null;
  if (!username || !password) {
    throw new Error('SKOGSSTYRELSEN_USERNAME and SKOGSSTYRELSEN_PASSWORD must be supplied together');
  }
  return { type: 'basic', username, password };
}

export function authorizationHeaders(credentials) {
  if (!credentials) return {};
  if (credentials.type === 'bearer') return { Authorization: `Bearer ${credentials.bearer}` };
  if (credentials.type === 'basic') {
    const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  throw new Error(`unsupported credential type ${credentials.type}`);
}

export function gdalHttpEnvironment(credentials) {
  if (!credentials) return {};
  const common = {
    GDAL_DISABLE_READDIR_ON_OPEN: 'EMPTY_DIR',
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS: '.tif,.tiff,.gpkg,.laz',
    CPL_VSIL_CURL_CACHE_SIZE: String(64 * 1024 * 1024),
    VSI_CACHE: 'TRUE',
    VSI_CACHE_SIZE: String(64 * 1024 * 1024),
  };
  if (credentials.type === 'basic') {
    return { ...common, GDAL_HTTP_USERPWD: `${credentials.username}:${credentials.password}` };
  }
  if (credentials.type === 'bearer') {
    return { ...common, GDAL_HTTP_HEADERS: `Authorization: Bearer ${credentials.bearer}` };
  }
  throw new Error(`unsupported credential type ${credentials.type}`);
}

export function credentialState(credentials) {
  return credentials ? `${credentials.type}-configured` : 'missing';
}
