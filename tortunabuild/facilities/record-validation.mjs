/* Record the completed checks and pin the exact reviewed facility delivery. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=new URL('../../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root));
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=file=>JSON.parse(read(file));
const pin=file=>({file,bytes:read(file).length,sha256:hash(read(file))});
const out='tortunabuild/facilities/';
const before=json(out+'browser/report.json'),final=json(out+'browser-final/report.json');
const blend=json(out+'blend-inspection.json'),source=json(out+'source-preservation-check.json');
assert.ok(before.passed&&final.passed&&blend.passed&&source.passed);
assert.equal(before.modes[0].views.length,5);
assert.equal(final.modes[0].views.length,2);
assert.deepEqual(final.modes.map(m=>m.mode),['authored','source','failed-load']);
const exported=json(out+'model-export.json');
const publication=json(out+'published-models.json');
assert.deepEqual(publication.buildings,exported.buildings);
const descriptors=final.expected.records.map(r=>r.descriptor);
assert.equal(descriptors.length,8);
for(const row of exported.buildings){
  assert.deepEqual(descriptors.find(d=>d.buildingId===row.buildingId).asset,row.asset);
  assert.equal(hash(read('apps/golf/public/'+row.asset.url)),row.asset.sha256);
  assert.equal(hash(read('apps/golf/dist/'+row.asset.url)),row.asset.sha256);
  if(row.buildingId!=='way/1163533128')assert.deepEqual(before.expected.records.find(r=>r.descriptor.buildingId===row.buildingId).descriptor.asset,row.asset);
}
for(const row of source.sources)assert.equal(hash(read(row.file)),row.sha256);
for(const row of publication.evidence)assert.equal(hash(read(row.file)),row.sha256);
const log=file=>{const b=read('tortunabuild/cache/facilities/'+file);return b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8');};
assert.match(log('app-build.log'),/built in/);
assert.match(log('app-check.log'),/app isolation passed/);
assert.match(log('renderer-check.log'),/renderer build passed/);
assert.match(log('unit-tests.log'),/7 passed/);
const evidence=['model-export.json','published-models.json','source-preservation-check.json','blend-inspection.json',
  'tortuna-facilities.blend','browser/report.json','browser-final/report.json',
  ...exported.buildings.map(r=>r.label+'.png'),
  ...before.modes[0].views.map(v=>'browser/'+v.image),
  ...final.modes[0].views.map(v=>'browser-final/'+v.image)];
const report={schemaVersion:1,date:new Date().toISOString(),passed:true,
  newBuildings:7,totalAuthoredBuildings:8,assetBytes:exported.totalAssetBytes,triangles:exported.totals.triangles,
  checks:{blenderScenesAndAnchors:true,sourceGeometryPreserved:true,allFinalAssetsInProductionBuild:true,
    authoredLoaderUnitTests:7,browserModes:final.modes.map(m=>({mode:m.mode,passed:m.passed})),
    appBuild:true,appBundleCheck:true,rendererBundleCheck:true},
  browserReview:'Five initial cluster views; final front views and all eight identities/fallbacks rechecked after entry bay refinement. Six other facility assets unchanged.',
  limitations:['Three facades use unverified neutral display defaults','Opening dimensions and material colours are architectural estimates','Software WebGL2 checks are not native-device performance evidence'],
  finalRuntimeStats:final.modes[0].views[0].state.stats,evidence:evidence.map(file=>pin(out+file))};
fs.writeFileSync(fileURLToPath(new URL(out+'validation.json',root)),JSON.stringify(report,null,2)+'\n');
console.log(`PASS: seven facility models, eight authored buildings, final assets and review files pinned`);
