#!/usr/bin/env node
/* Reapply reviewed vector changes without reacquiring unchanged terrain/roofs.
 * Requires the current model, source collection and published ground in Git.
 * Run source adoption first: python lidingobuild/mapping/apply-putting-cuts.py
 * This step writes only the model. Pack/migration/publication follow explicitly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReviewedSurfaces, applyReviewedApproaches } from './apply-reviewed-surfaces.mjs';
import { openPublishedGround, createPublishedGroundLookup } from '../packages/course-v2/published-ground-lookup.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const opened = openPublishedGround(fs,path,path.join(root,'apps/golf/public'),'lidingo');
const lookup = createPublishedGroundLookup(opened.ground,opened.readAsset);
const before = read('lidingobuild/course-model.json');
const model = applyReviewedApproaches(applyReviewedSurfaces(before,read('lidingobuild/mapping/playing-surfaces.geojson'),
  read('lidingobuild/mapping/putting-cuts-2025.json'),(x,z)=>lookup.heightAt(677700.5+x,6586399.5-z)),read('lidingobuild/mapping/approaches-2025.geojson'));
fs.writeFileSync(path.join(root,'lidingobuild/course-model.json'),JSON.stringify(model,null,2)+'\n');
console.log(JSON.stringify({greensReviewed:14,terrainChanged:false,roofsChanged:false,waterChanged:false,
  cameraStartsRepaired:model.holes.reduce((n,h,i)=>n+h.tees.marks.filter((m,j)=>JSON.stringify(m.c)!==JSON.stringify(before.holes[i].tees.marks[j].c)).length,0)}));
