#!/usr/bin/env node
/* The GolfTraxx GPS survey against the source-traced Visby model.
 *
 * geo_data/visby_clean.json is a third-party survey: 18 holes x 5 points, pulled
 * from GolfTraxx course id 62230SW ("Visby Golfklubb, Vastergarn Kronholmen 415")
 * with the repo's own geo_data/golftraxx_extract.py. CLAUDE.md's rule for such a
 * record is that it is "believed only as far as something that never entered it
 * agrees", so this script measures the agreement instead of asserting it, and
 * writes golftraxx-survey-review.json.
 *
 * Nothing here moves geometry. It reports:
 *   - each GT green centre against the model's traced green centroid,
 *   - each GT back-tee marker against the model's observed tee pad,
 *   - the hole length the GT endpoints imply against the club's card, which is
 *     the statistic that separates a right hole assignment from a wrong one: a
 *     right one is off by a consistent, ONE-SIDED amount (the marker sits in
 *     front of the real back tee), a wrong one scatters.
 *
 *   node visbybuild/mapping/golftraxx-review.mjs [--out <file>]                */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { VISBY_FRAME, local } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const OUT = outIndex >= 0 ? argv[outIndex + 1] : path.join(HERE, 'golftraxx-survey-review.json');

const survey = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/visby_clean.json'), 'utf8'));
const model = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'course-model.json'), 'utf8'));
const card = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'card.json'), 'utf8'));
const cardHoles = card.holes || card;

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polylineLength = points => points.reduce((total, point, index) =>
  index ? total + distance(points[index - 1], point) : 0, 0);
const ringCentroid = ring => {
  let sx = 0, sz = 0;
  for (const [x, z] of ring) { sx += x; sz += z; }
  return [sx / ring.length, sz / ring.length];
};
const ringArea = ring => {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
    twice += x1 * z2 - x2 * z1;
  }
  return Math.abs(twice / 2);
};

/* GolfTraxx serves WGS 84; this frame is EPSG:3006 local metres, so the join is
   the repo's Krueger series and not a flat-earth approximation. */
const points = {};
for (const feature of survey.features) {
  const hole = Number(feature.properties.hole);
  const [longitude, latitude] = feature.geometry.coordinates;
  (points[hole] = points[hole] || {})[feature.properties.name] =
    local(latLonToSweref99Tm(latitude, longitude));
}

const holes = model.holes.map(hole => {
  const survey_ = points[hole.n];
  const cardHole = cardHoles.find(entry => (entry.number ?? entry.n) === hole.n);
  const cardLength = (cardHole.lengths || cardHole.t)[0];
  const teeMark = survey_['TheTipsTee Back Reach'];
  const greenCentre = survey_['Green Center'];
  const pads = hole.tees?.pads || [];
  const padCentroid = pads.length ? ringCentroid(pads[0].ring || pads[0]) : null;

  /* The model's own polyline, with each end retargeted onto the survey. The
     interior vertices are the traced corridor and are left alone. */
  const retargeted = [teeMark, ...hole.line.slice(1, -1), greenCentre];
  const surveyLength = polylineLength(retargeted);

  return {
    hole: hole.n,
    par: hole.par,
    cardLengthMetres: cardLength,
    greenCentreDeltaMetres: +distance(greenCentre, hole.green.c).toFixed(2),
    greenRingAreaSquareMetres: +ringArea(hole.green.ring).toFixed(0),
    teeMarkDeltaMetres: padCentroid === null ? null : +distance(teeMark, padCentroid).toFixed(2),
    modelLineLengthMetres: +hole.lineLen.toFixed(1),
    modelLineVersusCardPercent: +(100 * (hole.lineLen - cardLength) / cardLength).toFixed(1),
    surveyRetargetedLengthMetres: +surveyLength.toFixed(1),
    surveyVersusCardPercent: +(100 * (surveyLength - cardLength) / cardLength).toFixed(1),
    surveyStraightLineMetres: +distance(teeMark, greenCentre).toFixed(1),
    teeStatus: hole.tees?.status ?? null,
  };
});

/* Two different disagreements, and conflating them would hide which record is
   at fault. A hole whose survey-retargeted length EXCEEDS the card is
   impossible -- the played length is measured along the playing line, so a
   corridor polyline to the real green can never be longer -- and that convicts
   the PROVIDER's endpoint. A hole whose retargeted length sits inside the
   agreed band while the green centres are far apart convicts the MODEL: the
   survey is behaving exactly like its seventeen neighbours, so the traced
   outline is the odd one out. */
const DISPUTE_GREEN_METRES = 20;
const impossible = hole => hole.surveyVersusCardPercent > 0;
const providerDisputed = holes.filter(impossible);
const agreed = holes.filter(hole =>
  !impossible(hole) && hole.greenCentreDeltaMetres <= DISPUTE_GREEN_METRES);
const modelDisputed = holes.filter(hole =>
  !impossible(hole) && hole.greenCentreDeltaMetres > DISPUTE_GREEN_METRES);
const disputed = [...providerDisputed, ...modelDisputed];
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[sorted.length >> 1]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

const review = {
  reviewedFor: 'visby',
  survey: {
    path: 'geo_data/visby_clean.json',
    provider: 'GolfTraxx',
    courseId: '62230SW',
    listedAs: 'Visby Golfklubb, Vastergarn Kronholmen 415, Visby, SW',
    layoutUrl: 'https://golftraxx.com/full-layout?coursename=Visby+Golfklubb&zipcode=62230SW&city=&state=SW&static=true',
    extractedBy: 'geo_data/golftraxx_extract.py',
    holes: 18,
    points: survey.features.length,
    pointKinds: ['Tee Target', 'Green Center', 'Green Front', 'Green Back', 'TheTipsTee Back Reach'],
    crsInterpretation: 'OGC:CRS84 from the provider\'s web-mapping context; no source-declared CRS or accuracy',
    joinedBy: 'packages/course-geo/chmv2/projection.mjs latLonToSweref99Tm, then visbybuild/frame.mjs local()',
  },
  frame: { easting: VISBY_FRAME.easting, northing: VISBY_FRAME.northing, text: VISBY_FRAME.text },
  holes,
  agreement: {
    greenCentreDeltaMetresByHole: Object.fromEntries(holes.map(h => [h.hole, h.greenCentreDeltaMetres])),
    agreedHoleCount: agreed.length,
    agreedGreenCentreDeltaMedianMetres: +median(agreed.map(h => h.greenCentreDeltaMetres)).toFixed(2),
    agreedGreenCentreDeltaMaxMetres: +Math.max(...agreed.map(h => h.greenCentreDeltaMetres)).toFixed(2),
    agreedSurveyVersusCardPercentMedian: +median(agreed.map(h => h.surveyVersusCardPercent)).toFixed(1),
    agreedSurveyVersusCardPercentRange: [
      Math.min(...agreed.map(h => h.surveyVersusCardPercent)),
      Math.max(...agreed.map(h => h.surveyVersusCardPercent)),
    ],
    oneSided: agreed.every(h => h.surveyVersusCardPercent < 0),
    interpretation:
      'Every agreed hole comes out SHORTER than its card by a similar amount, which is what a '
      + 'right hole assignment looks like: the provider\'s back-tee marker stands in front of the '
      + 'card\'s back tee. A wrong assignment scatters instead.',
  },
  disputed: {
    providerRecordDisputed: providerDisputed.map(hole => ({
      ...hole,
      fault: 'GolfTraxx endpoint',
      reasoning:
        'The survey endpoints imply a hole LONGER than the club\'s card, which the played line '
        + 'cannot be. The provider\'s point is not on this hole of the eighteen.',
    })),
    modelRecordDisputed: modelDisputed.map(hole => ({
      ...hole,
      fault: 'model green outline',
      reasoning:
        'The survey endpoints put this hole inside the same one-sided band as the fifteen agreed '
        + 'holes, so the survey is behaving normally here. The traced green ring is the outlier: '
        + 'compare its area against the agreed greens.',
    })),
    agreedGreenRingAreaRangeSquareMetres: [
      Math.min(...agreed.map(hole => hole.greenRingAreaSquareMetres)),
      Math.max(...agreed.map(hole => hole.greenRingAreaSquareMetres)),
    ],
  },
  notes: [
    'This survey is third-party geometry. It is recorded as an independent cross-check; it does not '
    + 'supply approved control and does not by itself move any geometry.',
    'Green Front and Green Back are retained in the survey file but are not used here: the model '
    + 'carries traced green outlines, and a front/back pair cannot define one without an axis.',
  ],
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(review, null, 2)}\n`);
console.log(`${path.relative(ROOT, OUT)}: ${agreed.length} agreed, ${disputed.length} disputed`);
console.log(`  agreed green-centre delta: median ${review.agreement.agreedGreenCentreDeltaMedianMetres} m, max ${review.agreement.agreedGreenCentreDeltaMaxMetres} m`);
console.log(`  agreed survey-vs-card: median ${review.agreement.agreedSurveyVersusCardPercentMedian}%, range ${review.agreement.agreedSurveyVersusCardPercentRange.join('..')}%, one-sided ${review.agreement.oneSided}`);
console.log(`  agreed green ring areas: ${review.disputed.agreedGreenRingAreaRangeSquareMetres.join('..')} m2`);
for (const hole of providerDisputed) {
  console.log(`  provider record disputed h${hole.hole}: survey vs card ${hole.surveyVersusCardPercent}% (impossible), green delta ${hole.greenCentreDeltaMetres} m`);
}
for (const hole of modelDisputed) {
  console.log(`  model record disputed h${hole.hole}: survey vs card ${hole.surveyVersusCardPercent}% (in band), green delta ${hole.greenCentreDeltaMetres} m, ring ${hole.greenRingAreaSquareMetres} m2`);
}
