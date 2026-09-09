import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File, validateSourceManifest } from '../../packages/course-geo/manifest.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prefix = 'geo_data/course-v2/angso/';
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT,file), 'utf8'));
const file = prefix+'source-manifest.json', manifest = read(file);
const acquisition = read(prefix+'reference/lm-ortho-acquisition-2026-09-09.json');
assert.equal(acquisition.state, 'acquired-for-review');
assert(acquisition.access.authorized && acquisition.windows.length === 19 && acquisition.windows.every(w => w.validFraction === 1));
const review = read('angsobuild/mapping/orthophoto-review.json');
const source = manifest.sources.find(s => s.id === 'imagery-lm-ortho');
Object.assign(source, {
  lifecycle: 'planned', use: 'candidate', capturedAt: '2025-04-24', acquiredAt: '2026-09-09',
  sourceUri: 'https://api.lantmateriet.se/stac-bild/v1/collections/orto-o2-2025',
  checksum: null, localPath: null,
  checksumReason: 'The whole-source lifecycle remains planned: full remote TIFFs were range-read, not hashed in full. All 18 native complete-hole windows and the overview ARE acquired and individually SHA-256 pinned in reference/lm-ortho-acquisition-2026-09-09.json.',
  notes: 'Verified 0.16 m RGBI imagery covers every hole; a 0.8 m overview provides context. Mosaic source polygons date every window to 2025-04-24. The accepted review replaces 18 greens, 16 fairway/approach outlines, 50 physical tee platforms, 33 bunkers and eight pond edges. Exact source pixels, capture evidence and uncertainties are retained. Fairway cuts on par-3 holes 12 and 15 remain legacy because spring imagery does not resolve them confidently. Colour identities of tee platforms remain unverified. Imagery is measurement input, never a runtime texture; independent control and absolute positional accuracy are not established.',
});
const entries = [
  ...['catalog','plan','acquisition','capture','validation'].map(part => ({id:`lm-ortho-${part}-2026-09-09`,kind:'acquisition',
    path:prefix+`reference/lm-ortho-${part}-2026-09-09.json`,use:'discovery-evidence',
    notes:`Authenticated orthophoto ${part} evidence, including immutable identifiers, dates, source grids and checksums.`})),
  {id:'lm-orthophoto-surface-review',kind:'surface',path:'angsobuild/mapping/orthophoto-review.json',use:'migration-only',
    notes:'Combined explicit pixel-edge boundary decisions with native image hashes, exact affines, per-part provenance and review limitations.'},
  ...review.parts.map((part,i) => ({id:`lm-orthophoto-review-part-${i+1}`,kind:'surface',path:part.path,use:'migration-only',
    notes:'Independent feature-class review containing original pixel decisions and interpretation notes.'})),
];
if (fs.existsSync(path.join(ROOT,'angsobuild/mapping/alignment-report.json'))) entries.push({
  id:'lm-orthophoto-alignment-audit',kind:'control',path:'angsobuild/mapping/alignment-report.json',use:'discovery-evidence',
  notes:'Independent PROJ verification of pixel-to-model coordinates, ring topology, reviewed/retained class inventory and explicit unresolved tee references. Numerical transform accuracy is not field survey accuracy.',
});
for (const entry of entries) {
  const artifact = {...entry,sha256:sha256File(path.join(ROOT,entry.path)),derivedFrom:['imagery-lm-ortho']};
  const index = manifest.artifacts.findIndex(a => a.id === artifact.id);
  if (index < 0) manifest.artifacts.push(artifact); else manifest.artifacts[index] = artifact;
}
for (const artifact of manifest.artifacts) {
  if (['legacy-course-model','legacy-marking','migration-course-model-epsg3006','migration-residual-report'].includes(artifact.id)) {
    artifact.sha256 = sha256File(path.join(ROOT,artifact.path));
    if (!artifact.derivedFrom.includes('imagery-lm-ortho')) artifact.derivedFrom.push('imagery-lm-ortho');
  }
}
manifest.artifacts.find(a => a.id==='legacy-course-model').notes = 'Composite compatibility model with explicit Lantmateriet image-reviewed playing boundaries and pond edges. Terrain retains its measured RH 2000 source. Published scorecard values are separate from physical route length; inferred tee references retain uncertainty.';
manifest.artifacts.find(a => a.id==='legacy-marking').notes = 'Rule-derived penalty/OB stakes regenerated around reviewed pond and fairway geometry. Stake positions remain inferred from club rules and legacy woodland evidence, not surveyed.';
manifest.artifacts.find(a => a.id==='migration-course-model-epsg3006').notes = 'Current composite model projected to absolute EPSG:3006 through PROJ/pyproj; horizontal vectors include reviewed orthophoto geometry. Independent canonical-origin control remains outstanding.';
const assets = manifest.blockers.find(b => b.id==='authoritative-assets');
assets.description = 'Terrain and all playing-ground orthophoto windows are acquired and verified; full source-file checksums, remaining topography and independent control approval are outstanding.';
assets.exitGate = 'Complete remaining source registration and independent controls; image sampling distance must not be presented as surveyed positional accuracy.';
const legacy = manifest.blockers.find(b => b.id==='legacy-imagery-rights');
legacy.description = 'Reviewed playing surfaces use Lantmateriet imagery, but retained fairway cuts on holes 12/15, legacy canopy, facilities and other surrounding derivatives still have older Esri/OSM lineage.';
legacy.exitGate = 'Resolve the remaining retained derivatives from approved sources or explicit production rights.';
assert.deepEqual(validateSourceManifest(manifest,{catalog:read('geo_data/course-v2/source-catalog.json'),repoRoot:ROOT,label:file}),[]);
fs.writeFileSync(path.join(ROOT,file),JSON.stringify(manifest,null,2)+'\n');
console.log('Updated Angso source evidence and current artifact hashes.');
