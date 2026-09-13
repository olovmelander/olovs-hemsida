import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('docs/graphics/tree-palette-2026-09-13');
const read=name=>JSON.parse(fs.readFileSync(path.join(out,`${name}-validation.json`),'utf8'));
const cases=['puttom-final','upsala-final','angso-final','upsala-low','upsala-natural','puttom-day-review','puttom-direct-day'];
const browser=cases.map(name=>{
  const r=read(name);assert.deepEqual(r.errors,[]);assert(!r.failure);
  assert.equal(r.backend,'webgpu');
  assert.equal(r.modes.length,name.includes('day-review')?2:name.includes('direct-day')?1:8);
  assert(r.modes.every(m=>m.audit.ok));
  for(const m of r.modes)assert(fs.existsSync(path.join(out,m.screenshot)));
  return{name,backend:r.backend,modes:r.modes.map(m=>m.mode),errors:0};
});
const unchanged=[];
for(const course of ['puttom','upsala']){
  const before=read(`${course}-before`),after=read(`${course}-final`);
  assert.deepEqual(before.camera,after.camera);assert.deepEqual(before.triangles,after.triangles);
  unchanged.push({course,identicalCamera:true,identicalTreeTriangles:true});
}
const tiers=read('upsala-final').tiers;assert.equal(tiers.length,4);assert(tiers.every(t=>t.audit.ok));
const species=[...new Set(read('angso-final').inventory.map(m=>m.key).filter(Boolean))].sort();assert.equal(species.length,5);
const report={browser,comparisons:unchanged,autumnTiers:tiers.map(t=>({tier:t.tier,ok:t.audit.ok})),species,
  checks:{relevantUnitTests:{files:11,passed:72},afterDayTurfAdjustment:{files:3,passed:17},
    productionBuild:{exitCode:0,publicDataCopied:false,log:'output/witness-palette-build.log'},
    mainAndGroundLint:'passed',interactiveReview:{selections:24,errors:0}},
  limits:['Desktop Chrome WebGPU; low quality is a 390x844 desktop viewport, not a physical-phone benchmark.',
    'Three representative courses were visually reviewed; the shared palette is used by every course in painted mode.']};
fs.writeFileSync(path.join(out,'validation-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Validated ${browser.reduce((n,r)=>n+r.modes.length,0)} atmosphere captures, four tree tiers and five species.`);
