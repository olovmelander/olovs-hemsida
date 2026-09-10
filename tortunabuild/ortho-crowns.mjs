/* Every laser crown maximum against the 2026-05-02 orthophoto.
 *
 * The 2021 leaf-off laser is the measured record of where crowns stood and how
 * tall they were; the 2026 national orthophoto (0.16 m, servable at 0.32 m
 * through the Min karta WMS with no credentials, PNG so Node decodes it) is
 * five years newer and is the one record that never entered the crown
 * detection. This reads, for each candidate written by compile-objects.mjs,
 * the imagery inside the crown's own radius about its apex and in an annulus
 * round it, and says one of three things:
 *
 *   present   dark, textured canopy where the laser put a crown
 *   absent    open ground there in 2026 -- felled, cleared or never a tree
 *   unclear   neither reading is decisive (thin spring canopy, shadow of a
 *             neighbour, a wet patch); kept, flagged, never promoted
 *
 * The cuts are the ones trace-canopy-changes.mjs calibrated on this same
 * frame (cache/fell-calib.mjs): open ground reads a median brightness of 88
 * or more with under 10% of samples darker than 70; intact forest reads
 * 47-75 with 22-97% dark. A crown is DISTINCT when the annulus round it
 * (1.4-2.4 radii) is at least 25 brighter than its disc, which is a tree
 * standing on turf and not a cell of closed forest.
 *
 * Output: geo_data/course-v2/tortuna/vegetation/ortho-crown-review.json (the
 * verdict per key, with the numbers) and the approvals file the second
 * compile pass reads.
 *
 *     node tortunabuild/ortho-crowns.mjs                                     */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from '../geobuild/png.mjs';
import { machineReviewDecision } from '../packages/course-v2/vegetation/compile-vegetation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STAGE = path.join(ROOT, 'tortunabuild/cache/vegetation/objects-stage');
const CACHE = path.join(HERE, 'cache/ortho/lm-0.32-png');
const METRES = 0.32;
const SOURCE = { collection: 'orto-n2-2026', capturedAt: '2026-05-02T13:09:09Z', service: 'https://minkarta.lantmateriet.se/map/ortofoto layer Ortofoto_0.16', readAtMetres: METRES };
export const CUTS = Object.freeze({
  openMedianBrightness: 88, openDarkFraction: 0.10,      /* trace-canopy-changes.mjs, cache/fell-calib.mjs */
  crownMedianBrightness: 80, crownDarkFraction: 0.15,
  darkBelow: 70, distinctContrast: 25, minimumRadiusMetres: 1.5,
  /* a crown is green and a roof is not: measured on this frame, 2,207 confirmed
     crowns read excess green p10 1 / p50 7, 73 maxima on roof envelopes read
     p50 -2 / p75 0; a promotion needs the green as well as the darkness */
  promoteExcessGreen: 3,
});

async function fetchPiece(minE, maxN, columns, rows) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${minE.toFixed(1)}_${maxN.toFixed(1)}_${columns}x${rows}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Ortofoto_0.16&STYLES=&SRS=EPSG:3006`
      + `&BBOX=${minE},${maxN - rows * METRES},${minE + columns * METRES},${maxN}&WIDTH=${columns}&HEIGHT=${rows}&FORMAT=image/png`;
    let response = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' } });
      if (response.ok) break;
      if (attempt === 4) throw new Error(`orthophoto piece ${columns}x${rows} at ${minE},${maxN} returned HTTP ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2048) throw new Error('service exception rather than imagery');
    fs.writeFileSync(file, bytes);
  }
  return decodePNG(fs.readFileSync(file));
}

/** A brightness mosaic over an EPSG:3006 window, one byte per 0.32 m. */
export async function brightnessMosaic({ minEasting, maxNorthing, width, height }) {
  const W = Math.round(width / METRES), H = Math.round(height / METRES);
  const bright = new Uint8Array(W * H), green = new Int16Array(W * H);
  const MAX = 4096;
  for (let row0 = 0; row0 < H; row0 += MAX) for (let column0 = 0; column0 < W; column0 += MAX) {
    const columns = Math.min(MAX, W - column0), rows = Math.min(MAX, H - row0);
    const piece = await fetchPiece(minEasting + column0 * METRES, maxNorthing - row0 * METRES, columns, rows);
    if (piece.width !== columns || piece.height !== rows) throw new Error('piece size differs from the request');
    const ch = piece.channels;
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const i = (r * columns + c) * ch, o = (row0 + r) * W + column0 + c;
      const R = piece.data[i], G = piece.data[i + 1], B = piece.data[i + 2];
      bright[o] = Math.round((R + G + B) / 3);
      green[o] = 2 * G - R - B;
    }
    console.error(`piece ${columns}x${rows} at column ${column0} row ${row0}`);
  }
  return { W, H, bright, green, minEasting, maxNorthing,
    px: (e, n) => [(e - minEasting) / METRES, (maxNorthing - n) / METRES] };
}

const median = v => { if (!v.length) return NaN; const s = Float64Array.from(v).sort(); return s[s.length >> 1]; };

/** Disc and annulus statistics about a point. */
export function crownReading(mosaic, easting, northing, radiusMetres, cuts = CUTS) {
  const r = Math.max(cuts.minimumRadiusMetres, radiusMetres) / METRES;
  const [cx, cy] = mosaic.px(easting, northing);
  const disc = [], discGreen = [], ring = [];
  let dark = 0;
  const R = Math.ceil(r * 2.4);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (x < 0 || y < 0 || x >= mosaic.W || y >= mosaic.H) continue;
    const d = Math.hypot(dx, dy) / r;
    const b = mosaic.bright[y * mosaic.W + x];
    if (d <= 1) { disc.push(b); discGreen.push(mosaic.green[y * mosaic.W + x]); if (b < cuts.darkBelow) dark++; }
    else if (d >= 1.4 && d <= 2.4) ring.push(b);
  }
  if (!disc.length) return null;
  const discMedian = median(disc), ringMedian = median(ring), darkFraction = dark / disc.length;
  const open = discMedian >= cuts.openMedianBrightness && darkFraction < cuts.openDarkFraction;
  const crown = discMedian <= cuts.crownMedianBrightness && darkFraction >= cuts.crownDarkFraction;
  return {
    verdict: crown ? 'present' : open ? 'absent' : 'unclear',
    distinct: crown && Number.isFinite(ringMedian) && ringMedian - discMedian >= cuts.distinctContrast,
    discMedian, ringMedian: Number.isFinite(ringMedian) ? ringMedian : null,
    darkFraction: Math.round(darkFraction * 1000) / 1000,
    excessGreen: median(discGreen), samples: disc.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidates = JSON.parse(fs.readFileSync(path.join(STAGE, 'candidates.json'), 'utf8'));
  const grid = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/tortuna/vegetation/canopy-evidence.json'), 'utf8')).grid;
  /* the canopy window, cell edges */
  const window = { minEasting: grid.minEasting - 0.5, maxNorthing: grid.maxNorthing + 0.5, width: grid.width, height: grid.height };
  const mosaic = await brightnessMosaic(window);
  const readings = new Map();
  const counts = { present: 0, absent: 0, unclear: 0, distinct: 0 };
  const byZone = {};
  for (const c of candidates) {
    const reading = crownReading(mosaic, c.apex.easting, c.apex.northing, c.radiusMetres);
    if (!reading) continue;
    readings.set(c.key, reading);
    counts[reading.verdict]++; if (reading.distinct) counts.distinct++;
    const z = byZone[c.truthZone] ||= { present: 0, absent: 0, unclear: 0, distinct: 0 };
    z[reading.verdict]++; if (reading.distinct) z.distinct++;
  }
  /* the same versioned rules the first pass applied, re-derived here so the
     report names what the rules approved and what the imagery then said */
  const machine = new Set(candidates.filter(c => machineReviewDecision(c).approved).map(c => c.key));
  /* Approvals: a machine-approved crown the imagery does not refuse; and a
     maximum the rules held back only for the leaf-off reasons (prominence,
     compactness, confidence, radius, or a stand crown that touched its
     neighbour) is PROMOTED when the imagery shows a distinct crown standing
     clear on open ground where the laser put it -- two records that never
     entered each other. Excluded candidates and heights under 3 m never. */
  const approvals = [], refused = [], promoted = [], absent = [];
  for (const c of candidates) {
    const reading = readings.get(c.key);
    if (reading && reading.verdict === 'absent' && c.representation !== 'excluded') {
      absent.push({ key: c.key, zone: c.truthZone, representation: c.representation, easting: c.apex.easting, northing: c.apex.northing, radiusMetres: c.radiusMetres, heightMetres: c.heightMetres, discMedian: reading.discMedian, darkFraction: reading.darkFraction });
    }
    if (!reading || c.representation === 'excluded' || c.heightMetres < 3) continue;
    const machineApproved = machine.has(c.key);
    if (machineApproved) {
      if (reading.verdict === 'absent') refused.push({ key: c.key, zone: c.truthZone, ...reading });
      else approvals.push({ key: c.key, basis: reading.verdict === 'present' ? 'laser+ortho' : 'laser, ortho unclear' });
    } else if (reading.distinct && reading.excessGreen >= CUTS.promoteExcessGreen && c.truthZone !== 'C') {
      approvals.push({ key: c.key, promote: true, basis: 'laser maximum + distinct 2026 crown', standReasons: c.standReasons });
      promoted.push({ key: c.key, zone: c.truthZone, representation: c.representation, standReasons: c.standReasons, heightMetres: c.heightMetres, radiusMetres: c.radiusMetres, ...reading });
    }
  }
  const report = {
    schemaVersion: 1, groundId: 'tortuna', observedOn: '2026-09-10', source: SOURCE, cuts: CUTS,
    candidates: candidates.length, read: readings.size, counts, byZone,
    machineApproved: machine.size, approved: approvals.length,
    refused: { count: refused.length, byZone: refused.reduce((o, r) => (o[r.zone] = (o[r.zone] || 0) + 1, o), {}), keys: refused },
    /* every maximum the laser measured as canopy and the imagery shows as open
       ground, outside the traced clear-fells: the stand compile takes these out
       too, so a felled tree is planted neither as a record nor as a stand tree */
    absent: { count: absent.length, byZone: absent.reduce((o, r) => (o[r.zone] = (o[r.zone] || 0) + 1, o), {}), keys: absent },
    promoted: { count: promoted.length, byZone: promoted.reduce((o, r) => (o[r.zone] = (o[r.zone] || 0) + 1, o), {}), keys: promoted },
    method: 'per laser maximum: median brightness and dark fraction of the 0.32 m orthophoto inside the crown radius (floor 1.5 m) about the apex; open = median >= 88 and dark < 10% (the clear-fell calibration of trace-canopy-changes.mjs), crown = median <= 80 and dark >= 15%; distinct = the 1.4-2.4 radius annulus reads 25 brighter than the disc; a promotion also needs excess green >= 3',
    limitations: ['A May capture: birch and aspen are half in leaf, so a thin deciduous crown on turf can read unclear; unclear is kept, never promoted.',
      'The imagery confirms a crown stood there in 2026; heights and radii stay the laser\'s 2021 measurement.',
      'A crown inside closed forest cannot be distinguished from its neighbours in either record; it stays in the stand field.'],
  };
  fs.writeFileSync(path.join(ROOT, 'geo_data/course-v2/tortuna/vegetation/ortho-crown-review.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'tortunabuild/cache/vegetation/ortho-approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
  console.log(JSON.stringify({ counts, byZone, machineApproved: machine.size, approved: approvals.length, refused: report.refused.count, refusedByZone: report.refused.byZone, promoted: report.promoted.count, promotedByZone: report.promoted.byZone }, null, 1));
}
