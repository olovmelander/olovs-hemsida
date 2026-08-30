/* Build Mellanbanan's course model: its own nine holes, the Stora banan's
   environment, and the Stora banan itself carried across as SCENERY.

   usage: node upsalabuild/reconcile-mellanbanan.mjs

   The nine share their ground with the eighteen but not their play. Everything
   the eighteen's model says about the PLACE -- terrain, water, woods, roads,
   buildings, the clubhouse -- is the same place and is reused verbatim. What
   changes is which holes are played: Mellanbanan's nine become `holes`, and the
   Stora banan's greens, fairways and tees become `scenery`, because otherwise
   standing on Mellanbanan you would see the championship course rendered as
   rough. That is exactly what M.scenery is for, and it is symmetric: on the
   eighteen's card, Mellanbanan will be the scenery.

   The hole lines come from the club's own banguide, registered to the world
   through three OSM ponds (see trace-mellanbanan.mjs) and then set to the card's
   exact length. Greens, fairways and tee pads are SYNTHESISED around those lines
   and marked prov:"synth" -- the club drew where the holes are, not the shape of
   every green, and this file does not pretend otherwise. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const parent = readJSON(path.join(HERE, 'course-model.json'));
const card = readJSON(path.join(HERE, 'card-mellanbanan.json'));
const traced = readJSON(path.join(HERE, 'mellanbanan-traced.json'));

/* Real ground heights for each tee and green, decoded from the SAME heightfield
   the eighteen uses -- it is the same hill. The HUD prints "Spelas N m uppför"
   from these, so a placeholder here is a false statement about the hole, not a
   missing nicety: h.elev is an object {tee, green, rise}, and setting it to a
   number is what made the first build throw on h.elev.rise.toFixed. */
const hf = readJSON(path.join(HERE, 'heightfields.json')).hf0;
/* The field is deflate-raw, then two byte planes, then zigzag deltas against a
   Paeth-style predictor. This is decodeHF from the engine's codec, inverted the
   same way -- a first attempt that read it as plain little-endian pairs produced
   a perfectly flat course at 21 m, which is what a wrong decode looks like when
   it does not throw. */
const hfBytes = zlib.inflateRawSync(Buffer.from(hf.b64, 'base64'));
const heights = (() => {
  const { nx, nz, h0, hs } = hf, n = nx * nz;
  const out = new Float32Array(n), q = new Int32Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const zz = hfBytes[k] | (hfBytes[n + k] << 8);
    const d = (zz >>> 1) ^ -(zz & 1);
    const a = i ? q[k - 1] : 0;
    const b = j ? q[k - nx] : (i ? q[k - 1] : 0);
    const c = (i && j) ? q[k - nx - 1] : b;
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    q[k] = ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)) + d;
    out[k] = h0 + q[k] * hs;
  }
  return out;
})();
const groundAt = (x, z) => {
  const fx = (x - hf.x0) / hf.dx, fz = (z - hf.z0) / hf.dx;
  const i = Math.max(0, Math.min(hf.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(hf.nz - 2, Math.floor(fz)));
  const tx = fx - i, tz = fz - j, k = j * hf.nx + i;
  const a = heights[k], b = heights[k + 1], c = heights[k + hf.nx], d = heights[k + hf.nx + 1];
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
};

const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const polyLen = l => { let s = 0; for (let i = 1; i < l.length; i++) s += hyp(l[i - 1], l[i]); return s; };
/* an ellipse ring, which is what a synthesised green or tee honestly is */
const ellipse = (c, rx, rz, rot, n = 16) => {
  const co = Math.cos(rot), si = Math.sin(rot), out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    out.push([+(c[0] + x * co - z * si).toFixed(1), +(c[1] + x * si + z * co).toFixed(1)]);
  }
  return out;
};

const holes = card.holes.map(h => {
  const t = traced.holes[h.n];
  const line = t.line;
  const tee = line[0], green = line[line.length - 1];
  const b = Math.atan2(green[0] - tee[0], -(green[1] - tee[1]));   /* north is -z */
  const F = [Math.sin(b), -Math.cos(b)], R = [-Math.cos(b), Math.sin(b)];

  /* the green: a little past the line's end, sized by par as a real one is */
  const gr = h.par === 3 ? 13 : h.par === 5 ? 15 : 14;
  const gc = green;
  const greenRing = ellipse(gc, gr, gr * 0.78, b);

  /* the fairway: a corridor from 40 m out to the green's front, narrowing in.
     Par 3s get none, which is what a par 3 has. */
  const rings = [];
  if (h.par > 3) {
    const from = 42, to = Math.max(50, polyLen(line) - 18);
    const halfW = h.par === 5 ? 21 : 19;
    const pts = [];
    for (const [d, w] of [[from, halfW * 0.8], [(from + to) / 2, halfW], [to, halfW * 0.72]])
      pts.push([[tee[0] + F[0] * d + R[0] * w, tee[1] + F[1] * d + R[1] * w],
                [tee[0] + F[0] * d - R[0] * w, tee[1] + F[1] * d - R[1] * w]]);
    rings.push([...pts.map(p => p[0]), ...pts.reverse().map(p => p[1])]
      .map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]));
  }

  /* one tee pad per card tee, stepped back along the hole's own axis so each
     plays its printed length -- the same rule the six built courses use */
  const pads = [], marks = [];
  h.t.forEach((len, k) => {
    const back = len - h.t[0];                    /* 0 for the back tee, negative forward */
    const c = [green[0] - F[0] * len, green[1] - F[1] * len];
    pads.push({ ring: ellipse(c, 6.5, 4.6, b, 8), c: [+c[0].toFixed(1), +c[1].toFixed(1)],
                prov: 'synth', teeIdx: k });
    marks.push({ teeIdx: k, m: len, c: [+c[0].toFixed(1), +c[1].toFixed(1)],
                 b: +(b * 180 / Math.PI).toFixed(1) });
    void back;
  });

  return {
    n: h.n, par: h.par, idx: h.hcp, t: h.t,
    line: line.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]),
    lineLen: +polyLen(line).toFixed(1), lenDev: 0,
    lineSrc: 'club banguide, registered through OSM ponds; length from the card',
    green: { ring: greenRing, c: [+gc[0].toFixed(1), +gc[1].toFixed(1)], prov: 'synth', area: Math.round(Math.PI * gr * gr * 0.78) },
    fairway: { rings, prov: 'synth' },
    tees: { pads, marks },
    bunkers: [],
    pin: [+gc[0].toFixed(1), +gc[1].toFixed(1)],
    elev: (() => {
      const te = groundAt(tee[0], tee[1]), ge = groundAt(gc[0], gc[1]);
      return { tee: +te.toFixed(1), green: +ge.toFixed(1), rise: +(ge - te).toFixed(1) };
    })(),
    tiers: 1,
    name: null, note: null,
    conf: 'provisional: routing from the club banguide, shapes synthesised',
  };
});

/* the eighteen becomes scenery -- its mown ground must still read as mown */
const P = parent.scenery || {};
const scenery = {
  greens: [...(P.greens || []), ...parent.holes.map(h => h.green.ring)],
  fairways: [...(P.fairways || []), ...parent.holes.flatMap(h => h.fairway.rings)],
  tees: [...(P.tees || []), ...parent.holes.flatMap(h => h.tees.pads.map(p => p.ring))],
  bunkers: [...(P.bunkers || []), ...parent.holes.flatMap(h => h.bunkers.map(b => b.ring))],
  grass: P.grass || [],
  range: P.range || [],
};

const model = {
  version: parent.version,
  origin: parent.origin, mPerLat: parent.mPerLat, mPerLon: parent.mPerLon, frame: parent.frame,
  seaLevel: parent.seaLevel,
  card: card.holes.map(h => ({ n: h.n, par: h.par, hcp: h.hcp, t: h.t })),
  holes,
  water: parent.water, streams: parent.streams, coast: parent.coast,
  vegetation: parent.vegetation, infra: parent.infra, pois: parent.pois,
  scenery,
  note: 'Upsala GK Mellanbanan. Environment shared verbatim with the Stora banan (upsalabuild/course-model.json); the eighteen is carried here as scenery. Hole routing from the club banguide registered through three OSM ponds; hole lengths exact from the club card; greens, fairways and tee pads synthesised and marked prov:"synth".',
};

fs.writeFileSync(path.join(HERE, 'mellanbanan-model.json'), JSON.stringify(model) + '\n');
const tot = holes.reduce((s, h) => s + h.lineLen, 0);
console.log(`nine holes, par ${holes.reduce((s, h) => s + h.par, 0)}, drawn total ${tot.toFixed(0)} m against card ${card.printedOut.Vit} m`);
console.log(`scenery carried from the eighteen: ${scenery.greens.length} greens, ${scenery.fairways.length} fairway rings, ${scenery.tees.length} tee pads`);
console.log('wrote upsalabuild/mellanbanan-model.json');
