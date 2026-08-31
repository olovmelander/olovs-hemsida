import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gridPath, loadGridSpec, sha256Bytes } from './proj.mjs';

const spec = loadGridSpec();
const target = gridPath();
const checkOnly = process.argv.includes('--check');

async function validate(path) {
  try {
    const [metadata, bytes] = await Promise.all([stat(path), readFile(path)]);
    return metadata.size === spec.sizeBytes && sha256Bytes(bytes) === spec.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

if (await validate(target)) {
  console.log(`Verified ${spec.fileName} (${spec.sha256})`);
  process.exit(0);
}

if (checkOnly) {
  throw new Error(`Missing or invalid ${target}; run the Pixi fetch-grid task while online`);
}

await mkdir(dirname(target), { recursive: true });
const partial = `${target}.partial`;
await rm(partial, { force: true });

const response = await fetch(spec.url, { redirect: 'follow' });
if (!response.ok || !response.body) {
  throw new Error(`Could not download ${spec.url}: HTTP ${response.status}`);
}

try {
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
  if (!await validate(partial)) {
    throw new Error(`Checksum or byte-size mismatch for ${spec.url}`);
  }
  await rename(partial, target);
} catch (error) {
  await rm(partial, { force: true });
  throw error;
}

console.log(`Downloaded and verified ${spec.fileName} (${spec.sha256})`);
