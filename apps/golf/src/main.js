
/* ===========================================================================
   Ängsö Golfklubb — a course on a Mälaren peninsula at Stora Bodarna.

   The geometry in the GEODATA block below is not drawn by hand or generated
   from a description. It is the fusion of the club's card, the four holes
   OpenStreetMap has surveyed here (with their real hole numbers), outlines
   traced from orthorectified satellite imagery for the other fourteen, and an
   elevation model -- reconciled by angsobuild/, which prints how far they
   disagree.

   Two things about this place are easy to get wrong, and the scene must not.
   The course is NOT on Ängsön: it sits on the mainland peninsula immediately
   north of the island, across Spånsundet -- the island's edge is some 700 m
   south of the clubhouse and the bridge to it a little beyond that. And the
   reserve next door is Ängsö NATURRESERVAT in Västmanland, not the Ängsö
   national park of the same name, which is an island 100 km east in the
   Roslagen archipelago.

   Conventions worth knowing before editing:
     - Local metres about ORIGIN. North is -z, east is +x. A compass bearing is
       atan2(dx, -dz). Forward for a bearing b is (sin b, cos b), so the player's
       right hand is (-cos b, sin b). The reflected version of that looks entirely
       plausible and has mirrored every sided feature on a course once before.
     - Heights are metres above sea level, unshifted. Mälaren wraps the
       peninsula on three sides; every pond on the course carries its own
       measured level, which is why they are pools here rather than craters with
       a sheet of water laid across them.
   =========================================================================== */

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, color, uniform, attribute, varying, texture, uv,
  positionWorld, positionLocal, normalWorld, normalLocal, cameraPosition, time as __liveTime,
  mix, smoothstep, clamp, pow, max, min, abs, sin, cos, dot, normalize, fract,
  floor, step, exp, sqrt, length, cross, saturate, oneMinus, select, luminance, fwidth,
  mx_noise_float, mx_fractal_noise_float, pass, screenUV, positionView, reflect,
  normalMap, bumpMap, transformedNormalView,
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { loadCourse } from './loader/pack.js';
import { buildScenery, loadSceneryModule } from './engine/scenery/index.js';
import { buildRail } from './shell/rail.js';
import { buildNavDrawer } from './shell/menu.js';
import { legacyTarget, goToCourse } from './shell/router.js';
import { inflate, decodeHF } from './engine/codec.js';
import { TAU, clampf, hyp, lerp, smooth, rightOf, polyLen, alongLine, ptSegD, distToLine, ringBBox, inRing, ringSD, centroidOf, hash2, vnoise, fbm } from './engine/geom.js';
import { createClassifier, SURFACE } from './engine/surface.js';
import { createGroundAtlas } from './engine/atlas.js';
import { buildGroundSurfaceFeatures } from './engine/surface-features.mjs';
import { createV2GroundMaterialDecorator, makeGround } from './engine/material.js';
import { createGroundHeightSampler } from './engine/ground-height-sampler.mjs';
import { loadPuttomTerrainPreview } from './engine/v2-puttom-preview.mjs';

/* ?det=1 pins the clocks -- the TSL time uniform driving water and clouds, and
   the flag-cloth wave -- so two boots render the same pixels. Phase 0 proved the
   pin is all the determinism this engine needs; from phase 2 the app is
   hand-maintained source, so the parity contract lives here as a runtime switch
   instead of a special build. */
const DET = new URLSearchParams(location.search).get('det') === '1';
const groundMode = new URLSearchParams(location.search).get('ground') === 'mesh' ? 'mesh' : 'atlas';
const time = DET ? float(3.25) : __liveTime;

/* ------------------------------------------------------------------ boot ui */
const bootEl = document.getElementById('boot');
const barEl = document.querySelector('#bar i');
const msgEl = document.getElementById('bmsg');
const bootStarted = performance.now();
const BOOT_PERF = { marks: [], atlasMs: 0, totalMs: 0 };
let step0 = 0;
const STEPS = ['terräng', 'vatten', 'banan', 'skog', 'ljus', 'klar'];
const tick = (msg, frac) => {
  BOOT_PERF.marks.push({ name: msg, atMs: +(performance.now() - bootStarted).toFixed(1) });
  msgEl.textContent = msg;
  barEl.style.width = (frac * 100).toFixed(0) + '%';
  return new Promise(r => setTimeout(r, 20));
};
let workSliceStarted = performance.now();
const shouldYieldWork = () => performance.now() - workSliceStarted >= 42;
const yieldWork = () => new Promise(resolve => setTimeout(() => {
  workSliceStarted = performance.now();
  resolve();
}, 0));

/* the course, fetched: everything below this line is data-driven. Which course
   is the ?bana= deep link; the manifest's first entry stands in until the
   phase-5 rail replaces defaults with a choice. */
/* A link to one of the six standalone pages resolves here, view intact. This
   runs before the pack is fetched: redirecting after a 400 KB download would
   work and would still be wrong. */
{
  const to = legacyTarget(location.pathname, location.search);
  if (to) { location.replace(to); throw new Error('redirecting to ' + to); }
}
const rawBana = new URLSearchParams(location.search).get('bana');
const isBareVisit = !rawBana;
const COURSE = await loadCourse(rawBana);
const CMETA = COURSE.meta;
const PACK = COURSE.pack;

if (isBareVisit) {
  document.title = 'Banvy 3D — Svenska golfbanor i realtid';
  const bt = document.getElementById('bootTitle');
  const bs = document.getElementById('bootSub');
  if (bt) bt.textContent = 'Banvy 3D';
  if (bs) bs.textContent = 'Svenska golfbanor i 3D · Förbereder grafik';
} else {
  document.title = CMETA.title;
  const bt = document.getElementById('bootTitle');
  const bs = document.getElementById('bootSub');
  if (bt) bt.textContent = CMETA.club;
  if (bs) bs.textContent = `${CMETA.tag} · ${CMETA.holes} hål · Par ${CMETA.par}`;
}

const hdNameEl = document.getElementById('hdName');
if (hdNameEl) hdNameEl.textContent = CMETA.name;
const hdsubEl = document.getElementById('hdsub');
if (hdsubEl) hdsubEl.textContent = `${CMETA.tag} · ${CMETA.holes} hål`;
{
  /* the tee-hiding breakpoint is per course (a 6-tee card needs the room a
     3-tee card never uses), so the rule is written here, not in the stylesheet */
  const st = document.createElement('style');
  st.textContent =
    `@media(max-width:980px){#tees .tee:nth-child(n+${CMETA.tees.hideFrom}){display:none}}` +
    `@media(max-width:700px){#tees .tee:nth-child(n+${CMETA.tees.hideFrom}){display:block}}`;
  document.head.append(st);
}
/* resolved here because the PLANTER needs it, and the planter runs long before
   the landmarks do: a course whose forest is not the engine's default says so. */
const SCENERY = await loadSceneryModule(CMETA.slug);
const GEO = PACK.H.GEO;
const HF0 = PACK.H.HF0;
const HF1 = PACK.H.HF1;

await tick('läser terrängdata', 0.04);
/* The preview is opt-in and dynamically imports its verifier only for
   ?bana=puttom&v2=1. Start its bounded tile requests beside GPK1 inflation so
   the integrity work does not serialize the boot. A failed or absent preview
   resolves to an explicit fallback state and never blocks the normal course. */
const terrainPreviewPromise = loadPuttomTerrainPreview({
  slug: CMETA.slug,
  geo: GEO,
  packSha256: CMETA.sha256,
  search: location.search,
});
const [b0, b1, bv, TERRAIN_PREVIEW] = await Promise.all([
  inflate(PACK.s0), inflate(PACK.s1), inflate(PACK.sv), terrainPreviewPromise,
]);
const H0 = decodeHF(HF0, b0), H1 = decodeHF(HF1, b1);
const M = JSON.parse(new TextDecoder().decode(bv));
const HOLES = M.holes;

const terrainPreviewBadge = document.getElementById('v2TerrainBadge');
function setTerrainPreviewBadge(backend = null, renderState = null, meshMetres = null) {
  if (!terrainPreviewBadge || !TERRAIN_PREVIEW.requested) return;
  terrainPreviewBadge.hidden = false;
  const title = terrainPreviewBadge.querySelector('b');
  const detail = terrainPreviewBadge.querySelector('span');
  if (TERRAIN_PREVIEW.ready && renderState !== 'failed') {
    terrainPreviewBadge.dataset.state = renderState === 'ready' ? 'ready' : 'loading';
    title.textContent = '1 M TERRÄNG · PREVIEW';
    detail.textContent = [
      'Puttom',
      `${TERRAIN_PREVIEW.resources.length} verifierade tiles`,
      backend,
      meshMetres ? `1 m höjd · ${meshMetres} m mesh` : null,
    ].filter(Boolean).join(' · ');
  } else {
    terrainPreviewBadge.dataset.state = 'fallback';
    title.textContent = 'STANDARDTERRÄNG · FALLBACK';
    detail.textContent = CMETA.slug === 'puttom'
      ? '1 m-previewn kunde inte verifieras'
      : '1 m-previewn är ännu bara aktiverad för Puttom';
  }
}
setTerrainPreviewBadge();
/* How many holes this course HAS, rather than the eighteen every course here has
   happened to have. Upsala's Mellanbanan and Johannesberg's nine are nines, and
   they share their parent's environment as separate courses rather than becoming
   holes 19-27 of it -- so the hole strip, the wraparound to the next tee, the
   goHole clamp and the tour all have to read the card instead of assuming. */
const NHOLES = HOLES.length;

/* --------------------------------------------------------------------- AO
   How much of the sky a point can actually see. Without it every slope facing the
   sun renders at full irradiance and a hillside of dry fescue comes out the colour
   of a sand dune, because nothing in the lighting model knows that a hillside sits
   in the bottom of its own landscape. Six directions at two radii, sampled against
   the elevation model rather than the sculpted surface -- this is the shape of the
   land occluding itself, and the metre-scale detail neither adds nor removes sky. */
const AO_DIRS = [];
for (let i = 0; i < 6; i++) AO_DIRS.push([Math.cos(i / 6 * TAU), Math.sin(i / 6 * TAU)]);
function horizonAO(x, z, h) {
  let occ = 0;
  for (const [dx, dz] of AO_DIRS) {
    let m = 0;
    for (const r of [14, 46]) {
      const s = (demH(x + dx * r, z + dz * r) - h) / r;
      if (s > m) m = s;
    }
    occ += Math.min(1, m * 2.4);
  }
  return 1 - (occ / 6) * 0.42;
}

/* ------------------------------------------------------------ elevation */
function sampleGrid(G, S, x, z) {
  const fx = (x - S.x0) / S.dx, fz = (z - S.z0) / S.dx;
  if (fx < 0 || fz < 0 || fx > S.nx - 1.001 || fz > S.nz - 1.001) return null;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * S.nx + i;
  return lerp(lerp(G[k], G[k + 1], tx), lerp(G[k + S.nx], G[k + S.nx + 1], tx), tz);
}
/* the course at 4 m, the vista at 32 m, cross-faded over the last 130 m of the
   fine grid so the join is a slope rather than a step */
function demH(x, z) {
  const previewHeight = TERRAIN_PREVIEW.heightAt(x, z);
  if (Number.isFinite(previewHeight)) return previewHeight;
  const a = sampleGrid(H0, HF0, x, z);
  const b = sampleGrid(H1, HF1, x, z) ?? a ?? 0;
  if (a === null) return b;
  const edge = Math.min(x - HF0.x0, HF0.x0 + (HF0.nx - 1) * HF0.dx - x,
                        z - HF0.z0, HF0.z0 + (HF0.nz - 1) * HF0.dx - z);
  const w = smooth(0, 130, edge);
  return lerp(b, a, w);
}

/* --------------------------------------------------- spatial index of the
   course, so terrainH and the classifier are not O(features) per sample */
const CELL = 24;
class Grid {
  constructor() { this.m = new Map(); this.list = []; }
  add(rec, bb, pad = 0) {
    this.list.push(rec);
    const i0 = Math.floor((bb.x0 - pad) / CELL), i1 = Math.floor((bb.x1 + pad) / CELL);
    const j0 = Math.floor((bb.z0 - pad) / CELL), j1 = Math.floor((bb.z1 + pad) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + ',' + j;
      let a = this.m.get(k); if (!a) this.m.set(k, a = []);
      a.push(rec);
    }
  }
  at(x, z) { return this.m.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || []; }
}

/* surface ids -- the roughness and detail tables below are indexed by these */
const S_ROUGH = SURFACE.ROUGH, S_SEMI = SURFACE.SEMI, S_FAIR = SURFACE.FAIRWAY,
      S_GREEN = SURFACE.GREEN, S_FRINGE = SURFACE.FRINGE, S_TEE = SURFACE.TEE,
      S_SAND = SURFACE.SAND, S_PATH = SURFACE.PATH, S_HEATH = SURFACE.HEATH,
      S_FOREST = SURFACE.FOREST, S_SHORE = SURFACE.SHORE;

const GI = new Grid();      // greens
const TI = new Grid();      // tee pads
const BI = new Grid();      // bunkers
const FI = new Grid();      // fairways + mown scenery
const WI = new Grid();      // water bodies
const VI = new Grid();      // forest / scrub / sand / rock
const PI = new Grid();      // paths and tracks (as polylines)

/* A TEE MARKER HAS TO STAND ON A TEE.

   The card carries three to six tees a hole; the surveys mapped one or two pads.
   Measured across the six courses, only 24-63% of tee markers had any prepared
   ground under them at all -- the rest were a pair of coloured balls sitting in
   the rough, and `?vy=tee` opened the hole standing there. Veckefjärden looked
   best (63%) for one reason: its pipeline already synthesises a pad per card tee
   and marks it prov:"synth". The other five never did.

   So the same inference is made here, once, before anything reads the pads: any
   mark no mapped pad covers gets a deck at the mark, squared to the hole's own
   bearing. Everything downstream then just works -- TI benches it level in
   terrainH, the atlas rasterises it as SURFACE.TEE, the marker lands on mown
   grass. It is an inference and it says so (prov:"synth"); what is NOT invented
   is where the tee is, which the card's own length fixed.

   Deck size follows Veckefjärden's own synth pads: 10.4 m across the line by
   8.8 m along it, the shape of a real teeing ground rather than a square. */
for (const h of HOLES) {
  const pads = h.tees.pads;
  for (const mk of h.tees.marks || []) {
    if (pads.some(p => inRing(mk.c[0], mk.c[1], p.ring))) continue;
    const b = mk.b * Math.PI / 180;
    const F = [Math.sin(b), Math.cos(b)], R = [-Math.cos(b), Math.sin(b)];
    const HW = 5.2, HD = 4.4;
    pads.push({
      prov: 'synth', teeIdx: mk.teeIdx, c: [mk.c[0], mk.c[1]],
      ring: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
        [mk.c[0] + R[0] * HW * u + F[0] * HD * v,
         mk.c[1] + R[1] * HW * u + F[1] * HD * v]),
    });
  }
}

/* A SHORELINE IS A CURVE, AND THE TRACE IS A POLYGON.

   The surveyed water rings run in straight segments -- around Veckefjärden's
   island 14th they average 15 m and reach 48 m -- and the visible waterline is
   where terrainH crosses the water level, which that ring carves. So the island
   came out as a faceted plate with hard corners where the club's photographs
   show a smooth rounded promontory.

   Two passes, in the order that matters: split the long segments so a curve CAN
   exist, then average the points so it is one. Only near the played ground --
   the shoreline that matters is the shoreline you stand next to, and this ring
   is walked by terrainH for every terrain sample, so making the whole fjärd
   dense would be paid for on ground nobody ever sees. Nothing finer than the
   4 m terrain grid is worth resolving, which is why the split is 3 m. */
function smoothShore(ring, near, step = 3, passes = 3, minPts = 8) {
  if (!ring || ring.length < minPts) return ring;
  const dense = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    dense.push(a);
    if (!near(a) && !near(b)) continue;
    const n = Math.min(24, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k < n; k++)
      dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  /* light averaging passes: corner-cutting without the point doubling chaikin
     would add, and it leaves anything outside `near` exactly as traced */
  let out = dense;
  for (let pass = 0; pass < passes; pass++) {
    const next = out.slice();
    for (let i = 0; i < out.length; i++) {
      if (!near(out[i])) continue;
      const p = out[(i - 1 + out.length) % out.length], q = out[(i + 1) % out.length];
      next[i] = [(p[0] + out[i][0] * 2 + q[0]) / 4, (p[1] + out[i][1] * 2 + q[1]) / 4];
    }
    out = next;
  }
  return out;
}
{
  /* "near" is the played ground plus a margin, which is where a shoreline is
     ever seen close enough for its facets to show. Derived from the holes
     themselves because playB is not built until much further down. */
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const h of HOLES) for (const p of h.line) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  const M0 = 180;
  const near = p => p[0] > x0 - M0 && p[0] < x1 + M0 && p[1] > z0 - M0 && p[1] < z1 + M0;
  for (const w of M.water) {
    if (w.stream || !w.ring) continue;
    w.ring = smoothShore(w.ring, near);
  }
  /* The silt shallows are traced far coarser than the water is -- 12 points with
     a 64 m median segment and one of 427 m -- and they draw the pale margin
     right where the eye is, just off the island 14th. Same treatment. */
  if (M.surround && M.surround.shallows)
    M.surround.shallows = M.surround.shallows.map(r => smoothShore(r, near));

  /* THE MOWN EDGES, for the same reason and at a finer step.
     Measured across the six courses, fairway rings run a 10-31 m MEDIAN segment
     and reach 136 m, and a green -- about 20 m across -- carries a 4-7 m median,
     which makes it a twelve-sided polygon. Those are the longest boundaries on a
     hole and the most obviously straight.

     The cost lands in different places and that is what makes this affordable:
     fairway rings are rasterised into the atlas ONCE and are not walked
     per-sample in atlas mode, so densifying them is nearly free. Green and tee
     rings ARE walked per terrain sample (their pads, and the scatter apron), so
     they get a coarser step and fewer passes -- enough to round a polygon, not
     enough to multiply the ring. */
  const always = () => true;
  for (const h of HOLES) {
    h.green.ring = smoothShore(h.green.ring, always, 2.0, 2, 6);
    h.fairway.rings = h.fairway.rings.map(r => smoothShore(r, always, 2.5, 3, 6));
    for (const t of h.tees.pads) if (t.prov !== 'synth') t.ring = smoothShore(t.ring, always, 2.5, 1, 6);
  }
  M.scenery.fairways = M.scenery.fairways.map(r => smoothShore(r, always, 2.5, 3, 6));
  M.scenery.greens = M.scenery.greens.map(r => smoothShore(r, always, 2.0, 2, 6));
}

for (const h of HOLES) {
  const g = { ring: h.green.ring, bb: ringBBox(h.green.ring), hole: h.n, c: h.green.c };
  GI.add(g, g.bb, 26);
  h._g = g;
  for (const t of h.tees.pads) { const r = { ring: t.ring, bb: ringBBox(t.ring) }; TI.add(r, r.bb, 12); }
  for (const b of h.bunkers) { const r = { ring: b.ring, bb: ringBBox(b.ring), c: centroidOf(b.ring) }; BI.add(r, r.bb, 9); b._r = r; }
  for (const r of h.fairway.rings) { const q = { ring: r, bb: ringBBox(r) }; FI.add(q, q.bb, 16); }
}
for (const r of M.scenery.fairways.concat(M.scenery.greens, M.scenery.tees, M.scenery.grass, M.scenery.range)) {
  const q = { ring: r, bb: ringBBox(r), scen: true }; FI.add(q, q.bb, 12);
}
for (const r of M.scenery.bunkers) { const q = { ring: r, bb: ringBBox(r) }; BI.add(q, q.bb, 8); }
for (const w of M.water) { const q = { ring: w.ring, bb: ringBBox(w.ring), level: w.level, isLake: w.isLake }; WI.add(q, q.bb, 30); }
for (const [k, rs] of Object.entries(M.veg))
  for (const r of rs) { const q = { ring: r, bb: ringBBox(r), kind: k }; VI.add(q, q.bb, 6); }
for (const p of M.infra.paths.concat(M.infra.tracks)) {
  const q = { line: p.line, bb: ringBBox(p.line), w: p.kind === 'track' ? 1.7 : p.kind === 'service' ? 1.9 : 1.5 };
  PI.add(q, q.bb, 6);
}
for (const r of M.infra.roads) {
  const q = { line: r.line, bb: ringBBox(r.line), w: r.kind === 'trunk' ? 8 : 4 };
  PI.add(q, q.bb, r.kind === 'trunk' ? 12 : 8);
}
for (const rw of (M.infra.railway || [])) {
  const q = { line: rw.line, bb: ringBBox(rw.line), w: 4 };
  PI.add(q, q.bb, 8);
}
const II = new Grid();      // building footprints, so nothing grows through a wall
for (const b of M.infra.buildings) { const q = { ring: b.ring, bb: ringBBox(b.ring) }; II.add(q, q.bb, 10); }
for (const p of (M.infra.parking || [])) { const q = { ring: p.ring, bb: ringBBox(p.ring) }; II.add(q, q.bb, 8); }
const LI = new Grid();      // landuse: fields, gardens, industry -- ground tint and scatter policy
for (const l of (M.infra.landuse || [])) { const q = { ring: l.ring, bb: ringBBox(l.ring), kind: l.kind }; LI.add(q, q.bb, 6); }
const SI = new Grid();      // traced surroundings: clear-fells, the machinery yard, the hayfields
if (M.surround) {
  for (const ring of (M.surround.clearfells || [])) { const q = { ring, bb: ringBBox(ring), kind: 'cut' }; SI.add(q, q.bb, 6); }
  if (M.surround.yard) { const q = { ring: M.surround.yard, bb: ringBBox(M.surround.yard), kind: 'yard' }; SI.add(q, q.bb, 6); }
  if (M.surround.hayfields) { const q = { ring: M.surround.hayfields, bb: ringBBox(M.surround.hayfields), kind: 'hay' }; SI.add(q, q.bb, 6); }
}
const RES = (M.infra.reserves || []).map(r => ({ ring: r.ring, bb: ringBBox(r.ring) }));
const SHAL = ((M.surround && M.surround.shallows) || []).map(r => ({ ring: r, bb: ringBBox(r) }));
/* A course may declare that one of its holes stands behind an ARMOURED shore --
   dumped stone at the waterline rather than a mown bank. Three things follow and
   the engine asks for all three: the carve stands proud of the water, the
   waterline band is granite grey instead of bleached sand, and boulders pack
   along the ring. The hole is NAMED, not the coordinate written down: its green
   centre is already in the pack, so the module states a fact about the course
   rather than a number about the frame. */
const ARM = (() => {
  const a = SCENERY && SCENERY.armour;
  const g = a && M.holes[a.hole - 1] && M.holes[a.hole - 1].green;
  return g ? { c: g.c, rise: a.rise, paint: a.paint, colour: a.colour } : null;
})();
/* holes the far-vista forest ring must leave open, declared by the course */
const CLEARINGS = (SCENERY && SCENERY.clearings) || [];
/* How this club's clubhouse actually looks. The defaults are Veckefjärden's --
   the old school, cream render under a dark red roof, three storeys of windows --
   because that is the building this code was written from. Every other course
   overrides them from its own photographs; aerial imagery gives a roof but never
   a facade, so these came from pictures taken on the ground. */
const CLUB_LOOK = Object.assign(
  { wall: 0xe7e2d4, roof: 0x9d3f2e, height: 5.4, windowRows: [1.4, 3.5], terrace: true },
  (SCENERY && SCENERY.clubhouse) || {});
const HV = (M.infra.power ? M.infra.power.lines : []).filter(l => (l.voltage || 0) >= 100000);
for (const s of M.streams) { const q = { line: s.line, bb: ringBBox(s.line), w: s.w, stream: true }; WI.add(q, q.bb, 14); }

/* --------------------------------------------------------------- terrain
   The elevation model is a 2 m lidar product resampled to 4 m: it knows the hill
   the hole climbs but not the metre-scale shaping a green complex is made of. So
   the ground is the model, and everything a greenkeeper built is added on top. */
/* The clubhouse stands on a levelled bench with a mown lawn running right up to
   its terrace -- the ground photographs show fresh green turf on every side, not
   the scrub slope the raw DEM colouring gave it. One building gets a pad; the
   bbox guard keeps the cost out of the other million terrainH calls. */
const CLUB = (() => {
  const b = (M.infra.buildings || []).find(q => q.name && /golfklubb/i.test(q.name));
  if (!b) return null;
  let base = Infinity, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of b.ring) {
    base = Math.min(base, demH(p[0], p[1]));
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  const c = centroidOf(b.ring);
  return { ring: b.ring, base: base + 0.22, cx: c[0], cz: c[1],
           bb: { x0: x0 - 36, x1: x1 + 36, z0: z0 - 36, z1: z1 + 36 } };
})();

/* Before the terrain meshes exist this is the legacy analytic sculpt used to
   build them. Once the meshes are installed, terrainH is switched to the shared
   visible-ground sampler below so camera, water, surfaces and objects cannot
   disagree with the terrain that the renderer actually presents. */
let visibleGroundHeightAt = null;
function terrainH(x, z) {
  return visibleGroundHeightAt ? visibleGroundHeightAt(x, z) : legacyTerrainH(x, z);
}
function legacyTerrainH(x, z) {
  let h = demH(x, z);

  /* greens: a pad flat enough to putt on, tilted gently back to front, tiered
     where the guide says the green is tiered */
  /* how much prepared pad (green or tee) is present here -- the bunker hollow
     below yields to it, so a greenside bunker cannot pull the putting surface
     down with it */
  let padW = 0;
  for (const g of GI.at(x, z)) {
    const sd = ringSD(x, z, g.ring);
    if (sd > 22) continue;
    const w = 1 - smooth(-1.5, 14, sd);
    if (w <= 0.001) continue;
    padW = Math.max(padW, w);
    const base = demH(g.c[0], g.c[1]);
    const hole = HOLES[g.hole - 1];
    const p = alongLine(hole.line, 0.995);
    const F = [Math.sin(p.b), Math.cos(p.b)];
    const along = (x - g.c[0]) * F[0] + (z - g.c[1]) * F[1];   // + is past the pin
    let pad = base + 0.35 - along * 0.021;                      // back-to-front fall
    if (hole.tiers > 1) pad += Math.tanh(along * 0.26) * 0.42;
    pad += Math.sin(x * 0.115) * Math.cos(z * 0.104) * 0.11;    // borrow
    h = lerp(h, pad, w);
  }
  /* tees: dead level decks */
  for (const t of TI.at(x, z)) {
    const sd = ringSD(x, z, t.ring);
    if (sd > 9) continue;
    const w = 1 - smooth(-0.5, 6.5, sd);
    if (w <= 0.001) continue;
    padW = Math.max(padW, w);
    if (t.base === undefined) { const c = centroidOf(t.ring); t.base = demH(c[0], c[1]); }
    h = lerp(h, t.base + 0.28, w);
  }
  /* the clubhouse bench: level under the footprint, feathered into its slope */
  if (CLUB && x > CLUB.bb.x0 && x < CLUB.bb.x1 && z > CLUB.bb.z0 && z < CLUB.bb.z1) {
    const sd = ringSD(x, z, CLUB.ring);
    if (sd < 22) h = lerp(h, CLUB.base, 1 - smooth(2.5, 22, sd));
  }
  /* Bunkers: a dished floor and a rolled lip. Both terms are continuous through the
     edge, which the first version was not -- it dropped 0.32 m the instant a sample
     crossed inside and raised 0.34 m just outside, so the rim was a two-thirds-metre
     cliff. On a 4 m grid that tears into the jagged flaps that were showing up round
     every bunker. */
  for (const b of BI.at(x, z)) {
    const sd = ringSD(x, z, b.ring);
    if (sd > 9) continue;
    const r = Math.max(4, Math.min(14, (b.bb.x1 - b.bb.x0 + b.bb.z1 - b.bb.z0) * 0.25));
    /* the lip's falloff must be wider than the 4 m grid that carries it: at 1.7 m
       the core mesh, the sand overlay and the collar each sampled a different lip
       and the rim came apart into floating flaps */
    h += 0.30 * Math.exp(-Math.abs(sd) / 3.4);               /* the rolled lip */
    /* The hollow reaches OUTSIDE the sand, and that is a sampling fix, not a
       style choice. A dish that is zero exactly at the ring has to do all of its
       falling within the bunker, and a bunker is often narrower than two cells of
       a 4 m grid -- measured, the mesh was drawing 0.56 m of an intended 1.08 m,
       and eleven of Veckefjärden's 55 came out flatter than 0.25 m. Starting the
       fall a couple of metres out gives the grid something it can actually
       sample, and reads as what it is: sand sitting in a hollow.
       It yields to prepared pad, so a greenside bunker still cannot drag the
       putting surface down -- there, this is exactly the old carve. */
    const outward = 2.5 * (1 - padW);
    h -= 1.25 * smooth(-outward, r * 0.85, -sd);             /* the dish */
  }
  /* streams cut, ponds and the fjord hold their own measured level */
  let shoreDamp = 1;
  for (const w of WI.at(x, z)) {
    if (w.stream) {
      const d = distToLine(x, z, w.line);
      if (d < w.w * 3.4) h -= (0.55 + w.w * 0.16) * (1 - smooth(0, w.w * 3.4, d));
      if (d < w.w * 3.6) shoreDamp = Math.min(shoreDamp, smooth(w.w * 1.6, w.w * 3.6, d));
      continue;
    }
    const sd = ringSD(x, z, w.ring);
    if (sd > 26) continue;
    shoreDamp = Math.min(shoreDamp, smooth(2, 9, sd));
    /* the traced silt shallows: the satellite's wide pale margins are a bed a few
       decimetres down, not the metres the default carve digs */
    let shallow = false;
    if (w.isLake && sd < 0) for (const sr of SHAL) {
      if (x < sr.bb.x0 || x > sr.bb.x1 || z < sr.bb.z0 || z > sr.bb.z1) continue;
      if (ringSD(x, z, sr.ring) < 0) { shallow = true; break; }
    }
    if (shallow) { h = Math.min(h, w.level - 0.28); continue; }
    /* One continuous surface through the waterline: the bed falls away from it going
       in, the bank rises from it going out, and both are exactly the water's own
       level at the edge itself. Two separate branches meeting at a step made every
       shoreline a low cliff, which is a thing the 4 m grid then tore. */
    const bed = lerp(0, w.isLake ? 5.5 : 2.2, smooth(0, w.isLake ? 55 : 18, -sd));
    const bank = lerp(0, 0.9, smooth(0, 15, sd));
    const target = w.level - bed + bank;
    const wgt = 1 - smooth(0, 26, sd);
    h = sd < 0 ? Math.min(h, target) : lerp(h, Math.max(h, target), wgt * 0.75);
    /* an armoured shore is a berm of dumped stone, not a mown bank: proud of the
       waterline and lumpy at boulder scale, fading to nothing past the band so the
       carve stays continuous through its own edge */
    if (ARM && w.isLake && Math.hypot(x - ARM.c[0], z - ARM.c[1]) < ARM.rise) {
      const band = 1 - smooth(2, 5.5, Math.abs(sd));
      if (band > 0) h += (0.12 + fbm(x * 0.11, z * 0.11, 2) * 0.18) * band;
    }
  }

  /* The elevation model is a 2 m product resampled to 4 m, so everything finer than
     that has been averaged away and the ground comes out suspiciously smooth. This
     puts back relief at the scale each surface actually has it: rough is lumpy, a
     fairway is gently rolling, a green is nearly flat with just enough movement to
     borrow on, and woodland is the roughest ground on the property. Adding it
     uniformly would be worse than not adding it -- it is the contrast between a
     smooth green and lumpy rough that makes both read correctly. */
  const cls = microClass(x, z);
  /* damped to zero at the waterline: the fbm was added AFTER the shore carve, and
     around the island 14th it lifted patches of bed back above the fjord's level --
     slivers of land coplanar with the water, reading as a torn mesh */
  if (cls.amp > 0.001) h += fbm(x / cls.len, z / cls.len, 3) * cls.amp * seamFade(x, z) * shoreDamp;
  return h;
}

/* Fade the added relief out over the last 90 m of the fine grid so that where the
   coarse mesh shows through, it agrees. */
let SEAM = null;
function seamFade(x, z) {
  if (!SEAM) return 1;
  const d = Math.min(x - SEAM.x0, SEAM.x1 - x, z - SEAM.z0, SEAM.z1 - z);
  return smooth(-30, 90, d);
}

/* how much fine relief a point should have, by what is growing on it */
function microClass(x, z) {
  if (groundAtlas?.contains(x, z)) {
    const s = groundAtlas.sampleAt(x, z).surface;
    if (s === SURFACE.SAND) return { amp: 0.0, len: 20 };
    if (s === SURFACE.GREEN) return { amp: 0.05, len: 26 };
    if (s === SURFACE.TEE) return { amp: 0.03, len: 22 };
    if (s === SURFACE.FAIRWAY) return { amp: 0.26, len: 36 };
    if (s === SURFACE.FRINGE) return { amp: 0.12, len: 30 };
    if (s === SURFACE.SEMI) return { amp: 0.48, len: 32 };
    if (s === SURFACE.FOREST) return { amp: 1.35, len: 23 };
    /* The atlas proves no mown polygon owns this point, so the old green/tee/
       bunker/fairway ring walks are unnecessary. */
    return { amp: 1.05, len: 27 };
  }
  let green = 0, tee = 0, fair = 0, sand = 0, forest = 0;
  for (const g of GI.at(x, z)) { const sd = ringSD(x, z, g.ring); if (sd < 3) green = Math.max(green, 1 - smooth(-2, 3, sd)); }
  for (const t of TI.at(x, z)) { const sd = ringSD(x, z, t.ring); if (sd < 2) tee = Math.max(tee, 1 - smooth(-1, 2, sd)); }
  for (const b of BI.at(x, z)) { const sd = ringSD(x, z, b.ring); if (sd < 1) sand = Math.max(sand, 1 - smooth(-1, 1, sd)); }
  for (const f of FI.at(x, z)) { const sd = ringSD(x, z, f.ring); if (sd < 4) fair = Math.max(fair, 1 - smooth(-2, 4, sd)); }
  for (const v of VI.at(x, z)) {
    if (v.kind !== 'forest' && v.kind !== 'wood') continue;
    const sd = ringSD(x, z, v.ring);
    if (sd < 0) forest = Math.max(forest, 1);
  }
  const mown = Math.max(green, tee, fair);
  /* Wavelengths are chosen against the 4 m grid that carries them: anything under
     about 12 m aliases into noise instead of reading as ground. The blade-scale
     relief is the normal map's job, not the mesh's. */
  if (sand > 0.4) return { amp: 0.0, len: 20 };
  if (green > 0.4) return { amp: 0.05, len: 26 };
  if (tee > 0.4) return { amp: 0.03, len: 22 };
  if (fair > 0.4) return { amp: 0.26, len: 36 };
  const base = forest > 0.5 ? 1.35 : 1.05;
  return { amp: base * (1 - mown * 0.8), len: forest > 0.5 ? 23 : 27 };
}

/* The satellite canopy raster, classified and rasterised at 3 m: 0 unknown, 2 open,
   3 trees. Decoded here, before the ground is coloured, because it has the last word
   in BOTH directions: the planter reads it for where trees stand, and groundAt reads
   it so an OSM forest ring the imagery has thinned to scattered singles does not
   keep a closed-canopy floor. */
let coverAt = () => 0;
if (M.cover) {
  const cv = M.cover;
  const bytes = Uint8Array.from(atob(cv.b64), c => c.charCodeAt(0));
  coverAt = (x, z) => {
    const i = Math.floor((x - cv.x0) / cv.cell), j = Math.floor((z - cv.z0) / cv.cell);
    if (i < 0 || j < 0 || i >= cv.nx || j >= cv.nz) return 0;
    const k = j * cv.nx + i;
    return (bytes[k >> 2] >> ((k & 3) * 2)) & 3;
  };
}

/* The analytic classifier remains the oracle. Once the runtime atlas exists,
   high-volume consumers use its O(1) lookup inside CORE and fall back to the
   oracle outside it. */
let groundAtlas = null;
const classifyAnalytic = createClassifier({ GI, TI, BI, FI, PI, VI, HOLES, ringSD, distToLine, smooth });
const classify = (x, z) => {
  if (!groundAtlas?.contains(x, z)) return classifyAnalytic(x, z);
  const c = groundAtlas.classifyAt(x, z);
  /* THE APRON, and it is what keeps things off the mown ground.
     Every scatter loop -- trees, bushes, tufts, stones -- rejects a candidate
     whose `fair` is over about 0.05, and the analytic classifier supplied that
     by fading a fairway apron to 13 m around a green and 7 m around a tee. The
     atlas cannot: its SDF measures the distance to the ADJACENT class, and a
     green is ringed by its collar, so out in the rough it reads FRINGE and knows
     nothing about the green behind it. Losing the apron let trees stand at the
     very edge of a green -- and on the island 14th, where the green IS the
     island, that put one on the putting surface.
     Read from the rings themselves, which is exact. Only greens and tees walk
     rings here; fairways, bunkers, paths and forest all still come from the
     atlas, so this is a small fraction of the work the old classifier did. */
  for (const g of GI.at(x, z)) {
    const sd = ringSD(x, z, g.ring);
    if (sd < 13) c.fair = Math.max(c.fair, (1 - smooth(3, 13, sd)) * 0.85);
  }
  for (const t of TI.at(x, z)) {
    const sd = ringSD(x, z, t.ring);
    if (sd < 7) c.fair = Math.max(c.fair, (1 - smooth(1, 7, sd)) * 0.7);
  }
  return c;
};

/* --------------------------------------------------------------- palette
   Vertex colours go into a raw Float32Array, which r185 reads as linear working
   space, so they are converted here. Material colours must NOT get the same
   treatment -- Color(hex) is converted by three itself and doing it twice
   darkens by about 2.8x. */
const s2l = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const L = hex => [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
/* Authored as the colours grass actually is in daylight rather than the colours grass
   looks like in a photograph of a dark screen. A fairway is a yellow-green, not a
   forest green; the rough is browner and paler than the fairway, not darker, because
   fescue in a Swedish August is straw with green in it; and a green is bluer and
   deeper than the fairway around it. Those three relationships are most of what makes
   mown ground read as mown ground from 200 m away. */
/* nudged against the club's July aerial: the mown surfaces run brighter and
   greener than the first authoring -- a fresh-cut vividness, not a repaint */
const C = {
  rough:  L(0x62723d), fescue: L(0x847f4c), semi:  L(0x588c37),
  fair:   L(0x60a03e), green:  L(0x489a4c), fringe:L(0x649540),
  tee:    L(0x5c9d42), sand:   L(0xd6c396), path:  L(0x757168),
  /* the forest floor was 0x334423 -- against fog-lit turf it rendered near-black,
     and whole hillsides read as burnt ground; this is bilberry-and-litter brown,
     with the deepest shade kept for ground the satellite says is closed canopy */
  heath:  L(0x776c3f), forest: L(0x46512e), shore: L(0xb2a37e),
  wet:    L(0x6a7046), rock:   L(0x736e63),
  /* the surroundings: crop tones for the west-shore fields, slash for the
     clear-fells, hard gravel for the machinery yard, hay for the Ås meadows */
  cropA:  L(0xb59a4e), cropB: L(0x7a8f4a), cropC: L(0xa08b62),
  slash:  L(0x8a7a55), hard:  L(0x8a857b), hay:   L(0x9aa159), lawn: L(0x5f8a3f),
  aspT:   L(0x55565a), aspL:  L(0x5d5e60), soil:  L(0x6e6046), ballast: L(0x7a7570),
  riprap: L(0xa39e94),
};

/* how each surface is shaded: detail scale, bump strength, gloss, mow anisotropy */
const SHADE = {
  [S_ROUGH]: [0.62, 1.25, 0.06, 0], [S_SEMI]: [1.15, 0.62, 0.17, 0.5],
  /* the mow hierarchy runs fairway > tee > green: a green's rings are the tightest
     cut on the course and the QUIETEST -- at 1.75 the signature 14th read as a
     bullseye that out-shouted its own fairway */
  [S_FAIR]: [1.55, 0.44, 0.28, 1.15], [S_GREEN]: [2.85, 0.13, 0.54, 0.9],
  [S_FRINGE]: [2.0, 0.30, 0.34, 0.9], [S_TEE]: [2.2, 0.22, 0.40, 1.3],
  [S_SAND]: [2.3, 0.58, 0.14, 0], [S_PATH]: [3.2, 0.34, 0.18, 0],
  [S_HEATH]: [0.85, 1.05, 0.09, 0], [S_FOREST]: [0.55, 1.35, 0.05, 0],
  [S_SHORE]: [1.6, 0.75, 0.22, 0],
  [SURFACE.WETLAND]: [0.72, 0.92, 0.10, 0], [SURFACE.ROCK]: [1.8, 0.48, 0.16, 0],
  [SURFACE.ASPHALT]: [3.4, 0.18, 0.34, 0], [SURFACE.GRAVEL]: [2.6, 0.46, 0.12, 0],
  [SURFACE.DIRT]: [1.9, 0.55, 0.08, 0], [SURFACE.MUD]: [1.2, 0.38, 0.30, 0],
};

/* the colour and the four shading channels at a point */
function groundAt(x, z, h) {
  const c = classify(x, z);
  let col, sid;
  const n1 = fbm(x * 0.021, z * 0.021, 2), n2 = fbm(x * 0.11, z * 0.11, 2);

  /* base: heath on the sandy flats, fescue on the slopes, forest floor in the trees */
  /* Three grasses rather than one. This is heathland: fescue that has gone to straw
     on the sandy rises, coarser green rough in the hollows where it holds water, and
     bracken between them. Sampling that at three different wavelengths is what keeps
     a hundred hectares of rough from reading as one flat colour, which was what made
     the ground look painted rather than grown. */
  const n3 = fbm(x * 0.0052 + 40, z * 0.0052 - 17, 2);
  /* Steep ground is not mown, not grazed and mostly not grass: it is scrub and
     exposed till. Without this the whole ridge behind the 14th comes out as one
     enormous pale dune, which is the most obvious thing wrong with a heightfield
     that has been coloured by rule rather than by what grows on it. */
  const sl = Math.hypot(demH(x + 6, z) - demH(x - 6, z), demH(x, z + 6) - demH(x, z - 6)) / 12;
  /* ...but a carved bank inside the playing corridor is mown grass, however steep:
     the 16th tee's first sightline crossed a bank this recolour painted as raw till,
     and greens sit against faces steeper than the scrub threshold */
  const inPlay = (1 - smooth(16, 30, c.dLine)) * (1 - c.forest);
  const steep = smooth(0.30, 0.78, sl) * (1 - inPlay * 0.8);
  const heath = smooth(0.05, 0.55, n1 * 0.65 + n3 * 0.5) * (1 - c.forest) * (1 - steep * 0.85);
  const damp = smooth(0.30, -0.35, n1 * 0.5 + n3 * 0.75) * (1 - c.forest);
  col = C.rough.map((v, i) => lerp(v, C.fescue[i], smooth(-0.45, 0.55, n2 * 0.5 + n3 * 0.6) * 0.75));
  col = col.map((v, i) => lerp(v, C.heath[i], heath * 0.62));
  col = col.map((v, i) => lerp(v, C.semi[i], damp * 0.38));
  /* Åsberget shows its granite: the club's aerials have bare grey crag faces on the
     steep ground, so rock breaks through harder and paler than the first guess */
  col = col.map((v, i) => lerp(v, lerp(C.forest[i], C.rock[i], smooth(0.45, 0.85, sl)), steep * 0.75));
  sid = heath > 0.55 ? S_HEATH : S_ROUGH;
  if (c.forest > 0.02) {
    /* the satellite has the last word: where it reads open inside an OSM forest
       ring the ground is litter and heath under scattered singles, not the
       closed-canopy floor -- this is what un-scorches the thinned hillsides */
    const closed = coverAt(x, z) === 2 ? 0.42 : 1;
    col = col.map((v, i) => lerp(v, C.forest[i], c.forest * 0.85 * closed));
    if (closed === 1 || c.forest * closed > 0.35) sid = S_FOREST;
  }
  if (c.wet > 0.02) { col = col.map((v, i) => lerp(v, C.wet[i], c.wet * 0.7)); }

  /* the surroundings' own ground: fields hashed to a crop tone each, garden lawns,
     industry hardstanding, the traced clear-fells and yard, the Ås hay meadows */
  for (const q of LI.at(x, z)) {
    if (ringSD(x, z, q.ring) > 0) continue;
    if (q.kind === 'farmland' || q.kind === 'farmyard') {
      const k = hash2(Math.round(q.bb.x0 * 0.13), Math.round(q.bb.z0 * 0.13));
      const crop = k < 0.4 ? C.cropA : k < 0.75 ? C.cropB : C.cropC;
      col = col.map((v, i) => lerp(v, crop[i], 0.72)); sid = S_SEMI;
    } else if (q.kind === 'residential' || q.kind === 'allotments') {
      col = col.map((v, i) => lerp(v, C.lawn[i], 0.4));
    } else if (q.kind === 'industrial' || q.kind === 'commercial') {
      col = col.map((v, i) => lerp(v, C.hard[i], 0.35));
    }
  }
  for (const q of SI.at(x, z)) {
    if (ringSD(x, z, q.ring) > 0) continue;
    if (q.kind === 'cut') { col = col.map((v, i) => lerp(v, C.slash[i], 0.7)); sid = S_HEATH; }
    else if (q.kind === 'yard') { col = col.map((v, i) => lerp(v, C.hard[i], 0.85)); sid = S_PATH; }
    else if (q.kind === 'hay') { col = col.map((v, i) => lerp(v, C.hay[i], 0.6)); sid = S_SEMI; }
  }
  /* the clubhouse lawn: every ground photograph shows fresh mown green running
     right up to the terrace -- the apron overrides the scrub-and-till colouring
     the slope rules would otherwise paint around the building */
  if (CLUB && x > CLUB.bb.x0 && x < CLUB.bb.x1 && z > CLUB.bb.z0 && z < CLUB.bb.z1) {
    const sd = ringSD(x, z, CLUB.ring);
    if (sd < 34) {
      const w = 1 - smooth(8, 34, sd);
      col = col.map((v, i) => lerp(v, C.lawn[i], w * 0.9));
      if (w > 0.45) sid = S_SEMI;
    }
  }

  /* semi-rough: a band of first cut hugging the mown ground */
  const semi = clampf((1 - smooth(4, 16, c.dLine - 22)) * 0.6, 0, 0.6) * (1 - c.forest);
  if (semi > 0.02) { col = col.map((v, i) => lerp(v, C.semi[i], semi)); if (semi > 0.35) sid = S_SEMI; }

  if (c.fair > 0.02) {
    col = col.map((v, i) => lerp(v, C.fair[i], c.fair));
    if (c.fair > 0.5) sid = S_FAIR;
  }
  if (c.fringe > 0.02) { col = col.map((v, i) => lerp(v, C.fringe[i], c.fringe)); if (c.fringe > 0.5) sid = S_FRINGE; }
  if (c.tee > 0.02) { col = col.map((v, i) => lerp(v, C.tee[i], c.tee)); if (c.tee > 0.5) sid = S_TEE; }
  if (c.green > 0.02) {
    col = col.map((v, i) => lerp(v, C.green[i], c.green));
    if (c.green > 0.5) sid = S_GREEN;
  }
  /* NO sand paint on the terrain mesh: a sand-coloured vertex bleeds a 4 m halo
     into the surrounding grass however tight the classify window is, and every
     bunker wore a pale diamond. The overlay mesh draws all the sand -- extended
     past the ring so it tucks over the seam -- and the ground beneath keeps its
     turf, the way a cut bunker actually meets its bank. c.sand still guards the
     scatter and the planter. */

  /* The waterline: wet sand, then bleached shore. Gated on the horizontal distance
     to the ring as well as the height, because the shore carve keeps the ground
     within a metre of the water level for fifteen metres out -- height alone painted
     the whole island 14th as a mud beach. */
  let lvl = null, sdW = 1e9;
  for (const w of WI.at(x, z)) {
    if (w.stream) continue;
    const sd = ringSD(x, z, w.ring);
    if (sd < 30 && (lvl === null || w.level > lvl)) lvl = w.level;
    if (sd < sdW) sdW = sd;
  }
  /* an armoured shoreline is granite, not sand: pale stone barely darkened by
     the wet, wearing the path surface's harder, tighter specular */
  const rip = !!ARM && lvl !== null && Math.hypot(x - ARM.c[0], z - ARM.c[1]) < ARM.paint;
  /* THE BANK UNDER THE COLLAR IS STONE, NOT TURF, and it has to be painted that
     way up the whole face the rock covers. Gated at 0.6 m above the level it
     stopped a hand's breadth above the water, so the render showed a band of
     boulders, then a strip of GREEN GRASS, then the water -- rock cannot sit on
     a lawn and reach the lake. The armoured shore therefore paints to 2.2 m up
     the bank and 9 m out; everywhere else keeps the tight sand band it had, and
     a course with no `armour` never enters this at all. */
  const bandTop = rip ? 0.95 : 0.6, bandOut = rip ? 6 : 7;
  if (lvl !== null && c.green < 0.4 && sdW < bandOut) {
    const above = h - lvl;
    if (above < bandTop) {
      /* the band's edge wanders with noise: a waterline drawn at one exact
         distance renders as a hard stair-step on the 4 m grid, and a real
         shore is never a drawn line */
      const wn = fbm(x * 0.16, z * 0.16, 2) * 1.8;
      const wet = (1 - smooth(-0.15, bandTop, above))
                * (1 - smooth((rip ? 3.5 : 1.5) + wn, (rip ? 8.5 : 4.8) + wn, sdW));
      const sc = rip ? C.riprap : C.shore;
      col = col.map((v, i) => lerp(v, sc[i] * (1 - wet * (rip ? 0.15 : 0.38)), wet * (rip ? 0.95 : 0.85)));
      if (wet > 0.45) sid = rip ? S_PATH : S_SHORE;
    }
  }
  const sh = SHADE[sid];
  return { col, sid, det: sh[0], bmp: sh[1], gls: sh[2], str: sh[3] * (1 - c.forest),
           mow: c.dLine, mowK: sid === S_FAIR ? 0.95 : sid === S_SEMI ? 1.05 : 0 };
}

/* ------------------------------------------------------------- scene setup */
await tick('startar renderaren', 0.10);
/* Choose quality before allocating shadows and instances. The URL always wins;
   otherwise a previous slow visit and genuinely constrained devices start light
   instead of spending ten seconds proving they needed to. */
const qualityParam = new URLSearchParams(location.search).get('q');
let rememberedQuality = null;
/* ...but NOT under ?det=1. Instance counts change with quality, so a scene that
   sniffs the device is a scene that differs between machines -- and det=1 exists
   to make two boots produce the same pixels. A four-core CI box would otherwise
   capture goldens no eight-core machine could ever reproduce, and the diff would
   read as a rendering regression. Under det the URL's own ?q= is the only voice. */
if (!DET) { try { rememberedQuality = localStorage.getItem('banvy-quality'); } catch {} }
const constrainedDevice = !DET
  && ((navigator.deviceMemory && navigator.deviceMemory <= 4)
   || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));
const LOWQ = qualityParam === 'lo'
  || (qualityParam !== 'hi' && (rememberedQuality === 'lo' || constrainedDevice));
/* runtime quality drop (auto-detected weak GPU) and motion preference */
let lowfx = false;
const RMOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* skyltar: 0 off, 1 hole numbers, 2 numbers + faciliteter. skyMax is 1 on a course
   whose facilities are not in the data, so the cycle never promises an empty layer. */
let skyState = 2, skyMax = 2, skyHidden = false;
/* WebGPU can exist and still fail to start (an OS beta, a driver, a flag): an
   init that threw left the splash on "startar" forever, blamed on the network.
   Fall back to the WebGL2 backend instead; ?gl=1 forces it for testing. */
const FORCE_GL = new URLSearchParams(location.search).get('gl') === '1';
const mkRenderer = forceWebGL => new THREE.WebGPURenderer({ antialias: true, samples: 4,
  outputBufferType: THREE.HalfFloatType, powerPreference: 'high-performance', forceWebGL });
let renderer;
try {
  renderer = mkRenderer(FORCE_GL);
  await renderer.init();
} catch (e) {
  renderer = mkRenderer(true);
  await renderer.init();
}
renderer.setPixelRatio(LOWQ ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.20;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const IS_GPU = renderer.backend?.isWebGPUBackend === true;
/* Allocated lazily by the CI/readback hook only. Normal visits, including the
   opt-in preview, must not pay for a second full-size color target. */
let captureReadbackTarget = null;
let captureRenderLocked = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 1.5, 22000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
/* Not clamped at the horizon. Hole 1 climbs 26 m and hole 2 falls 41, so a camera
   forbidden from sitting below what it is looking at gets shoved into the air the
   moment you stand on an uphill tee -- which is exactly the shot worth seeing. The
   ground is kept out of the camera by clamping its height against the terrain every
   frame instead, which is what that clamp was standing in for. */
controls.maxPolarAngle = Math.PI - 0.08;
controls.minDistance = 6;
controls.maxDistance = 4200;

/* ------------------------------------------------------------- textures */
function canvasTex(size, draw, { srgb = true, rep = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* One packed map does all the turf detail: R blade-scale speckle, G a medium clump,
   B a macro variation that keeps a fairway from tiling visibly, A a glint mask. */
const DETAIL = canvasTex(512, (g, S) => {
  const im = g.createImageData(S, S), d = im.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const blade = (Math.sin(x * 2.1 + Math.sin(y * 0.7) * 2) * 0.5 + 0.5) * 0.5
                + (hash2(x, y) * 0.5);
    const clump = fbm(x * 0.055, y * 0.055, 3) * 0.5 + 0.5;
    const macro = fbm(x * 0.012, y * 0.012, 2) * 0.5 + 0.5;
    d[i] = blade * 255; d[i + 1] = clump * 255; d[i + 2] = macro * 255;
    d[i + 3] = Math.pow(hash2(x + 977, y + 131), 6) * 255;
  }
  g.putImageData(im, 0, 0);
}, { srgb: false });

/* A tangent-space normal map of grass blades: the derivative of the same clump
   field, which is why the bump and the albedo agree instead of fighting. */
const GRASSN = canvasTex(512, (g, S) => {
  const im = g.createImageData(S, S), d = im.data;
  const H = (x, y) => fbm(x * 0.16, y * 0.16, 3) * 0.6 + Math.sin(x * 1.9 + Math.sin(y * 0.8)) * 0.12;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const nx = (H(x - 1, y) - H(x + 1, y)) * 1.6, ny = (H(x, y - 1) - H(x, y + 1)) * 1.6;
    const l = Math.hypot(nx, ny, 1);
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}, { srgb: false });

const SANDN = canvasTex(256, (g, S) => {
  const im = g.createImageData(S, S), d = im.data;
  const H = (x, y) => Math.sin(x * 0.42 + Math.sin(y * 0.11) * 3.2) * 0.5 + fbm(x * 0.3, y * 0.3, 2) * 0.4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const nx = (H(x - 1, y) - H(x + 1, y)) * 1.1, ny = (H(x, y - 1) - H(x, y + 1)) * 1.1;
    const l = Math.hypot(nx, ny, 1);
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}, { srgb: false });

const WATERN = canvasTex(512, (g, S) => {
  const im = g.createImageData(S, S), d = im.data;
  const H = (x, y) => fbm(x * 0.028, y * 0.043, 4) + fbm(x * 0.11, y * 0.09, 2) * 0.35;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const nx = (H(x - 1, y) - H(x + 1, y)) * 2.6, ny = (H(x, y - 1) - H(x, y + 1)) * 2.6;
    const l = Math.hypot(nx, ny, 1);
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}, { srgb: false });

/* ------------------------------------------------------------- lighting */
const uSun = uniform(new THREE.Vector3(-0.42, 0.46, 0.78).normalize());
/* seasonal foliage: the birch crowns and reed heads take their colour from the
   preset, which is what lets Höst turn the shore gold without a rebuild */
const uLeaf = uniform(new THREE.Color(0x5f8944));
const uReedC = uniform(new THREE.Color(0x8d8a52));
const sun = new THREE.DirectionalLight(0xfff2de, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(LOWQ ? 1024 : 2048, LOWQ ? 1024 : 2048);
sun.shadow.camera.near = 120; sun.shadow.camera.far = 3400;
/* Terrain is a huge, gently-sloped receiver, which is the worst case for shadow
   acne: at a grazing sun every quad shadows itself unless the sample is pushed well
   along the normal first. A green view came out uniformly dim because of it. */
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.22;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xdff0ff, 0x4c5842, 1.15);
scene.add(hemi);

const PRESETS = {
  /* hemiI 1.20 left the long evening tree shadows dead black -- the low sun casts
     30-80 m of shade and the only light inside it is this hemisphere term */
  /* sun y 0.42 was a 25-degree afternoon wearing golden colours: every warm ramp in
     the dome and the water tops out at 0.42, so the flagship dusk rendered noon-blue.
     y 0.18 (11 degrees after normalising) is a real 63N golden hour, and the ramps
     below were rewidened around it */
  golden: { sun: 0xffc384, int: 3.1, dir: [-0.56, 0.18, 0.71], hemiS: 0xffdcbb, hemiG: 0x716c52,
            hemiI: 1.60, fog: 0xc4b49c, dens: 0.00040, exp: 1.22, turb: 4.2, ray: 2.1, cloud: 0.40,
            bloom: 0.20 },
  noon:   { sun: 0xfffaf0, int: 3.0, dir: [-0.22, 0.88, 0.42], hemiS: 0xdff0ff, hemiG: 0x56634a,
            hemiI: 1.35, fog: 0xb4cfdc, dens: 0.00033, exp: 1.02, turb: 2.6, ray: 1.1, cloud: 0.26,
            bloom: 0.08 },
  mist:   { sun: 0xe7f4f2, int: 1.5, dir: [-0.36, 0.52, 0.78], hemiS: 0xd8edf2, hemiG: 0x4e5a4c,
            hemiI: 1.55, fog: 0xc3d4d8, dens: 0.00115, exp: 1.04, turb: 6.5, ray: 0.6, cloud: 0.62,
            bloom: 0.10 },
  /* hemiI 0.95 sat below the 1.20 the golden note above records as dead-black
     shadows, and the steel-blue fog said overcast, not daybreak: lifted, and shifted
     to the cold rose a clear northern dawn actually has */
  dawn:   { sun: 0xffc9a0, int: 2.2, dir: [0.70, 0.26, -0.62], hemiS: 0xc2bed2, hemiG: 0x4c4c42,
            hemiI: 1.30, fog: 0x9d93a4, dens: 0.00055, exp: 1.18, turb: 5.4, ray: 2.6, cloud: 0.34,
            bloom: 0.22 },
  /* the club's own October aerial: low gold sun, storm-grey sky, birches turned */
  host:   { sun: 0xffbe72, int: 2.7, dir: [-0.64, 0.28, 0.58], hemiS: 0xd9cfc2, hemiG: 0x5c5340,
            hemiI: 1.25, fog: 0xa8a89e, dens: 0.00052, exp: 1.2, turb: 5.2, ray: 2.5, cloud: 0.55,
            leaf: 0xc8842e, reed: 0xa88a3e, bloom: 0.16 },
};
let preset = PRESETS.golden;
const fog = new THREE.FogExp2(0xa2bcca, 0.00042);
const uFogC = uniform(new THREE.Color(0xa2bcca));
const uFogD = uniform(0.00042);
scene.fog = fog;

/* Sky. The volumetric one only exists on the WebGPU backend; on WebGL2 a gradient
   dome stands in, which is a real difference and is stated in the UI rather than
   hidden. Both are lit by the same sun vector so the horizon never disagrees with
   the shadows. */
let skyMesh = null, skyDome = null;
if (IS_GPU) {
  const { SkyMesh } = await import('three/addons/objects/SkyMesh.js');
  skyMesh = new SkyMesh();
  skyMesh.scale.setScalar(12000);
  skyMesh.renderOrder = -2;
  scene.add(skyMesh);
} else {
  /* A hand-built stand-in for the scattering model. It is not physical, but it gets
     the four things that actually read: the zenith is deep and slightly violet, the
     horizon is pale and warm, the sun has a bright aureole that widens as it drops,
     and there is a band of cloud whose lit edges face the sun. */
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const D = normalize(positionLocal);
  const up = D.y;
  const sd = saturate(D.dot(uSun));
  const sunUp = uSun.y.max(0.02);
  const zen = mix(color(0x123a72), color(0x1f5f9e), sunUp);
  const mid = mix(color(0x4d7fa8), color(0x66a0c8), sunUp);
  /* the warm-horizon ramp reaches 0.52 so a 0.2-0.3 sun (golden, dawn, host) still
     lands well inside it -- at the old 0.42 ceiling those presets rendered noon-blue */
  const hor = mix(color(0xe6b98a), color(0xbcd3dd), smoothstep(0.10, 0.52, sunUp));
  let c = mix(hor, mid, pow(saturate(up), 0.72));
  c = mix(c, zen, pow(saturate(up), float(0.85).add(sunUp.mul(0.5))));
  c = mix(color(0x63705f), c, smoothstep(-0.05, 0.03, up));
  /* aureole: tight and white when the sun is high, wide and orange when it is low */
  c = c.add(mix(color(0xffb060), color(0xfff0d0), sunUp)
      .mul(pow(sd, mix(float(5), float(30), sunUp)).mul(mix(float(0.85), float(0.35), sunUp))));
  c = c.add(color(0xfff6e4).mul(pow(sd, 900).mul(2.2)));
  /* cloud: two scrolling octaves of the detail map projected on the dome, kept above
     the horizon so it never appears as a band across the trees */
  const cuv = D.xz.div(up.abs().max(0.10)).mul(0.014);
  const cl = texture(DETAIL, cuv.add(vec2(time.mul(0.0018), time.mul(0.0009)))).b
    .mul(texture(DETAIL, cuv.mul(2.3).sub(vec2(time.mul(0.0026), 0))).g.add(0.35));
  const cover = uniform(0.34);
  const puff = smoothstep(cover, cover.add(0.30), cl).mul(smoothstep(0.02, 0.20, up));
  const lit = mix(color(0x9aa6b0), color(0xfff4e6), sd.mul(0.7).add(sunUp.mul(0.3)));
  c = mix(c, lit, puff.mul(0.82));
  m.colorNode = c;
  skyDome = new THREE.Mesh(new THREE.SphereGeometry(11000, 48, 28), m);
  skyDome.renderOrder = -2;
  skyDome.userData.cover = cover;
  scene.add(skyDome);
}

/* A small procedural environment, generated once, so metal and water have
   something to reflect on both backends. */
{
  const env = new THREE.Scene();
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const up = normalize(positionLocal).y;
  m.colorNode = mix(color(0x8fa88f), mix(color(0xcfe2e8), color(0x3d7fb8), pow(saturate(up), 0.5)),
                    smoothstep(-0.1, 0.05, up));
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), m));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.58;
}

let presetName = 'golden';
function setPreset(name) {
  const p = PRESETS[name] || PRESETS.golden;
  preset = p;
  presetName = PRESETS[name] ? name : 'golden';
  sun.color.setHex(p.sun); sun.intensity = p.int;
  const d = new THREE.Vector3(...p.dir).normalize();
  uSun.value.copy(d);
  hemi.color.setHex(p.hemiS); hemi.groundColor.setHex(p.hemiG); hemi.intensity = p.hemiI;
  fog.color.setHex(p.fog); fog.density = p.dens;
  uFogC.value.setHex(p.fog, THREE.SRGBColorSpace); uFogD.value = p.dens;
  scene.background = new THREE.Color(p.fog);
  renderer.toneMappingExposure = p.exp;
  if (skyDome?.userData.cover) skyDome.userData.cover.value = 0.62 - p.cloud * 0.55;
  if (skyMesh) {
    skyMesh.turbidity.value = p.turb;
    skyMesh.rayleigh.value = p.ray;
    skyMesh.mieCoefficient.value = 0.005;
    skyMesh.mieDirectionalG.value = 0.79;
    if (skyMesh.cloudCoverage) skyMesh.cloudCoverage.value = p.cloud;
    if (skyMesh.cloudDensity) skyMesh.cloudDensity.value = 0.36;
    skyMesh.sunPosition.value.copy(d).multiplyScalar(450000);
  }
  uLeaf.value.setHex(p.leaf ?? 0x5f8944);
  uReedC.value.setHex(p.reed ?? 0x8d8a52);
  /* the glow belongs to the light: dusk lamps and low-sun water need a halo that
     noon must not have, so the bloom strength follows the preset */
  if (renderer.__bloomNode) renderer.__bloomNode.strength.value = lowfx ? 0 : (p.bloom ?? 0.14);
  placeSun();
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === name));
  if (window.__navDrawer) window.__navDrawer.updateActivePreset(presetName);
  syncURL();
}

/* ------------------------------------------------------------- materials */
/* The turf shader. Four per-vertex channels drive it, which is what lets one
   material cover fescue and a putting green without either looking like the other:
   aDet how tightly the detail tiles, aBmp how much relief, aGls how wet it reads,
   aStr how strongly the mow shows. Gloss arrives as roughness because that is the
   only thing the standard BRDF actually listens to. */
function makeTurf() {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, vertexColors: true });
  const aDet = attribute('aDet', 'float');
  const aBmp = attribute('aBmp', 'float');
  const aGls = attribute('aGls', 'float');
  const aStr = attribute('aStr', 'float');
  const aMow = attribute('aMow', 'vec2');
  const wp = positionWorld.xz;
  const cd = cameraPosition.sub(positionWorld).length();
  const near = oneMinus(smoothstep(60, 420, cd));

  /* Three taps at three scales. The scales matter more than the texture does: at a
     tile of a metre and a half the whole thing averages to flat grey past about ten
     metres, which is most of what a golfer is ever looking at. These tile at roughly
     2 m, 9 m and 70 m, so there is structure at arm's length, at the width of a
     fairway, and across the whole property. */
  const sc = aDet.max(0.45);
  const dtF = texture(DETAIL, wp.mul(sc.mul(0.33)));      /* about 2 m: blades */
  const dt = texture(DETAIL, wp.mul(sc.mul(0.055)));      /* about 12 m: clumps  */
  const dtM = texture(DETAIL, wp.mul(0.0085));            /* about 120 m: the field */

  /* Centred on zero before it is applied. Written as a multiplier around 1 the mean
     of the three taps lands near 1 and the whole modulation cancels to a fraction of
     a percent, which is a texture you have paid for and cannot see. Close up the fine
     tap carries it; far away that tap is smaller than a pixel and only the two slow
     ones survive, which is also what stops it shimmering. */
  const micro = mix(dt.g.sub(0.5).mul(0.55).add(dtM.b.sub(0.5).mul(0.45)),
                    dtF.r.sub(0.5).mul(0.58).add(dt.g.sub(0.5).mul(0.30))
                      .add(dtM.b.sub(0.5).mul(0.16)), near);
  const amt = clamp(aBmp.mul(0.44), 0.11, 0.56);
  let col = attribute('color', 'vec3').mul(float(1).add(micro.mul(amt.mul(2.1))));

  /* Mow bands, per pixel from the coordinate the mesh carries. A mown band is not
     really a different colour -- it is the same grass lying the other way, so what
     changes is how it catches the light. Hence a small albedo shift and a much larger
     view-dependent sheen: the stripes appear and vanish as you walk round the green,
     which is the thing that makes them read as grass rather than as paint. */
  const V = normalize(cameraPosition.sub(positionWorld));
  /* Fade the band out before it aliases, not after: once a stripe cycle is under a
     few pixels the sin can only moire, and a floor of residual contrast at distance
     turned the far fairways to shimmer and the green rings to op-art. fwidth of the
     phase is exactly cycles-per-pixel, so the attenuation is resolution-aware. */
  const phase = aMow.x.mul(aMow.y);
  const band = sin(phase);
  const bandAA = oneMinus(smoothstep(0.55, 1.7, fwidth(phase)));
  /* A band lying toward the light is paler; one lying away is darker and glossier.
     Part of that is fixed, so the stripes are there at any angle, and part follows
     the view, so they strengthen and fade as you walk round -- which is what tells
     the eye it is grass lying two ways rather than paint. */
  /* Looking down-sun the whole band system is already lit by the specular term, and
     stacking the albedo sheen on top of that read as a fairway of gold sand. The
     sheen yields as the view turns into the sun. */
  const intoSun = pow(saturate(V.negate().dot(uSun)), 3);
  const sheen = oneMinus(abs(V.y)).mul(0.075).add(0.038).mul(oneMinus(intoSun.mul(0.75)));
  col = col.mul(float(1).add(band.mul(aStr.min(1.8)).mul(sheen).mul(near.mul(0.35).add(0.65)).mul(bandAA)));

  /* light through the blade rather than off it -- the reason turf glows when the
     sun is low and behind it */
  const sss = pow(saturate(V.dot(uSun.negate())), 3.4).mul(0.16);
  col = col.add(vec3(0.07, 0.15, 0.035).mul(sss).mul(aStr.add(0.4).min(1.2)));

  m.colorNode = col;
  /* a mown band lying toward you is glossier than one lying away */
  m.roughnessNode = clamp(float(0.97).sub(aGls.mul(0.62)).sub(band.mul(bandAA).mul(aStr).mul(0.05)), 0.40, 0.99);
  /* The blade-level relief lives in the normal map, not in the mesh: a 4 m grid
     cannot hold it and a finer one would cost a quarter of a million vertices to
     say the same thing. It fades out with distance because past a couple of
     hundred metres it is finer than a pixel and only adds shimmer. */
  /* bumpMap, not normalMap: a tangent-space normal map needs UVs and tangents, and
     these meshes are built from world coordinates and carry neither. bumpMap
     differentiates the sampled value in screen space instead, so it works on
     geometry that has nothing but positions. */
  m.normalNode = bumpMap(texture(DETAIL, wp.mul(sc.mul(0.33))).r,
                         aBmp.add(0.25).mul(near).mul(0.5));
  return m;
}

function makeSand() {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, vertexColors: true });
  const wp = positionWorld.xz;
  const cd = cameraPosition.sub(positionWorld).length();
  const near = oneMinus(smoothstep(30, 200, cd));
  const t = texture(DETAIL, wp.mul(0.22));
  const tm = texture(DETAIL, wp.mul(0.045));
  m.colorNode = attribute('color', 'vec3').mul(float(0.88).add(t.r.mul(0.14)).add(tm.b.mul(0.12)));
  m.roughnessNode = float(0.94);
  /* rake lines: shallow, and only worth computing where they can be seen */
  m.normalNode = bumpMap(texture(SANDN, wp.mul(0.30)).r, near.mul(0.30));
  return m;
}

/* ------------------------------------------------------------- terrain mesh */
await tick('bygger terrängen', 0.16);

/* Three levels of detail, aligned so their shared edges land on the same points:
   the play area at 4 m, the rest of the lidar tile at 12 m, and the vista at 36 m.
   Where two levels meet the corner vertices coincide exactly because both ask
   terrainH for the same place; only the fine level's in-between vertices can
   diverge, by well under a metre, and the skirt covers that. */
const playB = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const h of HOLES) for (const p of [...h.line, ...h.green.ring]) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  for (const r of M.scenery.greens.concat(M.scenery.range)) for (const p of r) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  return { x0, x1, z0, z1 };
})();
const snap = (v, g) => Math.round(v / g) * g;
const CORE = { dx: 4, x0: snap(playB.x0 - 150, 36), x1: snap(playB.x1 + 150, 36),
                       z0: snap(playB.z0 - 150, 36), z1: snap(playB.z1 + 150, 36) };
const MIDR = { dx: 12, x0: snap(HF0.x0 + 8, 36), x1: snap(HF0.x0 + (HF0.nx - 1) * HF0.dx - 8, 36),
                        z0: snap(HF0.z0 + 8, 36), z1: snap(HF0.z0 + (HF0.nz - 1) * HF0.dx - 8, 36) };
/* The far ring: the vista terrain, and the stand-in forest scattered over it. It
   stops well inside the vista heightfield, because past a few kilometres the
   individual cones stop being legible and the DEM is doing all the work.

   Square by default, but a course may say otherwise, and one does: Veckefjärden's
   ring reaches 6 km NORTH to put Åsberget and the hills behind it on the horizon
   the course actually looks at, and stops 2.5 km south, where it would only be
   spending a quarter of the ring on fogged ground. That asymmetry is a fact about
   where the course stands, so it comes from the course. */
const FARR = { dx: 36, x0: -5400, x1: 5400, z0: -5400, z1: 5400,
               ...((SCENERY && SCENERY.farRing) || {}) };

const stats = { verts: 0, tris: 0, trees: 0, draws: 0 };
SEAM = MIDR;
const builtTerrain = { core: null, mid: null };
let terrainPreviewGroundActive = false;

function sampleBuiltHeight(grid, x, z) {
  if (!grid) return null;
  const fx = (x - grid.x0) / grid.dx, fz = (z - grid.z0) / grid.dx;
  if (fx < 0 || fz < 0 || fx >= grid.nx - 1 || fz >= grid.nz - 1) return null;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const k = j * grid.nx + i;
  const a = grid.heights[k], b = grid.heights[k + 1];
  const c = grid.heights[k + grid.nx], d = grid.heights[k + grid.nx + 1];
  if (!Number.isFinite(a + b + c + d)) return null;
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz
                      : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

const groundHeightSampler = createGroundHeightSampler({
  previewActive: () => terrainPreviewGroundActive,
  previewHeightAt: (x, z) => TERRAIN_PREVIEW.heightAt(x, z),
  legacyMeshHeightAt: (x, z) => sampleBuiltHeight(builtTerrain.core, x, z)
    ?? sampleBuiltHeight(builtTerrain.mid, x, z),
  fallbackHeightAt: legacyTerrainH,
});

/* Height-sensitive consumers always use the same frontier as the renderer:
   verified v2 when installed, otherwise the built legacy triangles, then the
   analytic legacy terrain only beyond both mesh extents. */
function renderedGroundH(x, z) {
  return groundHeightSampler.heightAt(x, z);
}

/* WHERE THE GROUND NEEDS TO BE FINER THAN 4 METRES.

   The 4 m grid is what makes everything look faceted, and it is not because the
   data is coarse -- the rings are smooth now -- but because the SURFACE only has
   a vertex every four metres. Measured consequences: a bunker draws 0.56 m of an
   intended 1.08 m because there is often no vertex deep enough inside it to hold
   the dish, and a shoreline steps in 4 m facets however smooth its ring is.

   Refining everything is the wrong trade: a global 2 m CORE is four times the
   vertices for ground that is mostly a flat fairway with nothing to resolve. The
   detail lives on FEATURE EDGES, which are a few per cent of the area, so the
   mask is stamped from the feature perimeters themselves -- cost proportional to
   how much edge a course has, not to how big it is. Testing every cell against
   every ring instead would have walked the thousand-point lake ring 147,000
   times. */
function buildDetailMask(R) {
  const nx = Math.round((R.x1 - R.x0) / R.dx) + 1, nz = Math.round((R.z1 - R.z0) / R.dx) + 1;
  const mask = new Uint8Array(nx * nz);
  const stamp = (x, z, rad) => {
    const i0 = Math.max(0, Math.floor((x - rad - R.x0) / R.dx));
    const i1 = Math.min(nx - 2, Math.ceil((x + rad - R.x0) / R.dx));
    const j0 = Math.max(0, Math.floor((z - rad - R.z0) / R.dx));
    const j1 = Math.min(nz - 2, Math.ceil((z + rad - R.z0) / R.dx));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
  };
  const walk = (ring, rad, step) => {
    if (!ring || ring.length < 2) return;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k < n; k++)
        stamp(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, rad);
    }
  };
  /* the waterline gets the widest band: it is a silhouette against the sky or
     the water, which is the least forgiving thing a facet can sit on */
  for (const w of M.water) if (!w.stream && w.ring) walk(w.ring, 7, 3);
  for (const h of HOLES) {
    for (const b of h.bunkers) walk(b.ring, 5, 3);      /* the dish and its lip */
    walk(h.green.ring, 5, 3);                            /* the pad's shoulder */
  }
  let n = 0;
  for (let k = 0; k < mask.length; k++) n += mask[k];
  return { mask, nx, nz, cells: n, total: (nx - 1) * (nz - 1) };
}

async function buildTerrain(R, hole, withDetail) {
  const nx = Math.round((R.x1 - R.x0) / R.dx) + 1, nz = Math.round((R.z1 - R.z0) / R.dx) + 1;
  const atlasOwnsSurfaceEdges = groundMode === 'atlas' && groundAtlas && R === CORE;
  const pos = [], col = [], det = [], bmp = [], gls = [], str = [], mow = [], aoArr = [], idx = [];
  const map = new Int32Array(nx * nz).fill(-1);
  const heights = new Float32Array(nx * nz);
  heights.fill(NaN);
  const hx0 = hole ? hole.x0 : 0, hx1 = hole ? hole.x1 : 0, hz0 = hole ? hole.z0 : 0, hz1 = hole ? hole.z1 : 0;
  const inHole = (x, z) => hole && x > hx0 + 1e-6 && x < hx1 - 1e-6 && z > hz0 + 1e-6 && z < hz1 - 1e-6;

  for (let j = 0; j < nz; j++) {
    if (shouldYieldWork()) await yieldWork();
    for (let i = 0; i < nx; i++) {
    const x = R.x0 + i * R.dx, z = R.z0 + j * R.dx;
    if (inHole(x, z)) continue;
    const h = withDetail ? terrainH(x, z) : demH(x, z);
    heights[j * nx + i] = h;
    map[j * nx + i] = pos.length / 3;
    pos.push(x, h, z);
    if (withDetail) {
      /* Anti-alias the paint. One colour sample per vertex draws every boundary
         narrower than the grid -- the wet shore, the bank shading, a landuse
         edge -- as a sawtooth of whole triangles. Where a probe tap disagrees
         with the centre, the vertex takes a five-tap average instead, and the
         stair-steps dissolve into one soft cell. */
      const g = groundAt(x, z, h);
      let cr = g.col[0], cg = g.col[1], cb = g.col[2];
      if (!atlasOwnsSurfaceEdges) {
        const q = R.dx * 0.42;
        const g2 = groundAt(x + q, z + q * 0.7, terrainH(x + q, z + q * 0.7));
        if (Math.abs(cr - g2.col[0]) + Math.abs(cg - g2.col[1]) + Math.abs(cb - g2.col[2]) > 0.02) {
          const g3 = groundAt(x - q, z + q * 0.8, terrainH(x - q, z + q * 0.8));
          const g4 = groundAt(x - q * 0.7, z - q, terrainH(x - q * 0.7, z - q));
          const g5 = groundAt(x + q * 0.8, z - q * 0.9, terrainH(x + q * 0.8, z - q * 0.9));
          cr = (cr + g2.col[0] + g3.col[0] + g4.col[0] + g5.col[0]) / 5;
          cg = (cg + g2.col[1] + g3.col[1] + g4.col[1] + g5.col[1]) / 5;
          cb = (cb + g2.col[2] + g3.col[2] + g4.col[2] + g5.col[2]) / 5;
        }
      }
      const ao = horizonAO(x, z, h);
      col.push(cr * ao, cg * ao, cb * ao);
      aoArr.push(ao);
      det.push(g.det); bmp.push(g.bmp); gls.push(g.gls); str.push(g.str);
      mow.push(g.mow || 0, g.mowK || 0);
    } else {
      /* the vista is read at a distance through fog: slope and height, then what
         the map says the ground is used for -- fields, gardens, industry */
      const sl = Math.hypot(demH(x + R.dx, z) - h, demH(x, z + R.dx) - h) / R.dx;
      const t = clampf((h - 24) / 150, 0, 1);
      const rocky = smooth(0.22, 0.62, sl);
      let base = C.forest.map((v, k) => lerp(lerp(v, C.rough[k], t * 0.5), C.rock[k], rocky * 0.8));
      for (const q of LI.at(x, z)) {
        if (ringSD(x, z, q.ring) > 0) continue;
        if (q.kind === 'farmland' || q.kind === 'farmyard') {
          const k2 = hash2(Math.round(q.bb.x0 * 0.13), Math.round(q.bb.z0 * 0.13));
          const crop = k2 < 0.4 ? C.cropA : k2 < 0.75 ? C.cropB : C.cropC;
          base = base.map((v, k3) => lerp(v, crop[k3], 0.85));
        } else if (q.kind === 'residential') base = base.map((v, k3) => lerp(v, C.lawn[k3], 0.4));
        else if (q.kind === 'industrial' || q.kind === 'commercial') base = base.map((v, k3) => lerp(v, C.hard[k3], 0.5));
        break;
      }
      col.push(base[0], base[1], base[2]);
      aoArr.push(1.0);
      det.push(0.4); bmp.push(0.9); gls.push(0.04); str.push(0);
      mow.push(0, 0);
    }
    }
  }
  /* ---- the fine pass, on feature edges only ---------------------------------
     A refined cell is replaced by a K x K sub-grid. The seam is the whole
     problem: a fine edge against a COARSE neighbour must lie exactly on that
     neighbour's straight edge, or a crack of sky opens along it -- the same
     lesson the LoD skirts taught. So an edge vertex takes the interpolated
     height when the neighbour is coarse and the true height when it is refined,
     and both sides of any pair apply the same rule, so they always agree.
     Vertices are shared through `fineAt`: duplicating them would give the two
     cells different averaged normals and draw a lit seam down every join. */
  const fine = (withDetail && R === CORE && DETAIL_MASK) ? DETAIL_MASK.mask : null;
  const K = 4;
  const fineAt = new Map();
  const isFine = (i, j) => !!(fine && i >= 0 && j >= 0 && i < nx - 1 && j < nz - 1 && fine[j * nx + i]);
  const emitFine = (x, z, h) => {
    const vi = pos.length / 3;
    pos.push(x, h, z);
    const g = groundAt(x, z, h);
    const ao = horizonAO(x, z, h);
    col.push(g.col[0] * ao, g.col[1] * ao, g.col[2] * ao);
    aoArr.push(ao);
    det.push(g.det); bmp.push(g.bmp); gls.push(g.gls); str.push(g.str);
    mow.push(g.mow || 0, g.mowK || 0);
    return vi;
  };
  const vertOf = (i, j, u, v) => {
    const key = (j * K + v) * (nx * K + 1) + (i * K + u);
    const had = fineAt.get(key);
    if (had !== undefined) return had;
    /* a cell corner is a coarse vertex; reuse it so the two meshes are one */
    if ((u === 0 || u === K) && (v === 0 || v === K)) {
      const ci = i + (u === K ? 1 : 0), cj = j + (v === K ? 1 : 0);
      const idx0 = map[cj * nx + ci];
      if (idx0 >= 0) { fineAt.set(key, idx0); return idx0; }
    }
    const x = R.x0 + (i + u / K) * R.dx, z = R.z0 + (j + v / K) * R.dx;
    const H = (ci, cj) => heights[cj * nx + ci];
    let h;
    const onLeft = u === 0, onRight = u === K, onBottom = v === 0, onTop = v === K;
    const stitch = (onLeft && !isFine(i - 1, j)) || (onRight && !isFine(i + 1, j))
                || (onBottom && !isFine(i, j - 1)) || (onTop && !isFine(i, j + 1));
    if (stitch && (onLeft || onRight)) {
      const ci = i + (onRight ? 1 : 0);
      h = H(ci, j) + (H(ci, j + 1) - H(ci, j)) * (v / K);
    } else if (stitch) {
      const cj = j + (onTop ? 1 : 0);
      h = H(i, cj) + (H(i + 1, cj) - H(i, cj)) * (u / K);
    } else {
      h = terrainH(x, z);
    }
    const vi = emitFine(x, z, h);
    fineAt.set(key, vi);
    return vi;
  };

  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = map[j * nx + i], b = map[j * nx + i + 1], c = map[(j + 1) * nx + i], d = map[(j + 1) * nx + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    if (isFine(i, j)) {
      for (let v = 0; v < K; v++) for (let u = 0; u < K; u++) {
        const p00 = vertOf(i, j, u, v), p10 = vertOf(i, j, u + 1, v);
        const p01 = vertOf(i, j, u, v + 1), p11 = vertOf(i, j, u + 1, v + 1);
        idx.push(p00, p01, p10, p10, p01, p11);
      }
      continue;
    }
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  groundChannels(g, det, bmp, gls, str, aoArr, mow);
  g.setIndex(idx);
  g.computeVertexNormals();
  stats.verts += pos.length / 3; stats.tris += idx.length / 3;
  if (R === CORE) builtTerrain.core = { ...R, nx, nz, heights };
  else if (R === MIDR) builtTerrain.mid = { ...R, nx, nz, heights };
  return g;
}

/* WebGPU permits only 8 vertex buffers, and position + color + normal already
   take three. The six ground channels therefore share ONE interleaved buffer --
   they count as a single vertex buffer while the shaders keep reading
   aDet/aBmp/aGls/aStr/aAO/aMow by name, on both backends. A ninth separate
   attribute is exactly how the terrain silently stopped drawing under WebGPU. */
function groundChannels(g, det, bmp, gls, str, ao, mow) {
  const n = det.length;
  const lace = new Float32Array(n * 7);
  for (let v = 0; v < n; v++) {
    const o = v * 7;
    lace[o] = det[v]; lace[o + 1] = bmp[v]; lace[o + 2] = gls[v]; lace[o + 3] = str[v];
    lace[o + 4] = ao[v]; lace[o + 5] = mow[v * 2]; lace[o + 6] = mow[v * 2 + 1];
  }
  const buf = new THREE.InterleavedBuffer(lace, 7);
  g.setAttribute('aDet', new THREE.InterleavedBufferAttribute(buf, 1, 0));
  g.setAttribute('aBmp', new THREE.InterleavedBufferAttribute(buf, 1, 1));
  g.setAttribute('aGls', new THREE.InterleavedBufferAttribute(buf, 1, 2));
  g.setAttribute('aStr', new THREE.InterleavedBufferAttribute(buf, 1, 3));
  g.setAttribute('aAO', new THREE.InterleavedBufferAttribute(buf, 1, 4));
  g.setAttribute('aMow', new THREE.InterleavedBufferAttribute(buf, 2, 5));
}

/* A skirt hangs a wall down from a rectangle's edge so a sliver of sky can never
   show through the seam between two levels of detail. */
function skirt(R, depth, sampler) {
  const pos = [], col = [], det = [], bmp = [], gls = [], str = [], mow = [], aoArr = [], idx = [];
  const edge = [];
  const N = 220;
  for (let i = 0; i <= N; i++) edge.push([lerp(R.x0, R.x1, i / N), R.z0]);
  for (let i = 1; i <= N; i++) edge.push([R.x1, lerp(R.z0, R.z1, i / N)]);
  for (let i = 1; i <= N; i++) edge.push([lerp(R.x1, R.x0, i / N), R.z1]);
  for (let i = 1; i <= N; i++) edge.push([R.x0, lerp(R.z1, R.z0, i / N)]);
  for (const [x, z] of edge) {
    const h = sampler(x, z);
    const g = groundAt(x, z, h);
    for (const y of [h + 0.05, h - depth]) {
      pos.push(x, y, z);
      col.push(g.col[0] * 0.8, g.col[1] * 0.8, g.col[2] * 0.8);
      aoArr.push(1.0);
      det.push(g.det); bmp.push(g.bmp); gls.push(0.02); str.push(0); mow.push(0, 0);
    }
  }
  for (let i = 0; i < edge.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  groundChannels(g, det, bmp, gls, str, aoArr, mow);
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Each coarse level keeps a ring of itself underneath the finer one instead of
   stopping at its edge. A skirt hung at the seam works, but it is a vertical wall,
   and a vertical wall a kilometre away catches the low sun and draws a bright line
   across the hills that reads as a road cut. Tucking the coarse mesh under the fine
   one costs one ring of triangles and cannot be seen at all: whatever shows through
   a crack is the same hillside, one level coarser. */
const under = (R, by) => ({ x0: R.x0 + by, x1: R.x1 - by, z0: R.z0 + by, z1: R.z1 - by });

if (groundMode === 'atlas') {
  const features = buildGroundSurfaceFeatures({ holes: HOLES, model: M });

  const atlasStarted = performance.now();
  groundAtlas = createGroundAtlas({ CORE, HOLES, features, res: 1 });
  BOOT_PERF.atlasMs = +(performance.now() - atlasStarted).toFixed(1);
}

const turfMat = groundMode === 'atlas'
  ? makeGround({ atlas: groundAtlas, DETAIL, SANDN, uSun, C, SHADE })
  : makeTurf();
/* Every surface that LIES ON the terrain -- mown overlays, sand, roads, paths,
   parking, ballast, the greengrid -- nudges itself in front of it in DEPTH SPACE,
   in units of whatever precision the device's depth buffer actually has. The
   centimetres of world-space lift alone z-fight on a phone's shallow buffer at
   distance, which is where the speckled fairways in the phone photo came from.
   Only the three terrain levels themselves stay un-nudged. */
const nudged = (tier, mk = makeTurf) => {
  const m = mk();
  m.polygonOffset = true;
  m.polygonOffsetFactor = -tier;
  m.polygonOffsetUnits = -tier * 2;
  return m;
};
const DETAIL_MASK = buildDetailMask(CORE);
const coreMesh = new THREE.Mesh(await buildTerrain(CORE, null, true), turfMat);
coreMesh.userData.tag = 'core';
coreMesh.receiveShadow = true; coreMesh.castShadow = true;
scene.add(coreMesh);

await tick('bygger terrängen', 0.26);
const midMesh = new THREE.Mesh(await buildTerrain(MIDR, under(CORE, 24), true), turfMat);
midMesh.userData.tag = 'mid';
midMesh.receiveShadow = true;
scene.add(midMesh);

await tick('bygger horisonten', 0.34);
const farMesh = new THREE.Mesh(await buildTerrain(FARR, under(MIDR, 72), false), turfMat);
farMesh.userData.tag = 'far';
scene.add(farMesh);

/* Replace only the rectangular part of the legacy core for which all 16
   verified 1 m tiles exist. Triangles outside that pilot remain the seamless
   GPK1 fallback; boundary skirts on the BVCH topology seal the sub-grid cut. */
function cutTerrainPreviewRect(geometry, bounds) {
  const position = geometry.getAttribute('position');
  const source = geometry.getIndex()?.array;
  if (!position || !source || !bounds) return Object.freeze({ removedTriangles: 0 });
  const retained = new source.constructor(source.length);
  let write = 0, removedTriangles = 0;
  for (let index = 0; index < source.length; index += 3) {
    const a = source[index], b = source[index + 1], c = source[index + 2];
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    if (x > bounds.x0 && x < bounds.x1 && z > bounds.z0 && z < bounds.z1) {
      removedTriangles++;
      continue;
    }
    retained[write++] = a; retained[write++] = b; retained[write++] = c;
  }
  geometry.setIndex(new THREE.BufferAttribute(retained.slice(0, write), 1));
  return Object.freeze({ removedTriangles });
}

let terrainPreviewBatch = null;
let terrainPreviewLegacyIndex = null;
let terrainPreviewRender = Object.freeze({ status: TERRAIN_PREVIEW.ready ? 'pending' : 'fallback' });
if (TERRAIN_PREVIEW.ready) {
  try {
    const { TerrainTileBatchSet } = await import('./engine/v2-terrain-batch.mjs');
    /* Low-quality WebGL2 keeps exact 1 m CPU sampling but submits every second
       source vertex. That cuts the pilot from ~2.1 M to ~0.52 M triangles while
       preserving the same bounds, tile identities and single draw call. */
    const renderStride = !IS_GPU && LOWQ ? 2 : 1;
    const renderResources = TERRAIN_PREVIEW.renderResources(renderStride);
    terrainPreviewBatch = new TerrainTileBatchSet({
      maximumTiles: renderResources.length,
      morphDurationMilliseconds: 0,
      decorateMaterial: createV2GroundMaterialDecorator({
        /* A ready preview has verified both its height and migration-labelled
           surface tile frontier. Its material never silently falls back to an
           unbound runtime atlas inside the replaced terrain rectangle. */
        atlas: TERRAIN_PREVIEW.surfaceAtlas, DETAIL, C, SHADE,
      }),
    });
    terrainPreviewBatch.sync(renderResources);
    scene.add(terrainPreviewBatch.group);
    terrainPreviewLegacyIndex = coreMesh.geometry.getIndex();
    const cut = cutTerrainPreviewRect(coreMesh.geometry, TERRAIN_PREVIEW.bounds);
    if (cut.removedTriangles < 1) {
      throw new Error('verified terrain preview did not overlap the legacy core mesh');
    }
    terrainPreviewGroundActive = true;
    terrainPreviewRender = Object.freeze({
      status: 'ready',
      renderStride,
      meshResolutionMetres: renderResources[0].sampleSpacingMetres,
      ...cut,
      ...terrainPreviewBatch.stats(),
    });
    setTerrainPreviewBadge(
      IS_GPU ? 'WebGPU' : 'WebGL2', 'ready', renderResources[0].sampleSpacingMetres,
    );
  } catch (error) {
    terrainPreviewGroundActive = false;
    terrainPreviewBatch?.dispose();
    terrainPreviewBatch = null;
    TERRAIN_PREVIEW.surfaceAtlas?.dispose?.();
    if (terrainPreviewLegacyIndex) coreMesh.geometry.setIndex(terrainPreviewLegacyIndex);
    terrainPreviewRender = Object.freeze({
      status: 'failed',
      error: String(error?.message || error).slice(0, 300),
    });
    console.warn('Puttom 1 m terrain renderer fell back to the GPK1 mesh:', error);
    setTerrainPreviewBadge(IS_GPU ? 'WebGPU' : 'WebGL2', 'failed');
  }
}

/* From here onward every surface, water-depth probe, vegetation/object base,
   camera constraint and interaction ray follows the visible ground contract. */
visibleGroundHeightAt = groundHeightSampler.heightAt;

/* ------------------------------------------------- conforming course surfaces
   A 4 m grid cannot hold the edge of a green: it would be a staircase. So every
   mown outline is triangulated on its own and laid a few centimetres over the
   ground, which is what makes the difference between a course and a coloured map. */
function triangulate(ring) {
  const pts = ring.map(p => new THREE.Vector2(p[0], p[1]));
  try { return THREE.ShapeUtils.triangulateShape(pts, []); } catch { return []; }
}
/* split until no edge is longer than `maxEdge`, so the patch follows the ground it
   is laid on instead of tenting over it */
function subdivide(verts, faces, maxEdge) {
  let V = verts.map(v => v.slice()), F = faces.map(f => f.slice());
  for (let pass = 0; pass < 5; pass++) {
    const mid = new Map(), nv = V, nf = [];
    let split = false;
    const key = (a, b) => a < b ? a + '_' + b : b + '_' + a;
    const midOf = (a, b) => {
      const k = key(a, b);
      if (mid.has(k)) return mid.get(k);
      const i = nv.length;
      nv.push([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2]);
      mid.set(k, i); return i;
    };
    for (const [a, b, c] of F) {
      const ab = hyp(V[a], V[b]), bc = hyp(V[b], V[c]), ca = hyp(V[c], V[a]);
      if (Math.max(ab, bc, ca) <= maxEdge) { nf.push([a, b, c]); continue; }
      split = true;
      const m1 = midOf(a, b), m2 = midOf(b, c), m3 = midOf(c, a);
      nf.push([a, m1, m3], [m1, b, m2], [m3, m2, c], [m1, m2, m3]);
    }
    V = nv; F = nf;
    if (!split) break;
  }
  return { V, F };
}

/* minimum-area oriented box of a ring: car rows run along it, gable ridges ride it */
function obb2(ring) {
  if (ring.length < 3) return null;
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const ang = Math.atan2(bz - az, bx - ax);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of ring) {
      const u = x * c + z * s, v = -x * s + z * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { area, cx: um * c - vm * s, cz: um * s + vm * c,
               hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, ang };
    }
  }
  if (best && best.hd > best.hw) {                     /* long axis is always hw */
    const t = best.hw; best.hw = best.hd; best.hd = t;
    best.ang += Math.PI / 2;
  }
  return best;
}

/* The rendered ground is NOT terrainH: it is terrainH sampled on the 4 m core grid
   and linearly interpolated across each triangle (split on the b-c diagonal, the
   same way buildTerrain indexes them). A conforming overlay must hug THAT surface:
   in a dished bunker the grid's chords ride well above the analytic curve, and an
   overlay lifted 3 cm off the curve had the terrain's grass triangles surfacing
   through the middle of the sand. Corner heights are memoised -- neighbouring
   overlay vertices share cells, so this costs about what one terrainH call did. */
function meshH(x, z) {
  return renderedGroundH(x, z);
}

/* Rings arrive as surveyed polygons: straight runs between vertices metres apart,
   and a mown edge drawn as straight segments reads as a zigzag -- the sharp lines
   the phone photo of the island 14th circles. Two rounds of corner-cutting turn
   every overlay boundary into the smooth curve a mower actually leaves. Rings that
   are already dense stay as they are. */
function chaikin(ring, rounds = 2) {
  let r = ring;
  for (let k = 0; k < rounds && r.length < 220; k++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
               [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    r = out;
  }
  return r;
}

function surfaceMesh(rings, lift, maxEdge, shade, conservative) {
  const pos = [], col = [], det = [], bmp = [], gls = [], str = [], mow = [], idx = [];
  for (const ring0 of rings) {
    if (ring0.length < 3) continue;
    const ring = chaikin(ring0);
    const faces = triangulate(ring);
    if (!faces.length) continue;
    const { V, F } = subdivide(ring, faces, maxEdge);
    const base = pos.length / 3;
    for (const [x, z] of V) {
      /* conservative: matching heights AT the vertices is not enough where the
         grid surface is convex BETWEEN them -- the bunker lip is a 4 m crease,
         and an overlay chord crossing it cut below the ridge, so the terrain
         surfaced through the sand as green gashes. Sampling a small neighbourhood
         and keeping the max rides the overlay over every crease it can span. */
      const h = conservative
        ? Math.max(meshH(x, z),
                   meshH(x + 1.6, z), meshH(x - 1.6, z), meshH(x, z + 1.6), meshH(x, z - 1.6),
                   meshH(x + 1.15, z + 1.15), meshH(x - 1.15, z + 1.15),
                   meshH(x + 1.15, z - 1.15), meshH(x - 1.15, z - 1.15))
        : meshH(x, z);
      const g = shade ? shade(x, z, h) : groundAt(x, z, h);
      const ao = horizonAO(x, z, h);
      /* the rim seals: a boundary vertex tucks below the terrain instead of
         floating a lift above it, so a grazing view never sees the dark gap
         under the overlay's edge -- the same lesson as the LoD skirts */
      const bd = ringSD(x, z, ring) > -0.05;
      pos.push(x, bd ? meshH(x, z) - 0.06 : h + lift, z);
      col.push(g.col[0] * ao, g.col[1] * ao, g.col[2] * ao);
      det.push(g.det); bmp.push(g.bmp); gls.push(g.gls); str.push(g.str);
      mow.push(g.mow || 0, g.mowK || 0);
    }
    for (const [a, b, c] of F) idx.push(base + a, base + c, base + b);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aDet', new THREE.Float32BufferAttribute(det, 1));
  g.setAttribute('aBmp', new THREE.Float32BufferAttribute(bmp, 1));
  g.setAttribute('aGls', new THREE.Float32BufferAttribute(gls, 1));
  g.setAttribute('aStr', new THREE.Float32BufferAttribute(str, 1));
  g.setAttribute('aMow', new THREE.Float32BufferAttribute(mow, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  stats.verts += pos.length / 3; stats.tris += idx.length / 3;
  return g;
}

await tick('lägger fairways och greener', 0.44);

/* Push a closed ring outward by d metres along its angle bisectors. Used for the
   collar round a green and the first cut round a fairway, which are the two bands
   that stop mown ground from looking like a decal stuck on the rough. */
function offsetRing(ring, d) {
  const n = ring.length, out = [];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  const sgn = area > 0 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const p = ring[i], a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
    const n1 = [p[1] - a[1], a[0] - p[0]], n2 = [b[1] - p[1], p[0] - b[0]];
    const l1 = Math.hypot(n1[0], n1[1]) || 1, l2 = Math.hypot(n2[0], n2[1]) || 1;
    const mx = n1[0] / l1 + n2[0] / l2, mz = n1[1] / l1 + n2[1] / l2;
    const ml = Math.hypot(mx, mz);
    if (ml < 0.15) { out.push(p.slice()); continue; }
    const half = Math.max(0.42, ml / 2);
    out.push([p[0] + mx / ml * sgn * d / half, p[1] + mz / ml * sgn * d / half]);
  }
  return out;
}

/* The overlays must not reuse the terrain's classifier. That one fades a surface out
   over several metres, which is right for a 4 m grid that cannot hold an edge and
   wrong here: an outline that has been cut on the ground has an edge, and running the
   soft classifier over it would blur back in exactly the crispness these meshes exist
   to provide. */
/* The mow coordinate: distance across the hole for a fairway, a fixed diagonal for
   anything with no hole to run along. It is carried per vertex and the band itself is
   computed per pixel from it, because a stripe baked into vertices on a 3.6 m mesh is
   sampled four times per 16 m period and comes out as beating, not as stripes. */
const mowCoord = (x, z, hole) => hole ? distToLine(x, z, hole.line) : (x + z) * 0.7071;
const mowBand = (x, z, hole, k) => Math.sin(mowCoord(x, z, hole) * k) * 0.5 + 0.5;
const shadeFair = hole => (x, z) => {
  const n = fbm(x * 0.06, z * 0.06, 2);
  /* mowK 2.30 made 1.4 m stripes -- half a real gang mower's width -- which aliased
     into shimmer at the 150-300 m a player actually reads a fairway. 0.95 is a
     3.3 m stripe, and the fairway carries the loudest mow on the course */
  return { col: C.fair.map(v => v * (0.97 + n * 0.06)),
           det: 1.55, bmp: 0.44, gls: 0.28, str: 1.15,
           mow: mowCoord(x, z, hole), mowK: 0.95 };
};
/* greens are mown in rings from the edge in, which is what the club's own aerials
   show -- the mow coordinate is distance to the green's edge, so the bands close
   concentrically around the surface instead of striping across it */
const shadeGreen = hole => (x, z) => ({
  col: C.green.slice(), det: 2.85, bmp: 0.13, gls: 0.42, str: 0.85,
  mow: hole ? -ringSD(x, z, hole.green.ring) : (x + z) * 0.7071, mowK: 4.19,
});
const shadeCollar = hole => (x, z) => ({
  col: C.fringe.slice(), det: 2.0, bmp: 0.3, gls: 0.34, str: 0.8,
  mow: mowCoord(x, z, hole), mowK: 2.90,
});
const shadeSemi = hole => (x, z) => {
  const n = fbm(x * 0.05, z * 0.05, 2);
  return { col: C.semi.map(v => v * (0.94 + n * 0.12)), det: 1.15, bmp: 0.62, gls: 0.17, str: 0.45,
           mow: mowCoord(x, z, hole), mowK: 1.05 };
};
const shadeTee = () => (x, z) => ({
  col: C.tee.slice(), det: 2.2, bmp: 0.22, gls: 0.4, str: 1.3,
  mow: (x - z) * 0.7071, mowK: 2.86,
});
const shadeSand = (x, z) => {
  const g = fbm(x * 0.3, z * 0.3, 2) * 0.05;
  /* the raked centre is palest; toward the wall under the lip the sand darkens
     and warms -- the occlusion of a cut hazard, which a light grid this coarse
     cannot shade on its own. sd is distance to the bunker's own edge. */
  let sd = -9;
  for (const b of BI.at(x, z)) sd = Math.max(sd, ringSD(x, z, b.ring));
  const wall = smooth(-1.5, -0.05, sd);
  const k = 0.95 + g;
  return { col: [C.sand[0] * k * (1 - wall * 0.14), C.sand[1] * k * (1 - wall * 0.20), C.sand[2] * k * (1 - wall * 0.28)],
           det: 2.3, bmp: 0.6, gls: 0.13, str: 0, mow: 0, mowK: 0 };
};

if (groundMode !== 'atlas') {
  /* Each overlay tier pulls itself in front of the layers beneath in depth space:
     semi first, then fairway, collar, green and tee, sand above all -- so the
     stack resolves on any depth buffer, not just a deep desktop one. */
  const OMATS = [null, nudged(1), nudged(2), nudged(3), nudged(4)];
  const sandMat = nudged(5, makeSand);
  const add = (rings, lift, edge, shade, order, mat, cons) => {
    const g = surfaceMesh(rings, lift, edge, shade, cons);
    if (!g) return;
    const m = new THREE.Mesh(g, mat || OMATS[Math.min(order, 4)]);
    m.receiveShadow = true;
    m.renderOrder = order;
    scene.add(m);
    stats.draws++;
  };
  /* laid in the order a mower would: the widest cut first, the tightest last */
  for (const h of HOLES) {
    if (h.fairway.rings.length) {
      add(h.fairway.rings.map(r => offsetRing(r, 4.5)), 0.018, 5.5, shadeSemi(h), 1);
      add(h.fairway.rings, 0.036, 3.6, shadeFair(h), 2);
    }
    add([offsetRing(h.green.ring, 3.2)], 0.052, 2.2, shadeCollar(h), 3);
    add([h.green.ring], 0.072, 1.4, shadeGreen(h), 4);
    add(h.tees.pads.map(t => offsetRing(t.ring, 2.2)), 0.05, 3.0, shadeCollar(h), 3);
    add(h.tees.pads.map(t => t.ring), 0.086, 2.0, shadeTee(), 4);
    if (h.bunkers.length) add(h.bunkers.map(b => offsetRing(b.ring, 0.5)), 0.035, 1.8, shadeSand, 5, sandMat, true);
  }
  /* the short course, the range and the practice green are mown grass too */
  add(M.scenery.fairways.concat(M.scenery.range), 0.03, 5.0,
      (x, z) => ({ ...shadeFair(null)(x, z), str: 0.35, mowK: 0 }), 2);
  add(M.scenery.greens, 0.06, 1.8, shadeGreen(null), 4);
  add(M.scenery.tees, 0.07, 2.4, shadeTee(), 4);
  add(M.scenery.bunkers.concat(M.veg.sand).map(r => offsetRing(r, 0.5)), 0.035, 2.2, shadeSand, 5, sandMat, true);
}

/* -------------------------------------------------------------- parking
   The three gravel lots OSM maps beside the clubhouse plus the south lot the
   satellite shows and OSM lacks. Compacted gravel, rows of parked cars, and an
   engine-heater post at every bay head -- a Norrland car park. */
const carSpots = [];
{
  const lots = (M.infra.parking || []).filter(p => p.ring && p.ring.length >= 3);
  if (groundMode !== 'atlas' && lots.length) {
    const g = surfaceMesh(lots.map(p => p.ring), 0.045, 4.0, (x, z) => {
      const n = fbm(x * 0.2, z * 0.2, 2);
      return { col: C.hard.map(v => v * (0.95 + n * 0.09)), det: 2.6, bmp: 0.4, gls: 0.12, str: 0 };
    });
    if (g) {
      const m = new THREE.Mesh(g, nudged(3));
      m.receiveShadow = true; m.renderOrder = 3;
      scene.add(m);
      stats.draws++;
    }
  }
  const posts = [];
  for (const p of lots) {
    const B = obb2(p.ring);
    if (!B || B.hw < 5) continue;
    const c = Math.cos(B.ang), s = Math.sin(B.ang);
    const rows = B.hd > 9 ? [-(B.hd - 3.1), B.hd - 3.1] : [0];
    for (const v of rows) {
      for (let u = -B.hw + 3; u <= B.hw - 3; u += 2.75) {
        const x = B.cx + u * c - v * s, z = B.cz + u * s + v * c;
        if (ringSD(x, z, p.ring) > -1.4) continue;
        const k = hash2(Math.round(x * 3), Math.round(z * 3));
        const hx = x + s * Math.sign(v || 1) * 2.3, hz = z - c * Math.sign(v || 1) * 2.3;
        posts.push(hx, terrainH(hx, hz) + 0.04, hz);
        if (k > 0.45) continue;
        carSpots.push({ x, z, yaw: -B.ang + (v >= 0 ? 0 : Math.PI) + (k - 0.2) * 0.08, h: terrainH(x, z) + 0.05 });
      }
    }
  }
  if (posts.length) {
    const pg = new THREE.CylinderGeometry(0.035, 0.04, 0.95, 5);
    pg.translate(0, 0.47, 0);
    const im = new THREE.InstancedMesh(pg, new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(0x3a3f45), roughness: 0.7 }), posts.length / 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < posts.length / 3; k++) {
      v3.set(posts[k * 3], posts[k * 3 + 1], posts[k * 3 + 2]);
      im.setMatrixAt(k, m4.compose(v3, q, s3));
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    stats.draws++;
  }
}

/* a car is two boxes; a car park is fifty of them in three colour buckets */
{
  for (const r of M.infra.roads) {
    if (r.kind !== 'trunk' || !r.oneway) continue;
    const { P } = resamp(r.line, 6);
    for (let i = 2; i < P.length - 2; i++) {
      if (hash2(Math.round(P[i][0]), Math.round(P[i][1])) > 0.045) continue;
      const b = Math.atan2(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      const off = (hash2(i, 7) - 0.5) * 1.6;
      const x = P[i][0] - Math.cos(b) * off, z = P[i][1] + Math.sin(b) * off;
      carSpots.push({ x, z, yaw: b, h: terrainH(x, z) + 0.2 });
    }
  }
  if (carSpots.length) {
    const body = mergeGeos([(() => { const g = new THREE.BoxGeometry(1.76, 0.6, 4.35); g.translate(0, 0.58, 0); return g; })(),
                            (() => { const g = new THREE.BoxGeometry(1.6, 0.52, 2.05); g.translate(0, 1.12, -0.15); return g; })()]);
    const PALETTES = [[0xd8d9d6, 0xb4b6b8], [0x2b2d30, 0x6f7275], [0x7e2a24, 0x2a3a55]];
    const buckets = [[], [], []];
    for (const csp of carSpots) {
      const k = hash2(Math.round(csp.x * 5), Math.round(csp.z * 5));
      buckets[k < 0.55 ? 0 : k < 0.85 ? 1 : 2].push(csp);
    }
    for (let bkt = 0; bkt < 3; bkt++) {
      const list = buckets[bkt];
      if (!list.length) continue;
      const mat = new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color(PALETTES[bkt][0]), roughness: 0.35, metalness: 0.55, flatShading: true });
      const im = new THREE.InstancedMesh(body, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
      for (let k = 0; k < list.length; k++) {
        const csp = list[k];
        v3.set(csp.x, csp.h, csp.z);
        const sc = 0.94 + hash2(k, bkt) * 0.14;
        s3.set(sc, sc, sc);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), csp.yaw);
        im.setMatrixAt(k, m4.compose(v3, q, s3));
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      scene.add(im);
      stats.draws++;
    }
    stats.cars = carSpots.length;
  }
}

/* Roads as engineered ribbons, for the same reason the fairways are overlays.

   Painted into a 4 m terrain grid a two-metre cart path cannot be narrower than the
   cell it lands in, so the whole network bled out to twenty metres of warm brown and
   read as dry riverbeds. A strip laid along the polyline is the right width by
   construction -- and a road is GRADED: its centreline height is a 24 m box filter
   of the ground, so it cuts and fills gently through the terrain's micro-relief the
   way a real roadbed does, while its verge vertices glue back to the ground and
   become the embankment shoulder. Each cross-section is five vertices:
   verge - edge - crown - edge - verge. aMow carries (metres along, across/halfW)
   and aStr the paint mode, which is how one merged mesh draws Swedish edge lines
   and 3/9 m lane dashes only where its roads actually have them. */
function resamp(L, step) {
  const P = [], S = [];
  let s = 0;
  for (let i = 0; i < L.length - 1; i++) {
    const d = hyp(L[i], L[i + 1]);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) {
      P.push([lerp(L[i][0], L[i + 1][0], k / n), lerp(L[i][1], L[i + 1][1], k / n)]);
      S.push(s + d * k / n);
    }
    s += d;
  }
  P.push(L[L.length - 1]); S.push(s);
  return { P, S };
}
function buildRoad(runs, asphalt) {
  const pos = [], col = [], det = [], bmp = [], gls = [], str = [], mow = [], idx = [];
  let ri = 0;
  for (const run of runs) {
    if (run.line.length < 2) continue;
    const { P, S } = resamp(run.line, 3);
    if (P.length < 2) continue;
    const lift = run.lift + (ri++ % 8) * 0.004;
    /* the graded centreline: box-filtered ground, never below run.minH (bridges) */
    const hraw = P.map(p => terrainH(p[0], p[1]));
    const hs = hraw.map((_, i) => {
      let a = 0, n = 0;
      for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < hraw.length) { a += hraw[j]; n++; } }
      return Math.max(a / n, run.minH || -1e9);
    });
    const base = pos.length / 3;
    const OFF = [-run.w - 2.2, -run.w, 0, run.w, run.w + 2.2];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      for (const u of OFF) {
        const x = P[i][0] + nx * u, z = P[i][1] + nz * u;
        const verge = Math.abs(u) > run.w + 0.01;
        const crown = 0.05 * (1 - (u / run.w) ** 2);
        const h = verge ? terrainH(x, z) + 0.03
                        : hs[i] + Math.max(0, crown) + lift;
        const ao = horizonAO(x, z, h);
        let cc;
        if (verge) {
          const g = groundAt(x, z, h);
          cc = g.col.map((v, k2) => lerp(v, C.hard[k2], 0.3) * ao);
        } else if (asphalt) {
          const n2 = fbm(x * 0.09, z * 0.09, 2);
          cc = run.tone.map(v => v * (1 + n2 * 0.10) * ao);
        } else {
          const n2 = fbm(x * 0.22, z * 0.22, 2);
          cc = (run.tone || C.path).map(v => v * (0.94 + n2 * 0.10) * ao);
        }
        pos.push(x, h, z);
        col.push(cc[0], cc[1], cc[2]);
        det.push(verge ? 0.8 : 3.2); bmp.push(verge ? 0.9 : 0.34); gls.push(asphalt && !verge ? 0.3 : 0.16);
        str.push(verge ? 0 : (run.paint || 0));
        mow.push(S[i], verge ? Math.sign(u) * 1.8 : u / run.w);
      }
    }
    for (let i = 0; i < P.length - 1; i++)
      for (let k = 0; k < 4; k++) {
        const a = base + i * 5 + k;
        idx.push(a, a + 1, a + 5, a + 5, a + 1, a + 6);
      }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aDet', new THREE.Float32BufferAttribute(det, 1));
  g.setAttribute('aBmp', new THREE.Float32BufferAttribute(bmp, 1));
  g.setAttribute('aGls', new THREE.Float32BufferAttribute(gls, 1));
  g.setAttribute('aStr', new THREE.Float32BufferAttribute(str, 1));
  g.setAttribute('aMow', new THREE.Float32BufferAttribute(mow, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  stats.verts += pos.length / 3; stats.tris += idx.length / 3;
  return g;
}

/* asphalt with its paint in the shader: aMow.y is across-the-road in half-widths,
   so the edge line sits at 0.90 on every road regardless of its width */
function makeAsphalt() {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });
  const am = attribute('aMow', 'vec2');
  const paint = attribute('aStr', 'float');
  const dt = texture(DETAIL, positionWorld.xz.mul(0.13)).g.sub(0.5);
  const base = attribute('color', 'vec3').mul(dt.mul(0.22).add(1));
  const uN = am.y.abs();
  const edge = oneMinus(smoothstep(0.025, 0.06, uN.sub(0.90).abs())).mul(step(0.5, paint));
  const dash = oneMinus(smoothstep(0.02, 0.05, uN))
                 .mul(step(1.5, paint))
                 .mul(oneMinus(smoothstep(0.22, 0.27, fract(am.x.div(12)))));
  m.colorNode = mix(base, color(0xcfd2d4), edge.add(dash).min(1).mul(0.8));
  /* asphalt shines at grazing light, which is most of how it reads as asphalt */
  const V = normalize(cameraPosition.sub(positionWorld));
  m.roughnessNode = float(0.76).sub(pow(oneMinus(saturate(V.y.abs())), 3).mul(0.22));
  return m;
}

{
  const asphaltRuns = [], gravelRuns = [], dirtRuns = [];
  for (const r of M.infra.roads) {
    const surf = r.surface || 'asphalt';
    if (r.kind === 'trunk') {
      /* the E4: paired one-way roadbeds of the 2+1, one wide bed east of Ås */
      const w = r.oneway ? (r.lanes >= 2 ? 3.9 : 2.6) : 5.0;
      asphaltRuns.push({ line: r.line, w, paint: (!r.oneway || r.lanes >= 2) ? 2 : 1, lift: 0.16, tone: C.aspT });
    } else if (r.kind === 'secondary' || r.kind === 'tertiary') {
      asphaltRuns.push({ line: r.line, w: 3.2, paint: 2, lift: 0.14, tone: C.aspL });
    } else if (/gravel|ground|dirt|unpaved|compacted/.test(surf)) {
      gravelRuns.push({ line: r.line, w: 2.2, lift: 0.12 });
    } else {
      asphaltRuns.push({ line: r.line, w: 2.7, paint: 0, lift: 0.12, tone: C.aspL });
    }
  }
  if (groundMode !== 'atlas') {
    for (const t of M.infra.tracks) {
      if (/asphalt|paved/.test(t.surface || '')) asphaltRuns.push({ line: t.line, w: 1.9, paint: 0, lift: 0.10, tone: C.aspL });
      else gravelRuns.push({ line: t.line, w: t.kind === 'service' ? 1.9 : 1.7, lift: t.kind === 'service' ? 0.10 : 0.08 });
    }
    for (const p of M.infra.paths) {
      if (p.kind === 'cycleway' || /asphalt|paved/.test(p.surface || ''))
        asphaltRuns.push({ line: p.line, w: 1.3, paint: 0, lift: 0.07, tone: C.aspL });
      else dirtRuns.push({ line: p.line, w: 0.55, lift: 0.06, tone: C.soil });
    }
  }
  const asphaltMat = nudged(2, makeAsphalt);
  /* the gravel and dirt ribbons shared the terrain's own material, so on a
     shallow depth buffer the ground fought straight through them */
  const ribbonTurf = nudged(2);
  for (const [runs, asphalt, mat] of [[asphaltRuns, true, asphaltMat],
                                      [gravelRuns, false, ribbonTurf],
                                      [dirtRuns, false, ribbonTurf]]) {
    const g = buildRoad(runs, asphalt);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.renderOrder = 1;
    scene.add(m);
    stats.draws++;
  }

  /* The 2+1's wire-rope median: the single most recognisable feature of a Swedish
     trunk road. Midpoints between antiparallel one-way roadbeds within 13 m. */
  const ows = M.infra.roads.filter(r => r.kind === 'trunk' && r.oneway)
    .map(r => resamp(r.line, 6));
  const barPts = [];
  for (let a = 0; a < ows.length; a++) {
    const A = ows[a];
    for (let i = 0; i < A.P.length - 1; i++) {
      const p = A.P[i];
      const tb = A.P[i + 1];
      const bx = tb[0] - p[0], bz = tb[1] - p[1];
      let best = null, bd = 13;
      for (let b = 0; b < ows.length; b++) {
        if (b === a) continue;
        const B = ows[b];
        for (let j = 0; j < B.P.length - 1; j++) {
          const q = B.P[j];
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d >= bd) continue;
          const cx = B.P[j + 1][0] - q[0], cz = B.P[j + 1][1] - q[1];
          if (bx * cx + bz * cz < 0) { best = q; bd = d; }   /* antiparallel only */
        }
      }
      if (best) barPts.push([(p[0] + best[0]) / 2, (p[1] + best[1]) / 2]);
    }
  }
  if (barPts.length > 1) {
    const pos = [], idx = [];
    for (let i = 0; i < barPts.length - 1; i++) {
      const [x0, z0] = barPts[i], [x1, z1] = barPts[i + 1];
      if (Math.hypot(x1 - x0, z1 - z0) > 9) continue;
      const h0 = terrainH(x0, z0) + 0.18, h1 = terrainH(x1, z1) + 0.18;
      const b = pos.length / 3;
      pos.push(x0, h0, z0, x1, h1, z1, x0, h0 + 0.62, z0, x1, h1 + 0.62, z1);
      idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color(0x9aa0a3), roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide }));
      m.renderOrder = 2;
      scene.add(m);
      stats.draws++;
    }
  }
}

/* ------------------------------------------------------------------- water */
await tick('fyller vattnet', 0.52);
/* Water, shaded by hand rather than lit.

   Running it through the standard BRDF makes the reflection colours behave as if they
   were paint: they get multiplied by the sun and the sky a second time and the fjord
   comes out as a flat pale sheet you would read as haze. What water actually looks
   like is almost entirely reflection and almost not at all diffuse, so this computes
   the four terms that matter -- what colour the depth is, what the sky looks like in
   the direction you are reflecting toward, where the sun's glare falls, and where the
   surface runs out into foam -- and writes the answer. */
function makeWater() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
  const aSh = attribute('aShore', 'float');
  const aFoam = attribute('aFoam', 'float');
  const wp = positionWorld.xz;
  const t = time;

  /* Four wave scales crossing at four angles. One scrolling layer repeats visibly;
     four at incommensurate speeds do not, and the two fine ones fade out with
     distance where they would otherwise be finer than a pixel and just shimmer. */
  const cd = cameraPosition.sub(positionWorld).length();
  const near = oneMinus(smoothstep(90, 900, cd));
  const n1 = texture(WATERN, wp.mul(0.115).add(vec2(t.mul(0.028), t.mul(0.017)))).xy.sub(0.5);
  const n2 = texture(WATERN, wp.mul(0.052).add(vec2(t.mul(-0.021), t.mul(0.033)))).xy.sub(0.5);
  const n3 = texture(WATERN, wp.mul(0.245).add(vec2(t.mul(0.047), t.mul(-0.038)))).xy.sub(0.5);
  const n4 = texture(WATERN, wp.mul(0.014).add(vec2(t.mul(0.008), t.mul(0.011)))).xy.sub(0.5);
  /* The fine chop is kept at three tenths out to the horizon rather than faded to
     nothing. Water seen far off is almost all reflection, and if the reflection is
     unbroken it is a mirror of a pale sky -- which is to say, indistinguishable from
     haze. The glitter is the thing that says water. */
  /* a pond has no fetch: the fjord's chop on a 20 m pond tilted enough normals that
     the fresnel term fired everywhere and fifteen ponds rendered as ice sheets */
  const rippleAmp = mix(float(0.38), float(1), aFoam);
  const ripple = n1.mul(near.mul(0.45).add(0.30)).add(n3.mul(near.mul(0.30).add(0.16)))
                   .add(n2.mul(0.7)).add(n4.mul(0.9)).mul(rippleAmp);
  const N = normalize(vec3(ripple.x.mul(0.55), float(1), ripple.y.mul(0.55)));

  const V = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(oneMinus(saturate(N.dot(V))), 4.2).mul(0.93).add(0.035);

  /* the sky in the mirror direction, built from the same three colours the dome uses
     so the fjord and the sky above it can never disagree */
  const R = reflect(V.negate(), N);
  const up = saturate(R.y);
  const sunUp = uSun.y.max(0.02);
  const skyC = mix(mix(color(0xd9c6ad), color(0xcfe0e6), smoothstep(0.10, 0.52, sunUp)),
                   mix(color(0x21538f), color(0x3479b4), sunUp), pow(up, 0.45));

  /* depth: the bed falls away from the bank, so the shallows keep their own colour.
     The ramp is the water's own scale -- 30 m of shallows suits a fjord, but on a
     pond whose whole radius is ten metres it kept every pixel pale */
  /* the deep body is the blue the club's aerials show, not steel grey */
  const depth = smoothstep(0.0, 1.0, saturate(aSh.div(mix(float(7), float(30), aFoam))));
  let body = mix(color(0x2b6b78), color(0x0a2b44), depth);
  /* the regulated fjärd's bottom reading up through thin water: pale silt in the
     shallowest film, then the dark olive weed the close aerial shows */
  const aDp = attribute('aDepth', 'float');
  const bed = oneMinus(smoothstep(0.12, 1.1, aDp)).mul(aFoam);
  const bedCol = mix(color(0x8a7a5c), color(0x2e4a35), smoothstep(0.18, 0.6, aDp));
  body = mix(body, bedCol, bed.mul(0.85));

  let c = mix(body, skyC, fres.mul(0.88));
  /* the sun's own reflection -- the single thing that says a surface is moving */
  const H = normalize(V.add(uSun));
  c = c.add(color(0xfff2da).mul(pow(saturate(N.dot(H)), 260).mul(3.6)));
  c = c.add(color(0xdff0f6).mul(pow(saturate(N.dot(H)), 22).mul(0.34)));
  /* foam, broken up by noise so a shoreline is a shoreline and not a stripe */
  /* Foam only where there is enough water behind it to make a wave. A metre-deep
     pond in a field has none at all, and drawing a three-metre white band round every
     one of them made fifteen ponds look like fifteen holes cut in an ice sheet. The
     lake gets a thin, broken line -- thresholded against noise so it is a scatter of
     wash rather than a rim. */
  const fw = texture(DETAIL, wp.mul(0.55).add(vec2(t.mul(0.035), t.mul(0.02)))).g;
  const foam = saturate(smoothstep(1.5, 0.15, aSh).mul(smoothstep(0.44, 0.72, fw)))
                 .mul(aFoam).mul(oneMinus(bed.mul(0.85)));
  c = mix(c, color(0xdfeeee), foam.mul(0.62));

  /* fog by hand too, since an unlit material gets none */
  const fogT = oneMinus(exp(cd.mul(cd).mul(uFogD.mul(uFogD)).negate()));
  m.colorNode = mix(c, uFogC, saturate(fogT));
  /* a pond bed a metre down should be a hint, not the picture: ponds start denser */
  m.opacityNode = mix(mix(float(0.86), float(0.97), depth),
                      mix(float(0.62), float(0.97), depth), aFoam)
                    .add(foam.mul(0.2)).sub(bed.mul(0.28)).clamp(0.4, 1);
  return m;
}
const waterMat = makeWater();

for (const w of M.water) {
  if (w.ring.length < 3) continue;
  const faces = triangulate(w.ring);
  if (!faces.length) continue;
  /* big water needs interior vertices for the wave normal to vary across; ponds
     need them for aShore -- at 26 m nearly every pond vertex sat ON the outline
     where aShore is zero, so the depth ramp never left the shallows */
  const { V, F } = subdivide(w.ring, faces, w.isLake ? 34 : 9);
  const pos = [], sh = [], fm = [], dp = [], idx = [];
  const foamy = w.isLake ? 1 : 0;
  for (const [x, z] of V) {
    pos.push(x, w.level, z);
    sh.push(Math.max(0, -ringSD(x, z, w.ring)));
    fm.push(foamy);
    /* how much water actually stands over the carved bed: the fjärd is a regulated
       lake and its wide pale margins are silt bottom UNDER water, so the shallows
       are drawn by letting the bed read through, not by exposing mud */
    dp.push(clampf(w.level - terrainH(x, z), 0, 3));
  }
  for (const [a, b, c] of F) idx.push(a, c, b);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(sh, 1));
  g.setAttribute('aFoam', new THREE.Float32BufferAttribute(fm, 1));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dp, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, waterMat);
  m.renderOrder = 6;
  scene.add(m);
  stats.draws++;
}

/* The open sea to the horizon. The detailed sea ring stops a couple of kilometres
   offshore; past it the vista heightfield is bare seabed. One coarse sheet at a
   whisker below 0 finishes the ocean: wherever the vista terrain is land it simply
   covers the sheet, and the real islands -- Mjältön, the Ulvöar, Högbonden's --
   stand out of it on their own DEM. */
if (M.water.some(w => w.isSea)) {
  const SX0 = HF1.x0, SX1 = HF1.x0 + (HF1.nx - 1) * HF1.dx;
  const SZ0 = HF1.z0, SZ1 = HF1.z0 + (HF1.nz - 1) * HF1.dx;
  const NXs = 56, NZs = 64;
  const pos = [], sh = [], fm = [], dp = [], idx = [];
  for (let j = 0; j <= NZs; j++) for (let i = 0; i <= NXs; i++) {
    pos.push(SX0 + (SX1 - SX0) * i / NXs, GEO.seaLevel - 0.05, SZ0 + (SZ1 - SZ0) * j / NZs);
    sh.push(60); fm.push(1); dp.push(3);
  }
  for (let j = 0; j < NZs; j++) for (let i = 0; i < NXs; i++) {
    const a = j * (NXs + 1) + i, b = a + 1, c = a + NXs + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(sh, 1));
  g.setAttribute('aFoam', new THREE.Float32BufferAttribute(fm, 1));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dp, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, waterMat);
  m.renderOrder = 5;
  scene.add(m);
  stats.draws++;
}

/* the five wooden jetties OSM maps on the fjärd's shore: plank decks over water */
{
  const lake = M.water.find(w => w.isLake);
  const deckY = (lake ? lake.level : 21.6) + 0.42;
  const V = [], K = [];
  const wood = L(0x8a7d6a), side = L(0x6d6154);
  const tri = (a, b, c, col) => { V.push(...a, ...b, ...c); K.push(...col, ...col, ...col); };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  for (const p of (M.infra.piers || [])) {
    if (p.ring) {
      const faces = triangulate(p.ring);
      for (const [a, b, c] of faces)
        tri([p.ring[a][0], deckY, p.ring[a][1]], [p.ring[c][0], deckY, p.ring[c][1]],
            [p.ring[b][0], deckY, p.ring[b][1]], wood);
      for (let i = 0; i < p.ring.length; i++) {
        const a = p.ring[i], b = p.ring[(i + 1) % p.ring.length];
        quad([a[0], deckY - 0.3, a[1]], [b[0], deckY - 0.3, b[1]],
             [b[0], deckY, b[1]], [a[0], deckY, a[1]], side);
      }
    } else if (p.line && p.line.length >= 2) {
      for (let i = 0; i < p.line.length - 1; i++) {
        const [x0, z0] = p.line[i], [x1, z1] = p.line[i + 1];
        const dl = Math.hypot(x1 - x0, z1 - z0) || 1;
        const nx = -(z1 - z0) / dl * 0.7, nz = (x1 - x0) / dl * 0.7;
        quad([x0 - nx, deckY, z0 - nz], [x1 - nx, deckY, z1 - nz],
             [x1 + nx, deckY, z1 + nz], [x0 + nx, deckY, z0 + nz], wood);
        quad([x0 - nx, deckY - 0.3, z0 - nz], [x1 - nx, deckY - 0.3, z1 - nz],
             [x1 - nx, deckY, z1 - nz], [x0 - nx, deckY, z0 - nz], side);
        quad([x0 + nx, deckY - 0.3, z0 + nz], [x1 + nx, deckY - 0.3, z1 + nz],
             [x1 + nx, deckY, z1 + nz], [x0 + nx, deckY, z0 + nz], side);
      }
    }
  }
  if (V.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(K, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide }));
    m.castShadow = true; m.renderOrder = 7;
    scene.add(m);
    stats.draws++;
  }
}

/* An armoured shore wears a collar of pale boulders at the waterline. They pack
   along the lake ring wherever it runs near the declared hole's green -- one
   instanced draw for the whole necklace. */
if (ARM) {
  const lake = M.water.find(w => w.isLake);
  if (lake) {
    const pts = [];
    const ring = lake.ring;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      if (Math.hypot(ax - ARM.c[0], az - ARM.c[1]) > ARM.rise && Math.hypot(bx - ARM.c[0], bz - ARM.c[1]) > ARM.rise) continue;
      /* A BAND, NOT A LINE. The club's photographs show a dumped-rock apron
         several metres wide, packed shoulder to shoulder all the way round the
         promontory; this was sampling a single jittered line and then throwing
         most of it away on a narrow height window, which left a sparse necklace
         of separate boulders. Walk ACROSS the shore normal as well as along it,
         and let the stones sit wherever the bank happens to be. */
      const segL = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / (segL || 1), uz = (bz - az) / (segL || 1);
      const nx = -uz, nz = ux;                     /* across the shore */
      const n = Math.max(1, Math.ceil(segL / 0.40));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        /* FIND THE BANK, THEN LAY THE COLLAR ON IT.
           Two earlier rules both failed, and for opposite reasons. Offsets from
           the traced ring drift, because the shore carve puts the real waterline
           metres away from the ring — so the band rode up the turf on one side
           and out into the lake on the other. A pure height window fails too,
           and worse: the carve holds the bed within a metre of the water level
           for fifteen metres out, so "near the water level" is a wide flat
           shelf, and the stones marched off the island onto it.
           What the collar actually follows is the BANK — the place the ground
           drops through the water level. So march outward along the shore normal
           until it does, and lay a narrow band across that crossing. */
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        let cross = null;
        for (let o = -5; o <= 9; o += 0.4) {
          if (terrainH(px + nx * o, pz + nz * o) <= lake.level) { cross = o; break; }
        }
        if (cross === null) continue;
        for (let s2 = 0; s2 < 5; s2++) {
          const off = cross - 1.7 + s2 * 0.72 + (hash2(i * 31 + k, s2 * 7 + 1) - 0.5) * 0.5;
          const jx = px + nx * off + (hash2(i * 13 + k, s2 * 5 + 3) - 0.5) * 0.5;
          const jz = pz + nz * off + (hash2(i * 17 + k, s2 * 13 + 5) - 0.5) * 0.5;
          const hh = terrainH(jx, jz);
          if (hh < lake.level - 0.6 || hh > lake.level + 1.3) continue;
          const sz = 0.38 + hash2(i + k, s2 + 21) * 0.44;
          pts.push(jx, hh - 0.08, jz, sz, hash2(i + k, s2 + 47) * TAU);
          /* The waterline itself carries the most rock -- it is the face the
             wash works on, and it is the band the eye reads. A second stone
             wherever the bank is within a metre of the level packs that zone
             without thickening the whole apron. */
          if (Math.abs(hh - lake.level) < 1.0) {
            const ex = jx + (hash2(i * 23 + k, s2 * 3 + 11) - 0.5) * 1.1;
            const ez = jz + (hash2(i * 29 + k, s2 * 9 + 17) - 0.5) * 1.1;
            const eh = terrainH(ex, ez);
            if (eh > lake.level - 0.6 && eh < lake.level + 1.3)
              pts.push(ex, eh - 0.08, ez, sz * 0.86, hash2(i + k, s2 + 71) * TAU);
          }
        }
      }
    }
    const nR = pts.length / 5;
    if (nR) {
      /* detail 0 on purpose: subdividing turned the riprap into smooth pebbles,
         and dumped granite is angular. "Less polygonal" is about surfaces that
         are curved in life -- a shoreline, a green -- not about rock. */
      const g = new THREE.DodecahedronGeometry(0.42, 0);
      g.scale(1, 0.72, 0.88);
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color(ARM.colour), roughness: 0.82, metalness: 0, flatShading: true }), nR);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
      for (let k = 0; k < nR; k++) {
        v3.set(pts[k * 5], pts[k * 5 + 1], pts[k * 5 + 2]);
        const sc = pts[k * 5 + 3];
        s3.set(sc, sc * 0.8, sc * (0.85 + (k % 3) * 0.12));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pts[k * 5 + 4]);
        im.setMatrixAt(k, m4.compose(v3, q, s3));
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      scene.add(im);
      stats.draws++; stats.riprap = nR;
    }
  }
}

/* --------------------------------------------------------------- vegetation */
await tick('planterar skogen', 0.60);

/* Trees are built rather than modelled: a spruce is a stack of drooping cones, a
   pine a bare trunk with a crown near the top, a birch a pale trunk under a loose
   canopy. Three species, two instanced meshes each, and the shapes differ enough
   that a treeline reads as a forest instead of a row of identical cones. */
function spruceGeo() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const r = 3.6 * (1 - t * 0.82) + 0.5;
    const hh = 3.4 * (1 - t * 0.4);
    const g = new THREE.ConeGeometry(r, hh, 11, 1, true);
    g.translate(0, 3.0 + t * 9.4, 0);
    parts.push(g);
  }
  return THREE.BufferGeometryUtils ? null : parts;
}
function mergeGeos(list) {
  let vt = 0, it = 0;
  for (const g of list) { vt += g.attributes.position.count; it += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vt * 3), nor = new Float32Array(vt * 3), idx = new Uint32Array(it);
  let vo = 0, io = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
/* A crown is grown, not turned. Every vertex of the merged crown is pushed by a
   seeded noise -- radially so the skirts run ragged, vertically so the tiers stop
   being parallel shelves -- and carries a brightness variation, because a single
   flat green over a whole tree is most of what made the treelines read as cut
   paper. Same triangle count as before; the polygons just stopped agreeing. */
function grownCrown(geo, seed, amp, colVar) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const n = fbm(x * 1.6 + seed * 13.7, z * 1.6 - y * 0.7 + seed * 7.1, 2);
    if (r > 0.05) {
      const k = 1 + n * amp;
      pos.setX(i, x * k); pos.setZ(i, z * k);
    }
    pos.setY(i, y + fbm(y * 0.9 + seed * 3.1, x * 1.2 - seed * 5.7, 2) * amp * 1.5);
    const cv = 1 + fbm(x * 2.1 - y * 1.1 + seed * 3, z * 2.1 + seed * 11, 2) * colVar;
    col[i * 3] = cv * (1 - n * 0.06); col[i * 3 + 1] = cv; col[i * 3 + 2] = cv * (1 + n * 0.1);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
const SPECIES = (() => {
  const spruce = grownCrown(mergeGeos((() => {
    const p = [];
    for (let i = 0; i < 7; i++) {
      const t = i / 6, r = 3.5 * (1 - t * 0.8) + 0.45, hh = 3.6 * (1 - t * 0.35);
      const g = new THREE.ConeGeometry(r, hh, 12, 1);
      g.translate(0, 2.6 + t * 9.6, 0);
      p.push(g);
    }
    return p;
  })()), 1, 0.15, 0.13);
  const pine = grownCrown(mergeGeos((() => {
    const p = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3, r = 4.2 - t * 1.4, hh = 2.8 - t * 0.5;
      const g = new THREE.ConeGeometry(r, hh, 12, 1);
      g.translate((t - 0.5) * 0.7, 8.5 + t * 2.6, (t * 0.6 - 0.3));
      p.push(g);
    }
    const tuft = new THREE.IcosahedronGeometry(1.5, 1);
    tuft.translate(0.4, 12.1, -0.2);
    p.push(tuft);
    return p;
  })()), 2, 0.2, 0.15);
  const birch = grownCrown(mergeGeos((() => {
    const p = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU;
      const g = new THREE.IcosahedronGeometry(2.3 - (i % 2) * 0.5, 1);
      g.translate(Math.cos(a) * 1.6, 7.2 + (i % 3) * 1.5, Math.sin(a) * 1.6);
      p.push(g);
    }
    return p;
  })()), 3, 0.22, 0.17);
  const trunk = (r0, r1, h) => { const g = new THREE.CylinderGeometry(r0, r1, h, 9); g.translate(0, h / 2, 0); return g; };
  return [
    { crown: spruce, trunk: trunk(0.18, 0.42, 3.2), cc: 0x2c5230, tc: 0x3f3122, sc: [0.85, 1.5] },
    { crown: pine, trunk: trunk(0.22, 0.46, 9.0), cc: 0x3a6134, tc: 0x6b4326, sc: [0.72, 1.34] },
    { crown: birch, trunk: trunk(0.16, 0.30, 7.4), cc: 0x5f8944, tc: 0xc9c6b2, sc: [0.60, 1.06] },
  ];
})();

/* coverAt (the satellite canopy raster) is decoded up by classify(), because the
   ground colour consults it too -- an OSM forest ring the imagery has thinned to
   scattered singles must not keep a closed-canopy floor. */

/* Where a tree may stand: in the woodland OSM drew or the hole plans show, off
   every mown surface, off the buildings' yards, out of the water -- and at FULL
   density right up to the stand's edge, because a treeline seen from the fairway
   is a wall, not a gradient. Interior thins a little (nobody sees deep into a
   stand at play height; the bigger interior crowns close the canopy instead).
   Two extra populations round it out: a birch fringe along the shorelines, and
   the occasional open-grown single the plans show scattered in the rough. */
/* Roughly how far is the shore: a multi-source BFS from every water margin on a
   6 m grid, out to 30 m. The birch belt needs the neighbourhood, not the survey,
   and asking the lake's 443-segment ring per sample would cost more than the
   whole planter. */
const SHORE = (() => {
  const cs = 6, x0 = MIDR.x0, z0 = MIDR.z0;
  const nx = Math.ceil((MIDR.x1 - x0) / cs), nz = Math.ceil((MIDR.z1 - z0) / cs);
  const d = new Float32Array(nx * nz).fill(1e9);
  let frontier = [];
  const seed = (x, z) => {
    const i = Math.floor((x - x0) / cs), j = Math.floor((z - z0) / cs);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = j * nx + i;
    if (d[k] > 0) { d[k] = 0; frontier.push(i, j); }
  };
  const walk = (pts, closed) => {
    for (let k = 0; k < (closed ? pts.length : pts.length - 1); k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / cs));
      for (let t = 0; t <= n; t++) seed(ax + (bx - ax) * t / n, az + (bz - az) * t / n);
    }
  };
  for (const w of M.water) walk(w.ring, true);
  for (const s of M.streams) walk(s.line, false);
  for (let step = 1; step <= 5; step++) {
    const next = [];
    for (let f = 0; f < frontier.length; f += 2) {
      const i = frontier[f], j = frontier[f + 1];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const k = b * nx + a;
        if (d[k] > step * cs) { d[k] = step * cs; next.push(a, b); }
      }
    }
    frontier = next;
  }
  return (x, z) => {
    const i = Math.floor((x - x0) / cs), j = Math.floor((z - z0) / cs);
    return (i < 0 || j < 0 || i >= nx || j >= nz) ? 1e9 : d[j * nx + i];
  };
})();

/* Reeds: the fjärd is a calm regulated lake and its low shores carry a Phragmites
   fringe -- densest on the reserve side, thinned where the course plays along the
   water so the views stay open. A reed is three crossed blades; ten thousand of
   them are one draw call. */
{
  const lake = M.water.find(w => w.isLake);
  if (lake) {
    const pts = [];
    const G = 1.7;
    /* the reed scan is boxed to the water body the course actually stands on --
       and the box matters beyond its cost: the 1.7 m lattice is phased from its
       own start, so moving the start moves every reed */
    const rb = (SCENERY && SCENERY.reedbed) || null;
    const bx0 = rb ? Math.max(MIDR.x0, rb.box[0]) : MIDR.x0, bx1 = rb ? Math.min(MIDR.x1, rb.box[1]) : MIDR.x1;
    const bz0 = rb ? Math.max(MIDR.z0, rb.box[2]) : MIDR.z0, bz1 = rb ? Math.min(MIDR.z1, rb.box[3]) : MIDR.z1;
    for (let z = bz0; z < bz1; z += G) {
      if (shouldYieldWork()) await yieldWork();
      for (let x = bx0; x < bx1; x += G) {
      const i = Math.floor(x / G), j = Math.floor(z / G);
      const px = x + (hash2(i, j) - 0.5) * G * 1.6, pz = z + (hash2(i + 7, j + 3) - 0.5) * G * 1.6;
      const shalBB = SHAL.some(sr => px > sr.bb.x0 && px < sr.bb.x1 && pz > sr.bb.z0 && pz < sr.bb.z1);
      if (!shalBB && SHORE(px, pz) > 7) continue;
      if (LOWQ && hash2(i + 5, j + 5) < 0.5) continue;
      const h = terrainH(px, pz);
      /* on the silt flats reeds gather into offshore islands -- the close aerial of
         the 14th shows whole beds standing in the shallow water -- while on firm
         shores they stay a waterline fringe */
      let inShal = false;
      if (shalBB) for (const sr of SHAL) if (ringSD(px, pz, sr.ring) < 0) { inShal = true; break; }
      let bedClump = 0;
      if (inShal) {
        if (h < lake.level - 0.42 || h > lake.level + 0.2) continue;
        const cl = fbm(px * 0.05, pz * 0.05, 2);
        if (cl < 0.22) continue;
        bedClump = 1;                       /* inside a bed, reeds stand shoulder to shoulder */
      } else if (h < lake.level - 0.22 || h > lake.level + 0.2) continue;
      let dens = 0.2 + (fbm(px * 0.02, pz * 0.02, 2) * 0.5 + 0.5) * 0.35;
      if (bedClump) dens = 0.92;
      if (rb && rb.denser && px < rb.denser[0]) dens *= rb.denser[1];
      const c = classify(px, pz);
      if (c.dLine < 34) dens *= 0.12;                    /* play stays open -- the moat above all */
      if (c.wet > 0.3) dens *= 2.2;                      /* the mapped reedbed */
      if (c.fair > 0.05 || c.green > 0.02 || c.tee > 0.02 || c.path > 0.1) continue;
      if (hash2(i + 31, j + 17) > dens) continue;
      pts.push(px, h - 0.06, pz, 0.5 + hash2(i + 61, j + 3) * 0.4, hash2(i + 3, j + 41) * TAU);
      }
    }
    const n = pts.length / 5;
    if (n) {
      const g = (() => {
        const p = [], nn = [];
        for (let k = 0; k < 3; k++) {
          const a = k / 3 * TAU + 0.7, c2 = Math.cos(a), s2 = Math.sin(a);
          p.push(c2 * 0.3, 0, s2 * 0.3, -c2 * 0.3, 0, -s2 * 0.3, c2 * 0.12, 2.1, s2 * 0.12);
          for (let q = 0; q < 3; q++) nn.push(-s2, 0.25, c2);
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        gg.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
        return gg;
      })();
      const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
      {
        const V = normalize(cameraPosition.sub(positionWorld));
        const lit = pow(saturate(V.dot(uSun.negate())), 2.2).mul(0.7);
        const tall = saturate(positionLocal.y.div(2.1)).mul(0.7);
        mat.colorNode = mix(color(0x53583a), uReedC, tall).mul(float(1).add(lit));

        /* GPU vertex sway for water reeds */
        const wp = positionWorld.xz;
        const hNorm = saturate(positionLocal.y.div(2.1));
        const weight = pow(hNorm, 1.6).mul(0.22);
        const windPhase = time.mul(2.2).add(wp.x.mul(0.08)).add(wp.y.mul(0.06));
        const swayX = sin(windPhase).mul(0.18).mul(weight);
        const swayZ = cos(windPhase.mul(0.9)).mul(0.14).mul(weight);
        mat.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));
      }
      const im = new THREE.InstancedMesh(g, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        v3.set(pts[k * 5], pts[k * 5 + 1], pts[k * 5 + 2]);
        const sc = pts[k * 5 + 3];
        s3.set(sc, sc * (0.85 + (k % 5) * 0.08), sc);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pts[k * 5 + 4]);
        im.setMatrixAt(k, m4.compose(v3, q, s3));
      }
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      stats.draws++; stats.reeds = n;
    }
  }
}

const trees = [[], [], []];
{
  const GAP = 5.4;
  const rnd = (i, j) => hash2(i * 7919 + 13, j * 104729 + 7);
  const bb = { x0: MIDR.x0, x1: MIDR.x1, z0: MIDR.z0, z1: MIDR.z1 };
  const hvBB = HV.map(l => ({ line: l.line, bb: ringBBox(l.line) }));
  const stakeCell = new Set();
  for (const m of (M.marking || [])) for (const [sx, sz] of m.pts)
    stakeCell.add(Math.floor(sx / 3) + ',' + Math.floor(sz / 3));
  const nearStake = (x, z) => {
    const ci = Math.floor(x / 3), cj = Math.floor(z / 3);
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++)
      if (stakeCell.has((ci + a) + ',' + (cj + b))) return true;
    return false;
  };
  for (let z = bb.z0; z < bb.z1; z += GAP) {
    if (shouldYieldWork()) await yieldWork();
    for (let x = bb.x0; x < bb.x1; x += GAP) {
    const i = Math.floor(x / GAP), j = Math.floor(z / GAP);
    if (LOWQ && rnd(i + 77, j + 55) < 0.45) continue;
    const px = x + (rnd(i, j) - 0.5) * GAP * 1.75;
    const pz = z + (rnd(i + 991, j + 77) - 0.5) * GAP * 1.75;
    let wood = 0, kindScrub = false;
    for (const v of VI.at(px, pz)) {
      if (v.kind === 'forest' || v.kind === 'wood') {
        const sd = ringSD(px, pz, v.ring);
        if (sd < 3.5) wood = Math.max(wood, sd < 0 ? 0.42 + 0.58 * smooth(-26, -12, sd)
                                                   : 0.3 * (1 - sd / 3.5));
      }
      else if (v.kind === 'scrub') { const sd = ringSD(px, pz, v.ring); if (sd < 0) { wood = Math.max(wood, 0.4); kindScrub = true; } }
    }
    /* The imagery is the authority in BOTH directions now. Satellite canopy plants
       where no polygon was surveyed -- and where the satellite sees open ground
       inside an OSM forest polygon (30% of their area), the stand thins to the
       scattered singles the club's own aerials show. OSM drew rooms; the imagery
       knows how much of each room is actually furnished. */
    const cvHere = coverAt(px, pz);
    if (wood < 0.05 && cvHere === 3) {
      /* density follows the LOCAL canopy fraction, not the single cell: solid
         raster plants a wall, speckle plants the scattered singles it depicts */
      let hits = 1;
      for (const [ox, oz] of [[4.5, 0], [-4.5, 0], [0, 4.5], [0, -4.5]])
        if (coverAt(px + ox, pz + oz) === 3) hits++;
      wood = 0.95 * Math.pow(hits / 5, 1.3);
    }
    if (cvHere === 2 && wood > 0.05) wood *= 0.07;
    /* Lone singles used to be a random sprinkle; the satellite raster's own
       speckle now says where they really stand, so the invented ones are gone --
       the club's aerial shows the mown expanse carrying literally none. A
       candidate with no woodland can still be a shore birch, so the early-out
       waits for the belt. */
    const dW = SHORE(px, pz);
    /* birches walk down to the waterline the way they do on every Norrland shore --
       thinner where the imagery says the shore is bare */
    const belt = dW < 28;
    if (belt) wood = Math.max(wood, 0.4 * (1 - smooth(18, 28, dW)) * (cvHere === 2 ? 0.22 : 1));
    /* what the surroundings say cannot stand here: cleared power-line corridors,
       the traced clear-fells (a few seed trees survive a hygge), working ground,
       hay meadows, and the open fields */
    if (wood > 0.05) {
      for (const hv of hvBB) {
        if (px < hv.bb.x0 - 15 || px > hv.bb.x1 + 15 || pz < hv.bb.z0 - 15 || pz > hv.bb.z1 + 15) continue;
        if (distToLine(px, pz, hv.line) < 14) { wood *= 0.12; break; }
      }
      for (const q of SI.at(px, pz)) if (ringSD(px, pz, q.ring) < 0)
        wood *= q.kind === 'cut' ? 0.06 : 0;
      for (const q of LI.at(px, pz))
        if ((q.kind === 'farmland' || q.kind === 'farmyard') && ringSD(px, pz, q.ring) < 0) wood = 0;
    }
    if (wood < 0.05) continue;
    const c = classify(px, pz);
    if (c.fair > 0.05 || c.green > 0.02 || c.tee > 0.02 || c.sand > 0.05 || c.path > 0.15) continue;
    if (c.dLine < 15) continue;
    const h = terrainH(px, pz);
    let wet = false;
    for (const w of WI.at(px, pz)) {
      if (w.stream) { if (distToLine(px, pz, w.line) < w.w * 3) wet = true; }
      else if (ringSD(px, pz, w.ring) < 3 || h < w.level + 0.5) wet = true;
    }
    if (wet) continue;
    let bldNear = false;
    for (const q of II.at(px, pz)) if (ringSD(px, pz, q.ring) < 6) { bldNear = true; break; }
    if (bldNear || nearStake(px, pz)) continue;
    /* the planted band thins toward the mid-ring edge; the impostor vista takes over */
    const edgeF = Math.min(px - bb.x0, bb.x1 - px, pz - bb.z0, bb.z1 - pz) / 50;
    if (edgeF < 1 && rnd(i + 43, j + 11) > edgeF) continue;
    const clump = fbm(px * 0.0165, pz * 0.0165, 2) * 0.5 + 0.5;
    if (rnd(i + 5, j + 5) > wood * (0.42 + clump * 0.86)) continue;
    const r = rnd(i + 31, j + 17);
    /* The default is the High Coast cape's pine country: pine on the rock and
       sand, spruce in the hollows, birch scattered through and fringing the
       shores. A course whose woods are genuinely another kind of woods overrides
       it -- Veckefjärden's reserve is grey-alder swamp forest, and rendering it
       as pine would be a statement about the place that is simply untrue. */
    const sp = kindScrub ? 2
             : (belt && r < 0.7) ? 2
             : SCENERY && SCENERY.species
               ? SCENERY.species({ r, x: px, z: pz, h, ringSD, RES })
               : (r < 0.56 ? 1 : r < 0.83 ? 0 : 2);
    let s = SPECIES[sp].sc[0] + rnd(i + 61, j + 3) * (SPECIES[sp].sc[1] - SPECIES[sp].sc[0]);
    if (wood < 0.3) s *= 1.2;                    /* a lone tree grows a full crown */
    trees[sp].push(px, h - 0.25, pz, s * (kindScrub ? 0.42 : 1), rnd(i + 3, j + 41) * TAU);
    }
  }
}
for (let s = 0; s < 3; s++) {
  const T = trees[s];
  const n = T.length / 5;
  if (!n) continue;
  const spec = SPECIES[s];
  for (const [geo, hex, isCrown] of [[spec.crown, spec.cc, true], [spec.trunk, spec.tc, false]]) {
    const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: isCrown ? 0.92 : 0.95, metalness: 0, flatShading: true });
    if (isCrown) {
      /* the same back-lit term the turf uses, so a treeline glows against a low sun
         instead of reading as a black cutout; birch crowns take the season's colour */
      const V = normalize(cameraPosition.sub(positionWorld));
      const cbase = s === 2 ? uLeaf : color(hex);
      mat.colorNode = cbase.mul(attribute('color', 'vec3')).mul(float(1).add(
        pow(saturate(V.dot(uSun.negate())), 2.6).mul(0.55)));
    }

    /* GPU-only harmonic wind sway with zero CPU matrix updates:
       Trunk roots at y=0 stay rigid, while crown upper branches gently bend */
    {
      const wp = positionWorld.xz;
      const hNorm = saturate(positionLocal.y.div(13.0));
      const weight = isCrown ? pow(hNorm, 1.4).mul(0.32) : pow(hNorm, 2.0).mul(0.10);
      const windPhase = time.mul(1.35).add(wp.x.mul(0.032)).add(wp.y.mul(0.024));
      const gust = sin(windPhase.mul(0.55)).mul(0.5).add(0.5);

      const swayX = sin(windPhase.add(positionLocal.y.mul(0.08))).mul(0.24)
                    .add(sin(windPhase.mul(2.1)).mul(0.06))
                    .mul(weight).mul(gust.mul(0.4).add(0.6));
      const swayZ = cos(windPhase.mul(0.82)).mul(0.18)
                    .add(cos(windPhase.mul(1.8)).mul(0.05))
                    .mul(weight).mul(gust.mul(0.4).add(0.6));

      mat.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    }
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.castShadow = true;
    im.receiveShadow = !isCrown;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      pos.set(T[k * 5], T[k * 5 + 1], T[k * 5 + 2]);
      const sc = T[k * 5 + 3];
      scl.set(sc, sc * (0.86 + (k % 7) * 0.045), sc);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), T[k * 5 + 4]);
      im.setMatrixAt(k, mtx.compose(pos, q, scl));
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = true;
    scene.add(im);
    stats.draws++;
  }
  stats.trees += n;
}

/* Beyond the planted middle ring the hills still carry forest, and a bare green
   hillside a kilometre off reads as clear-cut. One cone per stand-in, no trunks,
   no shadows, one draw call: at that distance a conifer is its silhouette. */
if (M.cover) {
  const cv = M.cover;
  const inset = 50;
  const pts = [];
  const rnd2 = (i, j) => hash2(i * 4241 + 5, j * 7573 + 11);
  /* no impostor conifer stands in a field, a garden block, a clear-fell or the yard */
  const openLand = (px, pz) => {
    for (const q of LI.at(px, pz))
      if (q.kind !== 'industrial' && q.kind !== 'commercial' && ringSD(px, pz, q.ring) < 0) return true;
    for (const q of SI.at(px, pz)) if (ringSD(px, pz, q.ring) < 0) return true;
    return false;
  };
  const cvx1 = cv.x0 + cv.nx * cv.cell, cvz1 = cv.z0 + cv.nz * cv.cell;
  /* the data ring: where the plans or the survey still reach */
  const GAP2 = LOWQ ? 18 : 13;
  for (let z = cv.z0; z < cvz1; z += GAP2) {
    if (shouldYieldWork()) await yieldWork();
    for (let x = cv.x0; x < cvx1; x += GAP2) {
      if (x > MIDR.x0 + inset && x < MIDR.x1 - inset &&
          z > MIDR.z0 + inset && z < MIDR.z1 - inset) continue;
      const i = Math.floor(x / GAP2), j = Math.floor(z / GAP2);
      const px = x + (rnd2(i, j) - 0.5) * GAP2 * 1.6;
      const pz = z + (rnd2(i + 7, j + 3) - 0.5) * GAP2 * 1.6;
      const cvv = coverAt(px, pz);
      let wooded = cvv === 3;
      /* the surveyed rings only speak where the imagery has no answer */
      if (!wooded && cvv === 0) for (const v of VI.at(px, pz)) {
        if ((v.kind === 'forest' || v.kind === 'wood') && ringSD(px, pz, v.ring) < 0) { wooded = true; break; }
      }
      if (!wooded) continue;
      if (openLand(px, pz)) continue;
      if (rnd2(i + 19, j + 13) > 0.8) continue;
      const h = terrainH(px, pz);
      if (h < GEO.seaLevel + 0.5) continue;
      pts.push(px, h - 0.4, pz, 0.8 + rnd2(i + 5, j + 23) * 0.7);
    }
  }
  /* beyond every record we have, the hills get the forest they carry in life --
     this ring is dressing, not data, and it stays far outside the property */
  const GAP3 = LOWQ ? 42 : 30;
  for (let z = FARR.z0; z < FARR.z1; z += GAP3) {
    if (shouldYieldWork()) await yieldWork();
    for (let x = FARR.x0; x < FARR.x1; x += GAP3) {
      if (x > cv.x0 && x < cvx1 && z > cv.z0 && z < cvz1) continue;
      const i = Math.floor(x / GAP3), j = Math.floor(z / GAP3);
      const px = x + (rnd2(i + 51, j + 29) - 0.5) * GAP3 * 1.6;
      const pz = z + (rnd2(i + 87, j + 61) - 0.5) * GAP3 * 1.6;
      if (fbm(px * 0.0011, pz * 0.0011, 2) < -0.18) continue;   /* pasture gaps */
      if (openLand(px, pz)) continue;
      /* a course may declare places this ring must not close over -- a churchyard
         it looks across at, a cleared works yard. They are facts about one place,
         so they come from the course's own module, never from the engine: the
         hardcoded coordinate that used to sit here was Norrfällsviken's, and it
         was punching that clearing into five other courses' horizons. */
      if (CLEARINGS.some(cl => Math.hypot(px - cl.c[0], pz - cl.c[1])
            < cl.r + (cl.wobble ? fbm(px * 0.01, pz * 0.01, 2) * cl.wobble : 0))) continue;
      if (rnd2(i + 9, j + 33) > 0.85) continue;
      const h = terrainH(px, pz);
      if (h < GEO.seaLevel + 1.5) continue;
      pts.push(px, h - 0.5, pz, 1.5 + rnd2(i + 3, j + 71) * 1.1);
    }
  }
  const n = pts.length / 4;
  if (n) {
    const geo = new THREE.ConeGeometry(3.1, 12, 5);
    geo.translate(0, 5.6, 0);
    const mat = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(0x2a4a2e), roughness: 0.95, metalness: 0, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      v.set(pts[k * 4], pts[k * 4 + 1], pts[k * 4 + 2]);
      const s = pts[k * 4 + 3];
      sv.set(s, s * (0.85 + (k % 5) * 0.07), s);
      im.setMatrixAt(k, m4.compose(v, q, sv));
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false;
    scene.add(im);
    stats.draws++;
    stats.vista = n;
  }
}

/* ---------------------------------------------------------- ground cover
   Rough at this scale is a hundred hectares of one colour, and no amount of texture
   fixes that on its own: what breaks up heathland in life is that it is lumpy with
   things -- tussocks of fescue, heather, juniper, stones. These are the cheapest
   possible stand-ins, a few triangles each, but they put an object every few metres
   where before there was a smooth surface, and that is most of the difference.

   They go only where the ground is neither mown nor wooded, and never inside the
   playing corridor, because rough this deep is a hazard and the corridor is not. */
{
  const tuft = (() => {
    const g = new THREE.BufferGeometry();
    const p = [], n = [];
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + 0.4, c = Math.cos(a), sn = Math.sin(a);
      /* a splayed blade: wide at the base, leaning out, meeting at a tip */
      p.push(c * 0.14, 0, sn * 0.14, -sn * 0.12, 0, c * 0.12, c * 0.24, 0.30, sn * 0.24);
      for (let k = 0; k < 3; k++) n.push(-sn, 0.55, c);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  })();
  const bush = new THREE.IcosahedronGeometry(0.62, 0);
  bush.scale(1, 0.62, 1); bush.translate(0, 0.34, 0);
  const stone = new THREE.DodecahedronGeometry(0.5, 0);
  stone.scale(1, 0.55, 0.85); stone.translate(0, 0.16, 0);

  const T = [], B = [], S = [], STU = [];
  const GAP = 5.2;
  const rnd = (i, j, k) => hash2(i * 6151 + k * 97, j * 24593 + k * 13);
  for (let z = MIDR.z0; z < MIDR.z1; z += GAP) {
    if (shouldYieldWork()) await yieldWork();
    for (let x = MIDR.x0; x < MIDR.x1; x += GAP) {
    const i = Math.round(x / GAP), j = Math.round(z / GAP);
    if (LOWQ && rnd(i, j, 9) < 0.5) continue;
    const px = x + (rnd(i, j, 1) - 0.5) * GAP * 1.8, pz = z + (rnd(i, j, 2) - 0.5) * GAP * 1.8;
    const c = classify(px, pz);
    if (c.fair > 0.03 || c.green > 0.02 || c.tee > 0.02 || c.sand > 0.05 || c.path > 0.1) continue;
    if (c.dLine < 24 || c.dLine > 300) continue;
    if (c.forest > 0.55) continue;                       /* the trees own that ground */
    let yard = false;
    for (const q of II.at(px, pz)) if (ringSD(px, pz, q.ring) < 3) { yard = true; break; }
    if (!yard) for (const q of LI.at(px, pz))
      if (q.kind !== 'industrial' && q.kind !== 'commercial' && ringSD(px, pz, q.ring) < 0) { yard = true; break; }
    if (!yard) for (const q of SI.at(px, pz))
      if (q.kind === 'yard' && ringSD(px, pz, q.ring) < 0) { yard = true; break; }
    if (yard) continue;                                  /* mown, cropped or worked ground */
    /* the clubhouse lawn is mown: no tussocks, no boulders on it */
    if (CLUB && Math.hypot(px - CLUB.cx, pz - CLUB.cz) < 52) continue;
    /* a clear-fell keeps its stumps: pale cut faces where the stand used to be */
    let cut = false;
    for (const q of SI.at(px, pz)) if (q.kind === 'cut' && ringSD(px, pz, q.ring) < 0) { cut = true; break; }
    if (cut) {
      if (rnd(i, j, 8) < 0.55) STU.push(px, terrainH(px, pz) - 0.04, pz, 0.8 + rnd(i, j, 7) * 0.5, rnd(i, j, 5) * TAU);
      continue;
    }
    const h = terrainH(px, pz);
    let wet = false;
    for (const w of WI.at(px, pz)) {
      if (w.stream) { if (distToLine(px, pz, w.line) < w.w * 3) wet = true; }
      else if (ringSD(px, pz, w.ring) < 3 || h < w.level + 0.4) wet = true;
    }
    if (wet) continue;
    const clump = fbm(px * 0.045, pz * 0.045, 2) * 0.5 + 0.5;
    const r = rnd(i, j, 3);
    const sc = 0.6 + rnd(i, j, 4) * 0.9;
    const rot = rnd(i, j, 5) * TAU;
    if (r < 0.52 + clump * 0.34) T.push(px, h, pz, sc, rot);
    else if (r < 0.90) { if (clump > 0.42) B.push(px, h, pz, sc * (0.7 + clump * 0.7), rot); }
    else {
      /* stones climb with the ground: the boulders belong on the slopes, the way
         hole 2's own drop carries its outcrops, not scattered evenly on the flats */
      const sl = Math.hypot(demH(px + 6, pz) - demH(px - 6, pz), demH(px, pz + 6) - demH(px, pz - 6)) / 12;
      const rocky = smooth(0.20, 0.52, sl);
      if (rnd(i, j, 6) > 0.72 - rocky * 0.5) S.push(px, h - 0.05, pz, sc * (0.8 + rocky * 1.7), rot);
    }
    }
  }

  const place = (geo, mat, arr, shadow) => {
    const n = arr.length / 5;
    if (!n) return 0;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      v.set(arr[k * 5], arr[k * 5 + 1], arr[k * 5 + 2]);
      const sc = arr[k * 5 + 3];
      sv.set(sc, sc * (0.8 + (k % 5) * 0.09), sc);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), arr[k * 5 + 4]);
      im.setMatrixAt(k, m4.compose(v, q, sv));
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = false;
    scene.add(im);
    stats.draws++;
    return n;
  };
  /* tussocks catch the low sun through the blade, the way the turf shader does */
  const tuftMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  {
    const V = normalize(cameraPosition.sub(positionWorld));
    const lit = pow(saturate(V.dot(uSun.negate())), 2.4).mul(0.55);
    const tint = texture(DETAIL, positionWorld.xz.mul(0.03)).b;
    tuftMat.colorNode = mix(color(0x4e5730), color(0x6b6a3c), tint).mul(float(1).add(lit.mul(0.45)));
  }
  const bushMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
  bushMat.colorNode = mix(color(0x4a5b32), color(0x6d5f4b),
    texture(DETAIL, positionWorld.xz.mul(0.017)).g);
  const stoneMat = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(0x7c766c), roughness: 0.86, metalness: 0, flatShading: true });

  stats.tufts = place(tuft, tuftMat, T, false);
  stats.bushes = place(bush, bushMat, B, true);
  stats.stones = place(stone, stoneMat, S, true);
  const stump = new THREE.CylinderGeometry(0.16, 0.2, 0.38, 6);
  stump.translate(0, 0.19, 0);
  const stumpMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
  stumpMat.colorNode = mix(color(0x5a4a38), color(0xb8a27c),
    smoothstep(0.3, 0.37, positionLocal.y));           /* pale cut face on top */
  stats.stumps = place(stump, stumpMat, STU, false);
}

/* ------------------------------------------------------- penalty marking
   Red and yellow stakes trace the margins of the water they mark -- the runs come out
   of the reconciler, which walked the real shorelines, so a stake can never stand away
   from its hazard. White is the property line. Rendered as one instanced mesh per
   colour: some eight hundred stakes, three draw calls. */
{
  const stakeGeo = new THREE.CylinderGeometry(0.035, 0.045, 1.05, 6);
  stakeGeo.translate(0, 0.52, 0);
  const capGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.09, 6);
  capGeo.translate(0, 0.98, 0);
  const COLS = { r: 0xd8443c, y: 0xe8c33a, w: 0xf2f0e8 };
  const byColor = { r: [], y: [], w: [] };
  for (const m of (M.marking || [])) {
    for (const [x, z] of m.pts) {
      /* a stake stands on dry ground; the reconciler put it there, but the sculpted
         bank can differ from the model's flat ring, so check against the built ground */
      const h = terrainH(x, z);
      let drowned = false;
      for (const w of WI.at(x, z)) if (!w.stream && h < w.level + 0.05) drowned = true;
      if (!drowned) byColor[m.c].push(x, h, z);
    }
  }
  for (const [c, arr] of Object.entries(byColor)) {
    const n = arr.length / 3;
    if (!n) continue;
    for (const geo of [stakeGeo, capGeo]) {
      const mat = new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color(COLS[c]), roughness: 0.55, metalness: 0.05,
        emissive: new THREE.Color(COLS[c]), emissiveIntensity: c === 'w' ? 0.05 : 0.12,
      });
      const im = new THREE.InstancedMesh(geo, mat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
      const sc = new THREE.Vector3(1, 1, 1);
      for (let k = 0; k < n; k++) {
        v.set(arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]);
        im.setMatrixAt(k, m4.compose(v, q, sc));
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      scene.add(im);
      stats.draws++;
    }
  }
}

/* --------------------------------------------------------- power and rail
   Two 130 kV corridors cross the property diagonally -- surveyed tower by tower in
   OSM -- and the Mellansel branch railway runs on its embankment just north of the
   E4. Both are the kind of thing a local sees without seeing; their absence is what
   made the middle distance read as nowhere in particular. */
{
  const PW = M.infra.power || { lines: [], towers: [], poles: [] };
  const IN = (x, z) => x > -1450 && x < 980 && z > -1900 && z < 700;
  /* a lattice pylon reads at distance as two crossed tapering planes and a crossarm */
  const towerGeo = (() => {
    const p = [], push = (...v) => p.push(...v);
    for (const rot of [0, Math.PI / 2]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      push(-1.6 * c, 0, -1.6 * s, 1.6 * c, 0, 1.6 * s, 0.45 * c, 22, 0.45 * s);
      push(1.6 * c, 0, 1.6 * s, -0.45 * c, 22, -0.45 * s, 0.45 * c, 22, 0.45 * s);
      push(1.6 * c, 0, 1.6 * s, -1.6 * c, 0, -1.6 * s, -0.45 * c, 22, -0.45 * s);
    }
    push(-3.4, 19.2, 0, 3.4, 19.2, 0, 3.4, 20.1, 0);
    push(-3.4, 19.2, 0, 3.4, 20.1, 0, -3.4, 20.1, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  })();
  const poleGeo = (() => {
    const g = new THREE.CylinderGeometry(0.14, 0.2, 9.5, 5);
    g.translate(0, 4.75, 0);
    const arm = new THREE.BoxGeometry(2.6, 0.16, 0.16);
    arm.translate(0, 8.6, 0);
    return mergeGeos([g, arm]);
  })();
  const towers = [], polesArr = [], wire = [];
  const seen = new Set();
  for (const ln of PW.lines) {
    const big = (ln.voltage || 0) >= 100000;
    const attach = big ? 19.5 : 8.2;
    const L = ln.line;
    for (let i = 0; i < L.length; i++) {
      const [x, z] = L[i];
      if (!IN(x, z)) continue;
      const key = Math.round(x / 4) + ',' + Math.round(z / 4);
      if (seen.has(key)) continue;
      seen.add(key);
      const nb = L[Math.min(i + 1, L.length - 1)], pb = L[Math.max(i - 1, 0)];
      const yaw = -Math.atan2(nb[1] - pb[1], nb[0] - pb[0]);
      (big ? towers : polesArr).push([x, terrainH(x, z) - 0.3, z, yaw]);
    }
    /* the wires: sagging catenaries between consecutive surveyed supports */
    if (!LOWQ) for (let i = 0; i < L.length - 1; i++) {
      const [x0, z0] = L[i], [x1, z1] = L[i + 1];
      if (!IN(x0, z0) && !IN(x1, z1)) continue;
      const span = Math.hypot(x1 - x0, z1 - z0);
      if (span < 4 || span > 480) continue;
      const h0 = terrainH(x0, z0) + attach, h1 = terrainH(x1, z1) + attach;
      const sag = Math.min(4.5, span * 0.035);
      const dx = x1 - x0, dz = z1 - z0;
      const nx = -dz / span, nz = dx / span;
      for (const off of big ? [-2.8, 0, 2.8] : [-1.0, 1.0]) {
        let prev = null;
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const pt = [x0 + dx * t + nx * off, lerp(h0, h1, t) - Math.sin(t * Math.PI) * sag, z0 + dz * t + nz * off];
          if (prev) wire.push(...prev, ...pt);
          prev = pt;
        }
      }
    }
  }
  const inst = (geo, list, colr) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(colr), roughness: 0.75, metalness: 0.3, flatShading: true, side: THREE.DoubleSide }), list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < list.length; k++) {
      v3.set(list[k][0], list[k][1], list[k][2]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), list[k][3]);
      im.setMatrixAt(k, m4.compose(v3, q, s3));
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    stats.draws++;
  };
  inst(towerGeo, towers, 0x7d8287);
  inst(poleGeo, polesArr, 0x5c5148);
  stats.pylons = towers.length + polesArr.length;

  /* the railway: ballast ribbon, two rails, masts -- and the Botniabanan bridge
     deck held above the water it crosses */
  const RW = (M.infra.railway || []).filter(r => r.line.length >= 2);
  if (RW.length) {
    const runs = RW.map(r => ({ line: r.line, w: 2.6, lift: 0.14, tone: C.ballast,
                                minH: r.bridge ? ((M.water.find(w => w.isLake) || { level: 22 }).level + 8) : -1e9 }));
    const g = buildRoad(runs, false);
    if (g) {
      const m = new THREE.Mesh(g, nudged(2));
      m.receiveShadow = true; m.renderOrder = 1;
      scene.add(m);
      stats.draws++;
    }
    const masts = [];
    for (const r of RW) {
      const { P, S } = resamp(r.line, 6);
      const bridge = RW.find(q2 => q2 === r).bridge;
      const minH = bridge ? ((M.water.find(w => w.isLake) || { level: 22 }).level + 8) : -1e9;
      let lastMast = -100;
      for (let i = 0; i < P.length - 1; i++) {
        const h = Math.max(terrainH(P[i][0], P[i][1]), minH) + 0.34;
        const hn = Math.max(terrainH(P[i + 1][0], P[i + 1][1]), minH) + 0.34;
        const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1];
        const dl = Math.hypot(dx, dz) || 1;
        const nx = -dz / dl, nz = dx / dl;
        if (!LOWQ) for (const off of [-0.75, 0.75])
          wire.push(P[i][0] + nx * off, h, P[i][1] + nz * off,
                    P[i + 1][0] + nx * off, hn, P[i + 1][1] + nz * off);
        if (S[i] - lastMast > 58) {
          lastMast = S[i];
          masts.push([P[i][0] + nx * 3.1, Math.max(terrainH(P[i][0] + nx * 3.1, P[i][1] + nz * 3.1), minH - 0.4), P[i][1] + nz * 3.1, -Math.atan2(dz, dx)]);
        }
      }
    }
    const mastGeo = (() => {
      const g2 = new THREE.CylinderGeometry(0.09, 0.12, 7.4, 5);
      g2.translate(0, 3.7, 0);
      const arm = new THREE.BoxGeometry(0.12, 0.12, 3.4);
      arm.translate(0, 6.9, -1.4);
      return mergeGeos([g2, arm]);
    })();
    inst(mastGeo, masts, 0x8a9094);
  }
  if (wire.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicNodeMaterial({
      color: new THREE.Color(0x2e3134), transparent: true, opacity: 0.8 }));
    scene.add(m);
    stats.draws++;
  }
}

/* ------------------------------------------------- distance plates + signs
   The fairway plates are distance-to-green markers, not pins: red 100, yellow 150,
   white 200, standing at the edge of the corridor where a player looks for them. */
const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);
const plateSites = [];
{
  const plateGeo = new THREE.BoxGeometry(0.4, 0.28, 0.06);
  plateGeo.translate(0, 0.62, 0);
  const postGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.62, 5);
  postGeo.translate(0, 0.31, 0);
  const postMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x6b6154), roughness: 0.9 });
  const PLATES = [[100, 0xd8443c], [150, 0xe8c33a], [200, 0xf2f0e8]];
  /* A yardage plate states the STRAIGHT-LINE distance to the middle of the
     green. It was being placed by the arc length still to run along the hole
     polyline, measured to the line's END -- two different things, and on a
     dogleg they diverge badly: measured across all six courses the plates were
     out by 2.6 m on average, 39 of 252 by more than five metres, and Ängsö's
     14th put its "200" where the green is 233 m away. Walking back from the
     green until the straight-line distance is the number on the plate is what
     the plate actually claims.
     Solved for the POST, not for the centre line: the post stands 15 m out to
     the side, and on a dogleg that offset is not perpendicular to the green, so
     placing the centre-line point correctly still left the post itself up to
     10 m out. What the post claims is the distance from where IT stands. */
  const plateAt = (line, greenC, dist, side) => {
    const total = polyLen(line);
    let best = null, bestErr = Infinity;
    /* the CLOSEST position, not the first one past the number: the post's own
       distance jumps at a polyline vertex, so a first-crossing search lands
       wherever the jump happens to leave it. Minimising picks the best the line
       can actually offer. */
    for (let s = 0; s <= total; s += 0.25) {
      const p = alongLine(line, 1 - s / total);
      const R = rightOf(p.b);
      const x = p.x + R[0] * 15 * side, z = p.z + R[1] * 15 * side;
      const err = Math.abs(hyp([x, z], greenC) - dist);   /* hyp takes two POINTS */
      if (err < bestErr) { bestErr = err; best = { p, x, z }; }
    }
    return bestErr <= 3 ? best : null;
  };
  for (const h of HOLES) {
    if (h.par < 4) continue;
    const total = polyLen(h.line);
    for (const [dist, col] of PLATES) {
      if (dist > total - 60) continue;
      for (const side of [-1, 1]) {
        const found = plateAt(h.line, h.green.c, dist, side);
        if (!found) continue;
        const { p, x, z } = found;
        const c = classify(x, z);
        if (c.sand > 0.1 || c.green > 0.1) continue;
        let wet = false;
        const y = terrainH(x, z);
        for (const w of WI.at(x, z)) if (!w.stream && y < w.level + 0.1) wet = true;
        if (wet) continue;
        const g = new THREE.Group();
        g.position.set(x, y, z);
        g.rotation.y = p.b + Math.PI / 2;
        const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardNodeMaterial({
          color: new THREE.Color(col), roughness: 0.5, emissive: new THREE.Color(col), emissiveIntensity: 0.1 }));
        plate.castShadow = true;
        g.add(new THREE.Mesh(postGeo, postMat), plate);
        furnitureGroup.add(g);
        /* recorded where they are PLANTED, so the gate measures the plate that
           was drawn rather than re-deriving where it ought to be -- a checker
           that restates the formula agrees with the bug */
        plateSites.push({ hole: h.n, says: dist, x, z, side });
      }
    }
  }
  /* a small sign at each green pointing at the next tee, so the walk reads */
  const signPlate = new THREE.BoxGeometry(0.5, 0.2, 0.05);
  signPlate.translate(0, 1.02, 0);
  const signPost = new THREE.CylinderGeometry(0.035, 0.04, 1.05, 5);
  signPost.translate(0, 0.52, 0);
  const signMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x2e4632), roughness: 0.75 });
  /* the plate is 0.5 x 0.2 m, so the face is drawn on a canvas of the same aspect --
     a square texture on a wide box stretches the arrow into a smear */
  const signFace = n => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#2e4632'; g.fillRect(0, 0, 160, 64);
    g.fillStyle = '#e6efe2';
    g.font = '700 34px Outfit,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('\u2192 ' + n, 80, 35);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  for (const h of HOLES) {
    const next = HOLES[h.n % NHOLES];
    const to = next.tees.marks[0].c;
    const b = Math.atan2(to[0] - h.pin[0], to[1] - h.pin[1]);
    const gr = Math.max(...h.green.ring.map(q => hyp(q, h.green.c)));
    const x = h.green.c[0] + Math.sin(b) * (gr + 5), z = h.green.c[1] + Math.cos(b) * (gr + 5);
    const g = new THREE.Group();
    g.position.set(x, terrainH(x, z), z);
    g.rotation.y = b;
    /* both faces read: the plate is passed on one side and met on the other, and a
       real sign at a real green is painted on both */
    const face = new THREE.MeshStandardNodeMaterial({ map: signFace(next.n), roughness: 0.8 });
    g.add(new THREE.Mesh(signPost, signMat),
          new THREE.Mesh(signPlate, [signMat, signMat, signMat, signMat, face, face]));
    furnitureGroup.add(g);
  }
}

/* ------------------------------------------------------------- furniture */
await tick('sätter ut flaggor', 0.72);
const TEE_COLS = CMETA.tees.cols;
const flagGroup = new THREE.Group();
scene.add(flagGroup);
const pins = [];
for (const h of HOLES) {
  const [x, z] = h.pin;
  const y = terrainH(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.6, 6),
    new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xf2f4f2), roughness: 0.35, metalness: 0.5 }));
  pole.position.y = 1.3; pole.castShadow = true;
  /* the club flies yellow flags with its badge, not red-and-amber halves */
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.5, 8, 3),
    new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xf2d24b),
      roughness: 0.85, side: THREE.DoubleSide }));
  cloth.position.set(0.39, 2.28, 0);
  g.add(pole, cloth);
  /* the cup, which is the thing that makes a green read as a green up close */
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.12, 12),
    new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x11170f), roughness: 1 }));
  cup.position.y = 0.02;
  g.add(cup);
  flagGroup.add(g);
  pins.push({ hole: h.n, cloth, g });

  /* tee markers: a pair per card tee, straddling the line */
  /* A pair of markers per card tee, set the width of a tee apart rather than the
     width of a stance, because that is how far apart they really are and at 0.13 m
     across they are otherwise unreadable from the deck behind them. */
  const mk = h.tees.marks;
  for (let k = 0; k < mk.length; k++) {
    const m = mk[k], b = m.b * Math.PI / 180, R = rightOf(b);
    const geo = new THREE.SphereGeometry(0.13, 8, 6);
    const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(TEE_COLS[k]), roughness: 0.45, metalness: 0.15 });
    for (const s of [-2.6, 2.6]) {
      const mx = m.c[0] + R[0] * s, mz = m.c[1] + R[1] * s;
      const sph = new THREE.Mesh(geo, mat);
      sph.position.set(mx, terrainH(mx, mz) + 0.11, mz);
      sph.castShadow = true;
      flagGroup.add(sph);
    }
  }
}

/* Buildings: every footprint within a kilometre in ONE vertex-coloured mesh --
   walls, gable roofs with the ridge on the long axis, a white fascia line under the
   eaves (the line that sells a Swedish house at three hundred metres) -- and the
   distant town as oriented boxes. Falu red dominates, because it does. The old
   version made two meshes PER building; twenty-eight buildings were fifty-six
   hidden draw calls, and every wall was the same grey. */
{
  const V = [], K = [];
  const tri = (a, b, c, col) => {
    V.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    K.push(...col, ...col, ...col);
  };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const areaOf = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
  const WALLS = [[0.55, L(0x7d2f24)], [0.70, L(0xd9c58a)], [0.82, L(0xc9c7bd)], [0.92, L(0x8f8c82)], [1.01, L(0x6f5b41)]];
  const ROOFA = L(0x3c3f42), ROOFB = L(0x6e3a28), TRIM = L(0xf0efe8), IND = L(0x9aa0a0);
  const wallOf = (cx, cz, kind, name) => {
    if (name && /golfklubb/i.test(name)) return L(0xe7e2d4);         /* the clubhouse */
    if (kind === 'industrial' || kind === 'commercial') return IND;
    const k = hash2(Math.round(cx / 2), Math.round(cz / 2));
    for (const [t, c] of WALLS) if (k < t) return c;
    return WALLS[0][1];
  };
  const roofOf = (cx, cz) => hash2(Math.round(cx / 2) + 7, Math.round(cz / 2) + 3) < 0.6 ? ROOFA : ROOFB;

  /* A house stands on the RENDERED ground, at its highest corner: basing on the
     lowest raw-DEM corner buried the sheds beside the clubhouse the moment its
     levelled bench raised the terrain around them. The skirt reaches down past
     the lowest corner so the downhill side never floats. */
  function houseBase(ring) {
    let top = -Infinity, bot = Infinity;
    for (const p of ring) {
      const t = terrainH(p[0], p[1]);
      top = Math.max(top, t); bot = Math.min(bot, t);
    }
    return { base: top + 0.06, skirt: Math.max(1.2, top - bot + 0.5) };
  }
  function house(ring, hgt, wall, roof, hip) {
    const { base, skirt } = houseBase(ring);
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      quad([a[0], base - skirt, a[1]], [b[0], base - skirt, b[1]],
           [b[0], base + hgt, b[1]], [a[0], base + hgt, a[1]], wall);
      /* fascia: outset a touch so it catches its own light */
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const el = Math.hypot(ex, ez) || 1;
      const ox = -ez / el * 0.05, oz = ex / el * 0.05;
      quad([a[0] + ox, base + hgt - 0.16, a[1] + oz], [b[0] + ox, base + hgt - 0.16, b[1] + oz],
           [b[0] + ox, base + hgt + 0.04, b[1] + oz], [a[0] + ox, base + hgt + 0.04, a[1] + oz], TRIM);
    }
    const B = obb2(ring);
    const area = areaOf(ring);
    if (hip && B) {
      /* The clubhouse's shallow hipped roof. The footprint is stepped, so a hip
         over the whole OBB overhung the notch by ten metres of floating slab --
         instead the footprint gets an exact flat cap (the rear wing's roof) and
         the hip rides only the block behind the longest wall. */
      const capC = roof.map(v => v * 0.8);
      const faces = triangulate(ring);
      for (const [a2, b2, c2] of faces)
        tri([ring[a2][0], base + hgt, ring[a2][1]], [ring[c2][0], base + hgt, ring[c2][1]],
            [ring[b2][0], base + hgt, ring[b2][1]], capC);
      let Lb = 0, Ei = 0;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const el = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (el > Lb) { Lb = el; Ei = i; }
      }
      const a0 = ring[Ei], a1 = ring[(Ei + 1) % n];
      const ux = (a1[0] - a0[0]) / Lb, uz = (a1[1] - a0[1]) / Lb;
      const cen = centroidOf(ring);
      let nx = -uz, nz = ux;
      if ((cen[0] - a0[0]) * nx + (cen[1] - a0[1]) * nz < 0) { nx = -nx; nz = -nz; }
      let dmax = 0;
      for (const p of ring) dmax = Math.max(dmax, (p[0] - a0[0]) * nx + (p[1] - a0[1]) * nz);
      const dep = Math.min(dmax, 14);
      const rise = clampf(dep * 0.24, 1.6, 3.2), rin = dep * 0.45;
      const P = (u, v, y) => [a0[0] + ux * u + nx * v, y, a0[1] + uz * u + nz * v];
      const e = base + hgt, r = e + rise, rm = dep / 2;
      quad(P(-0.5, -0.5, e), P(Lb + 0.5, -0.5, e), P(Lb + 0.5 - rin, rm, r), P(-0.5 + rin, rm, r), roof);
      quad(P(Lb + 0.5, dep + 0.5, e), P(-0.5, dep + 0.5, e), P(-0.5 + rin, rm, r), P(Lb + 0.5 - rin, rm, r), roof);
      tri(P(Lb + 0.5, -0.5, e), P(Lb + 0.5, dep + 0.5, e), P(Lb + 0.5 - rin, rm, r), roof);
      tri(P(-0.5, dep + 0.5, e), P(-0.5, -0.5, e), P(-0.5 + rin, rm, r), roof);
    } else if (B && area / (4 * B.hw * B.hd) > 0.68 && B.hd * 2 < 26) {
      /* gable: eaves rectangle inflated for overhang, ridge along the long axis */
      const c = Math.cos(B.ang), s = Math.sin(B.ang);
      const hw = B.hw + 0.35, hd = B.hd + 0.35;
      const rise = clampf(Math.tan(0.52) * B.hd, 1.2, 3.4);
      const P = (u, v, y) => [B.cx + u * c - v * s, y, B.cz + u * s + v * c];
      const e = base + hgt, r = e + rise;
      quad(P(-hw, -hd, e), P(hw, -hd, e), P(hw, 0, r), P(-hw, 0, r), roof);
      quad(P(hw, hd, e), P(-hw, hd, e), P(-hw, 0, r), P(hw, 0, r), roof);
      tri(P(hw, -hd, e), P(hw, hd, e), P(hw, 0, r), wall);
      tri(P(-hw, hd, e), P(-hw, -hd, e), P(-hw, 0, r), wall);
    } else {
      const faces = triangulate(ring);
      for (const [a, b2, c2] of faces)
        tri([ring[a][0], base + hgt, ring[a][1]], [ring[c2][0], base + hgt, ring[c2][1]],
            [ring[b2][0], base + hgt, ring[b2][1]], ROOFA);
    }
  }

  /* WHICH building is the clubhouse. Matching only /golfklubb/ found
     "Veckefjärdens golfklubb" and "Klubbhus Norrfällsvikens Golfklubb" but not
     "Ängsö GK Klubbhus" or Johannesberg's plain "klubbhus" -- so two of six
     clubhouses were being drawn as ordinary grey houses, 3.4 m tall with a
     generic roof and none of the clubhouse treatment. The marker layer already
     matched the wider pattern; the buildings pass was the odd one out.
     Only ONE building per course gets it, the largest match: Ängsö tags three
     separate structures "Ängsö GK Klubbhus", and its outbuildings are not
     clubhouses. Kept separate from CLUB, which shapes terrain. */
  const clubBuilding = M.infra.buildings
    .filter(b => b.ring.length >= 3
      && (b.amenity === 'clubhouse' || (b.name && /golfklubb|klubbhus/i.test(b.name))))
    .sort((a, b) => areaOf(b.ring) - areaOf(a.ring))[0] || null;

  for (const b of M.infra.buildings) {
    if (b.ring.length < 3) continue;
    if (b.amenity === 'place_of_worship') continue;   /* the chapel is bespoke */
    const [cx, cz] = centroidOf(b.ring);
    const isClub = b === clubBuilding;
    const hgt = b.h || (isClub ? CLUB_LOOK.height
              : b.kind === 'industrial' ? 5.5 : b.kind === 'commercial' ? 4.2
              : b.kind === 'house' || b.kind === 'residential' ? 3.0
              : areaOf(b.ring) < 45 ? 2.6 : 3.4);
    house(b.ring, hgt, isClub ? L(CLUB_LOOK.wall) : wallOf(cx, cz, b.kind, b.name),
          isClub ? L(CLUB_LOOK.roof) : roofOf(cx, cz), isClub);
    if (isClub) {
      /* the old school wears its three storeys of white-framed windows -- the grid
         is most of what says "that building" from the 18th fairway */
      const B = obb2(b.ring);
      if (B) {
        const c = Math.cos(B.ang), s = Math.sin(B.ang);
        /* the same base the walls use, or the windows and terrace drift off them */
        const { base } = houseBase(b.ring);
        const GLASS = L(0x212830);
        const P = (u, v, y) => [B.cx + u * c - v * s, y, B.cz + u * s + v * c];
        /* windows hang on the ring's own walls, not the bounding box -- the first
           two attempts floated them across the gaps where the footprint steps back */
        for (let e = 0; e < b.ring.length; e++) {
          const a0 = b.ring[e], a1 = b.ring[(e + 1) % b.ring.length];
          const ex = a1[0] - a0[0], ez = a1[1] - a0[1];
          const el = Math.hypot(ex, ez);
          if (el < 6) continue;
          const ux = ex / el, uz = ez / el;
          const nx = -uz, nz = ux;                       /* outward for a CCW-ish ring; DoubleSide forgives */
          const nWin = Math.floor((el - 2.4) / 2.15);
          for (const sgn of [1, -1]) for (const row of CLUB_LOOK.windowRows) {
            for (let w2 = 0; w2 < nWin; w2++) {
              const t0 = 1.2 + w2 * 2.15 + 0.35;
              const W = (tt, off, y) => [a0[0] + ux * tt + nx * off * sgn, y, a0[1] + uz * tt + nz * off * sgn];
              quad(W(t0 - 0.55, 0.09, base + row - 0.1), W(t0 + 0.55, 0.09, base + row - 0.1),
                   W(t0 + 0.55, 0.09, base + row + 1.6), W(t0 - 0.55, 0.09, base + row + 1.6), TRIM);
              quad(W(t0 - 0.42, 0.14, base + row), W(t0 + 0.42, 0.14, base + row),
                   W(t0 + 0.42, 0.14, base + row + 1.42), W(t0 - 0.42, 0.14, base + row + 1.42), GLASS);
            }
          }
        }
        /* the roof frame: the same longest-wall block the hip rides in house() */
        let Lb = 0, Ei = 0;
        for (let i2 = 0; i2 < b.ring.length; i2++) {
          const q0 = b.ring[i2], q1 = b.ring[(i2 + 1) % b.ring.length];
          const el2 = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
          if (el2 > Lb) { Lb = el2; Ei = i2; }
        }
        const r0 = b.ring[Ei], r1 = b.ring[(Ei + 1) % b.ring.length];
        const rux = (r1[0] - r0[0]) / Lb, ruz = (r1[1] - r0[1]) / Lb;
        let rnx = -ruz, rnz = rux;
        if ((cx - r0[0]) * rnx + (cz - r0[1]) * rnz < 0) { rnx = -rnx; rnz = -rnz; }
        let dmax = 0;
        for (const p of b.ring) dmax = Math.max(dmax, (p[0] - r0[0]) * rnx + (p[1] - r0[1]) * rnz);
        const dep = Math.min(dmax, 14);
        const ridgeY = base + hgt + clampf(dep * 0.24, 1.6, 3.2);
        const RP = u => [r0[0] + rux * u + rnx * dep / 2, r0[1] + ruz * u + rnz * dep / 2];
        /* chimneys on the ridge */
        for (const uC of [Lb * 0.28, Lb * 0.72]) {
          const e = ridgeY - 0.45, tC = ridgeY + 1.1;
          const cB = RP(uC);
          const corners = [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]];
          for (let k = 0; k < 4; k++) {
            const [o0, p0] = corners[k], [o1, p1] = corners[(k + 1) % 4];
            quad([cB[0] + o0, e, cB[1] + p0], [cB[0] + o1, e, cB[1] + p1],
                 [cB[0] + o1, tC, cB[1] + p1], [cB[0] + o0, tC, cB[1] + p0], L(0x8a8378));
          }
          quad([cB[0] - 0.45, tC, cB[1] - 0.45], [cB[0] + 0.45, tC, cB[1] - 0.45],
               [cB[0] + 0.45, tC, cB[1] + 0.45], [cB[0] - 0.45, tC, cB[1] + 0.45], ROOFA);
        }
        /* The garden front the photographs lead with: a white railed terrace
           running the whole course-facing wall, the broad stair down to the lawn,
           the flag row on the lawn below, and the Swedish flag on the ridge. */
        {
          /* the garden front faces the course -- south-west, toward the putting
             green and the 18th, where every ground photograph stands. Picking the
             west-MOST edge instead hung the terrace on the short gable end. */
          let bestE = -1, bestS = -1e9;
          for (let e2 = 0; e2 < b.ring.length; e2++) {
            const a0 = b.ring[e2], a1 = b.ring[(e2 + 1) % b.ring.length];
            const el2 = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
            if (el2 < 14) continue;
            const ex2 = (a1[0] - a0[0]) / el2, ez2 = (a1[1] - a0[1]) / el2;
            let nx2 = -ez2, nz2 = ex2;
            const mx2 = (a0[0] + a1[0]) / 2, mz2 = (a0[1] + a1[1]) / 2;
            if ((mx2 - cx) * nx2 + (mz2 - cz) * nz2 < 0) { nx2 = -nx2; nz2 = -nz2; }
            /* the garden front faces EAST here: the 9th and 18th greens and the
               practice ground all lie east of the clubhouse */
            const s2 = nx2;
            if (s2 > bestS) { bestS = s2; bestE = e2; }
          }
          if (bestE >= 0) {
            const a0 = b.ring[bestE], a1 = b.ring[(bestE + 1) % b.ring.length];
            const ex = a1[0] - a0[0], ez = a1[1] - a0[1];
            const el = Math.hypot(ex, ez);
            const ux = ex / el, uz = ez / el;
            let nx = -uz, nz = ux;
            const mx = (a0[0] + a1[0]) / 2, mz = (a0[1] + a1[1]) / 2;
            if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - cx) ** 2 + (mz - cz) ** 2) { nx = -nx; nz = -nz; }
            const A = (t, d, y) => [mx + ux * t + nx * d, y, mz + uz * t + nz * d];
            const HW = el / 2 - 1.0, D = 3.4, dk = base + 1.0;
            /* deck slab, front face, end faces */
            quad(A(-HW, 0, dk), A(HW, 0, dk), A(HW, D, dk), A(-HW, D, dk), TRIM);
            quad(A(-HW, D, base - 0.4), A(HW, D, base - 0.4), A(HW, D, dk), A(-HW, D, dk), TRIM);
            quad(A(-HW, 0, base - 0.4), A(-HW, D, base - 0.4), A(-HW, D, dk), A(-HW, 0, dk), TRIM);
            quad(A(HW, D, base - 0.4), A(HW, 0, base - 0.4), A(HW, 0, dk), A(HW, D, dk), TRIM);
            /* railing: a top band on posts */
            quad(A(-HW, D - 0.10, dk + 0.92), A(HW, D - 0.10, dk + 0.92),
                 A(HW, D - 0.10, dk + 1.06), A(-HW, D - 0.10, dk + 1.06), TRIM);
            for (let t = -HW + 0.5; t < HW; t += 1.7)
              quad(A(t - 0.05, D - 0.10, dk), A(t + 0.05, D - 0.10, dk),
                   A(t + 0.05, D - 0.10, dk + 0.95), A(t - 0.05, D - 0.10, dk + 0.95), TRIM);
            /* the broad stair down the middle of the terrace */
            for (let stp = 0; stp < 4; stp++) {
              const y = dk - (stp + 1) * 0.25, d1 = D + (stp + 1) * 0.36;
              quad(A(-2.6, d1 - 0.36, y), A(2.6, d1 - 0.36, y), A(2.6, d1, y), A(-2.6, d1, y), TRIM);
              quad(A(-2.6, d1, y), A(2.6, d1, y), A(2.6, d1, y - 0.25), A(-2.6, d1, y - 0.25), L(0xc9c7bd));
            }
            /* the flag row on the lawn below the terrace */
            for (let k = -2; k <= 2; k++) {
              const fx = mx + ux * k * 7 + nx * 14, fz = mz + uz * k * 7 + nz * 14;
              const fy = terrainH(fx, fz);
              for (const [ox, oz] of [[0.07, 0], [0, 0.07]])
                quad([fx - ox, fy, fz - oz], [fx + ox, fy, fz + oz],
                     [fx + ox * 0.7, fy + 8, fz + oz * 0.7], [fx - ox * 0.7, fy + 8, fz - oz * 0.7], TRIM);
              quad([fx, fy + 6.9, fz], [fx + ux * 1.15, fy + 6.9, fz + uz * 1.15],
                   [fx + ux * 1.15, fy + 7.7, fz + uz * 1.15], [fx, fy + 7.7, fz], TRIM);
            }
            /* the Swedish flag on the ridge */
            const rc = RP(Lb * 0.5);
            for (const [ox, oz] of [[0.06, 0], [0, 0.06]])
              quad([rc[0] - ox, ridgeY, rc[1] - oz], [rc[0] + ox, ridgeY, rc[1] + oz],
                   [rc[0] + ox, ridgeY + 4.6, rc[1] + oz], [rc[0] - ox, ridgeY + 4.6, rc[1] - oz], TRIM);
            quad([rc[0], ridgeY + 3.3, rc[1]], [rc[0] + ux * 1.5, ridgeY + 3.3, rc[1] + uz * 1.5],
                 [rc[0] + ux * 1.5, ridgeY + 4.25, rc[1] + uz * 1.5], [rc[0], ridgeY + 4.25, rc[1]], L(0x2a5fb4));
            quad([rc[0], ridgeY + 3.68, rc[1]], [rc[0] + ux * 1.5, ridgeY + 3.68, rc[1] + uz * 1.5],
                 [rc[0] + ux * 1.5, ridgeY + 3.88, rc[1] + uz * 1.5], [rc[0], ridgeY + 3.88, rc[1]], L(0xd8b93c));
          }
        }
      }
    }
  }

  /* Ås has no mapped footprints -- the village the southern holes look straight at
     exists in OSM only as residential landuse. Houses are laid out on a jittered
     grid inside those rings, kept off the roads, each aligned to its street. */
  for (const q of (M.infra.landuse || [])) {
    if (q.kind !== 'residential') continue;
    const bb = ringBBox(q.ring);
    let real = 0;
    for (const b of M.infra.buildings) {
      const [cx, cz] = centroidOf(b.ring);
      if (cx > bb.x0 && cx < bb.x1 && cz > bb.z0 && cz < bb.z1 && ringSD(cx, cz, q.ring) < 0) real++;
    }
    if (real > 2) continue;                       /* OSM already furnished this one */
    for (let z = bb.z0; z < bb.z1; z += 32) for (let x = bb.x0; x < bb.x1; x += 32) {
      const i = Math.floor(x / 32), j = Math.floor(z / 32);
      if (LOWQ && hash2(i + 3, j + 9) < 0.4) continue;
      const px = x + (hash2(i, j) - 0.5) * 22, pz = z + (hash2(i + 91, j + 17) - 0.5) * 22;
      if (ringSD(px, pz, q.ring) > -9) continue;
      if (hash2(i + 31, j + 5) > 0.62) continue;
      let road = null, rd = 26;
      for (const p of PI.at(px, pz)) {
        const d = distToLine(px, pz, p.line);
        if (d < rd) { rd = d; road = p; }
      }
      if (rd < 8) continue;                       /* on the street itself */
      const h0 = terrainH(px, pz);
      let wetB = false;
      for (const w of WI.at(px, pz)) if (!w.stream && (ringSD(px, pz, w.ring) < 4 || h0 < w.level + 0.5)) wetB = true;
      if (wetB) continue;
      let yaw = hash2(i + 13, j + 7) * TAU;
      if (road) {
        let bi = 0, bd = 1e9;
        for (let k = 0; k < road.line.length - 1; k++) {
          const d = distToLine(px, pz, [road.line[k], road.line[k + 1]]);
          if (d < bd) { bd = d; bi = k; }
        }
        yaw = Math.atan2(road.line[bi + 1][1] - road.line[bi][1], road.line[bi + 1][0] - road.line[bi][0]);
      }
      const hw = 4.6 + hash2(i + 1, j + 2) * 1.6, hd = 3.4 + hash2(i + 4, j + 8) * 0.9;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const ring = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
        .map(([u, v]) => [px + u * cs - v * sn, pz + u * sn + v * cs]);
      house(ring, 3.0, wallOf(px, pz, 'house', null), roofOf(px, pz));
      const qq = { ring, bb: ringBBox(ring) };
      II.add(qq, qq.bb, 10);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(K, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({
    vertexColors: true, roughness: 0.82, metalness: 0, flatShading: true, side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  stats.draws++; stats.tris += V.length / 9;

  /* the distant town: each far building is its oriented box, roof-grey on top,
     read through a kilometre of haze */
  const FB = M.infra.farB || [];
  if (FB.length) {
    const V2 = [], K2 = [];
    const tri2 = (a, b, c, col) => { V2.push(...a, ...b, ...c); K2.push(...col, ...col, ...col); };
    const q2 = (a, b, c, d, col) => { tri2(a, b, c, col); tri2(a, c, d, col); };
    for (const [cx, cz, hw, hd, ang, ind] of FB) {
      const h = ind ? 6.2 : 4.4;
      const base = demH(cx, cz) - 1.2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const P = (u, v, y) => [cx + u * c - v * s, y, cz + u * s + v * c];
      const k = hash2(Math.round(cx / 3), Math.round(cz / 3));
      const wall = ind ? IND : k < 0.5 ? L(0x86463c) : k < 0.8 ? L(0xb5ac93) : L(0x8f8c82);
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (let i = 0; i < 4; i++) {
        const [u0, v0] = corners[i], [u1, v1] = corners[(i + 1) % 4];
        q2(P(u0, v0, base), P(u1, v1, base), P(u1, v1, base + h), P(u0, v0, base + h), wall);
      }
      q2(P(-hw, -hd, base + h), P(hw, -hd, base + h), P(hw, hd, base + h), P(-hw, hd, base + h), ROOFA);
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(V2, 3));
    g2.setAttribute('color', new THREE.Float32BufferAttribute(K2, 3));
    g2.computeVertexNormals();
    const m2 = new THREE.Mesh(g2, new THREE.MeshStandardNodeMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide }));
    scene.add(m2);
    stats.draws++; stats.tris += V2.length / 9;
  }
}

/* --------------------------------------------------- club furniture and landmarks
   This cape's props: the target flags out on the driving range, the fishing
   village's white chapel of 1649 on its surveyed OSM footprint, and the boats
   along the marina piers -- the things a person standing on this course actually
   sees. The High Coast horizon itself (Mjältön, the Ulvö islands, Högbonden's
   island) needs no modelling: it is real terrain in the vista heightfield. */
{
  const V = [], K = [];
  const tri = (a, b, c, col) => { V.push(...a, ...b, ...c); K.push(...col, ...col, ...col); };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const WHITE = L(0xe8eae8), YEL = L(0xd8bc42), GREY = L(0x9a9fa3), DARKR = L(0x3c3f42);
  const avLights = [];
  const pole = (x, y0, z, h2, r, col) => {
    for (const [ox, oz] of [[r, 0], [0, r]])
      quad([x - ox, y0, z - oz], [x + ox, y0, z + oz], [x + ox * 0.6, y0 + h2, z + oz * 0.6], [x - ox * 0.6, y0 + h2, z - oz * 0.6], col);
  };
  /* The range's target flags, out in the landing field where a range actually
     keeps them. The satellite puts the tee shelter (an OSM hut, drawn with the
     buildings) at the field's NORTH end with the field falling away south of it,
     so the targets march away from the hut down the slope, staggered off the
     centre line at real ball-drop distances. The old version strung ten tall
     poles along the field's edge, which read as a fence across the tee line. */
  const rng = (M.scenery.range || [])[0];
  if (rng) {
    /* the tee bays stand on the field's WEST edge and the balls fly east */
    /* The tee end is the end of the field you walk to from the clubhouse. Deriving it
       beats writing it down: five of these six pages carried Norrfallsvikens hut
       coordinate, and a range traced anywhere else put its flags in another field. */
    const hut = (() => {
      const B = M.infra.buildings || [];
      const cb = B.find(q => q.amenity === 'clubhouse')
              || B.find(q => q.name && /golfklubb|klubbhus/i.test(q.name));
      if (!cb) return [-359, 229];
      const ref = centroidOf(cb.ring), rcen = centroidOf(rng);
      let best = rng[0], bd = Infinity;
      for (const p of rng) { const d = hyp(p, ref); if (d < bd) { bd = d; best = p; } }
      /* just inside the rim, so the first flag is not standing on the boundary */
      return [best[0] + (rcen[0] - best[0]) * 0.12, best[1] + (rcen[1] - best[1]) * 0.12];
    })();
    const c0 = centroidOf(rng);
    let dx = c0[0] - hut[0], dz = c0[1] - hut[1];
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const rx = -dz, rz = dx;
    const FCOL = [YEL, L(0xc9502e), WHITE];
    for (let k = 0; k < 6; k++) {
      const dist = 60 + k * 29;
      const lat = Math.sin(k * 2.4) * (14 + k * 3.5);
      let fx = hut[0] + dx * dist + rx * lat, fz = hut[1] + dz * dist + rz * lat;
      if (ringSD(fx, fz, rng) > -6) { fx = hut[0] + dx * dist; fz = hut[1] + dz * dist; }
      if (ringSD(fx, fz, rng) > -6) continue;
      const fy = terrainH(fx, fz);
      pole(fx, fy, fz, 3.2, 0.06, WHITE);
      const col = FCOL[k % 3];
      quad([fx, fy + 2.5, fz], [fx + rx * 1.1, fy + 2.5, fz + rz * 1.1],
           [fx + rx * 1.1, fy + 3.1, fz + rz * 1.1], [fx, fy + 3.1, fz], col);
    }
  }
  /* Norrfällsvikens kapell -- the fishing village's white wooden chapel of 1649,
     on its surveyed OSM footprint down by the harbour: a low white nave under a
     steep dark shingle roof, and the slender tower with its black cap and cross
     at one gable. It is the village's icon and the one built thing on this cape
     that earns a bespoke shape. */
  {
    const ch = (M.infra.buildings || []).find(b => b.amenity === 'place_of_worship');
    if (ch) {
      const R = ch.ring;
      let bi = 0, blen = 0;
      for (let i = 0; i < R.length; i++) {
        const a = R[i], b = R[(i + 1) % R.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > blen) { blen = l; bi = i; }
      }
      const a0 = R[bi], a1 = R[(bi + 1) % R.length];
      const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
      const ux = Math.cos(ang), uz = Math.sin(ang);
      const c = centroidOf(R);
      let y0 = Infinity;
      for (const p of R) y0 = Math.min(y0, terrainH(p[0], p[1]));
      y0 -= 0.15;
      const hw = Math.max(3.4, blen / 2 - 0.3), hd = 3.1;
      const P = (u, v, y) => [c[0] + ux * u - uz * v, y, c[1] + uz * u + ux * v];
      const WALLH = 3.1, RIDGE = 6.4, DARK = L(0x2e2a26);
      quad(P(-hw, -hd, y0), P(hw, -hd, y0), P(hw, -hd, y0 + WALLH), P(-hw, -hd, y0 + WALLH), WHITE);
      quad(P(hw, hd, y0), P(-hw, hd, y0), P(-hw, hd, y0 + WALLH), P(hw, hd, y0 + WALLH), WHITE);
      tri(P(hw, -hd, y0 + WALLH), P(hw, hd, y0 + WALLH), P(hw, 0, y0 + RIDGE), WHITE);
      tri(P(-hw, hd, y0 + WALLH), P(-hw, -hd, y0 + WALLH), P(-hw, 0, y0 + RIDGE), WHITE);
      quad(P(hw, -hd, y0), P(hw, hd, y0), P(hw, hd, y0 + WALLH), P(hw, -hd, y0 + WALLH), WHITE);
      quad(P(-hw, hd, y0), P(-hw, -hd, y0), P(-hw, -hd, y0 + WALLH), P(-hw, hd, y0 + WALLH), WHITE);
      quad(P(-hw - 0.25, -hd - 0.3, y0 + WALLH - 0.1), P(hw + 0.25, -hd - 0.3, y0 + WALLH - 0.1),
           P(hw + 0.25, 0, y0 + RIDGE), P(-hw - 0.25, 0, y0 + RIDGE), DARK);
      quad(P(hw + 0.25, hd + 0.3, y0 + WALLH - 0.1), P(-hw - 0.25, hd + 0.3, y0 + WALLH - 0.1),
           P(-hw - 0.25, 0, y0 + RIDGE), P(hw + 0.25, 0, y0 + RIDGE), DARK);
      /* the tower at the gable, its black pyramid cap and the cross */
      const tu = -hw + 1.0;
      const TX = c[0] + ux * tu, TZ = c[1] + uz * tu;
      for (const [du, dv] of [[1.1, 0], [0, 1.1]])
        quad([TX - ux * du + uz * dv, y0, TZ - uz * du - ux * dv],
             [TX + ux * du - uz * dv, y0, TZ + uz * du + ux * dv],
             [TX + (ux * du - uz * dv) * 0.82, y0 + 8.2, TZ + (uz * du + ux * dv) * 0.82],
             [TX - (ux * du - uz * dv) * 0.82, y0 + 8.2, TZ - (uz * du + ux * dv) * 0.82], WHITE);
      for (let k4 = 0; k4 < 4; k4++) {
        const aa = k4 / 4 * TAU + TAU / 8, ab = (k4 + 1) / 4 * TAU + TAU / 8;
        tri([TX + Math.cos(aa) * 1.15, y0 + 8.15, TZ + Math.sin(aa) * 1.15],
            [TX + Math.cos(ab) * 1.15, y0 + 8.15, TZ + Math.sin(ab) * 1.15],
            [TX, y0 + 11.0, TZ], DARK);
      }
      pole(TX, y0 + 10.9, TZ, 1.3, 0.07, WHITE);
      quad([TX - ux * 0.42, y0 + 11.85, TZ - uz * 0.42], [TX + ux * 0.42, y0 + 11.85, TZ + uz * 0.42],
           [TX + ux * 0.42, y0 + 12.03, TZ + uz * 0.42], [TX - ux * 0.42, y0 + 12.03, TZ - uz * 0.42], WHITE);
    }
  }
  /* boats along the marina piers: white hulls, a coloured transom-and-deck line,
     bow out, moored the way the summer harbour fills. Skipped wherever the spot
     is not actually water, so a pier that begins on the beach stays clear. */
  {
    const SHEER = [L(0x3b5a78), L(0xb04a38), L(0x4a7a52), L(0x777d84)];
    const isWater = (x, z) =>
      M.water.some(w => (w.isSea || w.isLake) && inRing(x, z, w.ring)) ||
      (M.infra.basins || []).some(b => inRing(x, z, b.ring));
    let bn = 0;
    for (const p of (M.infra.piers || [])) {
      const line = p.line || p.ring;
      if (!line || line.length < 2) continue;
      for (let i = 0; i < line.length - 1; i++) {
        const A = line[i], Bp = line[i + 1];
        const segL = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
        if (segL < 8) continue;
        const dx = (Bp[0] - A[0]) / segL, dz = (Bp[1] - A[1]) / segL;
        for (let d = 5; d + 4 < segL; d += 6.5) {
          bn++;
          if (hash2(bn, i * 7) < 0.38) continue;
          const side = (bn % 2 ? 2.0 : -2.0);
          const cx0 = A[0] + dx * d - dz * side, cz0 = A[1] + dz * d + dx * side;
          if (!isWater(cx0, cz0)) continue;
          const col = SHEER[bn % SHEER.length];
          const y = 0.02, bh = 0.6, hl = 2.6, hwd = 1.0, bow = 2.2;
          const p4 = (u, v, yy) => [cx0 + dx * u - dz * v, yy, cz0 + dz * u + dx * v];
          quad(p4(-hl, -hwd, y), p4(hl, -hwd, y), p4(hl, -hwd, y + bh), p4(-hl, -hwd, y + bh), WHITE);
          quad(p4(hl, hwd, y), p4(-hl, hwd, y), p4(-hl, hwd, y + bh), p4(hl, hwd, y + bh), WHITE);
          tri(p4(hl, -hwd, y + bh), p4(hl, -hwd, y), p4(hl + bow, 0, y + bh * 0.9), WHITE);
          tri(p4(hl, hwd, y), p4(hl, hwd, y + bh), p4(hl + bow, 0, y + bh * 0.9), WHITE);
          quad(p4(-hl, hwd, y), p4(-hl, -hwd, y), p4(-hl, -hwd, y + bh), p4(-hl, hwd, y + bh), col);
          quad(p4(-hl, -hwd, y + bh), p4(hl, -hwd, y + bh), p4(hl, hwd, y + bh), p4(-hl, hwd, y + bh), col);
        }
      }
    }
  }
  /* the course's own landmarks, if it has any -- Åsmasten and Själevads kyrka at
     Veckefjärden, the 1649 chapel at Norrfällsviken. Loaded by slug and handed
     THIS batch, so a horizon full of bespoke buildings is still one draw call,
     and a course without a module pays nothing at all. */
  await buildScenery(CMETA.slug, { THREE, scene, tri, quad, pole, demH, terrainH, L,
                                   WHITE, GREY, YEL, DARKR, vec3, stats, TAU, avLights });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(K, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({
    vertexColors: true, roughness: 0.6, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }));
  m.castShadow = true;
  scene.add(m);
  stats.draws++;
  /* the aviation lamps on the mast and the chimney: unlit and pushed past white
     so the bloom picks them out at dusk the way the real lamps read */
  if (avLights.length) {
    const P = [];
    for (const [lx, ly, lz] of avLights)
      for (const [ox, oz] of [[0.8, 0], [0, 0.8]]) {
        P.push(lx - ox, ly - 0.7, lz - oz, lx + ox, ly - 0.7, lz + oz, lx, ly + 0.8, lz);
        P.push(lx - ox, ly + 0.7, lz - oz, lx + ox, ly + 0.7, lz + oz, lx, ly - 0.8, lz);
      }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const lm = new THREE.Mesh(lg, new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }));
    lm.material.colorNode = vec3(3.0, 0.24, 0.2);
    scene.add(lm);
    stats.draws++; stats.tris += P.length / 9;
  }
}

/* ------------------------------------------------------------ post-process */
await tick('ställer ljuset', 0.86);
if (!LOWQ) {
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const bloomNode = bloom(sceneColor, 0.14, 0.3, 0.86);
  post.outputNode = sceneColor.add(bloomNode);
  renderer.__post = post;
  renderer.__bloomNode = bloomNode;   /* strength is per-preset; setPreset sets it */
}

/* RenderPipeline.render() intentionally takes no scene/camera arguments; the
   scene pass owns them. Keeping this call in one place prevents the WebGPU and
   forced-WebGL paths from quietly exercising different post-processing code. */
function renderActivePipeline() {
  if (renderer.__post) renderer.__post.render();
  else renderer.render(scene, camera);
}

/* the shadow camera follows the player, because a 2 km ortho frustum spends its
   whole resolution on ground nobody is looking at */
function placeSun() {
  const t = controls.target;
  const d = uSun.value;
  sun.position.set(t.x + d.x * 1200, t.y + d.y * 1200, t.z + d.z * 1200);
  sun.target.position.copy(t);
  sun.target.updateMatrixWorld();
  /* size the shadow box to what the camera can actually see, so a tee view spends
     all 2048 pixels on the tee and a wide view still has shadows at its edges */
  const R = clampf(camera.position.distanceTo(t) * 1.15 + 90, 260, 1150);
  const c = sun.shadow.camera;
  c.left = -R; c.right = R; c.top = R; c.bottom = -R;
  c.near = 200; c.far = 2400;
  c.updateProjectionMatrix();
}

/* ------------------------------------------------------------------- ui */
let hole = 1, teeIdx = 0, camMode = 'orbit', flying = 0;
const TEE_NAMES = CMETA.tees.names;

const holesBar = document.getElementById('holes');
for (let n = 1; n <= NHOLES; n++) {
  const b = document.createElement('button');
  b.className = 'hb'; b.textContent = n;
  b.onclick = () => goHole(n, true);
  holesBar.appendChild(b);
}
const teesEl = document.getElementById('tees');

function drawCard() {
  const h = HOLES[hole - 1];
  document.getElementById('cno').textContent = h.n;
  document.getElementById('cnm').textContent = h.name || `Hål ${h.n}`;
  /* A korthalsbana is not rated, so it has no stroke index and none is invented:
     h.idx is null there and the line is just the par. Printing "Index null"
     would state something about a real club that no source supports. */
  document.getElementById('cpi').textContent =
    h.idx == null ? `Par ${h.par}` : `Par ${h.par} · Index ${h.idx}`;
  teesEl.innerHTML = '';
  h.t.forEach((m, k) => {
    const d = document.createElement('div');
    d.className = 'tee' + (k === teeIdx ? ' on' : '');
    d.innerHTML = `<b>${m}</b><i>${TEE_NAMES[k]}</i>`;
    d.onclick = () => { teeIdx = k; drawCard(); if (camMode === 'tee') setCam('tee'); };
    teesEl.appendChild(d);
  });
  const rise = h.elev.rise;
  document.getElementById('facts').innerHTML =
    `Spelas <b>${Math.abs(rise).toFixed(0)} m</b> ${rise >= 0 ? 'uppför' : 'nedför'}<br>` +
    `Tee <b>${h.elev.tee.toFixed(0)} m</b> · green <b>${h.elev.green.toFixed(0)} m</b> ö.h.<br>` +
    `Ritad <b>${h.lineLen.toFixed(0)} m</b> · kortet <b>${h.t[0]} m</b>`;
  document.getElementById('nnm').textContent = h.name || `Hål ${h.n}`;
  document.getElementById('ntx').textContent = h.shape || h.note || '';
  document.querySelectorAll('.hb').forEach((b, i) => b.classList.toggle('on', i + 1 === hole));
  drawMini();
}

const camTween = { on: false, t: 0, dur: 1.5, from: new THREE.Vector3(), to: new THREE.Vector3(),
                   lookFrom: new THREE.Vector3(), lookTo: new THREE.Vector3() };
function flyTo(pos, look, dur = 1.5) {
  if (dur <= 0) {
    camera.position.copy(pos); controls.target.copy(look); camTween.on = false;
    return;
  }
  camTween.from.copy(camera.position); camTween.to.copy(pos);
  camTween.lookFrom.copy(controls.target); camTween.lookTo.copy(look);
  camTween.t = 0; camTween.dur = dur; camTween.on = true;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function setCam(mode, instant) {
  camMode = mode;
  const DUR = (instant || RMOTION) ? 0 : 1.5;
  syncURL();
  document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === mode));
  if (window.__navDrawer) window.__navDrawer.updateActiveCam(mode);
  const h = HOLES[hole - 1];
  const mk = h.tees.marks[teeIdx] || h.tees.marks[0];
  const p0 = alongLine(h.line, 0), p1 = alongLine(h.line, 1);
  const b = alongLine(h.line, 0.02).b;
  const F = [Math.sin(b), Math.cos(b)];
  if (mode === 'tee') {
    /* standing on the tee at eye height, looking down the hole. The aim point is a
       little short of the green so the whole corridor is in frame rather than a flag
       three hundred metres away filling the middle of an empty picture. */
    const x = mk.c[0] - F[0] * 7, z = mk.c[1] - F[1] * 7;
    const aim = alongLine(h.line, 0.72);
    flyTo(V3(x, terrainH(x, z) + 2.4, z), V3(aim.x, terrainH(aim.x, aim.z) + 3, aim.z), DUR);
  } else if (mode === 'green') {
    /* the approach, not a plan of the green: back down the fairway at the height a
       ball is at when it lands, so the complex is seen the way it is played */
    const p = alongLine(h.line, 0.80);
    const G = [Math.sin(p.b), Math.cos(p.b)];
    const x = p.x - G[0] * 24 + G[1] * 16, z = p.z - G[1] * 24 - G[0] * 16;
    flyTo(V3(x, terrainH(x, z) + 15, z),
          V3(h.pin[0], terrainH(h.pin[0], h.pin[1]) + 1.5, h.pin[1]), DUR);
  } else if (mode === 'top') {
    const m = alongLine(h.line, 0.5);
    flyTo(V3(m.x, terrainH(m.x, m.z) + 330, m.z + 0.1), V3(m.x, terrainH(m.x, m.z), m.z), DUR);
  } else {
    /* Behind and above the tee, looking down the hole. High enough to read the shape,
       low enough that the horizon and the sky are in frame -- a plan view from 400 m
       tells you where the bunkers are but nothing about what the shot looks like. */
    const m = alongLine(h.line, 0.4);
    const len = polyLen(h.line);
    const x = mk.c[0] - F[0] * (36 + len * 0.10) - F[1] * 26;
    const z = mk.c[1] - F[1] * (36 + len * 0.10) + F[0] * 26;
    flyTo(V3(x, terrainH(x, z) + 24 + len * 0.045, z),
          V3(m.x, terrainH(m.x, m.z) + 4, m.z), DUR);
  }
}
function goHole(n, recam, instant) {
  hole = Math.min(NHOLES, Math.max(1, n));
  drawCard();
  kikClear();
  if (gridOn) buildGreenGrid();
  if (recam) setCam(camMode, instant);
  syncURL();
}

/* -------------------------------------------------- deep links + delning
   Any view is a URL: ?hal=14&vy=tee&ljus=host&tee=2. The address bar follows
   along (best-effort: file:// refuses replaceState and that is fine), so a
   plain copy-paste always reproduces what is on screen. */
const VY2CAM = { tee: 'tee', green: 'green', fritt: 'orbit', ovan: 'top' };
const CAM2VY = { tee: 'tee', green: 'green', orbit: 'fritt', top: 'ovan' };
const LJUS2P = { kvall: 'golden', dag: 'noon', dis: 'mist', gryning: 'dawn', host: 'host' };
const P2LJUS = { golden: 'kvall', noon: 'dag', mist: 'dis', dawn: 'gryning', host: 'host' };
function syncURL() {
  try {
    const sp = new URLSearchParams(location.search);
    sp.set('hal', hole);
    sp.set('vy', CAM2VY[camMode] || 'fritt');
    sp.set('ljus', P2LJUS[presetName] || 'kvall');
    if (teeIdx) sp.set('tee', teeIdx + 1); else sp.delete('tee');
    if (CMETA.slug !== COURSE.all[0].slug) sp.set('bana', CMETA.slug); else sp.delete('bana');
    if (skyState !== skyMax) sp.set('skylt', skyState); else sp.delete('skylt');
    sp.delete('kiosk'); sp.delete('ren');
    window.history.replaceState(null, '', location.pathname + '?' + sp.toString());
  } catch (e) { /* file:// */ }
}
let toastT = 0;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.innerHTML = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), ms);
}

document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => setCam(b.dataset.cam));
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => setPreset(b.dataset.preset));
/* on a phone the rail is a sheet behind the Vy · Ljus button; choosing anything
   closes it so the scene comes straight back */
{
  const railEl = document.getElementById('rail'), tog = document.getElementById('uiToggle');
  const closeRail = () => { railEl.classList.remove('open'); tog.classList.remove('on'); };
  tog.onclick = () => {
    const open = railEl.classList.toggle('open');
    tog.classList.toggle('on', open);
  };
  railEl.querySelectorAll('.btn').forEach(b =>
    b.addEventListener('click', () => { if (window.matchMedia('(max-width:700px)').matches) closeRail(); }));
}
document.getElementById('flyBtn').onclick = () => { flying = flying > 0 ? 0 : 1e-4; };

/* ------------------------------------------------------------ ren vy */
function setClean(on) {
  document.body.classList.toggle('clean', on);
}
document.getElementById('cleanExit').onclick = () => { if (tour) endTour(); else setClean(false); };

/* ------------------------------------------------------- bansafari (kiosk) */
let tour = 0, tourCardT = 0;
function showTourCard() {
  const h = HOLES[hole - 1], el = document.getElementById('tourCard');
  el.querySelector('.tno').textContent = `HÅL ${h.n} · PAR ${h.par} · ${h.t[0]} M`;
  el.querySelector('.tnm').textContent = h.name || `Hål ${h.n}`;
  el.querySelector('.ttx').textContent = h.shape || h.note || '';
  el.classList.add('show');
  clearTimeout(tourCardT);
  tourCardT = setTimeout(() => el.classList.remove('show'), 6500);
}
function startTour() {
  tour = 1;
  document.body.classList.add('tour');
  setClean(true);
  goHole(1, false);
  showTourCard();
  flying = 1e-4;
}
function endTour() {
  tour = 0;
  flying = 0;
  document.body.classList.remove('tour');
  document.getElementById('tourCard').classList.remove('show');
  setClean(false);
  setCam(camMode);
}
document.getElementById('tourBtn').onclick = startTour;

/* --------------------------------------------------------------- kikaren
   Click the course, get what a caddie would say: the distance, the climb, the
   plays-like number, the lie out there, and how much of the line is carry over
   water. The ray marches terrainH so a tree canopy cannot steal the hit. */
let kik = false, kikGroup = null, kikPt = null;
const kikBtn = document.getElementById('rangeBtn');
kikBtn.onclick = () => {
  kik = !kik;
  kikBtn.classList.toggle('on', kik);
  if (!kik) kikClear(); else toast('Tryck på banan för att mäta från aktuell tee');
};
function kikClear() {
  if (kikGroup) {
    scene.remove(kikGroup);
    kikGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    kikGroup = null;
  }
  kikPt = null;
  document.getElementById('kikOut').classList.remove('show');
}
function groundHit(clientX, clientY) {
  camera.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1), camera);
  const o = rc.ray.origin, d = rc.ray.direction;
  for (let t = 2; t < 5200; t += 3) {
    if (o.y + d.y * t - terrainH(o.x + d.x * t, o.z + d.z * t) < 0) {
      let a = t - 3, b = t;
      for (let i = 0; i < 14; i++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m - terrainH(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m;
      }
      const tm = (a + b) / 2;
      return [o.x + d.x * tm, o.z + d.z * tm];
    }
  }
  return null;
}
function kikMeasure(clientX, clientY) {
  const hit = groundHit(clientX, clientY);
  if (!hit) return;
  kikClear();
  const h = HOLES[hole - 1];
  const mk = h.tees.marks[teeIdx] || h.tees.marks[0];
  const [ox, oz] = mk.c, [tx, tz] = hit;
  const dist = Math.hypot(tx - ox, tz - oz);
  const oy = terrainH(ox, oz), ty = terrainH(tx, tz);
  const dh = ty - oy;
  /* what is out there, and how much of the line is over water */
  const c = classify(tx, tz);
  let wet = 0;
  const steps = Math.max(2, Math.ceil(dist / 4));
  for (let i = 1; i < steps; i++) {
    const sx = ox + (tx - ox) * i / steps, sz = oz + (tz - oz) * i / steps;
    for (const w of WI.at(sx, sz)) {
      if (!w.stream && ringSD(sx, sz, w.ring) < 0 && terrainH(sx, sz) < w.level + 0.3) { wet++; break; }
    }
  }
  let over = false;
  for (const w of WI.at(tx, tz)) if (!w.stream && ringSD(tx, tz, w.ring) < 0 && ty < w.level + 0.3) over = true;
  const lie = over ? 'vatten' : c.green > 0.5 ? 'green' : c.sand > 0.4 ? 'bunker'
            : c.tee > 0.5 ? 'tee' : c.fair > 0.4 ? 'fairway' : c.path > 0.4 ? 'stig'
            : c.forest > 0.5 ? 'skog' : 'ruff';
  const plays = dist + dh;
  document.getElementById('kikOut').innerHTML =
    `Till punkten <b>${dist.toFixed(0)} m</b> · ${Math.abs(dh).toFixed(0)} m ${dh >= 0 ? 'uppför' : 'nedför'}` +
    ` · spelas <b>${plays.toFixed(0)} m</b><br>` +
    `landar i ${lie}${wet ? ` · bär över vatten ~<b>${wet * 4} m</b>` : ''}`;
  document.getElementById('kikOut').classList.add('show');
  kikPt = [tx, tz];
  /* the arc in the scene */
  kikGroup = new THREE.Group();
  const P = [];
  const rise = Math.min(30, 4 + dist * 0.055);
  for (let i = 0; i <= 30; i++) {
    const f = i / 30;
    const x = ox + (tx - ox) * f, z = oz + (tz - oz) * f;
    P.push(new THREE.Vector3(x, oy + 1.4 + (ty + 0.4 - oy - 1.4) * f + Math.sin(f * Math.PI) * rise, z));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(P),
    new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0xffdf8a), transparent: true, opacity: 0.95 }));
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xffdf8a) }));
  mark.position.set(tx, ty + 0.9, tz);
  kikGroup.add(line, mark);
  scene.add(kikGroup);
}
/* ------------------------------------------------- greengrid (yardage book)
   The donor app's PGA-yardage-book green reading, carried over: a wireframe
   grid draped on the putting surface, coloured by how hard the ball breaks --
   calm cyan, mild green, firm yellow, steep red. This page's greens carry
   real authored tilt and tiers, so the grid reads the actual break. */
let gridOn = false, gridMesh = null;
const gridBtn = document.getElementById('gridBtn');
function gridClear() {
  if (gridMesh) { scene.remove(gridMesh); gridMesh.geometry.dispose(); gridMesh = null; }
}
function buildGreenGrid() {
  gridClear();
  const h = HOLES[hole - 1];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of h.green.ring) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const size = Math.max(x1 - x0, z1 - z0) + 10;
  const geo = new THREE.PlaneGeometry(size, size, 44, 44);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const wx = cx + pos.getX(i), wz = cz + pos.getZ(i);
    pos.setX(i, wx); pos.setZ(i, wz);
    pos.setY(i, meshH(wx, wz) + 0.12);   /* hug the RENDERED surface, like the sand */
    const gx = (terrainH(wx + 1, wz) - terrainH(wx - 1, wz)) / 2;
    const gz = (terrainH(wx, wz + 1) - terrainH(wx, wz - 1)) / 2;
    const s = Math.hypot(gx, gz);
    const c = s < 0.022 ? [0.10, 0.80, 0.90] : s < 0.045 ? [0.15, 0.90, 0.25]
            : s < 0.085 ? [0.95, 0.80, 0.10] : [0.95, 0.22, 0.10];
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const gm = new THREE.MeshBasicNodeMaterial({
    vertexColors: true, wireframe: true, transparent: true, opacity: 0.8 });
  gm.polygonOffset = true;
  gm.polygonOffsetFactor = -6;
  gm.polygonOffsetUnits = -12;
  gridMesh = new THREE.Mesh(geo, gm);
  gridMesh.renderOrder = 7;
  scene.add(gridMesh);
}
gridBtn.onclick = () => {
  gridOn = !gridOn;
  gridBtn.classList.toggle('on', gridOn);
  if (gridOn) {
    buildGreenGrid();
    /* the donor's inspect move: in over the green, close enough to read the break */
    setCam('green');
    const h = HOLES[hole - 1], c = h.green.c;
    const p = alongLine(h.line, 0.9);
    const F = [Math.sin(p.b), Math.cos(p.b)];
    const gy = terrainH(c[0], c[1]);
    flyTo(V3(c[0] - F[0] * 26, gy + 21, c[1] - F[1] * 26), V3(c[0], gy + 1, c[1]), RMOTION ? 0 : 1.4);
  } else gridClear();
};

/* a click is a click only if the pointer did not drag (OrbitControls owns drags) */
{
  let px0 = 0, py0 = 0, pt0 = 0;
  renderer.domElement.addEventListener('pointerdown', e => {
    px0 = e.clientX; py0 = e.clientY; pt0 = performance.now();
    if (tour) endTour();
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (performance.now() - pt0 < 450 && Math.hypot(e.clientX - px0, e.clientY - py0) < 8) {
      if (kik) {
        kikMeasure(e.clientX, e.clientY);
        return;
      }
      const hitSprite = getSkyHit(e.clientX, e.clientY);
      if (hitSprite) {
        if (hitSprite.userData.fac && hitSprite.userData.facility) {
          viewFacility(hitSprite.userData.facility);
        } else if (hitSprite.userData.n) {
          goHole(hitSprite.userData.n, true);
          toast(`Hål ${hitSprite.userData.n}`);
        }
      }
    }
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (kik) return;
    const hitSprite = getSkyHit(e.clientX, e.clientY);
    if (hitSprite) {
      renderer.domElement.style.cursor = 'pointer';
      renderer.domElement.title = hitSprite.userData.fac ? (hitSprite.userData.nm || 'Facilitet') : `Hål ${hitSprite.userData.n}`;
    } else {
      renderer.domElement.style.cursor = '';
      renderer.domElement.title = '';
    }
  });
}

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowRight' || e.key === 'n') goHole(hole + 1, true);
  if (e.key === 'ArrowLeft' || e.key === 'p') goHole(hole - 1, true);
  if (e.key === 'h') { if (tour) endTour(); else setClean(!document.body.classList.contains('clean')); }
  if (e.key === 'm') setSky(skyState + 1);
});

/* --------------------------------------------------------------- minimap */
const mini = document.getElementById('minic'), mctx = mini.getContext('2d');
const MB = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const h of HOLES) for (const p of h.line) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  const pad = 90;
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
})();
const MS = Math.min(mini.width / (MB.x1 - MB.x0), mini.height / (MB.z1 - MB.z0));
const MOX = (mini.width - (MB.x1 - MB.x0) * MS) / 2, MOZ = (mini.height - (MB.z1 - MB.z0) * MS) / 2;
const MX = x => MOX + (x - MB.x0) * MS, MZ = z => MOZ + (z - MB.z0) * MS;

/* ------------------------------------------------------------------ skyltar
   Where a hole's number belongs is not a matter of taste. banguide/guide-markers.json
   measured the numbered discs on the club's own overview map at a mean 46 m from the
   hole MIDPOINT, against 185 m and 190 m from the tee and the green -- so the number
   sits at the middle of the hole, the way a Swedish oversiktskarta draws it.

   Facilities get a LETTER, not a pictogram. Somewhere under about sixteen displayed
   pixels a pictogram stops being a picture of anything and becomes a blob, and a
   letter is still a letter. K klubbhus, R rangen, O ovningsgreen. */
const SKY_R = 15, SKY_MIN = 31;
const SKY = { holes: [], fac: [] };
{
  for (const h of HOLES) SKY.holes.push({ n: h.n, f: 0.5, line: h.line, x: 0, z: 0 });
  const B = M.infra.buildings || [];
  const cb = B.find(q => q.amenity === 'clubhouse')
          || B.find(q => q.name && /golfklubb|klubbhus/i.test(q.name));
  if (cb) { const c = centroidOf(cb.ring); SKY.fac.push({ ch: 'K', nm: 'Klubbhus', x: c[0], z: c[1] }); }
  const rg = (M.scenery.range || [])[0];
  if (rg) { const c = centroidOf(rg); SKY.fac.push({ ch: 'R', nm: 'Drivingrange', x: c[0], z: c[1] }); }
  /* A putting green is a scenery green standing by the clubhouse. The ones scattered
     across the property are a short course, which is a different thing and does not
     get called an ovningsgreen: at Veckefjarden nine of the ten scenery greens are
     the korthalsbana, spread over 380 m, and one all-rings centroid would land in
     the middle of it and name it wrongly. */
  if (cb) {
    const k = SKY.fac[0];
    const near = (M.scenery.greens || []).map(centroidOf).filter(c => hyp(c, [k.x, k.z]) < 200);
    if (near.length) SKY.fac.push({ ch: '\u00d6', nm: '\u00d6vningsgreen',
      x: near.reduce((a, c) => a + c[0], 0) / near.length,
      z: near.reduce((a, c) => a + c[1], 0) / near.length });
  }
  skyMax = SKY.fac.length ? 2 : 1;
  if (skyState > skyMax) skyState = skyMax;
}

function skyAt(m) { const p = alongLine(m.line, m.f); m.x = p.x; m.z = p.z; }

/* Two facilities can genuinely adjoin: Veckefjarden's putting green stands 64 m from
   its clubhouse, which on this map is fourteen pixels -- one square inside the other.
   They are pushed apart ON THE MAP ONLY. The crowding belongs to the map, not to the
   ground, and moving the world markers to tidy a picture would be the wrong way round:
   at 0.22 px/m the same nudge would carry the klubbhus seventy metres off its roof. */
{
  for (const f of SKY.fac) { f.mx = MX(f.x); f.my = MZ(f.z); }
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < SKY.fac.length; i++) for (let j = i + 1; j < SKY.fac.length; j++) {
      const a = SKY.fac[i], b = SKY.fac[j];
      let dx = b.mx - a.mx, dy = b.my - a.my, d = Math.hypot(dx, dy);
      if (d >= SKY_MIN) continue;
      if (d < 1e-3) { dx = 1; dy = 0; d = 1; }
      const k = (SKY_MIN - d) / (2 * d);
      a.mx -= dx * k; a.my -= dy * k; b.mx += dx * k; b.my += dy * k;
      moved = true;
    }
    if (!moved) break;
  }
}
/* A compact routing puts parallel corridors within a disc of each other, and sliding
   every offender toward its own tee -- the obvious rule -- is not enough: it cannot
   separate a SAME-direction pair, and where two holes share a loop hub it drives them
   together. So each offender moves along its OWN centreline in whichever direction buys
   the most room, worst first, and never sideways: a number that has left its corridor is
   worse than one that grazes a neighbour. A disc nothing helps is marked stuck and the
   rest carry on, which is the honest outcome on a tight routing. */
{
  SKY.holes.forEach(skyAt);
  const fixed = SKY.fac.map(f => [f.mx, f.my]);
  const room = (i, c) => {
    let d = 1e9;
    for (let j = 0; j < SKY.holes.length; j++) {
      if (j === i) continue;
      const o = SKY.holes[j];
      d = Math.min(d, Math.hypot(c[0] - MX(o.x), c[1] - MZ(o.z)));
    }
    for (const q of fixed) d = Math.min(d, Math.hypot(c[0] - q[0], c[1] - q[1]));
    /* the north arrow owns its corner of the canvas */
    if (c[0] > 314 && c[1] < 76) d = 0;
    return d;
  };
  const stuck = new Set();
  for (let pass = 0; pass < 400; pass++) {
    let wi = -1, wd = SKY_MIN;
    for (let i = 0; i < SKY.holes.length; i++) {
      if (stuck.has(i)) continue;
      const m = SKY.holes[i], d = room(i, [MX(m.x), MZ(m.z)]);
      if (d < wd) { wd = d; wi = i; }
    }
    if (wi < 0) break;
    const m = SKY.holes[wi];
    let bf = m.f, bd = wd;
    for (const df of [-0.035, 0.035]) {
      const f = Math.min(0.88, Math.max(0.12, m.f + df));
      if (f === m.f) continue;
      const p = alongLine(m.line, f);
      const d = room(wi, [MX(p.x), MZ(p.z)]);
      if (d > bd) { bd = d; bf = f; }
    }
    if (bf === m.f) { stuck.add(wi); continue; }
    m.f = bf; skyAt(m);
  }
}
/* a marker on the rim would render half off the canvas; the clamp costs a few metres
   of position and buys a whole icon (Johannesberg's klubbhus sits 9 px from the top) */
const skyXY = p => {
  const e = mini.width - SKY_R - 2;
  return [Math.min(e, Math.max(SKY_R + 2, p.mx === undefined ? MX(p.x) : p.mx)),
          Math.min(e, Math.max(SKY_R + 2, p.my === undefined ? MZ(p.z) : p.my))];
};

/* One routine draws every marker on both surfaces -- the minimap blits it, the sprite
   layer bakes it into a texture -- so a disc on the map and a disc in the world are
   the same object seen twice. The numeral shrinks for two digits: at the single-digit
   size "18" crosses the rim, which is how the engine's own design.svg sizes it too. */
function drawPuck(g, cx, cy, r, ch, o) {
  o = o || {};
  const s = String(ch);
  g.save();
  g.beginPath();
  if (o.square) {
    const a = r * 0.93, k = a * 0.36;
    g.moveTo(cx - a + k, cy - a);
    g.arcTo(cx + a, cy - a, cx + a, cy + a, k);
    g.arcTo(cx + a, cy + a, cx - a, cy + a, k);
    g.arcTo(cx - a, cy + a, cx - a, cy - a, k);
    g.arcTo(cx - a, cy - a, cx + a, cy - a, k);
    g.closePath();
  } else g.arc(cx, cy, r, 0, TAU);
  g.fillStyle = o.fill || 'rgba(14,26,18,.88)';
  g.fill();
  g.lineWidth = Math.max(1.2, r * 0.11);
  g.strokeStyle = o.stroke || 'rgba(234,243,236,.46)';
  g.stroke();
  g.fillStyle = o.ink || '#eaf3ec';
  g.font = '700 ' + (r * (s.length > 1 ? 1.00 : 1.16)).toFixed(1) + 'px Outfit,sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(s, cx, cy + r * 0.05);
  g.restore();
}

/* static layers: eighteen discs and a handful of squares do not change between
   frames, so they are painted once and blitted, the way the base map already is */
const skyNum = document.createElement('canvas'), skyFac = document.createElement('canvas');
skyNum.width = skyNum.height = skyFac.width = skyFac.height = mini.width;
function paintSky() {
  const g1 = skyNum.getContext('2d'), g2 = skyFac.getContext('2d');
  g1.clearRect(0, 0, skyNum.width, skyNum.height);
  g2.clearRect(0, 0, skyFac.width, skyFac.height);
  for (const m of SKY.holes) { const p = skyXY(m); drawPuck(g1, p[0], p[1], SKY_R, m.n); }
  for (const f of SKY.fac) { const p = skyXY(f); drawPuck(g2, p[0], p[1], SKY_R, f.ch, { square: true, ink: '#e2cf9a' }); }
}
paintSky();

/* The lake, the woods and seventeen of the eighteen holes do not change between
   frames, so they are drawn once into their own canvas and blitted. Redrawing four
   hundred polygons every frame to move one arrow is work for nothing. */
const miniBase = document.createElement('canvas');
miniBase.width = mini.width; miniBase.height = mini.height;
{
  const g = miniBase.getContext('2d');
  const path2 = (pts, close) => {
    g.beginPath();
    pts.forEach((p, i) => i ? g.lineTo(MX(p[0]), MZ(p[1])) : g.moveTo(MX(p[0]), MZ(p[1])));
    if (close) g.closePath();
  };
  g.fillStyle = '#101c14'; g.fillRect(0, 0, mini.width, mini.height);
  g.fillStyle = 'rgba(46,72,44,.85)';
  for (const r of M.veg.forest.concat(M.veg.wood)) { path2(r, true); g.fill(); }
  g.fillStyle = 'rgba(38,88,116,.95)';
  for (const w of M.water) { if (w.area < 400) continue; path2(w.ring, true); g.fill(); }
  g.fillStyle = 'rgba(84,140,78,.9)';
  for (const h of HOLES) { for (const r of h.fairway.rings) { path2(r, true); g.fill(); } }
  for (const r of M.scenery.fairways) { path2(r, true); g.fill(); }
  g.fillStyle = 'rgba(120,196,118,.95)';
  for (const h of HOLES) { path2(h.green.ring, true); g.fill(); }
  g.strokeStyle = 'rgba(190,215,196,.30)'; g.lineWidth = 1.2;
  for (const h of HOLES) { path2(h.line, false); g.stroke(); }
  /* the map is north-up, and says so */
  g.strokeStyle = 'rgba(240,240,235,.8)'; g.fillStyle = 'rgba(240,240,235,.8)';
  g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(337, 42); g.lineTo(337, 22); g.stroke();
  g.beginPath(); g.moveTo(337, 15); g.lineTo(331.5, 26); g.lineTo(342.5, 26); g.closePath(); g.fill();
  g.font = '600 13px Outfit,sans-serif'; g.textAlign = 'center';
  g.fillText('N', 337, 58);
}
function drawMini() {
  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.drawImage(miniBase, 0, 0);
  if (skyState >= 1) mctx.drawImage(skyNum, 0, 0);
  if (skyState >= 2) mctx.drawImage(skyFac, 0, 0);
  const h = HOLES[hole - 1];
  mctx.strokeStyle = '#8cf0a8'; mctx.lineWidth = 3.2; mctx.lineJoin = 'round';
  mctx.beginPath();
  h.line.forEach((p, i) => i ? mctx.lineTo(MX(p[0]), MZ(p[1])) : mctx.moveTo(MX(p[0]), MZ(p[1])));
  mctx.stroke();
  mctx.fillStyle = '#f0a23a';
  mctx.beginPath(); mctx.arc(MX(h.line[0][0]), MZ(h.line[0][1]), 4.5, 0, TAU); mctx.fill();
  /* a flag, not a dot. Red on green is the one pair a deuteranope cannot split, so
     the pin is told apart by its shape as much as by its vermillion. */
  {
    const px = MX(h.pin[0]), py = MZ(h.pin[1]);
    mctx.strokeStyle = 'rgba(244,240,232,.9)'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.moveTo(px, py + 1.5); mctx.lineTo(px, py - 11); mctx.stroke();
    mctx.fillStyle = '#d55e00';
    mctx.beginPath(); mctx.moveTo(px, py - 11); mctx.lineTo(px + 8.5, py - 7.6);
    mctx.lineTo(px, py - 4.2); mctx.closePath(); mctx.fill();
  }
  if (skyState >= 1) {
    const p = skyXY(SKY.holes[hole - 1]);
    drawPuck(mctx, p[0], p[1], SKY_R + 1.5, h.n,
             { fill: '#8cf0a8', stroke: 'rgba(6,18,10,.5)', ink: '#06210f' });
  }
  if (kikPt) {
    mctx.strokeStyle = '#ffdf8a'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(MX(kikPt[0]), MZ(kikPt[1]), 5, 0, TAU); mctx.stroke();
  }
  /* where the camera is standing and which way it is looking */
  mctx.save();
  mctx.translate(MX(camera.position.x), MZ(camera.position.z));
  mctx.rotate(-Math.atan2(controls.target.x - camera.position.x, controls.target.z - camera.position.z));
  mctx.fillStyle = 'rgba(255,255,255,.92)';
  mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(5.5, 6); mctx.lineTo(0, 3.5); mctx.lineTo(-5.5, 6);
  mctx.closePath(); mctx.fill();
  mctx.restore();
}

/* ------------------------------------------------- skyltar i varlden
   Ovan is a real camera 330 m above the hole, where a 2.6 m flag is smaller than a
   pixel and nothing whatever says which hole is which. These are the same discs the
   minimap draws, billboarded over the ground and faded in by how high the camera is
   standing -- so they are there in the plan views and gone at eye level, where the
   card already names the hole and a number floating over the fairway is litter.
   Tying them to height rather than to the named view means Flygtur and the Bansafari
   stay clean without either knowing this layer exists. */
const skyGroup = new THREE.Group();
scene.add(skyGroup);
const skySprites = [];
{
  const mk = (ch, x, z, square, ink) => {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const paint = () => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, S, S);
      drawPuck(g, S / 2, S / 2, S * 0.44, ch, { square, ink, fill: 'rgba(14,26,18,.9)' });
    };
    paint();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteNodeMaterial({
      map: t, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
    s.center.set(0.5, 0);
    s.scale.set(26, 26, 1);
    s.position.set(x, terrainH(x, z) + 5, z);
    s.renderOrder = 8;
    s.userData.repaint = () => { paint(); t.needsUpdate = true; };
    skyGroup.add(s);
    skySprites.push(s);
    return s;
  };
  for (const m of SKY.holes) {
    const s = mk(m.n, m.x, m.z, false, null);
    s.userData.fac = false;
    s.userData.n = m.n;
    s.userData.hole = m;
  }
  for (const f of SKY.fac) {
    const s = mk(f.ch, f.x, f.z, true, '#e2cf9a');
    s.userData.fac = true;
    s.userData.facility = f;
    s.userData.nm = f.nm;
    s.userData.ch = f.ch;
  }
}

function viewFacility(fac, dur = 1.5) {
  if (!fac) return;
  const fx = fac.x, fz = fac.z;
  const fy = terrainH(fx, fz);
  flyTo(V3(fx - 60, fy + 34, fz - 60), V3(fx, fy + 4, fz), RMOTION ? 0 : dur);
  toast(`${fac.nm}`);
  const nnm = document.getElementById('nnm');
  const ntx = document.getElementById('ntx');
  if (nnm) nnm.textContent = fac.nm;
  if (ntx) ntx.textContent = `Facilitet på ${CMETA.name}`;
}

function getSkyHit(clientX, clientY) {
  if (!skyGroup.visible || skyHidden || skyState < 1) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const v = new THREE.Vector3();
  let bestDist = 34;
  let bestSprite = null;

  for (const s of skySprites) {
    if (!s.visible || s.material.opacity < 0.05) continue;
    v.copy(s.position);
    v.project(camera);
    if (v.z > 1 || v.z < -1) continue;
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(mouseX - sx, mouseY - sy);
    if (d < bestDist) {
      bestDist = d;
      bestSprite = s;
    }
  }
  return bestSprite;
}

function updateSky() {
  const camH = camera.position.y - terrainH(camera.position.x, camera.position.z);
  const a = (skyHidden || skyState < 1) ? 0 : Math.min(1, Math.max(0, (camH - 110) / 110));
  skyGroup.visible = a > 0.01;
  if (!skyGroup.visible) return;
  for (const s of skySprites) {
    s.visible = !(s.userData.fac && skyState < 2);
    /* the hole being played stands at full strength and its neighbours step back --
       enough to orient by, without repainting a second texture for every disc */
    s.material.opacity = a * (s.userData.n === hole ? 1 : 0.66);
  }
}

/* the overview is a selector too -- that is what every golf app makes of it, and the
   canvas carried no handler to get in the way. The store is 360 px shown at 172 or
   232, so a click has to come back through the element's own box before it can be
   tested against the table, and the target is grown well past the disc: a 14 px disc
   is nowhere near a finger. */
mini.style.cursor = 'pointer';
const skyCanvasXY = e => {
  const R = mini.getBoundingClientRect();
  return [(e.clientX - R.left) * (mini.width / R.width),
          (e.clientY - R.top) * (mini.height / R.height)];
};
const skyNearest = (cx, cy, list, reach) => {
  let best = -1, bd = SKY_R * reach;
  list.forEach((m, i) => {
    const p = skyXY(m), d = Math.hypot(cx - p[0], cy - p[1]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
};
mini.addEventListener('click', e => {
  if (skyState < 1) return;
  const c = skyCanvasXY(e);
  if (skyState >= 2) {
    const f = skyNearest(c[0], c[1], SKY.fac, 2.0);
    if (f >= 0) {
      viewFacility(SKY.fac[f]);
      return;
    }
  }
  const i = skyNearest(c[0], c[1], SKY.holes, 2.2);
  if (i >= 0) {
    goHole(i + 1, true);
    toast(`Hål ${i + 1}`);
  }
});
/* K and R and O are a private code without a legend, and a 360 px canvas has no room
   for one. The browser already owns a way to name a thing under the pointer. */
mini.addEventListener('pointermove', e => {
  if (skyState < 1) { mini.title = ''; mini.style.cursor = 'default'; return; }
  const c = skyCanvasXY(e);
  const f = skyState >= 2 ? skyNearest(c[0], c[1], SKY.fac, 1.8) : -1;
  if (f >= 0) { mini.title = SKY.fac[f].nm; mini.style.cursor = 'pointer'; return; }
  const i = skyNearest(c[0], c[1], SKY.holes, 2.0);
  if (i >= 0) { mini.title = `Hål ${SKY.holes[i].n}`; mini.style.cursor = 'pointer'; return; }
  mini.title = '';
  mini.style.cursor = 'default';
});

const SKY_MSG = ['Skyltar av', 'Skyltar: halnummer', 'Skyltar: hal och faciliteter'];
function setSky(n, quiet) {
  skyState = n > skyMax || n < 0 ? 0 : n;
  document.getElementById('skyltBtn').classList.toggle('on', skyState > 0);
  updateSky();
  drawMini();
  syncURL();
  if (!quiet) toast(SKY_MSG[skyState]);
}
document.getElementById('skyltBtn').onclick = () => setSky(skyState + 1);

/* ------------------------------------------------------------------- rail & navigation
   Shown over the running course when no course was asked for by name, and
   whenever someone asks for another one. */
const railEl = buildRail({
  courses: COURSE.all,
  current: CMETA.slug,
  isInitialBoot: isBareVisit,
  onPick: slug => {
    if (slug === CMETA.slug) {
      closeRail();
    } else {
      goToCourse(slug);
    }
  },
});
document.body.append(railEl);
let railOpen = false;

function openRail() {
  if (navDrawer.isOpen()) navDrawer.close();
  railOpen = true;
  /* The chooser is glass over a LIVE course, which is the whole idea -- but the
     course is what should show through it, not the course's HUD. Left alone, the
     hole strip and the card sit blurred behind the front door, and blurred UI
     behind UI reads as a mistake rather than as depth. */
  document.body.classList.add('choosing');
  railEl.hidden = false;
  railEl.classList.remove('leaving');
  const firstCard = railEl.querySelector('.card');
  if (firstCard) firstCard.focus();
}

function closeRail() {
  if (!railOpen) return;
  railOpen = false;
  railEl.classList.add('leaving');
  document.body.classList.remove('choosing');
  const done = () => { railEl.hidden = true; railEl.classList.remove('leaving'); };
  if (RMOTION) done(); else setTimeout(done, 380);
}

railEl.hidden = true;
const resumeBtn = document.getElementById('chooserResumeBtn');
if (resumeBtn) resumeBtn.onclick = closeRail;

document.getElementById('bytBtn').onclick = () => (railOpen ? closeRail() : openRail());
railEl.addEventListener('click', e => { if (e.target === railEl) closeRail(); });

/* In-game navigation drawer */
const navDrawer = buildNavDrawer({
  courses: COURSE.all,
  current: CMETA.slug,
  onBackToStart: () => openRail(),
  onSwitchCourse: (slug) => goToCourse(slug),
  onAction: (type, val) => {
    if (type === 'cam') setCam(val);
    if (type === 'preset') setPreset(val);
    if (type === 'clean') setClean(true);
  }
});
window.__navDrawer = navDrawer;
document.body.append(navDrawer.el);

const menuToggleBtn = document.getElementById('menuToggle');
if (menuToggleBtn) {
  menuToggleBtn.onclick = () => {
    if (railOpen) closeRail();
    if (navDrawer.isOpen()) navDrawer.close();
    else navDrawer.open();
  };
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (navDrawer.isOpen()) { navDrawer.close(); return; }
    if (railOpen) { closeRail(); return; }
  }
});
/* the webfont lands after the first paint, so every baked glyph is repainted once
   it is really there -- the base map's own N has always raced it */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
  paintSky();
  for (const s of skySprites) s.userData.repaint();
  drawMini();
});

/* ------------------------------------------------------------------- loop */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  captureReadbackTarget?.setSize(innerWidth, innerHeight);
});

let last = performance.now(), acc = 0, frames = 0, fps = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  terrainPreviewBatch?.tick(now);
  last = now; frames++; acc += dt;
  if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }

  if (camTween.on) {
    camTween.t += dt / camTween.dur;
    const t = Math.min(1, camTween.t);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    controls.target.lerpVectors(camTween.lookFrom, camTween.lookTo, e);
    if (t >= 1) camTween.on = false;
  }
  if (flying > 0) {
    flying += dt / 15;
    if (flying >= 1) {
      if (tour && hole < NHOLES) { goHole(hole + 1, false); showTourCard(); flying = 1e-4; }
      else if (tour) { endTour(); }
      else { flying = 0; setCam(camMode); }
    }
    else {
      const h = HOLES[hole - 1];
      const p = alongLine(h.line, flying * 1.02 - 0.02);
      const la = alongLine(h.line, Math.min(1.0, flying * 1.02 + 0.07));
      const F = [Math.sin(p.b), Math.cos(p.b)];
      const gy = terrainH(p.x, p.z);
      camera.position.set(p.x - F[0] * 26, gy + 22 + Math.sin(flying * Math.PI) * 16, p.z - F[1] * 26);
      controls.target.set(la.x, terrainH(la.x, la.z) + 2, la.z);
      camTween.on = false;
    }
  }
  /* flag cloth: a travelling wave pinned at the pole */
  const t = DET ? 3.25 : now / 1000;
  for (const p of pins) {
    const g = p.cloth.geometry, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i) + 0.39;
      pos.setZ(i, vx > 0.02 ? Math.sin(t * 5.5 + vx * 5.5) * 0.1 * vx : 0);
    }
    pos.needsUpdate = true;
  }
  controls.update();
  /* never underground, and never so close to it that the near plane clips through */
  const groundY = terrainH(camera.position.x, camera.position.z) + 1.7;
  if (camera.position.y < groundY) camera.position.y = groundY;
  placeSun();
  if (skyMesh) skyMesh.position.copy(camera.position);
  if (skyDome) skyDome.position.copy(camera.position);
  updateSky();
  drawMini();
  if (!captureRenderLocked) renderActivePipeline();
}

/* boot state comes from the URL when there is one: ?hal=14&vy=tee&ljus=host&tee=2
   opens exactly there, ?ren=1 opens clean, ?kiosk=1 starts the bansafari */
const BOOTQ = new URLSearchParams(location.search);
{
  setPreset(LJUS2P[(BOOTQ.get('ljus') || '').toLowerCase()] || 'golden');
  const ti = parseInt(BOOTQ.get('tee'), 10);
  if (ti >= 1 && ti <= 6) teeIdx = ti - 1;
  const n = parseInt(BOOTQ.get('hal'), 10);
  goHole(Number.isFinite(n) ? n : 1, false);
  setCam(VY2CAM[(BOOTQ.get('vy') || '').toLowerCase()] || 'orbit', true);
  /* a bare visit is a choice, not an arbitrary course pretending to be the
     product -- the default boots behind the rail so there is a real place
     rendering while you pick */
  if (!BOOTQ.get('bana') && BOOTQ.get('kiosk') !== '1' && BOOTQ.get('ren') !== '1') openRail();
  const sk = parseInt(BOOTQ.get('skylt'), 10);
  setSky(Number.isFinite(sk) ? sk : skyMax, true);
  if (BOOTQ.get('ren') === '1') setClean(true);
}

await tick('klar', 1.0);
renderer.setAnimationLoop(frame);
document.getElementById('hdsub').textContent =
  `${CMETA.tag} · ${IS_GPU ? 'WebGPU' : 'WebGL2'}${terrainPreviewRender.status === 'ready' ? ' · 1 m preview' : ''}`;
stats.draws = renderer.info?.render?.drawCalls || stats.draws;
BOOT_PERF.totalMs = +(performance.now() - bootStarted).toFixed(1);

async function waitForSubmittedGpuWork() {
  const queue = renderer.backend?.device?.queue;
  if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone();
}

/* Presentation screenshots are unreliable on headless WebGPU/SwiftShader: the
   browser can expose a fresh transparent swap texture even though the real app
   rendered correctly. These bounded hooks prove the active app pipeline itself
   without pretending that a software-adapter readback is hardware evidence. */
async function prepareCapture() {
  captureRenderLocked = true;
  try {
    renderer.setRenderTarget(null);
    renderActivePipeline();
    await waitForSubmittedGpuWork();
  } finally {
    captureRenderLocked = false;
  }
}

async function captureReadback() {
  if (!IS_GPU) throw new Error('render-target readback is only available for WebGPU');
  if (!captureReadbackTarget) {
    captureReadbackTarget = new THREE.RenderTarget(innerWidth, innerHeight, {
      depthBuffer: true,
      stencilBuffer: false,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      samples: 1,
    });
    captureReadbackTarget.texture.colorSpace = THREE.SRGBColorSpace;
  } else if (captureReadbackTarget.width !== innerWidth || captureReadbackTarget.height !== innerHeight) {
    captureReadbackTarget.setSize(innerWidth, innerHeight);
  }
  const width = captureReadbackTarget.width;
  const height = captureReadbackTarget.height;
  const previousTarget = renderer.getRenderTarget();
  captureRenderLocked = true;
  try {
    renderer.setRenderTarget(captureReadbackTarget);
    renderActivePipeline();
    await waitForSubmittedGpuWork();
    const pixels = await renderer.readRenderTargetPixelsAsync(
      captureReadbackTarget, 0, 0, width, height,
    );
    if (!(pixels instanceof Uint8Array) || pixels.byteLength !== width * height * 4) {
      throw new Error(`unexpected app WebGPU readback size ${pixels?.byteLength || 0}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('app WebGPU readback cannot create a 2D encoder');
    context.putImageData(new ImageData(
      new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      width,
      height,
    ), 0, 0);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('app WebGPU PNG encoding failed')),
      'image/png',
    ));
    const encoded = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < encoded.length; offset += 32_768) {
      binary += String.fromCharCode(...encoded.subarray(offset, offset + 32_768));
    }
    return Object.freeze({
      width,
      height,
      mimeType: 'image/png',
      base64: btoa(binary),
      sourceBytes: pixels.byteLength,
      encodedBytes: encoded.byteLength,
      provisional: true,
      performanceEvidence: false,
    });
  } finally {
    renderer.setRenderTarget(previousTarget);
    captureRenderLocked = false;
    renderActivePipeline();
    await waitForSubmittedGpuWork();
  }
}

/* published before the boot marker, not after: anything waiting on the marker acts
   the instant it appears, and an interface that is not there yet fails silently */
window.V3D = {
  stats: { verts: stats.verts | 0, tris: stats.tris | 0, trees: stats.trees, vista: stats.vista | 0,
           tufts: stats.tufts | 0, bushes: stats.bushes | 0, stones: stats.stones | 0,
           reeds: stats.reeds | 0, cars: stats.cars | 0, pylons: stats.pylons | 0, stumps: stats.stumps | 0,
           draws: stats.draws | 0, backend: IS_GPU ? 'webgpu' : 'webgl2' },
  goHole, setCam, setPreset, terrainH, demH, classify, groundAt, horizonAO, HOLES, M, GEO,
  perf: () => ({ ...BOOT_PERF, marks: BOOT_PERF.marks.map(mark => ({ ...mark })) }),
  groundInfo: () => ({
    mode: groundMode,
    bounds: groundAtlas ? { ...groundAtlas.bounds } : null,
    classCounts: groundAtlas ? Array.from(groundAtlas.data.classCounts) : null,
  }),
  groundSample: (x, z) => groundAtlas?.sampleAt(x, z) || null,
  v2Terrain: () => ({
    requested: TERRAIN_PREVIEW.requested,
    ready: TERRAIN_PREVIEW.ready,
    status: terrainPreviewRender.status,
    reason: TERRAIN_PREVIEW.reason,
    label: TERRAIN_PREVIEW.descriptor?.label || null,
    surface: TERRAIN_PREVIEW.surfaceDescriptor ? {
      label: TERRAIN_PREVIEW.surfaceDescriptor.label,
      provisional: TERRAIN_PREVIEW.surfaceDescriptor.provisional,
      reason: TERRAIN_PREVIEW.surfaceDescriptor.provisionalReason,
      sourcePackSha256: TERRAIN_PREVIEW.surfaceDescriptor.source.packSha256,
      tileCount: TERRAIN_PREVIEW.surfaceAtlas?.data?.tileIds?.length || 0,
      classIds: Array.from(TERRAIN_PREVIEW.surfaceClassIds || []),
      classes: TERRAIN_PREVIEW.surfaceAtlas?.data?.classCounts
        ? Array.from(TERRAIN_PREVIEW.surfaceAtlas.data.classCounts, (count, id) => ({ id, count }))
          .filter(item => item.count > 0)
        : [],
      primaryClasses: TERRAIN_PREVIEW.surfaceAtlas?.data?.primaryClassCounts
        ? Array.from(TERRAIN_PREVIEW.surfaceAtlas.data.primaryClassCounts, (count, id) => ({ id, count }))
          .filter(item => item.count > 0)
        : [],
    } : null,
    bounds: TERRAIN_PREVIEW.bounds ? { ...TERRAIN_PREVIEW.bounds } : null,
    bridge: TERRAIN_PREVIEW.bridge ? { ...TERRAIN_PREVIEW.bridge } : null,
    source: TERRAIN_PREVIEW.stats(),
    renderer: { ...terrainPreviewRender },
    backend: IS_GPU ? 'webgpu' : 'webgl2',
  }),
  classifyAnalytic,
  plates: () => plateSites.map(p => ({ ...p })),
  course: () => ({ ...CMETA }),
  settled: () => !camTween.on,
  heightSample: (x, z) => groundHeightSampler.inspectAt(x, z),
  probeH: (x, z) => renderedGroundH(x, z),
  setView: (px, py, pz, lx, ly, lz) => { flyTo(V3(px, py, pz), V3(lx, ly, lz), 0); },
  pick: (ndcX, ndcY) => {
    camera.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = rc.intersectObjects(scene.children, true);
    if (!hits.length) return null;
    const h = hits[0];
    return { dist: +h.distance.toFixed(1), point: h.point.toArray().map(v => +v.toFixed(1)),
             name: h.object.name || h.object.type, order: h.object.renderOrder,
             tag: h.object.userData.tag || null,
             mat: h.object.material?.type, inst: h.object.isInstancedMesh || false };
  },
  camInfo: () => ({ pos: camera.position.toArray().map(v => +v.toFixed(1)),
                    look: controls.target.toArray().map(v => +v.toFixed(1)), mode: camMode }),
  fps: () => fps,
  prepareCapture,
  captureReadback: IS_GPU ? captureReadback : null,
  startTour, endTour, kikMeasure,
  setSky, skyState: () => skyState, eachSky: fn => skySprites.forEach(fn),
  /* the CANVAS positions, not the world ones: where a marker is actually drawn is
     what a collision check has to measure */
  skyMarks: () => ({
    ppm: MS, r: SKY_R, w: mini.width,
    holes: SKY.holes.map(m => { const p = skyXY(m); return { id: String(m.n), f: +m.f.toFixed(3), px: +p[0].toFixed(1), py: +p[1].toFixed(1) }; }),
    fac: SKY.fac.map(f => { const p = skyXY(f); return { id: f.ch, px: +p[0].toFixed(1), py: +p[1].toFixed(1) }; }) }),
};

addEventListener('pagehide', () => {
  captureReadbackTarget?.dispose();
  captureReadbackTarget = null;
}, { once: true });

bootEl.classList.add('done');
setTimeout(() => { document.getElementById('hint').style.opacity = 0; }, 6000);
if (BOOTQ.get('kiosk') === '1') setTimeout(startTour, 1200);

/* Ten seconds of honest measurement, then a decision: a phone crawling at the
   full treatment gets its pixel ratio and bloom dropped on the fly, and the
   offer of the lightweight build (which also thins the instanced forest). */
if (!LOWQ) setTimeout(() => {
  let checked = 0, bad = 0;
  const qt = window.setInterval(() => {
    if (!fps) return;
    checked++;
    if (fps < 22) bad++;
    if (checked >= 10) {
      window.clearInterval(qt);
      if (bad >= 6) {
        lowfx = true;
        /* not under det: a harness run on a software rasterizer is always slow,
           and it must not leave a verdict behind that changes the next visit */
        if (!DET) { try { localStorage.setItem('banvy-quality', 'lo'); } catch {} }
        renderer.setPixelRatio(1);
        renderer.setSize(innerWidth, innerHeight);
        if (renderer.__bloomNode) renderer.__bloomNode.strength.value = 0;
        const sp = new URLSearchParams(location.search);
        sp.set('q', 'lo');
        toast(`Låg bildfrekvens — förenklade grafiken. <a href="${location.pathname}?${sp.toString()}">Starta i lättviktsläge</a>`, 10000);
      }
    }
  }, 1000);
}, 4000);
