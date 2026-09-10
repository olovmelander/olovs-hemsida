/* Register the coastal intake without changing course controls or terrain. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256File,validateSourceManifest} from '../../packages/course-geo/manifest.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ledger=path.join(root,'geo_data/course-v2/norrfallsviken/source-manifest.json');
const reportPath='geo_data/course-v2/norrfallsviken/reference/lm-marine-water-2026-09-09.json';
const report=JSON.parse(fs.readFileSync(path.join(root,reportPath),'utf8'));
const manifest=JSON.parse(fs.readFileSync(ledger,'utf8'));
const source={id:'water-breaks-lm-1m',productId:'lantmateriet-markhojdmodell-1m',roles:['hydrology','topography'],
 lifecycle:'acquired',use:'supporting',sourceUri:report.sources[0].url,localPath:reportPath,bboxWgs84:null,
 acquiredAt:report.acquiredAt.slice(0,10),capturedAt:null,checksum:sha256File(path.join(root,reportPath)),checksumReason:null,
 replacementSourceId:null,accuracyTier:'unrated',horizontalAccuracyMetres:null,verticalAccuracyMetres:null,
 notes:'The checksum pins an acquisition index containing the four original GPKG hashes. LM Markhojdmodell water breakgeometry, CC BY 4.0. Native sea boundaries and 57 mapped island polygons are preserved. Older-campaign gaps use connected unmodified 4 m terrain contours at RH2000 <=0.15 m; enclosed non-source dry artefacts <=0.8 m are filtered and two historically imaged open-sea rectangles are filled. The outer mainland contour stays at 0.15 m and all source island holes are restored. Gap coverage is inferred, not surveyed coastline. One common -0.03 m RH2000 sea display reference; no bathymetry or source terrain changes.'};
const put=(list,value)=>{const i=list.findIndex(x=>x.id===value.id);if(i<0)list.push(value);else list[i]=value;};
put(manifest.sources,source);
const imageryPath='geo_data/course-v2/norrfallsviken/reference/lm-marine-gap-orthophotos-2026-09-09.json';
const imagery=JSON.parse(fs.readFileSync(path.join(root,imageryPath),'utf8'));
put(manifest.sources,{...source,id:'imagery-lm-marine-2012',productId:'lantmateriet-ortofoto',roles:['imagery','hydrology'],
 sourceUri:imagery.windows[0].url,localPath:imageryPath,capturedAt:'2012-05-27',checksum:sha256File(path.join(root,imageryPath)),
 notes:'Dated LM RGB orthophotos at 0.5 m source resolution, acquired as bounded 1/2 m review windows. Visual inspection confirms open sea in two missing breakgeometry rectangles, including a false northern DTM land patch. Source windows and image hashes are recorded in the review; historical evidence, not a current waterline survey. CC BY 4.0.'});
for(const [id,kind,relative,notes] of [
 ['lm-marine-water-acquisition','acquisition',reportPath,'Original source identities, campaign gaps, connected terrain fallback, protected island probes and exact band topology validation.'],
 ['lm-marine-water-runtime','topography','apps/golf/public/'+report.artifact.url,'Compressed runtime sea polygons and disjoint shore bands in EPSG:3006, including island holes and explicit fallback provenance. Display geometry; ground chunks remain unchanged.'],
 ['lm-marine-gap-orthophotos','control',imageryPath,'Dated orthophoto windows, source identities and visual open-sea findings for two campaign gaps.'],
 ['lm-marine-runtime-validation','control','nvgkbuild/mapping/coastal-runtime-validation.json','Independent actual-runtime triangulation area, marine triangle containment and mapped-island probe validation.'],
])put(manifest.artifacts,{id,kind,path:relative,sha256:sha256File(path.join(root,relative)),
 derivedFrom:['water-breaks-lm-1m','terrain-lm-1m','imagery-lm-marine-2012'],use:'discovery-evidence',notes});
const sandPath='nvgkbuild/mapping/storsanden-sand-review.json';
put(manifest.artifacts,{id:'lm-storsanden-sand-review',kind:'surface',path:sandPath,sha256:sha256File(path.join(root,sandPath)),
 derivedFrom:['imagery-lm-ortho'],use:'discovery-evidence',notes:'Visible sand corridor from waterline into dune opening traced on the 2024-06-27 native RGBI review panel. Terrain tint blends at the vegetation edge; measured trees are retained. Dated interpretation, not a shoreline survey.'});
const errors=validateSourceManifest(manifest,{repoRoot:root,catalog:JSON.parse(fs.readFileSync(path.join(root,'geo_data/course-v2/source-catalog.json'),'utf8'))});
if(errors.length)throw new Error(errors.join('\n'));
fs.writeFileSync(ledger,JSON.stringify(manifest,null,2)+'\n');
console.log(`Norrfallsviken coastal source ledger verified: ${manifest.artifacts.length} artifacts`);
