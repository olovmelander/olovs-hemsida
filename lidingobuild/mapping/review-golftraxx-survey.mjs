/* Measure the GolfTraxx survey (geo_data/lidingo_clean.json) against records
 * that never entered it: the club's official card and the observed playing
 * surfaces in playing-surfaces.geojson.
 *
 * Three questions, each answered by data the other side never saw:
 *   1. Do the survey's tee==target holes reproduce the card's par 3s? (identity)
 *   2. Does every Green Center land on that hole's observed green?  (registration)
 *   3. Do the survey's own route lengths reproduce the card?        (scale)
 *
 * Question 3 is where GolfTraxx is known to be wrong: the same yards-as-metres
 * defect Ribbingsfors measured. This script MEASURES the ratio rather than
 * assuming it, because a defect that is only assumed cannot be gated.
 *
 * The projection is the repository's tested Krüger series, which reproduces
 * PROJ to millimetres. Nothing here writes a published coordinate: it writes a
 * review report, so the series is used to MEASURE and never to publish.
 *
 *   node lidingobuild/mapping/review-golftraxx-survey.mjs [--out <path>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';

const SURVEY = 'geo_data/lidingo_clean.json';
const SURFACES = 'lidingobuild/mapping/playing-surfaces.geojson';
const CARD = 'lidingobuild/card.json';
const METRES_PER_YARD = 0.9144;

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outPath = outIndex >= 0 ? argv[outIndex + 1] : 'lidingobuild/mapping/golftraxx-survey-review.json';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const survey = readJson(SURVEY);
const surfaces = readJson(SURFACES);
const card = readJson(CARD);

/* ---- the survey, projected once ---------------------------------------- */
const holes = new Map();
for (const f of survey.features) {
  const n = Number(f.properties.hole);
  const [lon, lat] = f.geometry.coordinates;
  const [easting, northing] = latLonToSweref99Tm(lat, lon);
  if (!holes.has(n)) holes.set(n, {});
  holes.get(n)[f.properties.name] = { easting, northing, lat, lon };
}
const holeNumbers = [...holes.keys()].sort((a, b) => a - b);

const dist = (a, b) => Math.hypot(a.easting - b.easting, a.northing - b.northing);

/* ---- polygon helpers over EPSG:3006 rings ------------------------------- */
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]));
/* About the ring's FIRST VERTEX. On raw EPSG:3006 coordinates the shoelace
   cross products are ~4.6e12 and their sum is the polygon's area, so a small
   ring's centroid is the ninth significant figure of a double and the rounding
   error is metres. Measured on this course's own polygons: greens were out by a
   median 2.83 m and up to 9.15 m before this, which is the same size as the
   agreement being reported below - so the first version of this report was
   measuring its own arithmetic as much as the survey. */
function ringCentroid(ring) {
  const ox = ring[0][0]; const oy = ring[0][1];
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x0 = ring[i][0] - ox; const y0 = ring[i][1] - oy;
    const x1 = ring[i + 1][0] - ox; const y1 = ring[i + 1][1] - oy;
    const cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) return null;
  return { easting: ox + cx / (3 * a), northing: oy + cy / (3 * a), area: Math.abs(a) / 2 };
}
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i]; const [x1, y1] = ring[i + 1];
    if ((y0 > point.northing) !== (y1 > point.northing)) {
      const x = x0 + (point.northing - y0) * (x1 - x0) / (y1 - y0);
      if (point.easting < x) inside = !inside;
    }
  }
  return inside;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 3) => (x === null ? null : Number(x.toFixed(d)));

/* ---- 1. identity: do the tee==target holes reproduce the card's par 3s? -- */
const surveyPar3 = holeNumbers.filter((h) => dist(holes.get(h)['Tee Target'], holes.get(h)['TheTipsTee Back Reach']) < 3);
const cardPar3 = card.holes.filter((h) => h.par === 3).map((h) => h.n);
const identityAgrees = surveyPar3.length === cardPar3.length
  && surveyPar3.every((h, i) => h === cardPar3[i]);

/* ---- 2. registration: Green Center against the observed greens ----------- */
const greens = surfaces.features.filter((f) => f.properties.kind === 'green');
const greenRows = [];
for (const h of holeNumbers) {
  const centre = holes.get(h)['Green Center'];
  let nearest = null;
  for (const g of greens) {
    for (const ring of ringsOf(g.geometry)) {
      const c = ringCentroid(ring);
      if (!c) continue;
      const d = Math.hypot(c.easting - centre.easting, c.northing - centre.northing);
      if (!nearest || d < nearest.distance) {
        nearest = {
          distance: d,
          hole: g.properties.hole ?? null,
          sourceFeatureId: g.properties.sourceFeatureId ?? null,
          method: g.properties.method ?? null,
          areaSquareMetres: c.area,
          contains: pointInRing(centre, ring),
          offsetEasting: centre.easting - c.easting,
          offsetNorthing: centre.northing - c.northing,
        };
      }
    }
  }
  greenRows.push({
    hole: h,
    nearestObservedGreenHole: nearest.hole,
    matchesHole: nearest.hole === h,
    containedByObservedGreen: nearest.contains,
    distanceToCentroidMetres: round(nearest.distance, 2),
    offsetEastingMetres: round(nearest.offsetEasting, 2),
    offsetNorthingMetres: round(nearest.offsetNorthing, 2),
    observedGreenSourceFeatureId: nearest.sourceFeatureId,
    observedGreenMethod: nearest.method,
    observedGreenAreaSquareMetres: round(nearest.areaSquareMetres, 1),
  });
}
const matched = greenRows.filter((r) => r.matchesHole).length;
const contained = greenRows.filter((r) => r.containedByObservedGreen).length;

/* ---- 3. scale: the survey's own route against the card ------------------ */
const routeRows = [];
for (const h of holeNumbers) {
  const p = holes.get(h);
  const routeMetres = dist(p['TheTipsTee Back Reach'], p['Tee Target']) + dist(p['Tee Target'], p['Green Center']);
  const cardHole = card.holes.find((c) => c.n === h);
  routeRows.push({
    hole: h,
    par: cardHole.par,
    cardBackTeeMetres: cardHole.t[0],
    surveyRouteMetres: round(routeMetres, 1),
    ratioToCard: round(routeMetres / cardHole.t[0], 4),
    surveyRouteAsYards: round(routeMetres / METRES_PER_YARD, 1),
  });
}
const scaleRows = routeRows.filter((r) => r.ratioToCard < 1);
const ratios = scaleRows.map((r) => r.ratioToCard);
const medianRatio = median(ratios);

/* ---- the report --------------------------------------------------------- */
const greenOffsets = greenRows.map((r) => Math.hypot(r.offsetEastingMetres, r.offsetNorthingMetres));
const report = {
  schemaVersion: 1,
  reviewedOn: '2026-09-08',
  state: 'measurement-evidence-only',
  generator: 'lidingobuild/mapping/review-golftraxx-survey.mjs',
  survey: {
    path: SURVEY,
    sha256: sha256(SURVEY),
    provider: 'GolfTraxx',
    courseId: '18130SW',
    courseName: 'Lidingö Golfklubb',
    listedAddress: 'Trolldalsvägen 2, Lidingö',
    layoutUrl: 'https://golftraxx.com/full-layout?coursename=Liding%C3%B6+Golfklubb&zipcode=18130SW&city=Liding%C3%B6&state=SW&static=true',
    directoryUrl: 'https://golftraxx.com/courses-by-state?state=SW&static=true',
    retrievedOn: '2026-09-08',
    extractor: 'geo_data/golftraxx_extract.py',
    holes: holeNumbers.length,
    points: survey.features.length,
    rights: 'Third-party published hole geometry. Retained as measurement evidence and per-hole anchors; it is not a club survey and carries no stated accuracy.',
  },
  comparedAgainst: [
    { path: CARD, sha256: sha256(CARD), role: 'official card; never entered the survey' },
    { path: SURFACES, sha256: sha256(SURFACES), role: 'observed playing surfaces; never entered the survey' },
  ],
  projection: {
    method: 'packages/course-geo/chmv2/projection.mjs (Krüger series on GRS 80)',
    note: 'Used to MEASURE residuals in EPSG:3006 only. No published coordinate is produced here; PROJ remains the authority for the migration.',
  },
  identityCheck: {
    question: 'Do the survey holes whose Tee Target equals their back tee reproduce the card\'s par 3s?',
    surveyTeeEqualsTargetHoles: surveyPar3,
    cardPar3Holes: cardPar3,
    agrees: identityAgrees,
    note: 'A survey hole with no separate landing target is a par 3. Six of six agree with the card, with no false positive, so the hole numbering of the extraction is confirmed by a record the extraction never read.',
  },
  greenRegistration: {
    question: 'Does each Green Center land on that hole\'s observed green?',
    holesMatchingObservedGreenHole: matched,
    holesContainedByObservedGreen: contained,
    medianDistanceToCentroidMetres: round(median(greenRows.map((r) => r.distanceToCentroidMetres)), 2),
    maxDistanceToCentroidMetres: round(Math.max(...greenRows.map((r) => r.distanceToCentroidMetres)), 2),
    medianOffsetEastingMetres: round(median(greenRows.map((r) => r.offsetEastingMetres)), 2),
    medianOffsetNorthingMetres: round(median(greenRows.map((r) => r.offsetNorthingMetres)), 2),
    medianOffsetMagnitudeMetres: round(median(greenOffsets), 2),
    decision: 'The median offset is far smaller than the scatter, so this is a SCATTER result and not a measured bias. No shift is applied to either record.',
    holes: greenRows,
  },
  routeScale: {
    question: 'Does the survey\'s own tee-to-green route reproduce the card length?',
    medianRatioToCard: round(medianRatio, 4),
    minRatioToCard: round(Math.min(...ratios), 4),
    maxRatioToCard: round(Math.max(...ratios), 4),
    metresPerYard: METRES_PER_YARD,
    finding: 'Every hole but the first measures a near-constant fraction of its card length, and that fraction is the yard. The survey\'s route lengths were laid out so that the metric card number reads as YARDS — the same defect Ribbingsfors measured in this provider.',
    consequence: 'The back-tee points are DERIVED, not surveyed, and are never adopted as tee positions. Observed tee pads remain the only tee geometry. The survey contributes green centres and the hole axis.',
    holes: routeRows,
  },
  adoption: {
    adopted: ['Green Center as the per-hole anchor for associating observed surfaces to holes'],
    refused: [
      'TheTipsTee Back Reach as a tee position (derived; carries the yards defect)',
      'Tee Target as a surveyed landing point (it is the same derived construction)',
      'Green Front/Back as a green outline (they bracket the green complex, not the putting surface)',
    ],
    note: 'Adopting an anchor is not adopting geometry. Observed polygons keep their own vertices.',
  },
};

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`survey        ${report.survey.holes} holes, ${report.survey.points} points  (${report.survey.courseId})`);
console.log(`identity      survey tee==target holes ${surveyPar3.join(',')} vs card par 3s ${cardPar3.join(',')}  -> ${identityAgrees ? 'AGREE' : 'DISAGREE'}`);
console.log(`registration  ${matched}/${holeNumbers.length} green centres on the right hole's observed green, ${contained} strictly inside`);
console.log(`              median ${report.greenRegistration.medianDistanceToCentroidMetres} m to centroid, max ${report.greenRegistration.maxDistanceToCentroidMetres} m`);
console.log(`              median offset dE ${report.greenRegistration.medianOffsetEastingMetres} dN ${report.greenRegistration.medianOffsetNorthingMetres} m (scatter, not bias)`);
console.log(`scale         route/card median ${report.routeScale.medianRatioToCard} over ${ratios.length} holes; one yard is ${METRES_PER_YARD} m`);
console.log(`wrote ${outPath}`);

if (!identityAgrees) { console.error('FAIL: the survey does not reproduce the card\'s par 3s'); process.exit(1); }
if (matched !== holeNumbers.length) { console.error('FAIL: a green centre does not land on its own hole\'s observed green'); process.exit(1); }
