/* Assemble the reviewed range site from the measurements in cache/range/ and
 * write it where the engine reads it. Coordinates stay EPSG:3006; the scenery
 * module converts to local metres with the frame the pack itself declares, so
 * this file never carries a second copy of the origin.
 *
 * This is a DISPLAY revision of observed objects, not survey. What is measured
 * is stated per field; what is not resolved at 0.32 m is named as unresolved. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TORTUNA_FRAME, local } from '../frame.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(readFileSync(resolve(HERE, '../cache/range', f), 'utf8'));
const mats = read('mat-line-raw.json');
const net = read('net-posts-raw.json');
const earth = read('earthworks-raw.json');
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
/* The frame is declared once, in tortunabuild/frame.mjs, and applied HERE.
   The engine reads only the local coordinates below, so the origin is never
   written down a second time in the app. */
const toLocal = p => local(p).map(v => round(v));

/* Drop the one detection the review crop shows on grass beyond the line's NW
   end: it is 5.09 m from its neighbour where every other gap is 2.45-3.50 m. */
const centres = mats.mats.map(m => m.centre).slice(1);
const line = { a: centres[0], b: centres.at(-1) };
const span = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
const gaps = centres.slice(1).map((c, i) => Math.hypot(c[0] - centres[i][0], c[1] - centres[i][1]));
const median = v => { const s = v.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/* Each mat is drawn as a square of the measured median area, turned to the
   local run of the line. Corner geometry is 4-5 pixels across and is NOT
   resolved; the position and the area are what the imagery supports. */
const side = Math.sqrt(median(mats.mats.map(m => m.areaSquareMetres)));
const matRecords = centres.map((c, i) => {
  const prev = centres[Math.max(0, i - 1)], next = centres[Math.min(centres.length - 1, i + 1)];
  const dx = next[0] - prev[0], dy = next[1] - prev[1], len = Math.hypot(dx, dy) || 1;
  const u = [dx / len, dy / len], v = [-u[1], u[0]];
  const h = side / 2;
  return {
    id: `tortuna-range-mat-${String(i + 1).padStart(2, '0')}`,
    centreEpsg3006: c.map(n => round(n)),
    ringEpsg3006: [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) =>
      [round(c[0] + u[0] * a + v[0] * b), round(c[1] + u[1] * a + v[1] * b)]),
    ringLocal: [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) =>
      toLocal([c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b])),
  };
});

/* The net's own base line, each post measured from its own shadow. The last
   raw detection sits 17.3 m beyond its neighbour on the scrub line where every
   other gap is 6.1-9.7 m, and is not carried. */
const posts = net.posts.filter((p, i, all) => {
  if (i === 0) return true;
  const gap = Math.hypot(p.epsg3006[0] - all[i - 1].epsg3006[0], p.epsg3006[1] - all[i - 1].epsg3006[1]);
  return gap < 14;
});
const heights = posts.map(p => p.heightMetres).sort((a, b) => a - b);
const netHeight = heights[Math.floor(heights.length / 2)];
const mad = median(heights.map(h => Math.abs(h - netHeight)));

const site = {
  schemaVersion: 1,
  groundId: 'tortuna',
  crs: 'EPSG:3006',
  frame: TORTUNA_FRAME.text,
  state: 'measured-display-model-not-human-accepted',
  source: {
    id: 'o66150_5975_25_mr26',
    collection: 'orto-n2-2026',
    capturedAt: net.capture,
    nativeResolutionMetres: 0.16,
    readAtResolutionMetres: 0.32,
    tile: 'tortunabuild/cache/orthophoto/north.png',
  },
  method: {
    mats: 'green-minus-red against its own local median over a 2.2 m radius, in a 3.5 m corridor about the tee line; '
      + 'the mats do not separate on any absolute colour cut, so the rule is local contrast, not hue',
    net: 'oriented matched filter along the solar bearing; the net is a continuous mesh whose shadow is a broad band, '
      + 'so the posts inside it separate by WIDTH, not by darkness',
    solar: `NOAA solar position at the source item's own capture instant: elevation ${round(net.sun.elevationDeg, 3)}°, `
      + `azimuth ${round(net.sun.azimuthDeg, 3)}°, shadow bearing ${round(net.shadowBearingDeg, 3)}°`,
    heightCorrection: "shadow length x tan(elevation) plus the ground rise the shadow runs over, sampled from this build's own heightfield",
    validation: 'the shadow bearing computed from the capture instant (45.06°) reproduces the dominant dark-line bearing '
      + 'measured independently in the pixels (46.0°); the two records never entered each other',
  },
  mats: {
    count: matRecords.length,
    spacingMetres: { median: round(median(gaps)), min: round(Math.min(...gaps)), max: round(Math.max(...gaps)) },
    areaSquareMetres: { median: round(median(mats.mats.map(m => m.areaSquareMetres))) },
    drawnSideMetres: round(side),
    spanMetres: round(span, 1),
    material: 'artificial-turf-hitting-mat',
    materialStatus: 'visual interpretation; equipment type and specification unverified',
    geometryStatus: 'positions measured; corner geometry unresolved at 0.32 m and drawn as a square of the measured median area',
    items: matRecords,
  },
  net: {
    kind: 'ball-stop-net',
    postCount: posts.length,
    heightMetres: round(netHeight),
    heightMadMetres: round(mad),
    heightRangeMetres: [round(heights[0]), round(heights.at(-1))],
    spacingMetres: round(median(posts.slice(1).map((p, i) =>
      Math.hypot(p.epsg3006[0] - posts[i].epsg3006[0], p.epsg3006[1] - posts[i].epsg3006[1])))),
    spanMetres: round(Math.hypot(posts.at(-1).epsg3006[0] - posts[0].epsg3006[0],
      posts.at(-1).epsg3006[1] - posts[0].epsg3006[1]), 1),
    lineEpsg3006: posts.map(p => p.epsg3006),
    lineLocal: posts.map(p => toLocal(p.epsg3006)),
    posts: posts.map(p => ({ epsg3006: p.epsg3006, local: toLocal(p.epsg3006), heightMetres: p.heightMetres,
      shadowLengthMetres: p.shadowLengthMetres, groundRiseMetres: p.shadowGroundRiseMetres })),
    geometryStatus: 'post positions and heights measured from their own shadows; post diameter, mesh gauge and any '
      + 'top cable are not resolved at 0.32 m and are drawn as display estimates',
  },
  /* The unfinished landing field. The club's own 2025 report is explicit that
     this is a project in progress, and the capture shows it: a scraped, pale,
     ungrassed surface with the constructed target areas standing in it. It is
     a READING, not a surface: the owner's word (2026-09-10) is that the range
     is grass, so the engine draws nothing over it -- see renderStatus. */
  earthworks: {
    kind: 'range_earthworks',
    areaSquareMetres: earth.areaSquareMetres,
    ringLocal: earth.ringLocal,
    ringEpsg3006: earth.ringEpsg3006,
    colourMeasured: '#a29c93',
    colourStatus: 'median interior colour of this capture; the render lights it, so this is the reading not the paint',
    method: `grown from a seed inside the scraped area on luminance >= ${earth.luminanceCut.toFixed(0)} and `
      + `green-minus-red <= ${earth.greenRedCut.toFixed(0)}, both measured on the range's own surroundings; `
      + 'boundary simplified at 1.5 m',
    clubStatement: 'Målet för denna säsong var att slutföra arbetet på rangen med jordmassorna och göra klart '
      + 'målområdena på rangen... I och med att ytan på rangen inte är gräsbetäckt, var vi tvungna att återinföra '
      + 'våra gamla bollar (Tortuna GK, medlemsundersökning 2024, published 2025)',
    geometryStatus: 'extent measured; it is a working surface and its boundary moves with the work',
    rendered: false,
    renderStatus: 'NOT DRAWN. The owner states (2026-09-10) that the driving range is grass; the bare fill this '
      + 'capture shows is a May 2026 reading of a field the club was still grassing, and the owner\'s word outranks a '
      + 'photograph four months older than it. Kept as the extent that was measured, never as a surface to paint.',
  },
  limitations: [
    'A display model of observed structures, not a survey. No coordinate here is an independent control.',
    'The club\'s own 2025 report describes the range as an unfinished project ("jordmassorna", "målområdena"); '
      + 'the landing field in this capture is largely bare earth. It is NOT drawn that way: the owner states (2026-09-10) that the range is grass, so the field renders as the turf the ground carries and the traced extent is kept as a reading only.',
    'The seventeen range_tee_pad features retained in the pack are a separate earlier reading of the same mats. '
      + 'They are revised for display by this file and are NOT deleted from the source model.',
  ],
};
const out = resolve(HERE, '../../apps/golf/src/engine/scenery/tortuna-range-site.json');
writeFileSync(out, JSON.stringify(site, null, 2) + '\n');
console.log('mats %s (span %s m, spacing %s m, %s m square)', site.mats.count, site.mats.spanMetres,
  site.mats.spacingMetres.median, site.mats.drawnSideMetres);
console.log('net  %s posts, %s m high (MAD %s, range %s), spacing %s m, span %s m',
  site.net.postCount, site.net.heightMetres, site.net.heightMadMetres,
  site.net.heightRangeMetres.join('-'), site.net.spacingMetres, site.net.spanMetres);
console.log('->', out);
