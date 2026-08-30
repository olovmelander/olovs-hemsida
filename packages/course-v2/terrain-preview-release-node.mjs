import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChunkAsset } from './chunk-node.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const DEFAULT_MAX_RELEASE_BYTES = 16 * 1024 * 1024;

function childPath(root, requested, label) {
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== target) {
    throw new Error(`${label} escapes its release root`);
  }
  return { target, relative: rel };
}

/**
 * Copy only the strict descriptor and its referenced, verified BVCH tiles into
 * a publishable directory. Source COG/XYZ files, shell tiles and coarser LODs
 * are intentionally unreachable from this allow-list operation.
 */
export async function stageTerrainPreviewRelease(sourceDirectory, releaseDirectory, {
  expectedLabel,
  expectedTileCount,
  maximumReleaseBytes = DEFAULT_MAX_RELEASE_BYTES,
} = {}) {
  const sourceRoot = resolve(sourceDirectory);
  const releaseRoot = resolve(releaseDirectory);
  if (sourceRoot === releaseRoot || releaseRoot.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('terrain preview release must be staged outside its source directory');
  }
  if (!Number.isSafeInteger(maximumReleaseBytes) || maximumReleaseBytes < 1) {
    throw new RangeError('maximumReleaseBytes must be a positive safe integer');
  }

  const descriptorPath = resolve(sourceRoot, 'preview.json');
  const descriptorStat = await stat(descriptorPath);
  if (!descriptorStat.isFile() || descriptorStat.size > MAX_DESCRIPTOR_BYTES) {
    throw new Error('terrain preview descriptor is missing or exceeds its byte budget');
  }
  const descriptorBytes = await readFile(descriptorPath);
  const descriptor = assertTerrainPreview(JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(descriptorBytes),
  ));
  if (expectedLabel !== undefined && descriptor.label !== expectedLabel) {
    throw new Error(`terrain preview label ${JSON.stringify(descriptor.label)} does not match the release`);
  }
  if (expectedTileCount !== undefined && descriptor.tiles.length !== expectedTileCount) {
    throw new Error(`terrain preview has ${descriptor.tiles.length} tiles; expected ${expectedTileCount}`);
  }

  let encodedBytes = descriptorBytes.byteLength;
  const assets = [];
  const seen = new Set();
  for (const tile of descriptor.tiles) {
    if (seen.has(tile.reference.url)) throw new Error(`duplicate preview asset ${tile.reference.url}`);
    seen.add(tile.reference.url);
    const source = childPath(sourceRoot, tile.reference.url, 'terrain preview asset');
    const bytes = await readFile(source.target);
    verifyChunkAsset(tile.reference, bytes);
    encodedBytes += bytes.byteLength;
    if (encodedBytes > maximumReleaseBytes) {
      throw new Error(`terrain preview release exceeds ${maximumReleaseBytes} bytes`);
    }
    assets.push(Object.freeze({
      tileId: tile.id,
      relativePath: source.relative,
      bytes,
      sha256: tile.reference.sha256,
      decodedBytes: tile.reference.decodedBytes,
    }));
  }

  await mkdir(releaseRoot, { recursive: false });
  await writeFile(resolve(releaseRoot, 'preview.json'), descriptorBytes, { flag: 'wx' });
  for (const asset of assets) {
    const target = childPath(releaseRoot, asset.relativePath, 'terrain preview release asset').target;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, asset.bytes, { flag: 'wx' });
  }

  return Object.freeze({
    descriptor: Object.freeze(descriptor),
    releaseRoot,
    files: Object.freeze(['preview.json', ...assets.map(asset => asset.relativePath)]),
    tileCount: assets.length,
    encodedBytes,
    decodedBytes: assets.reduce((sum, asset) => sum + asset.decodedBytes, 0),
  });
}

async function main() {
  const [sourceDirectory, releaseDirectory] = process.argv.slice(2);
  if (!sourceDirectory || !releaseDirectory) {
    throw new Error('usage: terrain-preview-release-node.mjs <source-directory> <release-directory>');
  }
  const result = await stageTerrainPreviewRelease(sourceDirectory, releaseDirectory, {
    expectedLabel: 'Puttom · Lantmäteriet 1 m terräng',
    expectedTileCount: 16,
  });
  console.log(JSON.stringify({
    ready: true,
    provisional: result.descriptor.provisional,
    files: result.files,
    tileCount: result.tileCount,
    encodedBytes: result.encodedBytes,
    decodedBytes: result.decodedBytes,
    retainedSourceTerrainBytes: 0,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(`terrain preview release failed: ${error.message}`);
    process.exitCode = 1;
  });
}
