import { resolveV2AssetUrl } from './runtime/http.mjs';

export const STARTUP_VERSION = 1;
export const STARTUP_BUILDER = 'lossless-ground-v1';
export const MAX_STARTUP_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_STARTUP_BYTES = 128 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;

export function groundAssetReferences(ground) {
  const refs = new Map();
  const add = ref => { if (ref) refs.set(ref.sha256, ref); };
  add(ground.shell);
  for (const tile of ground.tiles) for (const ref of Object.values(tile.layers)) add(ref);
  return [...refs.values()];
}

export function validateStartupManifest(manifest, { ground, groundSha256, baseUrl }) {
  if (manifest?.version !== STARTUP_VERSION || manifest.builder !== STARTUP_BUILDER ||
      manifest.groundId !== ground.groundId || manifest.groundSha256 !== groundSha256 ||
      !Array.isArray(manifest.packs) || !manifest.packs.length || manifest.packs.length > 128 ||
      !manifest.entries || typeof manifest.entries !== 'object') throw new Error('incompatible startup manifest');
  let total = 0;
  for (const pack of manifest.packs) {
    if (!SHA.test(pack.sha256) || !Number.isSafeInteger(pack.bytes) || pack.bytes < 1 ||
        pack.bytes > MAX_STARTUP_PACK_BYTES) throw new Error('invalid startup package');
    resolveV2AssetUrl(pack.url, baseUrl);
    total += pack.bytes;
  }
  if (total > MAX_STARTUP_BYTES) throw new Error('startup exceeds byte budget');
  const refs = groundAssetReferences(ground);
  if (Object.keys(manifest.entries).length !== refs.length) throw new Error('incomplete startup manifest');
  const ranges = manifest.packs.map(() => []);
  for (const ref of refs) {
    const entry = manifest.entries[ref.sha256];
    if (!entry || !Number.isSafeInteger(entry.pack) || entry.pack < 0 || entry.pack >= ranges.length ||
        !Number.isSafeInteger(entry.offset) || entry.offset < 0 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 ||
        entry.offset + entry.bytes > manifest.packs[entry.pack].bytes) throw new Error('invalid startup entry range');
    if (entry.codec === 'terrain-predictor-v1') {
      if (ref.kind !== 'terrain' || !SHA.test(entry.rawSha256) || !Number.isSafeInteger(entry.rawBytes) ||
          entry.rawBytes <= ref.decodedBytes || entry.rawBytes > ref.decodedBytes + 65552) throw new Error('invalid startup terrain identity');
    } else if (entry.codec !== 'bvch' || entry.bytes !== ref.bytes) throw new Error('unsupported startup codec');
    ranges[entry.pack].push(entry);
  }
  ranges.forEach((entries, i) => {
    let end = 0;
    for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
      if (entry.offset !== end) throw new Error('overlapping or incomplete startup package');
      end += entry.bytes;
    }
    if (end !== manifest.packs[i].bytes) throw new Error('startup package has unreferenced bytes');
  });
  return manifest;
}
