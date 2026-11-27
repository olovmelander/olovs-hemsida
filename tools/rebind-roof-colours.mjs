#!/usr/bin/env node
/* Re-pin a ground's measured roof colours to its republished pack, when the pack's
   buildings did not change.

   The roof colours (geobuild/facilities/roof-colours.py) are read off the orthophoto
   for each footprint the pack maps, and pinned to the pack's hash; house-kit.test.mjs
   fails when the pack moves on. A pack republished for something else -- Veckefjärden's
   white stakes, 27 November 2026 -- keeps every footprint, so measuring the roofs again
   (a credentialed download of the flights) would read the same pixels. This proves that
   instead: every footprint in the new pack has the ringCheck its roof was measured on,
   and there are as many of them. Only then does it move the pin, in the review record
   and in the runtime file, and nothing else. A changed footprint refuses: measure again.

     node tools/rebind-roof-colours.mjs --ground veckefjarden [--slug veckefjarden] [--write] */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ringCheck } from '../apps/golf/src/engine/house-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const ground = flag('ground');
if (!ground) { console.error('usage: node tools/rebind-roof-colours.mjs --ground <id> [--slug <first layout>] [--write]'); process.exit(2); }
const slug = flag('slug', ground);

const runtimeFile = path.join(ROOT, `apps/golf/src/engine/scenery/${ground}-roof-colours.json`);
const runtimeText = fs.readFileSync(runtimeFile, 'utf8');
const runtime = JSON.parse(runtimeText);
const reviewFile = path.join(ROOT, runtime.review);
const reviewText = fs.readFileSync(reviewFile, 'utf8');
const review = JSON.parse(reviewText);
if (runtime.packSha256 !== review.packSha256) throw new Error(`${ground}: the runtime file and its review are pinned to different packs`);

const bytes = fs.readFileSync(path.join(ROOT, `apps/golf/public/courses/${slug}/pack.bin`));
const packSha256 = createHash('sha256').update(bytes).digest('hex');
const headerBytes = bytes.readUInt32LE(4), header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString('utf8'));
const at = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
const buildings = JSON.parse(zlib.inflateRawSync(bytes.subarray(at, at + header.VEC.bytes)).toString('utf8')).infra?.buildings || [];

if (buildings.length !== review.buildings.length) throw new Error(`${slug}: ${buildings.length} footprints, the roofs were measured on ${review.buildings.length}: measure again`);
const moved = review.buildings.filter(b => ringCheck(buildings[b.index]?.ring) !== b.ringCheck);
if (moved.length) throw new Error(`${slug}: ${moved.length} footprints changed (first: index ${moved[0].index}): measure again`);

if (packSha256 === runtime.packSha256) { console.log(`${ground}: already pinned to ${packSha256.slice(0, 12)}`); process.exit(0); }
console.log(`${ground}: all ${buildings.length} footprints of ${slug} are the ones measured; pin ${runtime.packSha256.slice(0, 12)} -> ${packSha256.slice(0, 12)}`);
if (!process.argv.includes('--write')) { console.log('dry run: add --write to move the pin'); process.exit(0); }
const repin = text => {
  const next = text.replace(`"packSha256": "${runtime.packSha256}"`, `"packSha256": "${packSha256}"`);
  if (next === text) throw new Error('the pin was not found in its file');
  return next;
};
fs.writeFileSync(reviewFile, repin(reviewText));
fs.writeFileSync(runtimeFile, repin(runtimeText));
console.log(`wrote ${path.relative(ROOT, reviewFile)} and ${path.relative(ROOT, runtimeFile)}`);
