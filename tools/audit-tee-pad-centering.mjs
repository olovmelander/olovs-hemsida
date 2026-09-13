import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { withInferredTeePads } from '../apps/golf/src/engine/tee-pads.mjs';
import { deriveTeePlayingPositions } from '../apps/golf/src/engine/tee-playing-position.mjs';
import { inRing, ringSD, centroidOf } from '../apps/golf/src/engine/geom.js';
import { reviewedTeeMarkerPositions } from '../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public/courses/index.json'), 'utf8'));
const report = { method: 'Current published packs with app display anchors, pad inference and runtime lateral centering. Original references and physical pad polygons are unchanged. Edge distance is relative to pad polygons, not surveyed accuracy or a guarantee of daily tee-marker location.', courses: [], marks: [] };
const rounded = n => Math.round(n * 1000) / 1000;
for (const course of manifest.courses) {
  const pack = readPack(fs.readFileSync(path.join(root, 'apps/golf/public', course.packUrl)));
  const model = JSON.parse(inflateStream(pack.sv));
  const holes = withInferredTeePads(model.holes);
  for (const hole of holes) deriveTeePlayingPositions(hole);
  const rows = [];
  for (const hole of holes) for (const [index, mark] of hole.tees.marks.entries()) {
    const pads = hole.tees.pads;
    const contained = pads.filter(p => inRing(...mark.c, p.ring));
    const nominated = mark.sourcePadId == null ? contained
      : pads.filter(p => p.id === mark.sourcePadId || p.reviewId === mark.sourcePadId);
    const eligible = nominated.filter(p => inRing(...mark.c, p.ring));
    const pad = eligible.sort((a, b) => ringSD(...mark.c, a.ring) - ringSD(...mark.c, b.ring))[0];
    const centre = pad && centroidOf(pad.ring);
    const pair = reviewedTeeMarkerPositions(hole, mark);
    const pairCentre = pair.length === 2 ? [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2] : null;
    const nearest = Math.min(...pads.map(p => Math.abs(ringSD(...mark.c, p.ring))));
    const row = { course: course.slug, hole: hole.n, index, tee: course.tees.names[index],
      metres: hole.t?.[index] ?? mark.m, coordinate: mark.c, sourceCoordinate: mark.referenceC ?? mark.c,
      sourcePadId: mark.sourcePadId ?? null, padId: pad?.id ?? pad?.reviewId ?? null,
      playingPosition: mark.playingPosition,
      contained: contained.length > 0, onNominatedPad: !!pad,
      edgeClearanceMetres: pad ? rounded(-ringSD(...mark.c, pad.ring)) : null,
      nearestPadBoundaryMetres: Number.isFinite(nearest) ? rounded(nearest) : null,
      distanceToPadCentroidMetres: centre ? rounded(Math.hypot(mark.c[0] - centre[0], mark.c[1] - centre[1])) : null,
      centroidInsidePad: centre ? inRing(...centre, pad.ring) : null,
      decorativePairMidpoint: pairCentre,
      distanceToPairMidpointMetres: pairCentre ? rounded(Math.hypot(mark.c[0] - pairCentre[0], mark.c[1] - pairCentre[1])) : null,
      referenceKind: mark.orthophotoReference?.kind ?? null,
      associationConfidence: mark.associationConfidence ?? null,
      syntheticPad: pad?.prov === 'synth',
    };
    rows.push(row);
  }
  report.marks.push(...rows);
  report.courses.push({ course: course.slug, tees: rows.length,
    centredPlayingPositions: rows.filter(r => r.playingPosition?.method === 'lateral-pad-centre').length,
    maximumPlayingShiftMetres: rounded(Math.max(0, ...rows.map(r => r.playingPosition?.shiftM ?? 0))),
    previouslyLessThanOneMetreFromEdge: rows.filter(r => r.playingPosition?.beforeEdgeClearanceM < 1).length,
    outsideAllPads: rows.filter(r => !r.contained).length,
    outsideNominatedPad: rows.filter(r => !r.onNominatedPad).length,
    lessThanOneMetreFromEdge: rows.filter(r => r.edgeClearanceMetres != null && r.edgeClearanceMetres < 1).length,
    lessThanTwoMetresFromEdge: rows.filter(r => r.edgeClearanceMetres != null && r.edgeClearanceMetres < 2).length,
    pairMidpointMoreThanHalfMetreAway: rows.filter(r => r.distanceToPairMidpointMetres > .5).length,
    syntheticPads: rows.filter(r => r.syntheticPad).length });
}
const output = path.resolve(process.argv[2] || path.join(root, 'output/tee-pad-audit.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ courses: report.courses, veckefjardenHole1: report.marks.filter(r => r.course === 'veckefjarden' && r.hole === 1) }, null, 2));
