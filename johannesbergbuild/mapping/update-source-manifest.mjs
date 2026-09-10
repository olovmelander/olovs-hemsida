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
  notes:`The initial ${acquisition.windows.length} authenticated RGBI review windows cover both courses and estate facilities; supplementary tee-platform and OB windows are pinned in their separate review/acquisition artifacts. Native source pixels are 0.16 m; whole-hole context is 0.32 m and the estate overview is 0.8 m. Reviewed pixels are dated 2025-06-14. Both compatibility models consume the reviewed geometry and explicit tee references. Raw imagery remains in the ignored local cache. Ground sample distance is not absolute positional accuracy; tee-colour ownership is reviewed or explicitly inferred, while daily tee-marker and individual OB-post positions are not surveyed.`,
});
const guide=manifest.sources.find(s=>s.id==='club-guide-legacy');
Object.assign(guide,{
  sourceUri:'https://johannesbergsgolf.se/vara-banor/banguide/',acquiredAt:'2026-09-09',
  checksumReason:'Individual club hole-plan snapshots and current local-rules page hashes are retained in the tee and OB review ledgers; there is no single combined guide asset checksum.',
  notes:'The club plans support the main course tee-colour topology and five reviewed OB display corridors. They do not establish daily marker positions, individual post spacing or surveyed boundary vertices. No club nine-hole colour map was found; its 15 accepted colour references are explicitly inferred from visible mat locations, corridor association and published Yellow/Red order.',
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
for(const name of ['front9','back9','back9-turf','nine','estate','tee-platforms']) {
  const relative=`johannesbergbuild/mapping/lm-review-${name}.json`;
  const artifact={id:`lm-orthophoto-review-${name}`,kind:'surface',path:relative,sha256:sha256File(path.join(root,relative)),derivedFrom:['imagery-lm-ortho'],use:'migration-only',notes:'Explicit visually reviewed vector boundaries with original-geometry pins, source hashes, capture dates, source-pixel coordinates and interpretation uncertainty. Compatibility geometry; no surveyed canonical-origin claim.'};
  const index=manifest.artifacts.findIndex(a=>a.id===artifact.id);
  if(index>=0)manifest.artifacts[index]=artifact;else manifest.artifacts.push(artifact);
}
for(const [id,relative,kind,derivedFrom,note]of [
  ['lm-tee-placement-review','johannesbergbuild/mapping/tee-placement-review.json','routing',['imagery-lm-ortho','club-guide-legacy'],'Explicit main-course tee references: 73 on nominated physical platforms, eight on fairway, two inside bounded mown-ground review areas, and seven unresolved references that cannot render physical markers. Club-guide topology supports colour associations; daily marker positions remain illustrative.'],
  ['lm-nine-tee-placement-review','johannesbergbuild/mapping/tee-placement-nine-review.json','routing',['imagery-lm-ortho','club-guide-legacy'],'Fifteen visible-mat references with explicitly inferred Yellow/Red ownership and unique platform identities. Yellow on holes 1, 2 and 6 remains unresolved and produces no physical marker. Original inherited references are retained as provenance, not used for nearest-platform snapping.'],
  ['lm-ob-placement-review','johannesbergbuild/mapping/ob-placement-review.json','topography',['imagery-lm-ortho','club-guide-legacy'],'Five club-guide-supported OB display corridors on holes 2, 4, 10, 16 and 18, aligned to visible landscape features. The 101 posts use illustrative 12 m spacing plus line corners; no individual post survey or legal-boundary measurement is claimed. Hole 3 remains unpublished. Hole 18 stops at the reviewed dry bank, with its northern continuation through the open-water junction unresolved. No new nine-hole OB is inferred.'],
  ['lm-ob-orthophoto-acquisition','johannesbergbuild/mapping/ob-orthophoto-acquisition.json','acquisition',['imagery-lm-ortho'],'Authenticated supplemental native 0.16 m RGBI window for the hole-3 OB review, with source identities, byte/image hashes, grid, mask and 2025-06-14 capture evidence. Acquisition did not resolve the corridor, which remains unpublished.'],
]) {
  const artifact={id,kind,path:relative,sha256:sha256File(path.join(root,relative)),derivedFrom,use:kind==='acquisition'?'discovery-evidence':'migration-only',notes:note};
  const index=manifest.artifacts.findIndex(a=>a.id===id);
  if(index>=0)manifest.artifacts[index]=artifact;else manifest.artifacts.push(artifact);
}
for (const [id,relative,kind,note] of [
  ['lm-alignment-validation','johannesbergbuild/mapping/lm-alignment-validation.json','control','Source byte checks, pixel-to-vector round trips, generated model identity, accepted/unresolved tee policy, actual marker-ball containment and colour separation, reviewed OB corridor/post policy, valid targets and shared scenery. Mechanical registration only; not independently surveyed absolute accuracy.'],
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
  if(!artifact.derivedFrom.includes('club-guide-legacy'))artifact.derivedFrom.push('club-guide-legacy');
  artifact.notes='Compatibility model with reviewed 2025 Lantmateriet surfaces and explicit tee references. Accepted mark.c values follow placement ledgers; inherited coordinates remain in orthophotoReference.originalReference.c. Across both courses there are 50+15 physical/inherited platforms, 98 accepted references (88 tee, eight fairway, two bounded mown areas), 196 illustrative marker balls and ten unresolved references without physical markers. Official card values are preserved. Five reviewed main-course OB display corridors carry 101 illustrative posts; hole 3, the northern continuation of hole 18 beyond the dry bank and nine-hole-specific OB remain unresolved.';
}
const assets=manifest.blockers.find(b=>b.id==='authoritative-assets');
assets.description='Shared 1 m RH 2000 terrain and 2021 Laserdata Skog are acquired. Authenticated 2025 orthophoto windows support reviewed playing surfaces, explicit tee references, five OB display corridors and estate corrections. Ten tee references, the hole-3 OB corridor and the northern hole-18 continuation beyond the dry bank remain unresolved; daily markers and individual posts are not surveyed. Topografi 10 remains unacquired; the independent canonical-origin gate is unchanged.';
assets.exitGate='Acquire any remaining required source windows and complete independent controls before claiming a surveyed canonical model. Retain source-specific redistribution terms.';
const routing=manifest.blockers.find(b=>b.id==='nine-hole-routing');
routing.description='All nine putting surfaces and 15 physical platforms are traced from 2025 orthophotos. Fifteen accepted Yellow/Red mat references have explicitly inferred ownership; Yellow on holes 1, 2 and 6 remains unresolved. Accepted back-tee references update route starts without altering the official card. Club-confirmed colour ownership, remaining back platforms and independent route controls are still required.';
const rights=manifest.blockers.find(b=>b.id==='legacy-imagery-rights');
rights.description='Reviewed playing surfaces and estate corrections now use dated Lantmateriet source windows. Some obscured surfaces, surroundings and the legacy fallback canopy remain inherited; the published measured vegetation uses Laserdata Skog.';
rights.exitGate='Resolve the remaining inherited features with approved imagery or field evidence before treating the complete estate as independently remapped.';
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(`Re-pinned Johannesberg source manifest (${manifest.artifacts.length} artifacts)`);
