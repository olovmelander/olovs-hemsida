#!/usr/bin/env node
/* Fold the measured surfaces of sat-shapes.json into the course model.

   Today that is the bunkers: every hole's bunker set is REPLACED by the sand
   bunkers detect-sand.mjs measured and the review accepted, as ellipses at the
   pixel centroid with the pixel-covariance axes. Guide bunkers that resolved to
   no sand are dropped, not guessed — they are listed in the trace file under
   unresolvedGuideBunkers so the decision is reviewable.

   Idempotent (the bunker set is derived from sat-shapes.json alone). Order:
     build-course.mjs -> apply-sat-shapes.mjs -> apply-surroundings.mjs
   (apply-surroundings burns bunker rings open in tree-cover, so it runs last). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polyArea, r1 } from '../geobuild/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const model = readJson(path.join(HERE, 'course-model.json'));
const shapes = readJson(path.join(HERE, 'sat-shapes.json'));
/* counted from the guide, not from the model being rewritten, so reruns agree */
const guideBunkerCount = readJson(path.join(HERE, 'guide-notes.json')).holes
  .reduce((sum, hole) => sum + hole.bunkers.length, 0);

function ellipse(c, major, minor, angleDeg, count = 14) {
  const a = angleDeg * Math.PI / 180;
  const ux = Math.cos(a), uz = Math.sin(a), rx = -uz, rz = ux;
  return Array.from({ length: count }, (_, index) => {
    const t = index / count * Math.PI * 2;
    return [r1(c[0] + ux * Math.cos(t) * major / 2 + rx * Math.sin(t) * minor / 2),
      r1(c[1] + uz * Math.cos(t) * major / 2 + rz * Math.sin(t) * minor / 2)];
  });
}

const PROV = 'Esri z18 sand classification (detect-sand.mjs), pixel centroid + covariance axes; reviewed; migration-only';
const before = guideBunkerCount;
let after = 0;
for (const hole of model.holes) {
  const measured = shapes.bunkers.filter(b => b.hole === hole.n);
  hole.bunkers = measured.map(b => {
    const ring = ellipse(b.c, b.major, b.minor, b.angleDeg);
    return { ring, c: [r1(b.c[0]), r1(b.c[1])], prov: PROV,
      areaMeasured: b.area, areaRing: Math.round(Math.abs(polyArea(ring))), confidence: b.confidence };
  });
  after += hole.bunkers.length;
  /* A measured bunker must not sit on its own green or a tee pad — that would
     mean the classifier caught a pale collar or deck, not sand. */
  for (const bunker of hole.bunkers) {
    const dGreen = Math.hypot(bunker.c[0] - hole.green.c[0], bunker.c[1] - hole.green.c[1]);
    if (dGreen < 9) throw new Error(`hole ${hole.n}: measured bunker at ${bunker.c} sits on the green centre (${dGreen.toFixed(1)} m)`);
  }
}

model.evidence.bunkers = {
  source: shapes.source,
  method: shapes.method,
  measured: after,
  guideInterpretedBefore: before,
  unresolvedGuideBunkers: shapes.unresolvedGuideBunkers,
};

fs.writeFileSync(path.join(HERE, 'course-model.json'), JSON.stringify(model));
console.log(`bunkers: ${before} guide-formula -> ${after} measured (${shapes.unresolvedGuideBunkers.length} guide entries resolved to no sand and dropped)`);
for (const hole of model.holes) {
  console.log(`  hole ${hole.n}: ${hole.bunkers.map(b => `(${b.c}) ${b.areaRing} m²`).join('  ') || '—'}`);
}
