import fs from 'node:fs';
import {sha256File} from '../../packages/course-geo/manifest.mjs';
// Preserve all other grounds, including work in progress in the shared registry.
for(const [slug,build,migration] of [
  ['johannesberg','johannesbergbuild','course-model'],
  ['johannesberg-9','johannesberg9build','nine-course-model'],
]) {
  const key=slug==='johannesberg'?'johannesberg':"'johannesberg-9'";
  for(const [file,pattern,digest] of [
    ['packages/course-geo/acquisition/hole-source-inventory.mjs',new RegExp(`(${key}: Object\\.freeze\\(\\{\\s+path: '${build}/course-model\\.json',\\s+sha256: ')[a-f0-9]{64}(')`),sha256File(`${build}/course-model.json`)],
    ['packages/course-geo/acquisition/hole-source-controls.mjs',new RegExp(`(${key}: ')[a-f0-9]{64}(')`),sha256File(`geo_data/course-v2/johannesberg/migration/${migration}.epsg3006.json`)],
  ]) {
    const before=fs.readFileSync(file,'utf8');
    if(!pattern.test(before))throw new Error(`Missing exact registry slot ${slug} in ${file}`);
    fs.writeFileSync(file,before.replace(pattern,(_,left,right)=>left+digest+right));
  }
}
console.log('Updated only the two Johannesberg model/migration registry slots');
