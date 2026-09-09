/* Re-pin only this ground after reviewed geometry and horizontal migration. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256File} from '../../packages/course-geo/manifest.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const file=path.join(root,'geo_data/course-v2/johannesberg/source-manifest.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
const acquisition=JSON.parse(fs.readFileSync(path.join(root,'geo_data/course-v2/johannesberg/reference/lm-ortho-acquisition-2026-09-09.json'),'utf8'));
const imagery=manifest.sources.find(s=>s.id==='imagery-lm-ortho');
Object.assign(imagery,{
  sourceUri:'https://api.lantmateriet.se/stac-bild/v1/collections/orto-o2-2025',
  acquiredAt:'2026-09-09',capturedAt:'2025-06-14',
  checksumReason:'Bounded RGBI windows were acquired and individually hashed; complete remote COGs were range-read, not downloaded and hashed in full. Exact source/grid/PNG/TIFF evidence is registered in the reference acquisition artifacts.',
  notes:`${acquisition.windows.length} authenticated RGBI review windows cover both courses and estate facilities. Native source pixels are 0.16 m; whole-hole context is 0.32 m and the estate overview is 0.8 m. Published mosaic seam metadata dates all acquired pixels to 2025-06-14. Reviewed vector corrections are applied before both compatibility models are written. Raw imagery remains in the ignored local cache. Ground sample distance is not absolute positional accuracy; no independent horizontal controls or daily tee-colour survey are claimed.`,
});
for(const [name,kind,use,note] of [
  ['catalog','acquisition','discovery-evidence','Live STAC latest complete campaign selection and unchanged source asset identities.'],
  ['plan','acquisition','discovery-evidence','Pinned baseline models, review windows, exact source pixel grids and native source identities.'],
  ['acquisition','acquisition','discovery-evidence','Authenticated bounded acquisition; all RGBI window hashes, transforms and coverage.'],
  ['capture','acquisition','discovery-evidence','Per-window mosaic-source intersections; all acquired imagery captured 2025-06-14.'],
  ['validation','control','discovery-evidence','Offline hashes, exact PNG/TIFF RGB equality, independent masks, CRS, transforms and worldfile checks.'],
]) {
  const relative=`geo_data/course-v2/johannesberg/reference/lm-ortho-${name}-2026-09-09.json`;
  const artifact={id:`lm-orthophoto-${name}`,kind,path:relative,sha256:sha256File(path.join(root,relative)),derivedFrom:['imagery-lm-ortho'],use,notes:note};
  const index=manifest.artifacts.findIndex(a=>a.id===artifact.id);
  if(index>=0)manifest.artifacts[index]=artifact;else manifest.artifacts.push(artifact);
}
for(const name of ['front9','back9','back9-turf','nine','estate']) {
  const relative=`johannesbergbuild/mapping/lm-review-${name}.json`;
  const artifact={id:`lm-orthophoto-review-${name}`,kind:'surface',path:relative,sha256:sha256File(path.join(root,relative)),derivedFrom:['imagery-lm-ortho'],use:'migration-only',notes:'Explicit visually reviewed vector boundaries with original-geometry pins, source hashes, capture dates, source-pixel coordinates and interpretation uncertainty. Compatibility geometry; no surveyed canonical-origin claim.'};
  const index=manifest.artifacts.findIndex(a=>a.id===artifact.id);
  if(index>=0)manifest.artifacts[index]=artifact;else manifest.artifacts.push(artifact);
}
for (const [id,relative,kind,note] of [
  ['lm-alignment-validation','johannesbergbuild/mapping/lm-alignment-validation.json','control','Source byte checks, pixel-to-vector round trips, actual generated model identity, valid targets, and exact shared scenery. Mechanical registration only; not independently surveyed absolute accuracy.'],
  ['lm-vegetation-surface-audit','geo_data/course-v2/johannesberg/reference/lm-vegetation-surface-audit-2026-09-09.json','canopy','Published crown and stand-cell comparison with accepted playing surfaces and dated imagery. Individual measured crowns are retained.'],
  ['lm-stand-exclusion-review','johannesbergbuild/mapping/lm-review-stand-exclusions.json','canopy','Four exact stand cells visibly on clear 2025 turf; source chunk and image hashes pin the exclusion decision.'],
  ['lm-stand-exclusion-publication','geo_data/course-v2/johannesberg/reference/lm-stand-exclusions-publication-2026-09-09.json','canopy','Exactly four exclusion flag bytes changed across three stand chunks; all tree objects, measurements, terrain, frame and other cells are preserved.'],
]) {
  if(!fs.existsSync(path.join(root,relative)))continue;
  const artifact={id,kind,path:relative,sha256:sha256File(path.join(root,relative)),derivedFrom:['imagery-lm-ortho'],use:'discovery-evidence',notes:note};
  const index=manifest.artifacts.findIndex(a=>a.id===id);
  if(index>=0)manifest.artifacts[index]=artifact;else manifest.artifacts.push(artifact);
}
for(const artifact of manifest.artifacts) artifact.sha256=sha256File(path.join(root,artifact.path));
for(const id of ['legacy-course-model','legacy-nine-course-model']) {
  const artifact=manifest.artifacts.find(a=>a.id===id);
  if(!artifact.derivedFrom.includes('imagery-lm-ortho'))artifact.derivedFrom.push('imagery-lm-ortho');
  artifact.notes='Legacy compatibility model with reviewed 2025 Lantmateriet playing-surface geometry. Official card values and unresolved tee-marker assignments remain separate from photographed physical surface boundaries.';
}
const assets=manifest.blockers.find(b=>b.id==='authoritative-assets');
assets.description='Shared 1 m RH 2000 terrain and 2021 Laserdata Skog are acquired. Authenticated 2025 orthophoto windows have been acquired, checked and used for reviewed playing surfaces and estate corrections. Topografi 10 remains unacquired; the independent canonical-origin gate is unchanged.';
assets.exitGate='Acquire any remaining required source windows and complete independent controls before claiming a surveyed canonical model. Retain source-specific redistribution terms.';
const routing=manifest.blockers.find(b=>b.id==='nine-hole-routing');
routing.description='All nine putting surfaces are now traced from 2025 orthophotos, including large corrections to inherited GPS/laser placeholders. Official tee-colour ownership, canopy-obscured platforms and independent route controls remain unresolved.';
const rights=manifest.blockers.find(b=>b.id==='legacy-imagery-rights');
rights.description='Reviewed playing surfaces and estate corrections now use dated Lantmateriet source windows. Some obscured surfaces, surroundings and the legacy fallback canopy remain inherited; the published measured vegetation uses Laserdata Skog.';
rights.exitGate='Resolve the remaining inherited features with approved imagery or field evidence before treating the complete estate as independently remapped.';
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(`Re-pinned Johannesberg source manifest (${manifest.artifacts.length} artifacts)`);
