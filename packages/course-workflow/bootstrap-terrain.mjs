#!/usr/bin/env node
/* A FIRST GENERATION'S TERRAIN, STAGED BEFORE ANYTHING IS PUBLISHED.

   The canopy reader compares the laser's ground with the terrain the app will
   draw, and the production stages pin the canopy evidence: on a new ground each
   waited for the other. This compiles the retained rings with the same compiler
   the `terrain` stage uses, checks every LOD0 sample against the raw raster, and
   writes it under output/ for `build-canopy.mjs --ground-document`.

   node packages/course-workflow/bootstrap-terrain.mjs --ground <id> --origin-height <RH2000, 2 decimals>

   Nothing here is published, and the `terrain` stage compiles the same bytes again. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compileTerrainRings } from '../course-v2/terrain-rings.mjs';
import { ringSpecFor } from '../course-v2/ground-rings-registry.mjs';
import { canonicalJson } from '../course-v2/canonical-json.mjs';
import { compareFinest } from './production-stages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The immutable ground frame, with the fingerprint every ground record carries. */
export function groundFrame(spec, originHeightRH2000) {
  assert(Number.isFinite(originHeightRH2000) && Math.abs(originHeightRH2000 * 100 - Math.round(originHeightRH2000 * 100)) < 1e-6,
    'the origin height is stated to the centimetre');
  const frame = {
    axisMapping: { worldX: 'easting - originEasting', worldY: 'heightRH2000 - originHeightRH2000', worldZ: 'originNorthing - northing' },
    compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006',
    origin: { easting: spec.centre.easting, heightRH2000: originHeightRH2000, northing: spec.centre.northing },
    verticalCrs: 'EPSG:5613',
  };
  return { ...frame, fingerprint: sha256(canonicalJson(frame)) };
}

function main(argv) {
  const value = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
  const groundId = value('--ground');
  const spec = ringSpecFor(groundId);
  const frame = groundFrame(spec, Number(value('--origin-height')));
  const cache = path.join(ROOT, value('--cache') || `packages/course-geo/toolchain/.cache/acquisition/${groundId}-ground-rings`);
  const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, `geo_data/course-v2/${groundId}/acquisition/ground-rings.json`), 'utf8'));
  const levels = spec.levels.map(level => {
    const row = evidence.levels.find(x => x.lod === level.lod);
    const bytes = fs.readFileSync(path.join(cache, `l${level.lod}.f32`));
    assert.equal(sha256(bytes), row.rasterSha256, `l${level.lod}: raster differs from its acquisition record`);
    const side = level.tilesPerSide * spec.tileSegments + 1;
    const heights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.equal(heights.length, side * side);
    return { ...level, heights };
  });
  const middle = levels[0].heights[(levels[0].tilesPerSide * spec.tileSegments / 2) * (levels[0].tilesPerSide * spec.tileSegments + 1) + levels[0].tilesPerSide * spec.tileSegments / 2];
  assert(Math.abs(middle - frame.origin.heightRH2000) <= 0.006, `the terrain at the origin is ${middle.toFixed(4)} m, not ${frame.origin.heightRH2000}`);
  const compiled = compileTerrainRings({ groundId, courseSlugs: spec.courseSlugs, levels, tileSegments: spec.tileSegments });
  const check = compareFinest({ spec, config: { baselineGround: null, firstGenerationPolicy: 'initial-source-compilation', terrain: { maximumBaselineDifferenceMetres: 0.0055 } } }, compiled, levels);
  const out = path.join(ROOT, `output/course-workflow/${groundId}/bootstrap`);
  fs.mkdirSync(out, { recursive: true });
  for (const [url, bytes] of compiled.resources) {
    const file = path.join(out, url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  const document = { groundId, courseSlugs: [...spec.courseSlugs], frame, bounds: compiled.bounds, shell: compiled.shell, tiles: compiled.tiles };
  fs.writeFileSync(path.join(out, 'ground.json'), `${JSON.stringify(document, null, 1)}\n`);
  console.log(JSON.stringify({ groundId, tiles: compiled.tiles.length, frame, check, out: path.relative(ROOT, out) }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
