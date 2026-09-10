/* Re-pin Norrfallsviken's reviewed geometry without changing its control status. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../../packages/course-geo/manifest.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const file=path.join(root,'geo_data/course-v2/norrfallsviken/source-manifest.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
const imagery=manifest.sources.find(s=>s.id==='imagery-lm-ortho');
const acquisitionPath='geo_data/course-v2/norrfallsviken/reference/lm-ortho-acquisition-2026-09-09.json';
Object.assign(imagery,{
  lifecycle:'acquired',use:'supporting',
  sourceUri:'https://api.lantmateriet.se/stac-bild/v1/collections/orto-u2-2024',
  acquiredAt:'2026-09-09',capturedAt:'2024-06-27',
  localPath:acquisitionPath,checksum:sha256File(path.join(root,acquisitionPath)),checksumReason:null,
  notes:'The source checksum identifies the bounded acquisition index, which records each TIFF/RGB window hash; it is not a full remote COG checksum. Raw pixels remain in the ignored cache. Newest live-catalog coverage verified 2026-09-09: 0.16 m RGBI, one 2024-06-27 source campaign, 23 verified review windows. All playing greens, visible tee platforms, 17 fairway corridors and selected facilities are explicitly traced. Coast/beach/forest context was inspected against inherited mapping. Pixel resolution is not surveyed absolute accuracy. Colour-specific tee ownership, daily markers and facade dimensions are not independently verified.',
});
function register(id,relative,kind,use,notes) {
  const artifact={id,kind,path:relative,sha256:sha256File(path.join(root,relative)),derivedFrom:['imagery-lm-ortho'],use,notes};
  const index=manifest.artifacts.findIndex(a=>a.id===id);
  if(index<0)manifest.artifacts.push(artifact);else manifest.artifacts[index]=artifact;
}
for(const name of ['catalog','plan','acquisition','capture','validation']) register(`lm-orthophoto-${name}`,
  `geo_data/course-v2/norrfallsviken/reference/lm-ortho-${name}-2026-09-09.json`,name==='validation'?'control':'acquisition','discovery-evidence',
  'Pinned source identity, native pixel transforms, acquisition hashes and dated capture coverage; validation proves mechanical image registration, not survey accuracy.');
for(const name of ['front9','back9','fairways','environment']) register(`lm-orthophoto-review-${name}`,
  `nvgkbuild/mapping/review-${name}-2026-09-09.json`,'surface','migration-only',
  'Explicit source-pixel traces and EPSG:3006 coordinates, converted through the unchanged legacy frame. Tee-platform reference associations are interpretations, not daily colour-marker surveys.');
register('lm-geometry-validation','geo_data/course-v2/norrfallsviken/reference/lm-geometry-validation-2026-09-09.json','control','discovery-evidence',
  'Independent PROJ/Shapely verification of source hashes, panel transforms, valid polygons, source coverage, shared green, nominated tee-platform containment and millimetre conversion consistency.');
register('lm-vegetation-audit','geo_data/course-v2/norrfallsviken/reference/lm-vegetation-audit-2026-09-09.json','canopy','discovery-evidence',
  'Published laser crown/stand comparison against reviewed turf. Two tree centres and six canopy cells intersect fairway traces; all eight have native-image visual review and are retained as canopy/edge uncertainty. No putting-surface or tee-platform centre conflict.');
for(const artifact of manifest.artifacts) artifact.sha256=sha256File(path.join(root,artifact.path));
const model=manifest.artifacts.find(a=>a.id==='legacy-course-model');
if(!model.derivedFrom.includes('imagery-lm-ortho'))model.derivedFrom.push('imagery-lm-ortho');
model.notes='Compatibility model with reviewed 2024 LM playing surfaces, shared hole-4/8 green, explicit physical platforms, range facilities, selected ponds and roof plan sections. Official card metadata is preserved without fitting image geometry to distances. Laser terrain and published vegetation are retained. Remaining unreviewed features and illustrative daily markers/facade details do not carry a perfect-alignment claim.';
const assets=manifest.blockers.find(b=>b.id==='authoritative-assets');
if(assets) {
  assets.description='Dated 2024 orthophoto windows are acquired and reviewed for playing surfaces and selected facilities. Existing laser terrain/vegetation remain published. Field controls, obscured features, colour-specific daily tee markers and exact building heights remain unresolved; Topografi 10 has not been acquired.';
  assets.exitGate='Complete independent controls and remaining feature evidence before claiming a surveyed canonical model. Source-specific rights remain applicable.';
}
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(`Re-pinned Norrfallsviken source manifest (${manifest.artifacts.length} artifacts)`);
