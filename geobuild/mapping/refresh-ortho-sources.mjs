/* Refresh only Veckefjarden's delivered orthophoto/source and migration ledgers.
 * Does not approve canonical survey accuracy or publish an application graph. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../../packages/course-geo/manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = sha256File;
const manifestPath = 'geo_data/course-v2/veckefjarden/source-manifest.json';
const manifest = read(manifestPath);
const base = 'geo_data/course-v2/veckefjarden/acquisition/';
const acquired = read(base + 'ortho-review.json');
if (acquired.state !== 'acquired-for-review' || acquired.windows.length !== 16 ||
    acquired.windows.some(w => w.validFraction !== 1)) throw Error('Incomplete orthophoto acquisition');
const discovery = read(base + 'ortho-discovery.json');
const parent = manifest.sources.find(s => s.id === 'imagery-lm-ortho');
parent.capturedAt = '2024-06-27';
parent.checksumReason = 'Full provider COGs were not retained or hashed; 16 bounded native windows have independent acquired source records and checksums.';
parent.notes = 'Latest complete campaign found on 2026-09-09 is orto-u2-2024, captured 2024-06-27. Sixteen native 0.16 m RGBI windows covering the shared 2049 m playing-ground extent were acquired, georeference-checked and used for explicit vector review. The larger discovery AOI is not a claim of retained pixel coverage. Pixel spacing is not surveyed positional accuracy; raw imagery remains in ignored local cache.';
const sourceIds = [];
for (const window of acquired.windows) {
  const id = 'imagery-lm-window-' + window.id;
  sourceIds.push(id);
  const sourceItem = discovery.items.find(item => item.id === window.sources[0].id);
  const record = {
    id, productId: 'lantmateriet-ortofoto', roles: ['imagery', 'surface'],
    lifecycle: 'acquired', use: 'supporting', sourceUri: sourceItem.assets.data.href,
    localPath: null, bboxWgs84: null, acquiredAt: acquired.observedAt.slice(0, 10),
    capturedAt: '2024-06-27', checksum: window.sha256, checksumReason: null,
    replacementSourceId: null, accuracyTier: 'B', horizontalAccuracyMetres: null,
    verticalAccuracyMetres: null,
    notes: `Checksum is the exact retained ${window.rasterFile} native EPSG:3006 RGBI crop, not the complete provider asset. Pixel-edge bounds ${JSON.stringify(window.boundsEpsg3006)}; ${window.width} x ${window.height} at 0.16 m; all pixels valid. All contributing sources, affine, hashes and local cache directory are recorded in ${base}ortho-review.json. No raw pixels redistributed.`,
  };
  const i = manifest.sources.findIndex(s => s.id === id);
  if (i < 0) manifest.sources.push(record); else manifest.sources[i] = record;
}
const additions = [
  ['ortho-discovery', 'acquisition', base+'ortho-discovery.json', 'discovery-evidence', 'Live catalogue campaign selection and coverage, including exact source item identities.'],
  ['ortho-plan', 'acquisition', base+'ortho-plan.json', 'discovery-evidence', 'Native-lattice bounded acquisition requests over the shared playing ground.'],
  ['ortho-acquisition', 'acquisition', base+'ortho-review.json', 'discovery-evidence', 'Completed private imagery intake with actual raster affines, coverage and per-file hashes.'],
  ['ortho-grid-verification', 'control', base+'ortho-grid-verification.json', 'discovery-evidence', 'Actual provider-to-crop affine and exact four-band sample checks; numerical registration only, not survey accuracy.'],
  ['ortho-trace-verification', 'control', base+'ortho-trace-verification.json', 'discovery-evidence', 'Source and panel hashes plus pixel-to-EPSG-to-local numerical residual checks.'],
  ['ortho-reviewed-vectors', 'surface', 'geobuild/mapping/lm-ortho-review.json', 'migration-only', 'Explicit source-pixel decisions, current vector overrides, provisional platform references and retained historical uncertainty.'],
  ['ortho-alignment-audit', 'control', base+'ortho-alignment-audit.json', 'discovery-evidence', 'Independent final source-to-model checks and per-hole adopted and unresolved inventory.'],
];
for (const [id, kind, file, use, notes] of additions) {
  if (!fs.existsSync(file)) continue;
  const artifact = { id, kind, path: file, sha256: hash(file), derivedFrom: sourceIds, use, notes };
  const i = manifest.artifacts.findIndex(a => a.id === id);
  if (i < 0) manifest.artifacts.push(artifact); else manifest.artifacts[i] = artifact;
}
for (const artifact of manifest.artifacts) {
  if (['legacy-course-model','legacy-short-course-model','migration-course-model-epsg3006',
    'migration-short-course-model-epsg3006','migration-residual-report'].includes(artifact.id)) {
    artifact.sha256 = hash(artifact.path);
    artifact.derivedFrom = [...new Set([...artifact.derivedFrom, ...sourceIds])];
  }
}
const blocker = manifest.blockers.find(b => b.id === 'authoritative-assets');
blocker.description = 'Native bounded 2024 orthophotos are acquired and reviewed vectors are applied. Controlled survey and complete replacement of remaining legacy surfaces, marker associations and environment boundaries are still pending.';
blocker.exitGate = 'Resolve the recorded per-feature review limits and independent controls; retain exact acquired asset and derivative provenance.';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Other course work can share these files: update only the two Veckefjarden keys.
for (const [file, paths] of [
  ['packages/course-geo/acquisition/hole-source-inventory.mjs', {
    veckefjarden: 'geobuild/course-model.json',
    'veckefjarden-korthalsbanan': 'veckefjardenkortbuild/course-model.json',
  }],
  ['packages/course-geo/acquisition/hole-source-controls.mjs', {
    veckefjarden: 'geo_data/course-v2/veckefjarden/migration/course-model.epsg3006.json',
    'veckefjarden-korthalsbanan': 'geo_data/course-v2/veckefjarden/migration/short-course-model.epsg3006.json',
  }],
]) {
  let contents = fs.readFileSync(file, 'utf8');
  for (const [slug, modelPath] of Object.entries(paths)) {
    const pattern = file.includes('inventory')
      ? new RegExp(`((?:'${slug}'|${slug}): Object\\.freeze\\(\\{\\s*path: '[^']+',\\s*sha256: ')[a-f0-9]{64}(')`)
      : new RegExp(`((?:'${slug}'|${slug}): ')[a-f0-9]{64}(')`);
    if (!pattern.test(contents)) throw Error(`Missing pinned key ${slug} in ${file}`);
    contents = contents.replace(pattern, `$1${hash(modelPath)}$2`);
  }
  fs.writeFileSync(file, contents);
}
console.log('Veckefjarden orthophoto and geometry source records refreshed.');
