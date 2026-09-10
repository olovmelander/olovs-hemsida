import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateSourceManifest } from '../../packages/course-geo/manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const prefix = 'geo_data/course-v2/upsala/';
const file = `${prefix}source-manifest.json`, manifest = read(file);
const acquisition = read(`${prefix}reference/lm-ortho-acquisition-2026-09-09.json`);
assert.equal(acquisition.state, 'acquired-for-review');
assert(acquisition.access.authorized && acquisition.windows.length === 28);
assert(acquisition.windows.every(w => w.validFraction === 1 && /^[a-f0-9]{64}$/.test(w.sha256)));
const source = manifest.sources.find(s => s.id === 'imagery-lm-ortho');
Object.assign(source, {
  lifecycle: 'planned', use: 'candidate', acquiredAt: '2026-09-09', capturedAt: null,
  sourceUri: 'https://api.lantmateriet.se/stac-bild/v1/collections/orto-o2-2025',
  checksum: null,
  checksumReason: 'Bounded RGBI windows are acquired and individually checksummed in reference/lm-ortho-acquisition-2026-09-09.json. The whole-source lifecycle remains planned because complete remote TIFFs were range-read, not downloaded and hashed in full.',
  notes: 'Authenticated native 0.16 m RGBI windows cover all 27 green complexes and mapped bunkers plus all 27 tee sites; a 0.8 m overview covers the shared playing ground. Published mosaic seam metadata dates every native window to 2025-06-14; the broader overview also includes 2025-04-25 imagery. The registered target bbox is wider than the acquired playing-ground windows; exact acquired bounds and capture times are in reference/. Reviewed surface vectors and bounded tee navigation-reference corrections are applied to both courses; raw imagery stays in ignored local cache. Absolute horizontal accuracy and independent control approval remain unestablished.',
});
const entries = [
  ...[
    ['lm-tee-site-review-stora-2026-09-09', 'surface', 'migration-only'],
    ['lm-tee-site-review-mellan-2026-09-09', 'surface', 'migration-only'],
    ['lm-tee-points-stora-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-tee-visible-interior-stora-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-mellan-orange-remaining-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-remaining17-validation-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['tee-site-coordinate-contract-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-remaining17-runtime-2026-09-09', 'acquisition', 'discovery-evidence'],
  ].map(([id, kind, use]) => ({ id, kind, use,
    path: `upsalabuild/mapping/${id}.json`,
    notes: 'Seventeen reviewed navigation sites: sixteen moved and one confirmed. Eight use published coordinates, three use visible tee interiors and six use approximate guide-identified fairway entrances with 12-15 m interpretation allowances. Evidence footprints are not physical platform boundaries. Full H13/H15 outlines, daily markers and absolute survey accuracy remain unverified.',
  })),
  ...[
    ['lm-stora-tee-platform-followup-2026-09-09', 'surface', 'migration-only'],
    ['lm-tee-followup-stora-2026-09-09', 'surface', 'migration-only'],
    ['lm-tee-followup-mellan-2026-09-09', 'surface', 'migration-only'],
    ['lm-mellan-published-tee-evidence-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-mellan-tee-followup-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-tee-followup-validation-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['lm-tee-followup-runtime-2026-09-09', 'acquisition', 'discovery-evidence'],
    ['tee-coordinate-contract-2026-09-09', 'acquisition', 'discovery-evidence'],
  ].map(([id, kind, use]) => ({ id, kind, use,
    path: `upsalabuild/mapping/${id}.json`,
    notes: 'Ordered tee followup: two source-reviewed Stora platforms, eleven bounded navigation corrections and source-to-consumer validation. Club-guide and published tee-point source identities, URLs and hashes are recorded inside the ledgers; daily markers and absolute survey accuracy remain unverified.',
  })),
  ...['plan', 'acquisition', 'capture', 'validation'].map(part => ({
    id: `lm-tee-${part}-2026-09-09`, kind: 'acquisition',
    path: `${prefix}reference/lm-tee-${part}-2026-09-09.json`, use: 'discovery-evidence',
    notes: 'Authenticated native 0.16 m windows covering all 27 tee sites; source grid and 2025-06-14 capture evidence retained independently of the green/bunker intake.',
  })),
  ...['front9', 'back9', 'mellan'].map(part => ({
    id: `lm-tee-review-${part}-2026-09-09`, kind: 'surface',
    path: `upsalabuild/mapping/lm-tee-review-${part}-2026-09-09.json`, use: 'migration-only',
    notes: 'Visual tee-platform review and explicit bounded navigation-reference associations. Preserves source pads, card distances and unsupported reference positions; does not establish daily marker positions or tee colours.',
  })),
  {
    id: 'lm-tee-alignment-validation-2026-09-09', kind: 'acquisition',
    path: 'upsalabuild/mapping/lm-tee-alignment-validation-2026-09-09.json', use: 'discovery-evidence',
    notes: 'Independent source-hash, pad containment, movement-limit and unchanged-geometry validation of the tee reference correction.',
  },
  ...['plan', 'acquisition', 'capture', 'catalog', 'validation'].map(part => ({
    id: `lm-ortho-${part}-2026-09-09`, kind: 'acquisition',
    path: `${prefix}reference/lm-ortho-${part}-2026-09-09.json`, use: 'discovery-evidence',
    notes: `Verified authenticated Upsala orthophoto ${part} evidence; source pixels remain in ignored local cache.`,
  })),
  ...['front9', 'back9', 'mellan'].map(part => ({
    id: `lm-surface-review-${part}-2026-09-09`, kind: 'surface',
    path: `upsalabuild/mapping/lm-review-${part}-2026-09-09.json`, use: 'migration-only',
    notes: 'Manual source-image review with original boundaries, accepted local and EPSG:3006 vectors, pixel traces, image hashes, capture dates and interpretation uncertainty. No survey approval or hidden-boundary inference.',
  })),
  {
    id: 'lm-surface-review-validation-2026-09-09', kind: 'acquisition',
    path: 'upsalabuild/mapping/lm-review-validation-2026-09-09.json', use: 'discovery-evidence',
    notes: 'Independent source-hash, pixel-transform, polygon-topology and shared-adoption checks for the three accepted boundary ledgers. Numerical agreement is not independent survey accuracy.',
  },
];
for (const entry of entries) {
  const record = { ...entry, sha256: sha(entry.path), derivedFrom: ['imagery-lm-ortho', 'osm-legacy'] };
  const i = manifest.artifacts.findIndex(a => a.id === entry.id);
  if (i < 0) manifest.artifacts.push(record); else manifest.artifacts[i] = record;
}
for (const id of ['legacy-course-model', 'shipped-middle-course-model', 'migration-course-model-epsg3006', 'migration-mellanbanan-course-model-epsg3006']) {
  const artifact = manifest.artifacts.find(a => a.id === id);
  if (artifact && !artifact.derivedFrom.includes('imagery-lm-ortho')) artifact.derivedFrom.push('imagery-lm-ortho');
}
const blocker = manifest.blockers.find(b => b.id === 'authoritative-assets');
blocker.description = 'Terrain and bounded authenticated orthophoto windows are acquired and verified. Surface review is partial and independent source/control approval remains outstanding; acquisition does not establish surveyed geometry.';
blocker.exitGate = 'Complete the remaining source review and independent controls, and record explicit approval before treating any candidate as authoritative.';
assert.deepEqual(validateSourceManifest(manifest, {
  catalog: read('geo_data/course-v2/source-catalog.json'), repoRoot: root, label: file,
}), [], 'Upsala source-manifest validation failed');
fs.writeFileSync(path.join(root, file), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Registered verified Upsala orthophoto acquisition and reviewed boundary evidence.');
