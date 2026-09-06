
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
import { TAU, clampf, hyp, lerp, smooth, rightOf, polyLen, alongLine, lineBearingAt, ptSegD, ringBBox, inRing, centroidOf, hash2, vnoise, fbm } from './engine/geom.js';
/* geom's ringSD and distToLine, through an edge index: the same values, and
   a cost that stops growing with the ring (ring-index.mjs). The optional
   fourth argument is a cutoff: past it a query returns a value on the right
   side with at least that magnitude, so a loop that only compares against a
   threshold, or feeds a smoothstep that has saturated, passes the threshold
   and stops paying for an answer it would not use. */
import { ringSDIndexed as ringSD, distToLineIndexed as distToLine } from './engine/ring-index.mjs';
import { bakeImpostorAtlas, createImpostorMaterial, createImpostorGeometry, impostorDebugMode, impostorBend } from './engine/tree-impostor.mjs';
import { treeFadeClock, treeFadeDuration, attachTreeFade, createFadeAttribute, PAIR, drainAt, reversedFade, FADE_EPOCH_S } from './engine/tree-fade.mjs';
import { createGroundClamp, GROUND_CLAMP } from './engine/camera-clamp.mjs';
import { createClassifier, SURFACE } from './engine/surface.js';
import { createGroundAtlas } from './engine/atlas.js';
import { buildGroundSurfaceFeatures } from './engine/surface-features.mjs';
import { createWoodlandContextSampler, woodlandSpeciesPrior } from './engine/woodland-context.mjs';
import {
  requestedSurfaceDebugMode,
  shouldRenderLegacySurfaceOverlays,
} from './engine/surface-render-policy.mjs';
import { createV2GroundMaterialDecorator, makeGround } from './engine/material.js';
import { smoothShore, smoothMownEdges } from './engine/ring-smoothing.mjs';
import { deriveTeeBearings, inferSynthTeePads } from './engine/tee-pads.mjs';
import { createGroundHeightSampler } from './engine/ground-height-sampler.mjs';
import { compassBearing, windAlong, playsLike, greenDistances, lineHazards, layupTargets } from './engine/rangefinder.js';
import {
  DEFAULT_BAG, MAX_BAG_CLUBS, gpsToLocal, nearestHole, normalizeBag, parseBag,
  pointAlongLine, recommendClub, strategyForHole,
} from './engine/caddie.js';
import { fetchWeather, compassName, weatherWord, WEATHER_TTL_MS } from './engine/weather.js';
import { PUTTOM_PREVIEW_CONFIG } from './engine/v2-puttom-preview.mjs';
import {
  selectV2TerrainSource,
  v2StreamProbeRequested,
  V2_GRAPH_RENDERER_GATE,
  V2_OBJECT_LAYER_GATE,
} from './engine/v2-terrain-select.mjs';
import { V2TerrainLiveAdapter } from './engine/v2-terrain-live-adapter.mjs';
import { contiguousRgba8Readback } from './engine/rgba8-readback.mjs';

/* ?det=1 pins the clocks -- the TSL time uniform driving water and clouds, and
   the flag-cloth wave -- so two boots render the same pixels. Phase 0 proved the
   pin is all the determinism this engine needs; from phase 2 the app is
   hand-maintained source, so the parity contract lives here as a runtime switch
   instead of a special build. */
const DET = new URLSearchParams(location.search).get('det') === '1';
const groundMode = new URLSearchParams(location.search).get('ground') === 'mesh' ? 'mesh' : 'atlas';
const surfaceDebugMode = requestedSurfaceDebugMode(location.search);
const time = DET ? float(3.25) : __liveTime;

let MODEL_PREP_STARTED = 0;
/* ------------------------------------------------------------------ boot ui */
const bootEl = document.getElementById('boot');
const barEl = document.querySelector('#bar i');
const msgEl = document.getElementById('bmsg');
const bootStarted = performance.now();
const BOOT_PERF = { marks: [], spans: [], atlasMs: 0, totalMs: 0, doneAtMs: 0, firstFrames: [] };
/* Spans name the heavy blocks the stage marks hide: one entry per block with
   its wall time. `lap` records the time since the previous lap, for runs of
   blocks that follow one another. Read them with V3D.perf(). */
const span = (name, startedMs, extra) => {
  BOOT_PERF.spans.push({ name, ms: +(performance.now() - startedMs).toFixed(1), ...(extra || {}) });
};
const LAP = { t: 0 };
const lapStart = () => { LAP.t = performance.now(); };
const lap = (name, extra) => { span(name, LAP.t, extra); LAP.t = performance.now(); };
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
/* V2 is the DEFAULT for every course with a reviewed live contract (the
   frontier registry, plus the retained Puttom pilot); a course without one
   defaults to GPK1 and fetches no v2 chunk, and ?v2=0 is the explicit
   opt-out everywhere. One boundary decides the source: a published, verified
   course/ground graph first, then the retained Puttom preview, then the
   explicit GPK1 fallback state. Start it beside GPK1 inflation so the
   integrity work does not serialize the boot. By default and under ?v2=1 a
   failed or absent source resolves to an explicit fallback and never blocks
   the normal course; under ?v2=require the selection throws instead of
   quietly serving GPK1. */
const previewStarted = performance.now();
/* The model is inflated beside the terrain selection, and a FIXED FRONTIER
   needs its water while its tiles decode (the lake beds are carved into the
   tiles, and a tile cannot be re-floored once its texels exist), so the
   selection is handed the model's water as a promise-returning function and
   M below is the same parse, awaited once. */
const modelPromise = inflate(PACK.sv).then(bytes => JSON.parse(new TextDecoder().decode(bytes)));
const terrainPreviewPromise = selectV2TerrainSource({
  slug: CMETA.slug,
  geo: GEO,
  packMeta: CMETA,
  search: location.search,
  waterBeds: async () => {
    const model = await modelPromise;
    return {
      bodies: (model.water || []).filter(w => !w.stream && w.ring?.length >= 3).map(w => ({ ring: w.ring, level: w.level })),
      shallows: (model.surround && model.surround.shallows) || [],
    };
  },
}).then(selection => { span('v2 preview: select + decode pilot/surface tiles', previewStarted); return selection; });
const [b0, b1, MODEL, V2_SELECTION] = await Promise.all([
  inflate(PACK.s0), inflate(PACK.s1), modelPromise, terrainPreviewPromise,
]);
const TERRAIN_PREVIEW = V2_SELECTION.source;
const TERRAIN_PREVIEW_CONFIG = V2_SELECTION.frontierConfig || PUTTOM_PREVIEW_CONFIG;
MODEL_PREP_STARTED = performance.now();
/* Phase 4 of the vegetation plan (docs/puttom-v2-lidar-tree-placement-plan.md):
   a published graph that carries object registries or stand fields has them
   fetched now, in parallel with everything below, through a dynamic import
   so that a flagless visit never downloads the vegetation runtime. The load
   is awaited before the ground is installed: under ?v2=require a bad chunk
   is a boot error, under ?v2=1 the legacy lattice serves everywhere. There
   is deliberately no per-tile fallback. */
const V2_VEGETATION_LOADING = V2_SELECTION.graph &&
  ((V2_SELECTION.graph.summary?.objectTiles || 0) + (V2_SELECTION.graph.summary?.standTiles || 0)) > 0
  ? import('./engine/v2-vegetation.mjs').then(async mod => ({
    mod,
    loaded: await mod.loadV2Vegetation({
      graph: V2_SELECTION.graph,
      baseUrl: new URL(import.meta.env.BASE_URL, location.href).href,
    }),
  }))
  : null;
let V2_VEGETATION = null;
let V2_VEGETATION_ERROR = null;
const H0 = decodeHF(HF0, b0), H1 = decodeHF(HF1, b1);
const M = MODEL;
const HOLES = M.holes;
/* A verified descriptor alone may not alter either construction or visible
   ground. The adapter opens those gates separately after backend preflight and
   after successful scene installation/legacy cut respectively. */
let terrainV2 = new V2TerrainLiveAdapter({
  source: TERRAIN_PREVIEW,
  courseSlug: CMETA.slug,
  expectedCourseSlug: TERRAIN_PREVIEW_CONFIG.slug,
  expectedTileCount: TERRAIN_PREVIEW_CONFIG.expectedTileCount,
  expectedSurfaceTileCount: TERRAIN_PREVIEW_CONFIG.expectedSurfaceTileCount,
  surfacePolicy: TERRAIN_PREVIEW_CONFIG.surfacePolicy || 'v2-atlas',
  cutoutContract: TERRAIN_PREVIEW_CONFIG.legacyCoreCutout,
});
/* A published graph that reaches past the course window -- nested rings of
   Lantmäteriet data to a 16 km root -- becomes the ONLY terrain: the streaming
   runtime draws it in the pilot's bridge and the legacy CORE, MID and FAR
   rings are never built, so there is no seam between two sources anywhere.
   The pilot source still supplies its 1 m sampler and the surface atlas.
   The rings are read NOW, on the main thread and before any GPU exists,
   because the water levels are measured against the ground a few hundred
   lines below and every lake must be measured against the world it will be
   drawn on -- the pilot sampler alone left the lakes outside its window at
   their Terrarium levels, metres off the DTM's own water surface, so their
   planes hid under the ground and the far scatter planted cones on them.
   Loaded dynamically so a flagless visit never downloads it. */
let V2_WORLD = null;
if (TERRAIN_PREVIEW.ready && V2_SELECTION.graph) {
  const mod = await import('./engine/v2-graph-terrain.mjs');
  if (mod.graphCoversHorizon(V2_SELECTION.graph.ground, TERRAIN_PREVIEW.descriptor?.bounds)) {
    const world = new mod.V2GraphTerrainAdapter({
      graph: V2_SELECTION.graph,
      source: TERRAIN_PREVIEW,
      courseSlug: CMETA.slug,
      baseUrl: new URL(import.meta.env.BASE_URL, location.href).href,
      legacyOriginEpsg3006: TERRAIN_PREVIEW_CONFIG.legacyOriginEpsg3006,
    });
    try {
      const ringStarted = performance.now();
      const ringTiles = await world.loadRings();
      console.info(`v2 world: ${ringTiles} ring tiles read for the model in ${Math.round(performance.now() - ringStarted)} ms`);
      span('v2 rings: fetch + verify + decode', ringStarted, { tiles: ringTiles });
      terrainV2 = world;
      V2_WORLD = mod;
    } catch (error) {
      const detail = String(error?.message || error).slice(0, 300);
      if (V2_SELECTION.require) throw new Error(`v2 krävdes men världens ringar kunde inte läsas: ${detail}`);
      console.warn('v2 world rings could not be read; the course window serves alone:', detail);
    }
  }
}

const terrainPreviewBadge = document.getElementById('v2TerrainBadge');
function setTerrainPreviewBadge(backend = null, renderState = null, meshMetres = null) {
  if (!terrainPreviewBadge || !TERRAIN_PREVIEW.requested) return;
  terrainPreviewBadge.hidden = false;
  const title = terrainPreviewBadge.querySelector('b');
  const detail = terrainPreviewBadge.querySelector('span');
  if (TERRAIN_PREVIEW.ready && renderState !== 'failed') {
    terrainPreviewBadge.dataset.state = renderState === 'ready' ? 'ready' : 'loading';
    const world = terrainV2.kind === 'graph' && terrainV2.rendererState;
    title.textContent = world?.status === 'ready' ? '1 M TERRÄNG · HELA VÄRLDEN' : '1 M TERRÄNG · PREVIEW';
    detail.textContent = [
      CMETA.name,
      world?.status === 'ready'
        ? `${world.tiles} tiles i ${world.levels.length} nivåer till 16 km`
        : `${TERRAIN_PREVIEW.resources.length} verifierade tiles`,
      backend,
      meshMetres ? `1 m höjd · ${meshMetres} m mesh` : null,
    ].filter(Boolean).join(' · ');
  } else {
    terrainPreviewBadge.dataset.state = 'fallback';
    title.textContent = 'STANDARDTERRÄNG · FALLBACK';
    detail.textContent = TERRAIN_PREVIEW.reason === V2_GRAPH_RENDERER_GATE
      ? 'v2-grafen är verifierad men den generella renderaren är inte aktiverad'
      : CMETA.slug === 'puttom'
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
  const previewHeight = terrainV2.constructionHeightAt(x, z);
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

/* A TEE MARKER HAS TO STAND ACROSS THE LINE, AND `mk.b` COULD NOT SAY WHERE.

   A pair of tee markers straddles the teeing ground: the axis between them is
   PERPENDICULAR to the direction of play, because the player stands between
   them and hits through. Measured over the shipped packs, only Veckefjarden's
   603 marks did that. On the other eight courses the pair's axis was a mean
   35-47 degrees off perpendicular and up to 89 -- Puttom's 6th had its two
   balls strung out ALONG the fairway, one behind the other.

   The cause is two conventions with one name. `mk.b` is written by the
   pipelines as a COMPASS bearing, `atan2(dx, -dz)` (geobuild/lib.mjs's
   `bearing`), by every build except geobuild -- which writes `alongLine`'s
   `atan2(dx, dz)` instead. The engine reads it as the latter, so `rightOf(b)`
   returned the true right only where the two agree. They differ by a mirror in
   z, so the error is `asin|sin 2b|`: exactly zero on a hole running due north
   or due east, exactly 90 degrees on one running north-east. That is why this
   looked fine on some holes and absurd on others, and why no gate caught it --
   the marker pair and the tee deck under it were squared to the SAME wrong
   bearing, so the "every marker stands on tee grass" check compared the data
   with itself and passed.

   So the bearing is not read any more, it is DERIVED from the hole line the
   engine itself draws -- the same authority `setCam('tee')` already used for
   the camera, which is why the view looked down the hole while the markers did
   not. `mk.b` is overwritten here, once, before anything reads it: on
   Veckefjarden it lands on the value already there.                          */
for (const h of HOLES) deriveTeeBearings(h);

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
  inferSynthTeePads(h);
  const pads = h.tees.pads;
  /* A pad's centre, derived from its own ring rather than carried beside it.
     The builds store `cx`/`cz` and emit-pack drops them -- correctly, they are
     redundant bytes -- but that left every pad in every pack without one, and
     the submersion gate reads `pad.cx` to probe the ground a player stands on.
     It was probing `undefined` and crashing on the first course, so that gate
     and everything after it had stopped running. Derived here, once, for
     mapped and synthesised pads alike: the vertex mean, which reproduces the
     builds' own value exactly on the quads they store. */
  for (const pad of pads) {
    if (Number.isFinite(pad.cx) && Number.isFinite(pad.cz)) continue;
    let sx = 0, sz = 0;
    for (const [x, z] of pad.ring) { sx += x; sz += z; }
    pad.cx = sx / pad.ring.length;
    pad.cz = sz / pad.ring.length;
  }
}

/* A SHORELINE IS A CURVE, AND THE TRACE IS A POLYGON -- smoothShore lives in
   engine/ring-smoothing.mjs now, because the v2 surface compiler has to
   rasterise exactly the rings this boot draws, and it once did not. */
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

  /* A BETTER GROUND MODEL INVALIDATES THE WATER LEVELS, and by less than it
     sounds. Each level in the model was measured off its own shoreline against
     the LEGACY dem -- build-heightfields' `levelOfPts`, the 30th percentile of
     the ground sampled at the ring's own points. Under v2 the ground moves, on
     Puttom by 0.1-0.3 m beneath two lakes, and that is enough to lift an entire
     lake bed ABOVE its own water plane: the surface is then hidden underneath
     and the lake renders as brown bed. A player reported exactly that before
     any gate did, because every gate compares the model with itself.

     So re-measure with the SAME RULE against the ground that will be drawn.
     Only the source changes, never the method -- same ring points, same
     percentile, before smoothShore densifies them so the sample set is the one
     the original rule used. A ring the frontier does not substantially cover
     keeps its committed level: a percentile of three points is worse evidence
     than a percentile of ten, and inventing precision is how a pilot starts
     lying about a place.

     Gated on `ready` rather than `active` because the level must be settled
     before WI indexes it, which is long before the batch installs. If the
     install then fails, these levels stay v2-derived over legacy ground: on
     this course at most 0.5 m out, and every body still renders as water. */
  if (TERRAIN_PREVIEW.ready && typeof TERRAIN_PREVIEW.heightAt === 'function') {
    /* CLEARANCE, and it is not a fudge. Lantmateriet's Markhojdmodell over
       water is the WATER SURFACE -- laser does not penetrate -- so the "ground"
       the frontier reports inside a lake ring IS the surface, and there is no
       bathymetry anywhere in this data. Place the plane exactly on the measured
       value and it lands coplanar with the bed that is drawn beneath it: the
       depth buffer cannot separate them and the lake flickers, which is what
       shipping the bare measurement did. Measured after that change, the three
       re-levelled bodies had a median clearance of 0.00, 0.00 and 0.03 m, while
       the one left alone kept 0.55 m and never flickered.

       The legacy build never hit this because its terrain builder CARVES a bed
       below the water; the v2 mesh is the verified DTM and is not carved. So
       the surface is lifted by a nominal amount instead, which lands inside the
       0.16-0.41 m clearance the legacy terrain happened to have. It makes the
       water up to a quarter-metre too high, and that is the honest trade: a
       stated 0.25 m error against a defect visible on every lake. */
    const COVERAGE = 0.6, PERCENTILE = 0.30, MIN_POINTS = 3, CLEARANCE = 0.25;
    /* the world when it is loaded -- every ring is then covered, and a lake
       two kilometres out is measured against the ground it is drawn on --
       otherwise the pilot's own window */
    const groundProbe = typeof terrainV2.worldHeightAt === 'function' && terrainV2.ringsLoaded
      ? (x, z) => terrainV2.worldHeightAt(x, z)
      : (x, z) => TERRAIN_PREVIEW.heightAt(x, z);
    const remeasured = [];
    for (const w of M.water) {
      if (w.stream || !w.ring?.length) continue;
      const heights = [];
      for (const p of w.ring) {
        const probe = groundProbe(p[0], p[1]);
        const h = Number.isFinite(probe) ? probe : probe?.height;
        if (Number.isFinite(h)) heights.push(h);
      }
      if (heights.length < MIN_POINTS) continue;
      heights.sort((a, b) => a - b);
      const measured =
        Math.round((heights[Math.floor(heights.length * PERCENTILE)] + CLEARANCE) * 100) / 100;
      /* Enough of the shoreline is on the frontier to replace the measurement
         outright. Below that the committed level is the better estimate of the
         two -- but the few covered points still prove the v2 bed sits higher
         than it, so the plane is RAISED to clear that bed and never lowered on
         thin evidence. A body straddling the frontier has one water surface
         over two ground models, and it has to stay above both.

         Measured, and this is why the rule has two halves: w185976262 has 3 of
         10 shore points on the frontier. Left alone it went from 1% of its bed
         dry under GPK1 to 11% under v2 -- a regression the coverage rule alone
         happily allowed, because refusing to act is not the same as doing no
         harm. */
      const level = heights.length >= w.ring.length * COVERAGE
        ? measured : Math.max(w.level, measured);
      if (level !== w.level) remeasured.push(`${w.name || w.id || 'vatten'} ${w.level}->${level}`);
      w.level = level;
    }
    if (remeasured.length) console.info('v2 water levels re-measured:', remeasured.join(', '));
    /* Now that every body has its level, read the water the model does NOT
       have off the ground: the extract cut lake polygons at its bounding
       box, and lakes past it are not in the pack at all, while the DTM shows
       each as a flat at its own level. The mask keeps trees off them, tints
       the bed under them, and lays a sheet where no ring does. */
    if (typeof terrainV2.detectFlatWater === 'function' && terrainV2.ringsLoaded) {
      const flatStarted = performance.now();
      const flat = terrainV2.detectFlatWater(M.water.filter(w => !w.stream && w.ring?.length >= 3).map(w => ({ ring: w.ring, level: w.level })));
      const uncovered = flat.components.filter(c => c.uncoveredCells > 0);
      console.info(`v2 flat water: ${flat.components.length} flats over 0.48 ha, ${uncovered.length} beyond the model's rings ` +
        `(${uncovered.reduce((s, c) => s + c.uncoveredCells, 0) * flat.spacing * flat.spacing / 10000 | 0} ha), ${Math.round(performance.now() - flatStarted)} ms`);
      span('v2 flat water: detect', flatStarted);
      /* The laser's ground inside a lake is the lake's surface. Carve a bed
         under all of it now -- before the water sheets measure their depth
         and before the GPU decodes a single tile -- so the water has depth
         where a lake has it, and the sheet has metres of clearance instead
         of a hand's width. */
      if (typeof terrainV2.carveWaterBeds === 'function') {
        const bed = terrainV2.carveWaterBeds();
        console.info(`v2 water beds: ${bed.hectares} ha carved to ${bed.maximumDepthMetres} m, ` +
          `${bed.carvedSamples} samples in ${bed.carvedTiles} ring tiles, ${bed.milliseconds} ms ` +
          `(field ${bed.fieldMilliseconds} ms: ${Object.entries(bed.fieldTimings || {}).map(([k, v]) => `${k} ${v}`).join(', ')})`);
        BOOT_PERF.spans.push({ name: 'v2 water beds: carve rings', ms: bed.milliseconds, tiles: bed.carvedTiles });
      }
    } else if (TERRAIN_PREVIEW.waterBedSummary) {
      /* A FIXED FRONTIER has no ring to find flat water in, and until 2026-09
         had no carve at all: Ribbingsfors' Skagern rendered as pale silt across
         the whole frontier, because the tiles inside its ring are the laser's
         water surface a hand's depth under the sheet, and only beyond the
         frontier did the legacy carve give the lake its depth. Its beds were
         carved as the tiles decoded (loadPublishedGraphTerrainFrontier, from
         the model's rings, re-flooring each lake tile); this only reports it.
         The profile matches the legacy carve so the bed is continuous where
         the frontier hands over to the legacy MID. */
      const bed = TERRAIN_PREVIEW.waterBedSummary;
      console.info(`v2 water beds (frontier): ${bed.hectares} ha carved to ${bed.maximumDepthMetres} m, ` +
        `${bed.carvedSamples} samples in ${bed.carvedTiles} tiles (${bed.rebasedTiles} re-floored), ${bed.shallowCells} shallow cells`);
      BOOT_PERF.spans.push({ name: 'v2 water beds: carve frontier (at decode)', ms: bed.fieldMilliseconds, tiles: bed.carvedTiles });
    }
  }

  const preserveMappedBoundaries = M.infra.preserveMappedBoundaries === true;
  for (const w of M.water) {
    if (w.stream || !w.ring) continue;
    w.ring = smoothShore(w.ring, near, 3, 3, 8, { preserveMappedBoundaries });
  }
  /* The silt shallows are traced far coarser than the water is -- 12 points with
     a 64 m median segment and one of 427 m -- and they draw the pale margin
     right where the eye is, just off the island 14th. Same treatment. */
  if (M.surround && M.surround.shallows)
    M.surround.shallows = M.surround.shallows.map(r => smoothShore(r, near, 3, 3, 8, { preserveMappedBoundaries }));

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
  // Boot and the atlas/v2 compiler apply the same boundary policy. Preserve
  // the live hole identities used by the rest of boot while replacing only
  // their copied surface containers, exactly as the previous in-place pass did.
  const mown = smoothMownEdges({ holes: HOLES, scenery: M.scenery, preserveMappedBoundaries });
  for (let i = 0; i < HOLES.length; i++) Object.assign(HOLES[i], mown.holes[i]);
  Object.assign(M.scenery, mown.scenery);
}

for (const h of HOLES) {
  const g = { ring: h.green.ring, bb: ringBBox(h.green.ring), hole: h.n, c: h.green.c };
  GI.add(g, g.bb, 26);
  h._g = g;
  for (const t of h.tees.pads) { const r = { ring: t.ring, bb: ringBBox(t.ring), preserveTerrain: t.preserveTerrain }; TI.add(r, r.bb, 12); }
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
  /* the class band under a road is its ribbon's width, not double it: a
     wider band showed as a dark margin either side of a pale gravel road */
  const w = r.kind === 'trunk' ? 8 : /gravel|compacted|ground|unpaved/.test(r.surface || '') ? 2.4 : 3;
  const q = { line: r.line, bb: ringBBox(r.line), w };
  PI.add(q, q.bb, r.kind === 'trunk' ? 12 : 8);
}
for (const rw of (M.infra.railway || [])) {
  const q = { line: rw.line, bb: ringBBox(rw.line), w: 4 };
  PI.add(q, q.bb, 8);
}
const II = new Grid();      // building footprints, so nothing grows through a wall
for (const b of M.infra.buildings) { const q = { ring: b.ring, bb: ringBBox(b.ring) }; II.add(q, q.bb, 10); }
for (const p of (M.infra.parking || [])) { const q = { ring: p.ring, bb: ringBBox(p.ring) }; II.add(q, q.bb, 8); }
for (const f of M.scenery.mappedFeatures || []) { const ring = f.rings?.[0]; if (ring) { const q = { ring, bb: ringBBox(ring) }; II.add(q, q.bb, 1); } }
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
  { wall: 0xe7e2d4, roof: 0x9d3f2e, height: 5.4, windowRows: [1.4, 3.5], terrace: true,
    /* a two-tone facade, a gabled roof, a glazed gable end with a balcony: what a
       modern clubhouse (Puttom) is made of, each off unless the course says so */
    lowerWall: null, lowerHeight: 0, gable: false, glazedGable: false, balcony: false },
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
  const b = (M.infra.buildings || []).find(q =>
    q.amenity === 'clubhouse' || (q.name && /golfklubb|klubbhus/i.test(q.name)));
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
/* Tee decks are sampled repeatedly while a terrain is built. Keep separate
   caches for the pure GPK1 and preflight-approved v2 height sources so an
   aborted optimized build cannot leak a v2 centroid into the fallback mesh. */
const teeBaseHeights = new WeakMap();
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
  /* Only inferred decks may alter the terrain; measured mowing extent is not
     evidence that the entire polygon is flat. */
  for (const t of TI.at(x, z)) {
    if (t.preserveTerrain) continue;
    const sd = ringSD(x, z, t.ring);
    if (sd > 9) continue;
    const w = 1 - smooth(-0.5, 6.5, sd);
    if (w <= 0.001) continue;
    padW = Math.max(padW, w);
    let bases = teeBaseHeights.get(t);
    if (!bases) { bases = []; teeBaseHeights.set(t, bases); }
    const source = terrainV2.preflightReady ? 1 : 0;
    if (bases[source] === undefined) {
      const c = centroidOf(t.ring);
      bases[source] = demH(c[0], c[1]);
    }
    h = lerp(h, bases[source] + 0.28, w);
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
/* How much the imagery's word counts here: 1 deep inside the raster, 0 at its
   edge. Beyond the raster only the surveyed rings speak, and a floor that
   changes rule at a straight line draws that line on the ground -- so the
   imagery's thinning and planting fade out over the last 240 m of its box. */
let coverEdgeFade = () => 0;
if (M.cover) {
  const cv = M.cover;
  const bytes = Uint8Array.from(atob(cv.b64), c => c.charCodeAt(0));
  const cx1 = cv.x0 + cv.nx * cv.cell, cz1 = cv.z0 + cv.nz * cv.cell;
  coverAt = (x, z) => {
    const i = Math.floor((x - cv.x0) / cv.cell), j = Math.floor((z - cv.z0) / cv.cell);
    if (i < 0 || j < 0 || i >= cv.nx || j >= cv.nz) return 0;
    const k = j * cv.nx + i;
    return (bytes[k >> 2] >> ((k & 3) * 2)) & 3;
  };
  coverEdgeFade = (x, z) => smooth(0, 240, Math.min(x - cv.x0, cx1 - x, z - cv.z0, cz1 - z));
}

/* The analytic classifier remains the oracle. Once the runtime atlas exists,
   high-volume consumers use its O(1) lookup inside CORE and fall back to the
   oracle outside it. */
let groundAtlas = null;
/* the indexed queries return what ringSD and distToLine return, without
   walking every edge of a 378-vertex forest ring for every point (ring-index.mjs) */
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
   forest green; the rough is the leaf-green of full summer, with only a restrained
   dry fescue variation; and a green is bluer and
   deeper than the fairway around it. Those three relationships are most of what makes
   mown ground read as mown ground from 200 m away. */
/* nudged against the club's July aerial: the mown surfaces run brighter and
   greener than the first authoring -- a fresh-cut vividness, not a repaint */
const C = {
  rough:  L(0x6f9348), fescue: L(0x82924f), semi:  L(0x659b42),
  fair:   L(0x60a03e), green:  L(0x489a4c), fringe:L(0x649540),
  tee:    L(0x5c9d42), sand:   L(0xd6c396), path:  L(0x757168),
  /* the forest floor was 0x334423 -- against fog-lit turf it rendered near-black,
     and whole hillsides read as burnt ground; this is bilberry-and-litter brown,
     with the deepest shade kept for ground the satellite says is closed canopy */
  /* ... and 0x46512e, measured from above with the trees hidden, was still a
     dark burnt olive: the floor reads dark in life because it stands in the
     crowns' shade, not because it is painted dark. Moss and bilberry, so the
     shadows do the darkening and the edge against mown turf stops shouting. */
  heath:  L(0x6d8142), forest: L(0x5c6b3c), shore: L(0xb2a37e),
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
    const closed = coverAt(x, z) === 2 ? 1 - 0.58 * coverEdgeFade(x, z) : 1;
    /* three quarters of the way to the floor colour, so the ground under the
       trees keeps a quarter of the rough it grows out of */
    col = col.map((v, i) => lerp(v, C.forest[i], c.forest * 0.75 * closed));
    if (closed === 1 || c.forest * closed > 0.35) sid = S_FOREST;
  }
  if (c.wet > 0.02) { col = col.map((v, i) => lerp(v, C.wet[i], c.wet * 0.7)); }

  /* the surroundings' own ground: fields hashed to a crop tone each, garden lawns,
     industry hardstanding, the traced clear-fells and yard, the Ås hay meadows */
  for (const q of LI.at(x, z)) {
    if (ringSD(x, z, q.ring, 1) > 0) continue;
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
    if (ringSD(x, z, q.ring, 1) > 0) continue;
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
    /* exact to 30 m: the level test reads 30 and the band below saturates by 11 */
    const sd = ringSD(x, z, w.ring, 30);
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
span('model prep after terrain data (pads, water levels, shores, grids)', MODEL_PREP_STARTED);
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
/* A phone is performance mode by default. The memory/core sniff above never
   catches a flagship phone (8 cores, capped or absent deviceMemory), so detect
   the FORM instead, by capability and never by user agent: the primary pointer
   is coarse with no hover (a touch-first device) and the screen's short side is
   phone-sized -- the same 768 px breakpoint the mobile HUD sheets use. An
   explicit ?q= still always wins, and det=1 stays device-blind so goldens do
   not depend on the machine that captured them. */
const phoneDevice = !DET
  && window.matchMedia('(pointer: coarse) and (hover: none)').matches
  && Math.min(window.screen?.width ?? Infinity, window.screen?.height ?? Infinity) <= 768;
const LOWQ = qualityParam === 'lo'
  || (qualityParam !== 'hi' && (rememberedQuality === 'lo' || constrainedDevice || phoneDevice));
/* runtime quality drop (auto-detected weak GPU) and motion preference */
let lowfx = false;
let autoQualityDone = false;   /* the auto-quality verdict has been reached (a harness waits on it) */
const RMOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* skyltar: 0 off, 1 hole numbers, 2 numbers + faciliteter. skyMax is 1 on a course
   whose facilities are not in the data, so the cycle never promises an empty layer. */
let skyState = 2, skyMax = 2, skyHidden = false;
/* WebGPU can exist and still fail to start (an OS beta, a driver, a flag): an
   init that threw left the splash on "startar" forever, blamed on the network.
   Fall back to the WebGL2 backend instead; ?gl=1 forces it for testing. */
const FORCE_GL = new URLSearchParams(location.search).get('gl') === '1';
/* ?gputime=1 asks the WebGPU backend for timestamp queries, so a harness can
   read GPU milliseconds per frame (V3D.gpuTime); off by default, since the
   query pool is a cost of its own and a vsync-locked frame time is not one */
const GPU_TIME = new URLSearchParams(location.search).get('gputime') === '1';
/* A reversed, float depth buffer, the default on WebGPU (?rdepth=0 switches it
   off). The camera runs from 1 m to 14 km
   and a 24-bit fixed-point depth buffer keeps about half a metre at 3 km, so
   everything lying on the terrain -- roads, marking, water sheets, the surface
   bands -- flickers against it as the camera moves. three's WebGPU backend
   takes depth32float under reversedDepthBuffer and flips the compare, but it
   passes polygonOffset through unchanged, and in reversed depth "toward the
   camera" is the other sign: DEPTH_SIGN carries that to every nudge below. */
const RDEPTH = new URLSearchParams(location.search).get('rdepth') !== '0';
const mkRenderer = forceWebGL => new THREE.WebGPURenderer({ antialias: true, samples: 4,
  outputBufferType: THREE.HalfFloatType, powerPreference: 'high-performance', forceWebGL, trackTimestamp: GPU_TIME,
  /* the WebGL2 fallback keeps the classic buffer: its reversed path needs EXT_clip_control and has not been measured here */
  reversedDepthBuffer: RDEPTH && !forceWebGL });
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
/* the sign every depth nudge takes: toward the camera is negative in the classic
   buffer and positive in the reversed one, and three passes polygonOffset through unchanged */
const DEPTH_SIGN = renderer.reversedDepthBuffer === true ? 1 : -1;
/* Allocated lazily by the CI/readback hook only. Normal visits, including the
   opt-in preview, must not pay for a second full-size color target. */
let captureReadbackTarget = null;
let captureRenderLocked = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 1.0, 14000);
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
const TEX_STARTED = performance.now();
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
span('procedural textures (DETAIL, GRASSN, SANDN, WATERN)', TEX_STARTED);

/* ------------------------------------------------------------- lighting */
const uSun = uniform(new THREE.Vector3(-0.42, 0.46, 0.78).normalize());
/* seasonal foliage: the birch crowns and reed heads take their colour from the
   preset, which is what lets Höst turn the shore gold without a rebuild */
const uLeaf = uniform(new THREE.Color(0x5f8944));
const uReedC = uniform(new THREE.Color(0x8d8a52));
const sun = new THREE.DirectionalLight(0xfff2de, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(LOWQ ? 1024 : 2048, LOWQ ? 1024 : 2048);
/* The shadow map is re-rendered when something that casts has moved, and not
   otherwise (shadowRest, in the frame loop): three's default is every frame,
   and at rest that pass over ten million triangles was a third of the frame's
   draws for a picture that did not change. ?shadowrest=0 is the before. */
const SHADOW_REST = new URLSearchParams(location.search).get('shadowrest') !== '0';
sun.shadow.autoUpdate = !SHADOW_REST;
const SHADOW_REST_STATE = { sunPos: new THREE.Vector3(NaN, NaN, NaN), target: new THREE.Vector3(NaN, NaN, NaN), tiles: -1, uploads: -1, morphStart: -1, dirtyUntil: 0, renders: 0, frames: 0, sinceRender: 0, why: '' };
let treeUploadsThisFrame = 0;
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
  /* three's SkyMesh pins itself to the far plane with z = w, which under a
     reversed depth buffer is the NEAR plane; and three reverses its whole render
     list under reversed depth, renderOrder included, so the sky then draws LAST
     and over the world (the sky-only frames of 2026-09-04). In the reversed
     convention the far plane is z = 0. */
  if (renderer.reversedDepthBuffer) {
    const base = skyMesh.material.vertexNode;
    skyMesh.material.vertexNode = Fn(() => { const p = vec4(base); return vec4(p.x, p.y, float(0), p.w); })();
  }
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
  const pmremStarted = performance.now();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.58;
  span('PMREM environment', pmremStarted);
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
/* The planted trees stop at MIDR's edge and the far cones begin there, and
   a stand that changes from lit crowns to dark silhouettes along a straight
   line draws that line across every hillside. This is 1 deep inside the ring
   and 0 at its edge: the planter thins by it and the cones fill in by its
   complement, so the hand-over is a 350 m band rather than a square. */
const midrEdgeFade = (x, z) => smooth(0, 350, Math.min(x - MIDR.x0, MIDR.x1 - x, z - MIDR.z0, MIDR.z1 - z));
const FARR = { dx: 36, x0: -5400, x1: 5400, z0: -5400, z1: 5400,
               ...((SCENERY && SCENERY.farRing) || {}) };

const stats = { verts: 0, tris: 0, trees: 0, draws: 0, surfaceOverlays: 0 };
/* the far cones' positions and the water sheets, kept so a harness can ask
   where they stand and hide them to see what is under them */
let VISTA_PTS = null;
const WATER_MESHES = [];
SEAM = MIDR;
const builtTerrain = { core: null, mid: null };

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
  previewActive: () => terrainV2.active,
  previewHeightAt: (x, z) => terrainV2.heightAt(x, z),
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

/* GROUND COLOUR TO THE HORIZON, FOR THE WORLD GRAPH.

   The legacy rings coloured every vertex: CORE and MID through groundAt (turf,
   forest floor under canopy, wet shore, landuse), FAR through a cheaper read
   of slope, height and what the map says the ground is used for. The v2
   material has no vertex colour, so the same two classifications are baked
   into two small rasters the rough class samples -- 6 m to 1.5 km, 24 m to
   6 km -- allocated before the material exists and filled once the world's
   heights are resident. sRGB bytes, so the darks keep their steps. */
const GROUND_TINT_NEAR = { half: 1536, dx: 6 };
const GROUND_TINT_FAR = { half: 6144, dx: 24 };
function createGroundTintTextures() {
  const make = ({ half, dx }) => {
    const n = Math.round((2 * half) / dx) + 1;
    const data = new Uint8Array(n * n * 4).fill(255);
    const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    return { texture, n, dx, bounds: { x0: -half - dx / 2, z0: -half - dx / 2, x1: half + dx / 2, z1: half + dx / 2 } };
  };
  return { near: make(GROUND_TINT_NEAR), far: make(GROUND_TINT_FAR) };
}
const toSrgbByte = v => Math.max(0, Math.min(255, Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))));
const SEA_TINT = [0.055, 0.085, 0.105];
/* the bed under a lake the DTM shows: dark, so a sheet above it reads as water
   and a flat the sheet misses never reads as a pale plate */
const FLAT_WATER_TINT = [0.05, 0.075, 0.09];
function fillGroundTintTextures(tint, heightAt) {
  const H = (x, z) => { const h = heightAt(x, z); return Number.isFinite(h) ? h : demH(x, z); };
  const flatWaterAt = typeof terrainV2.isFlatWaterAt === 'function' ? (x, z) => terrainV2.isFlatWaterAt(x, z) : () => false;
  const started = performance.now();
  const fill = (layer, colourAt) => {
    const { n, dx, bounds, texture } = layer;
    const data = texture.image.data;
    for (let j = 0; j < n; j++) {
      const z = bounds.z0 + (j + 0.5) * dx;
      for (let i = 0; i < n; i++) {
        const x = bounds.x0 + (i + 0.5) * dx;
        const c = flatWaterAt(x, z) ? FLAT_WATER_TINT : colourAt(x, z);
        const o = (j * n + i) * 4;
        data[o] = toSrgbByte(c[0]); data[o + 1] = toSrgbByte(c[1]); data[o + 2] = toSrgbByte(c[2]); data[o + 3] = 255;
      }
    }
    texture.needsUpdate = true;
  };
  fill(tint.near, (x, z) => groundAt(x, z, H(x, z)).col);
  /* Inside the near raster's box the far raster restates the near one, box
     averaged, so the two agree where the shader fades between them and the
     hand-over is only a change of resolution; the vista rule paints the rest. */
  const nearBox = (x, z) => {
    const { n, dx, bounds, texture } = tint.near;
    const i0 = Math.floor((x - GROUND_TINT_FAR.dx / 2 - bounds.x0) / dx), j0 = Math.floor((z - GROUND_TINT_FAR.dx / 2 - bounds.z0) / dx);
    const cells = Math.round(GROUND_TINT_FAR.dx / dx);
    if (i0 < 0 || j0 < 0 || i0 + cells > n || j0 + cells > n) return null;
    const sum = [0, 0, 0];
    for (let j = j0; j < j0 + cells; j++) for (let i = i0; i < i0 + cells; i++) {
      const o = (j * n + i) * 4;
      sum[0] += texture.image.data[o]; sum[1] += texture.image.data[o + 1]; sum[2] += texture.image.data[o + 2];
    }
    return sum.map(v => v / (cells * cells));
  };
  const fromSrgbByte = b => { const v = b / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  fill(tint.far, (x, z) => {
    const near = nearBox(x, z);
    if (near) return near.map(fromSrgbByte);
    const h = H(x, z);
    if (h < 0.5) return SEA_TINT;
    const sl = Math.hypot(H(x + GROUND_TINT_FAR.dx, z) - h, H(x, z + GROUND_TINT_FAR.dx) - h) / GROUND_TINT_FAR.dx;
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
    return base;
  });
  stats.tintMs = Math.round(performance.now() - started);
}

async function buildTerrain(R, hole, withDetail) {
  const nx = Math.round((R.x1 - R.x0) / R.dx) + 1, nz = Math.round((R.z1 - R.z0) / R.dx) + 1;
  const atlasOwnsSurfaceEdges = groundMode === 'atlas' && groundAtlas && R === CORE;
  const pos = [], col = [], det = [], bmp = [], gls = [], str = [], mow = [], aoArr = [], idx = [];
  const map = new Int32Array(nx * nz).fill(-1);
  const heights = new Float32Array(nx * nz);
  heights.fill(NaN);
  let skippedBasePoints = 0;
  const hx0 = hole ? hole.x0 : 0, hx1 = hole ? hole.x1 : 0, hz0 = hole ? hole.z0 : 0, hz1 = hole ? hole.z1 : 0;
  const inHole = (x, z) => hole && x > hx0 + 1e-6 && x < hx1 - 1e-6 && z > hz0 + 1e-6 && z < hz1 - 1e-6;

  for (let j = 0; j < nz; j++) {
    if (shouldYieldWork()) await yieldWork();
    for (let i = 0; i < nx; i++) {
    const x = R.x0 + i * R.dx, z = R.z0 + j * R.dx;
    if (inHole(x, z)) { skippedBasePoints++; continue; }
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
  g.userData.legacyBaseGrid = Object.freeze({
    nx,
    nz,
    totalBasePoints: nx * nz,
    emittedBasePoints: nx * nz - skippedBasePoints,
    skippedBasePoints,
  });
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
  span('ground atlas (1 m, CORE)', atlasStarted);
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
  m.polygonOffsetFactor = DEPTH_SIGN * tier;
  m.polygonOffsetUnits = DEPTH_SIGN * tier * 2;
  return m;
};
const DETAIL_MASK = buildDetailMask(CORE);

/* CPU validation cannot prove that TSL compiled for the selected backend. Draw
   the complete batch once into a tiny offscreen target before allowing the
   legacy builder to omit anything. The mesh is not frustum culled, so all 16
   texture layers and the real material pipeline are submitted. */
async function preflightTerrainPreviewGpu(batch) {
  const target = new THREE.RenderTarget(4, 4, {
    depthBuffer: true,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    samples: 1,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previousTarget = renderer.getRenderTarget();
  const previousShaderError = renderer.debug.onShaderError;
  const previousConsoleError = console.error;
  const device = renderer.backend?.device;
  const backendErrors = [];
  let errorScopePushed = false;
  let preflightError = null;
  let groupInstalled = false;
  try {
    /* Three r185 deliberately catches an asynchronous WebGPU pipeline error,
       logs it, marks the pipeline unusable and resolves compileAsync. The
       backend also owns a nested validation scope, so our outer scope cannot
       observe that error. Capture this bounded preflight's error channel as a
       second, fail-closed signal; otherwise the following draw is silently
       skipped and legacy CORE could be omitted without a working replacement. */
    console.error = (...details) => {
      if (backendErrors.length === 0) {
        backendErrors.push(details.map(detail => detail instanceof Error
          ? detail.message
          : String(detail)).join(' ').slice(0, 300));
      }
      previousConsoleError.apply(console, details);
    };
    renderer.debug.onShaderError = (...details) => {
      previousShaderError?.(...details);
      throw new Error('v2 terrain WebGL shader failed backend preflight');
    };
    scene.add(batch.group);
    groupInstalled = true;
    if (device?.pushErrorScope) {
      device.pushErrorScope('validation');
      errorScopePushed = true;
    }
    await renderer.compileAsync(batch.group, camera, scene);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    await waitForSubmittedGpuWork();
    const gl = renderer.backend?.gl;
    if (gl?.getError) {
      const glError = gl.getError();
      if (glError !== gl.NO_ERROR) {
        throw new Error(`v2 terrain WebGL preflight failed with GL error ${glError}`);
      }
    }
    if (errorScopePushed) {
      errorScopePushed = false;
      const gpuError = await device.popErrorScope();
      if (gpuError) throw new Error(`v2 terrain WebGPU preflight failed: ${gpuError.message}`);
    }
    if (backendErrors.length > 0) {
      throw new Error(`v2 terrain backend preflight logged an error: ${backendErrors[0]}`);
    }
  } catch (error) {
    preflightError = error;
  } finally {
    /* Restore every synchronous hook/resource before the only asynchronous
       cleanup. A rejected popErrorScope must not leave console interception,
       the offscreen target or the temporary group installed. */
    try { console.error = previousConsoleError; } catch (error) { preflightError ||= error; }
    try { renderer.debug.onShaderError = previousShaderError; } catch (error) { preflightError ||= error; }
    if (groupInstalled) {
      try { batch.group.removeFromParent(); } catch (error) { preflightError ||= error; }
    }
    try { renderer.setRenderTarget(previousTarget); } catch (error) { preflightError ||= error; }
    try { target.dispose(); } catch (error) { preflightError ||= error; }
    /* The offscreen proof is not an application frame. Leaving its draw in
       renderer.info makes the first visible-frame telemetry over-report. */
    try { renderer.info?.reset?.(); } catch (error) { preflightError ||= error; }
    if (errorScopePushed) {
      errorScopePushed = false;
      try { await device.popErrorScope(); } catch (error) { preflightError ||= error; }
    }
  }
  if (preflightError) throw preflightError;
}

/* Do not omit a single legacy vertex until the complete, material-decorated
   v2 frontier has proved that it can be installed as one draw. */
/* A published graph that reaches past the course window -- nested rings of
   Lantmäteriet data to a 16 km root -- becomes the ONLY terrain: the streaming
   runtime draws it in the pilot's bridge and the legacy CORE, MID and FAR
   rings are never built, so there is no seam between two sources anywhere.
   The pilot source still supplies its 1 m sampler and the surface atlas.
   Loaded dynamically so a flagless visit never downloads it. */
const BOOTQ_TILEGRACE = new URLSearchParams(location.search).get('tilegrace');
if (V2_WORLD) {
  terrainV2.configure({
    backend: IS_GPU ? 'webgpu' : 'webgl2',
    mobile: LOWQ,
    /* the pilot's course window took 64 tiles in one draw; a world of rings
       refines the course to 1 m AND keeps the horizon resident */
    profile: { targetErrorPixels: IS_GPU ? 1 : 1.5, maximumSelectedTiles: LOWQ ? 56 : 128 },
    /* ?tilegrace=<ms>: how long an unwanted tile stays resident (0 is the before: released on the next plan, its coarse parent drawn while it loads again) */
    releaseGraceMilliseconds: Number.isFinite(parseInt(BOOTQ_TILEGRACE, 10)) ? parseInt(BOOTQ_TILEGRACE, 10) : undefined,
  });
}
/* Every v2 height frontier has vertex-colour-free BVCH terrain and therefore
   needs the same procedural ground tint. The fixed Ribbingsfors frontier does
   not cover the horizon, but its 1 m CORE still must not become flat C.rough;
   fillGroundTintTextures falls back to the compatibility DEM outside the
   frontier's own sampler. */
const GROUND_TINT = TERRAIN_PREVIEW.ready ? createGroundTintTextures() : null;
if (TERRAIN_PREVIEW.ready) {
  /* Low-quality WebGL2 keeps exact 1 m CPU sampling but submits every second
     source vertex. Both frontiers must still preflight as the same 16 tiles
     and one logical draw before legacy construction can omit anything. */
  const renderStride = !IS_GPU && LOWQ ? 2 : 1;
  const prepareStarted = performance.now();
  const preparation = await terrainV2.prepare({
    coreGrid: CORE,
    renderStride,
    decorateMaterial: createV2GroundMaterialDecorator({
      atlas: TERRAIN_PREVIEW.surfaceAtlas || groundAtlas, DETAIL, C, SHADE,
      debugMode: surfaceDebugMode,
      tint: GROUND_TINT,
    }),
    legacySurfaceAtlas: TERRAIN_PREVIEW.surfacePolicy === 'legacy-ground-atlas'
      ? groundAtlas
      : null,
    preflight: preflightTerrainPreviewGpu,
    /* the coarse pyramid covers the world within a few tiles; the fine
       frontier streams in behind the rest of the boot and is awaited before
       'klar', so the first frame is the same and the wait overlaps the work */
    settle: 'coverage',
  });
  span('v2 prepare (worker, first frontier coverage, preflight)', prepareStarted);
  if (preparation.ok && GROUND_TINT) {
    const tintStarted = performance.now();
    fillGroundTintTextures(GROUND_TINT, (x, z) => terrainV2.constructionHeightAt(x, z));
    span('ground tint rasters (near 6 m + far 24 m)', tintStarted);
  }
  if (!preparation.ok) {
    const failure = terrainV2.rendererState;
    /* ?v2=require means diagnose, never mask: refuse to present the GPK1
       rebuild as if the required v2 terrain were serving. */
    if (V2_SELECTION.require) {
      throw new Error(`v2 krävdes men terrängpreflighten föll tillbaka: ${failure.error}`);
    }
    if (terrainPreviewBadge) terrainPreviewBadge.dataset.error = failure.error;
    console.warn('Puttom 1 m terrain preflight fell back to the full GPK1 mesh:', failure.error);
    setTerrainPreviewBadge(IS_GPU ? 'WebGPU' : 'WebGL2', 'failed');
  }
}

const makeCoreMesh = geometry => {
  const mesh = new THREE.Mesh(geometry, turfMat);
  mesh.userData.tag = 'core';
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
};
const coreStatsBefore = Object.freeze({ verts: stats.verts, tris: stats.tris });
let coreGeometry = null;
let coreMesh = null;
if (V2_VEGETATION_LOADING) {
  try {
    const vegWaitStarted = performance.now();
    V2_VEGETATION = await V2_VEGETATION_LOADING;
    span('v2 vegetation: wait for chunk load', vegWaitStarted);
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 300);
    if (V2_SELECTION.require) throw new Error(`v2 krävdes men vegetationslagren kunde inte verifieras: ${detail}`);
    V2_VEGETATION_ERROR = detail;
  }
}
if (terrainV2.preparation) {
  try {
    if (terrainV2.kind === 'graph') {
      /* the world adapter draws everything; no legacy ground is built at all */
      builtTerrain.core = null;
      scene.add(terrainV2.group);
      const terrainWorldRender = terrainV2.activate();
      setTerrainPreviewBadge(IS_GPU ? 'WebGPU' : 'WebGL2', 'ready', terrainWorldRender.meshResolutionMetres);
    } else {
    const terrainPreviewPrepared = terrainV2.preparation;
    /* The 8 m legacy guard participates in normal generation, then the existing
       full-preview clip hides it before the v2 batch is installed. */
    coreGeometry = await buildTerrain(CORE, terrainPreviewPrepared.plan.innerBounds, true);
    const legacyBuild = coreGeometry.userData.legacyBaseGrid;
    const cut = cutTerrainPreviewRect(
      coreGeometry, TERRAIN_PREVIEW.bounds, TERRAIN_PREVIEW.bridge,
    );
    stats.tris -= cut.removedTriangles;
    coreMesh = makeCoreMesh(coreGeometry);
    applyV2BridgeTransform(terrainV2.group, TERRAIN_PREVIEW.bridge);
    scene.add(coreMesh, terrainV2.group);
    const terrainPreviewRender = terrainV2.activate({ legacyBuild, cut });
    setTerrainPreviewBadge(
      IS_GPU ? 'WebGPU' : 'WebGL2', 'ready',
      terrainPreviewRender.meshResolutionMetres,
    );
    }
  } catch (error) {
    terrainV2.fail(error);
    coreMesh?.removeFromParent();
    coreGeometry?.dispose();
    coreMesh = null;
    coreGeometry = null;
    stats.verts = coreStatsBefore.verts;
    stats.tris = coreStatsBefore.tris;
    builtTerrain.core = null;
    /* Under ?v2=require the transaction still rolls back, but the GPK1 rebuild
       must not happen: required v2 that cannot install is a boot error. */
    if (V2_SELECTION.require) {
      throw new Error(`v2 krävdes men terränginstallationen föll tillbaka: ${String(error?.message || error).slice(0, 300)}`);
    }
    coreGeometry = await buildTerrain(CORE, null, true);
    coreMesh = makeCoreMesh(coreGeometry);
    scene.add(coreMesh);
    const terrainPreviewRender = terrainV2.confirmFallbackRebuilt();
    if (terrainPreviewBadge) terrainPreviewBadge.dataset.error = terrainPreviewRender.error;
    console.warn('Puttom 1 m terrain renderer rebuilt the full GPK1 mesh:', error);
    setTerrainPreviewBadge(IS_GPU ? 'WebGPU' : 'WebGL2', 'failed');
  }
} else {
  coreGeometry = await buildTerrain(CORE, null, true);
  coreMesh = makeCoreMesh(coreGeometry);
  scene.add(coreMesh);
}

await tick('bygger terrängen', 0.26);
/* MID's hole is normally CORE's footprint, because CORE is what covers the
   middle. The wide v2 frontier reaches PAST CORE, so when it is serving, MID
   must open its hole to the pilot instead or the 12 m mesh surfaces through the
   1 m one. The hole is the pilot's inscribed axis-aligned rectangle, since that
   is all buildTerrain can omit; the rotation overhang beyond it is removed the
   same way it is from CORE, by the rotated triangle cut. */
if (terrainV2.kind === 'graph' && terrainV2.active) {
  /* the world graph carries the middle and the horizon; nothing Terrarium is drawn */
  await tick('bygger horisonten', 0.34);
} else {
const midHole = terrainV2.active && TERRAIN_PREVIEW.legacyBounds
  ? under(TERRAIN_PREVIEW.legacyBounds, 24)
  : under(CORE, 24);
const midGeometry = await buildTerrain(MIDR, midHole, true);
if (terrainV2.active && TERRAIN_PREVIEW.legacyBounds) {
  stats.tris -= cutTerrainPreviewRect(midGeometry, TERRAIN_PREVIEW.bounds, TERRAIN_PREVIEW.bridge).removedTriangles;
}
const midMesh = new THREE.Mesh(midGeometry, turfMat);
midMesh.userData.tag = 'mid';
midMesh.receiveShadow = true;
scene.add(midMesh);

await tick('bygger horisonten', 0.34);
const farMesh = new THREE.Mesh(await buildTerrain(FARR, under(MIDR, 72), false), turfMat);
farMesh.userData.tag = 'far';
scene.add(farMesh);
}

/* Place the v2 batch in the legacy world. The tiles are cut on the EPSG:3006
   grid, whose north is 3.5 degrees off the legacy frame's true north here, and
   whose metre differs from the legacy frame's by a few parts in ten thousand --
   see engine/geodetic-frame.mjs. Composed as scale-after-rotation, which a
   Group's own T*R*S cannot express when the scale is anisotropic. */
function applyV2BridgeTransform(group, bridge) {
  if (!group) return;
  if (!Number.isFinite(bridge?.rotationRadians) || !Number.isFinite(bridge?.scaleX) ||
      !Number.isFinite(bridge?.scaleZ)) {
    throw new TypeError('the v2 terrain group needs the legacy grid bridge');
  }
  const cos = Math.cos(bridge.rotationRadians), sin = Math.sin(bridge.rotationRadians);
  group.matrix.set(
    bridge.scaleX * cos, 0, -bridge.scaleX * sin, 0,
    0, 1, 0, 0,
    bridge.scaleZ * sin, 0, bridge.scaleZ * cos, 0,
    0, 0, 0, 1,
  );
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
}

/* Replace only the part of the legacy core for which all 16 verified 1 m tiles
   exist. Triangles outside that pilot remain the seamless GPK1 fallback;
   boundary skirts on the BVCH topology seal the sub-grid cut. */
function cutTerrainPreviewRect(geometry, bounds, bridge) {
  const position = geometry.getAttribute('position');
  const source = geometry.getIndex()?.array;
  if (!position || !source || !bounds) return Object.freeze({ removedTriangles: 0 });
  if (typeof bridge?.toGrid !== 'function') throw new TypeError('the v2 cut needs the legacy grid bridge');
  const retained = new source.constructor(source.length);
  let write = 0, removedTriangles = 0;
  for (let index = 0; index < source.length; index += 3) {
    const a = source[index], b = source[index + 1], c = source[index + 2];
    /* `bounds` is the v2 grid rectangle, so the test runs in grid space: the
       removed region is then exactly the rotated footprint the batch covers,
       with no corner left doubled and none left bare. */
    const [x, z] = bridge.toGrid(
      (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
      (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3,
    );
    if (x > bounds.x0 && x < bounds.x1 && z > bounds.z0 && z < bounds.z1) {
      removedTriangles++;
      continue;
    }
    retained[write++] = a; retained[write++] = b; retained[write++] = c;
  }
  geometry.setIndex(new THREE.BufferAttribute(retained.slice(0, write), 1));
  return Object.freeze({ removedTriangles });
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
  for (const surface of rings) {
    const providedRings = !Array.isArray(surface) && surface.rings;
    const ring0 = providedRings ? providedRings[0] : Array.isArray(surface) ? surface : surface.ring;
    // Source rings must not receive a second Chaikin pass in legacy overlays.
    // Explicit polygon holes and per-surface shade overrides remain intact.
    const exactRings = providedRings || (M.infra.preserveMappedBoundaries === true ? [ring0] : null);
    const surfaceShade = Array.isArray(surface) ? shade : (surface.shade || shade);
    if (ring0.length < 3) continue;
    const ring = exactRings ? ring0 : chaikin(ring0);
    const polygon = exactRings || [ring];
    const faces = exactRings
      ? THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(...p)), polygon.slice(1).map(r => r.map(p => new THREE.Vector2(...p))))
      : triangulate(ring);
    if (!faces.length) continue;
    const { V, F } = subdivide(polygon.flat(), faces, maxEdge);
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
      const g = surfaceShade ? surfaceShade(x, z, h) : groundAt(x, z, h);
      const ao = horizonAO(x, z, h);
      /* the rim seals: a boundary vertex tucks below the terrain instead of
         floating a lift above it, so a grazing view never sees the dark gap
         under the overlay's edge -- the same lesson as the LoD skirts */
      const bd = exactRings ? polygon.some(r => Math.abs(ringSD(x, z, r)) < 0.05) : ringSD(x, z, ring) > -0.05;
      // Physical mats keep their entire measured footprint above the pad. Turf
      // overlays still bury the rim to seal their edge against the terrain.
      pos.push(x, bd && !surface.raisedBoundary ? meshH(x, z) - 0.06 : h + lift, z);
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

const legacySurfaceOverlays = shouldRenderLegacySurfaceOverlays({
  groundMode,
  v2Active: terrainV2.active,
});
if (legacySurfaceOverlays) {
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
    m.userData.tag = 'legacy-surface-overlay';
    scene.add(m);
    stats.draws++;
    stats.surfaceOverlays++;
  };
  /* Batch by mower tier, not by hole. These are the original curved rings, but
     six course-wide meshes keep their cost bounded to six draw calls. */
  const semi = [], fair = [], collar = [], green = [], tee = [], sand = [];
  for (const h of HOLES) {
    const semiShade = shadeSemi(h), fairShade = shadeFair(h);
    for (const ring of h.fairway.rings) {
      semi.push({ ring: offsetRing(ring, 4.5), shade: semiShade });
      fair.push({ ring, shade: fairShade });
    }
    const collarShade = shadeCollar(h);
    collar.push({ ring: offsetRing(h.green.ring, 3.2), shade: collarShade });
    green.push({ ring: h.green.ring, shade: shadeGreen(h) });
    const teeShade = shadeTee();
    for (const pad of h.tees.pads) {
      collar.push({ ring: offsetRing(pad.ring, 2.2), shade: collarShade });
      tee.push(pad.preserveTerrain ? { rings: [pad.ring], shade: teeShade } : { ring: pad.ring, shade: teeShade });
    }
    for (const bunker of h.bunkers) {
      sand.push({ ring: M.infra.preserveMappedBoundaries ? bunker.ring : offsetRing(bunker.ring, 0.5), shade: shadeSand });
    }
  }
  const quietFair = shadeFair(null);
  const sceneryFairShade = (x, z) => ({ ...quietFair(x, z), str: 0.35, mowK: 0 });
  for (const ring of M.scenery.fairways.concat(M.scenery.range)) {
    fair.push({ ring, shade: sceneryFairShade });
  }
  for (const ring of M.scenery.greens) green.push({ ring, shade: shadeGreen(null) });
  for (const ring of M.scenery.tees) tee.push({ ring, shade: shadeTee() });
  for (const ring of M.scenery.bunkers.concat(M.veg.sand)) {
    sand.push({ ring: M.infra.preserveMappedBoundaries ? ring : offsetRing(ring, 0.5), shade: shadeSand });
  }
  /* laid in the order a mower would: the widest cut first, the tightest last */
  add(semi, 0.018, 5.5, null, 1);
  add(fair, 0.036, 3.6, null, 2);
  add(collar, 0.052, 2.2, null, 3);
  add(green, 0.072, 1.4, null, 4);
  add(tee, 0.086, 2.0, null, 4);
  add(sand, 0.035, 1.8, null, 5, sandMat, true);
}

/* Dated facility footprints retain corners and interior exclusions. Mats
   are individually mapped objects; the surrounding platform is a separate surface. */
{
  const groups = new Map();
  for (const feature of M.scenery.mappedFeatures || []) {
    if (!feature.rings?.[0]?.length) continue;
    const inAtlas = feature.kind === 'practice_green' || feature.kind === 'range_bunker' || feature.kind === 'practice_bunker' || (feature.kind === 'range_tee_pad' && feature.material === 'unverified-turf-surface');
    if (inAtlas && !legacySurfaceOverlays) continue;
    const group = groups.get(feature.kind) || [];
    group.push({ rings: feature.rings, raisedBoundary: feature.kind === 'range_mat',
      shade: feature.material === 'mixed-hardstanding-and-mats'
        ? () => ({ col: C.hard.slice(), det: 1, bmp: 0.1, gls: 0.12, str: 0 }) : undefined });
    groups.set(feature.kind, group);
  }
  for (const [kind, polygons] of groups) {
    const isSand = kind === 'range_bunker' || kind === 'practice_bunker';
    const isMat = kind === 'range_mat';
    const shade = kind === 'practice_green' ? shadeGreen(null)
      : isSand ? shadeSand
        : isMat ? () => ({ col: L(0x43675a), det: 2.4, bmp: 0.04, gls: 0.1, str: 0 })
          : kind === 'range_tee_pad' ? shadeTee()
            : () => ({ col: kind === 'range_target_surface' ? [0.62, 0.62, 0.58] : C.hard.slice(), det: 1, bmp: 0.1, gls: 0.12, str: 0 });
    // The 3.5 cm separation from the platform is a rendering estimate, not a
    // surveyed mat thickness. Keep the exact quad; never sink its boundary.
    const g = surfaceMesh(polygons, isMat ? 0.12 : 0.085, isMat ? 0.5 : 1.0, shade, false);
    if (!g) continue;
    const order = isMat ? 7 : 6;
    const mesh = new THREE.Mesh(g, isSand ? nudged(order, makeSand) : nudged(order));
    mesh.receiveShadow = true; mesh.renderOrder = order;
    const turfOverlay = kind === 'practice_green' || isSand || (kind === 'range_tee_pad' && polygons.some(p => !p.shade));
    mesh.userData.tag = turfOverlay ? 'legacy-surface-overlay' : 'mapped-facility-footprint';
    if (turfOverlay) stats.surfaceOverlays++;
    if (isMat) mesh.userData.verticalPlacement = 'estimated rendering offset; mat thickness unmeasured';
    scene.add(mesh); stats.draws++;
  }
}

/* Parking keeps observed paving and polygon boundaries. Grounds with a
   mapped-only object inventory do not synthesize parked cars or heater posts. */
const carSpots = [];
{
  const lots = (M.infra.parking || []).filter(p => p.ring && p.ring.length >= 3);
  if (groundMode !== 'atlas' && lots.length) {
    const parkingShade = (x, z) => {
      const n = fbm(x * 0.2, z * 0.2, 2);
      return { col: C.hard.map(v => v * (0.95 + n * 0.09)), det: 2.6, bmp: 0.4, gls: 0.12, str: 0 };
    };
    const asphaltShade = (x, z) => {
      const n = fbm(x * 0.2, z * 0.2, 2);
      return { col: L(0x626668).map(v => v * (0.96 + n * 0.06)), det: 1.3, bmp: 0.08, gls: 0.1, str: 0 };
    };
    const g = surfaceMesh(lots.map(p => ({
      ...(p.prov === 'dated-orthophoto-trace' ? { rings: [p.ring] } : { ring: p.ring }),
      shade: /\b(asphalt|paved)\b/i.test(p.surface || '') ? asphaltShade : parkingShade,
    })), 0.045, 4.0, parkingShade);
    if (g) {
      const m = new THREE.Mesh(g, nudged(3));
      m.receiveShadow = true; m.renderOrder = 3;
      scene.add(m);
      stats.draws++;
    }
  }
  const posts = [];
  for (const p of lots) {
    /* an entrance square is gravel without cars, and a motorhome lot gets its
       motorhomes from the scenery batch instead of cars */
    if (M.infra.objectPlacement === 'mapped-only' || p.cars === false || p.vehicles === 'motorhome') continue;
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
    if (M.infra.objectPlacement === 'mapped-only' || r.kind !== 'trunk' || !r.oneway) continue;
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
    /* the verge feathers a road into the legacy 4 m terrain; a toned gravel
       run on the 1 m ground needs only a narrow pale shoulder, and the wide
       ground-coloured verge darkened by the terrain's ambient term was the
       "dark road" seen either side of the pale one */
    const vw = run.tone && !asphalt ? 0.7 : 2.2;
    const OFF = [-run.w - vw, -run.w, 0, run.w, run.w + vw];
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
        if (verge && run.tone && !asphalt) {
          cc = run.tone.map(v => v * 0.98);
        } else if (verge) {
          const g = groundAt(x, z, h);
          cc = g.col.map((v, k2) => lerp(v, C.hard[k2], 0.3) * ao);
        } else if (asphalt) {
          const n2 = fbm(x * 0.09, z * 0.09, 2);
          cc = run.tone.map(v => v * (1 + n2 * 0.10) * ao);
        } else if (run.tone) {
          /* compacted gravel is the palest ground there is, and it is never
             occluded the way turf under a bank is: measured in evening light
             the road rendered darker than the grass beside it (52 against 78)
             with the terrain's ambient term on it, so a toned gravel run
             takes no AO and sits a shade above the lots it joins */
          const n2 = fbm(x * 0.22, z * 0.22, 2);
          /* the lots are painted with this same colour, flat: the road must
             read as the same gravel, so no lift and only the grain */
          cc = run.tone.map(v => v * (0.97 + n2 * 0.06));
        } else {
          const n2 = fbm(x * 0.22, z * 0.22, 2);
          cc = C.path.map(v => v * (0.94 + n2 * 0.10) * ao);
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

/* Compacted gravel: matte, its vertex colour with a faint grain, nothing
   else. The gravel ribbons used to borrow the turf shader -- grass detail,
   bump and stripes over a grey vertex colour -- and came out a dark brown
   that never matched the lots, which the ground material paints flat. */
function makeGravel() {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const dt = texture(DETAIL, positionWorld.xz.mul(0.31)).g.sub(0.5);
  m.colorNode = attribute('color', 'vec3').mul(dt.mul(0.16).add(1));
  return m;
}

{
  const asphaltRuns = [], gravelRuns = [], dirtRuns = [];
  /* Near the course the ground material paints every road's band itself, in
     the same flat gravel as the lots, so a gravel road there gets NO ribbon:
     a ribbon over a painted band is a second road in a second shade. The
     ribbon remains for the stretch beyond the ground's coverage -- the v2
     surface layer where it is loaded, the boot atlas otherwise -- and a road
     that crosses the edge keeps one point inside so the two meet. */
  const painted = (x, z) => TERRAIN_PREVIEW.surfaceAtlas
    ? TERRAIN_PREVIEW.surfaceAtlas.probeAt(x, z)?.inBounds === true
    : (groundMode === 'atlas' && !!groundAtlas?.contains(x, z));
  const unpaintedRuns = line => {
    const flags = line.map(([x, z]) => painted(x, z));
    if (flags.every(Boolean)) return [];
    if (!flags.some(Boolean)) return [line];
    const runs = [];
    let run = [];
    for (let i = 0; i < line.length; i++) {
      if (!flags[i]) {
        if (!run.length && i > 0) run.push(line[i - 1]);   /* one painted point, so the ribbon reaches the band */
        run.push(line[i]);
      } else if (run.length) {
        run.push(line[i]);
        if (run.length >= 2) runs.push(run);
        run = [];
      }
    }
    if (run.length >= 2) runs.push(run);
    return runs;
  };
  for (const r of M.infra.roads) {
    const surf = r.surface || 'asphalt';
    if (r.kind === 'trunk') {
      /* the E4: paired one-way roadbeds of the 2+1, one wide bed east of Ås */
      const w = r.oneway ? (r.lanes >= 2 ? 3.9 : 2.6) : 5.0;
      asphaltRuns.push({ line: r.line, w, paint: (!r.oneway || r.lanes >= 2) ? 2 : 1, lift: 0.16, tone: C.aspT });
    } else if (r.kind === 'secondary' || r.kind === 'tertiary') {
      asphaltRuns.push({ line: r.line, w: 3.2, paint: 2, lift: 0.14, tone: C.aspL });
    } else if (/gravel|ground|dirt|unpaved|compacted/.test(surf)) {
      /* a gravel road is pale compacted grit, not the brown of a trodden path */
      for (const line of unpaintedRuns(r.line)) gravelRuns.push({ line, w: 2.2, lift: 0.12, tone: C.hard });
    } else {
      asphaltRuns.push({ line: r.line, w: 2.7, paint: 0, lift: 0.12, tone: C.aspL });
    }
  }
  if (groundMode !== 'atlas') {
    for (const t of M.infra.tracks) {
      if (/asphalt|paved/.test(t.surface || '')) asphaltRuns.push({ line: t.line, w: 1.9, paint: 0, lift: 0.10, tone: C.aspL });
      else gravelRuns.push({ line: t.line, w: t.kind === 'service' ? 1.9 : 1.7, lift: t.kind === 'service' ? 0.10 : 0.08, tone: t.kind === 'service' ? C.hard : undefined });
    }
    for (const p of M.infra.paths) {
      if (p.kind === 'cycleway' || /asphalt|paved/.test(p.surface || ''))
        asphaltRuns.push({ line: p.line, w: 1.3, paint: 0, lift: 0.07, tone: C.aspL });
      /* a gravel cart path is a metre and a half of compacted gravel, not a
         trodden line: the traced paths say so, and OSM's do where tagged */
      else if (/gravel|compacted|pebble/.test(p.surface || ''))
        gravelRuns.push({ line: p.line, w: 1.6, lift: 0.08, tone: C.hard.map((v, k) => lerp(v, C.path[k], 0.35)) });
      else dirtRuns.push({ line: p.line, w: 0.55, lift: 0.06, tone: C.soil });
    }
  }
  const asphaltMat = nudged(2, makeAsphalt);
  const gravelMat = nudged(2, makeGravel);
  /* the dirt ribbons share the terrain's own material, nudged so on a
     shallow depth buffer the ground does not fight straight through them */
  const ribbonTurf = nudged(2);
  for (const [runs, asphalt, mat] of [[asphaltRuns, true, asphaltMat],
                                      [gravelRuns, false, gravelMat],
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
/* probe gains: the sun glint and the fine chop, each 1 unless a harness turns it down (V3D.water) */
const uWaterGlint = uniform(1), uWaterChop = uniform(1);
function makeWater({ mask = null } = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
  /* A sheet sits a quarter-metre over a bed the DTM draws at the water's own
     surface, and three kilometres out a 24-bit depth buffer cannot tell the
     two apart: the lake flickered. A depth bias toward the camera settles it
     without moving the sheet. */
  m.polygonOffset = true;
  m.polygonOffsetFactor = DEPTH_SIGN * 1;
  m.polygonOffsetUnits = DEPTH_SIGN * 2;
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
  const ripple = n1.mul(near.mul(0.45).add(0.30)).add(n3.mul(near.mul(0.30).add(0.16))).mul(uWaterChop)
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
  c = c.add(color(0xfff2da).mul(pow(saturate(N.dot(H)), 260).mul(3.6)).mul(uWaterGlint));
  c = c.add(color(0xdff0f6).mul(pow(saturate(N.dot(H)), 22).mul(0.34)).mul(uWaterGlint));
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
  let opacity = mix(mix(float(0.86), float(0.97), depth),
                    mix(float(0.62), float(0.97), depth), aFoam)
                  .add(foam.mul(0.2)).sub(bed.mul(0.28)).clamp(0.4, 1);
  if (mask) {
    /* the sheet over water the ground found: its extent is the mask, read in
       the tile lattice's own space through the bridge's linear part */
    const g = mask.toGrid;
    const gx = wp.x.mul(g[0]).add(wp.y.mul(g[1]));
    const gz = wp.x.mul(g[2]).add(wp.y.mul(g[3]));
    const uvMask = vec2(gx.sub(float(mask.x0)).div(mask.width * mask.spacing), gz.sub(float(mask.z0)).div(mask.height * mask.spacing));
    const inMask = step(0, uvMask.x).mul(step(uvMask.x, 1)).mul(step(0, uvMask.y)).mul(step(uvMask.y, 1));
    opacity = opacity.mul(texture(mask.texture, uvMask).r).mul(inMask);
    /* the quad spans the component's whole box and is clear where the mask is
       zero, but a clear fragment still writes depth: over a lake the model
       draws, this sheet stood 15 cm above the ring's and hid it, so the carved
       bed showed through as a brown lake. It writes no depth at all. */
    m.depthWrite = false;
  }
  m.opacityNode = opacity;
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
  m.userData.tag = 'water';
  m.userData.water = w;
  scene.add(m);
  WATER_MESHES.push(m);
  stats.draws++;
}

/* THE WATER THE GROUND FOUND. The extract's rings stop at its bounding box
   and miss the lakes beyond it; the flats the 4 m ring detected carry on
   from there. One sheet per flat, a quad over its footprint at its level,
   drawn only where the mask says water and no ring already draws -- so a
   lake cut straight by the box continues at the ring's own level, and a
   lake the pack never had gets its surface back. */
const FLAT_WATER = terrainV2.flatWater ?? null;
if (FLAT_WATER?.components.some(c => c.uncoveredCells > 0)) {
  const bridge = TERRAIN_PREVIEW.bridge;
  const [ax, cx] = bridge.toGrid(1, 0), [bx, dx] = bridge.toGrid(0, 1); /* gx = ax·x + bx·z, gz = cx·x + dx·z */
  const maskTexture = new THREE.DataTexture(FLAT_WATER.mask, FLAT_WATER.width, FLAT_WATER.height, THREE.RedFormat, THREE.UnsignedByteType);
  maskTexture.minFilter = THREE.LinearFilter;
  maskTexture.magFilter = THREE.LinearFilter;
  maskTexture.wrapS = THREE.ClampToEdgeWrapping;
  maskTexture.wrapT = THREE.ClampToEdgeWrapping;
  maskTexture.generateMipmaps = false;
  maskTexture.flipY = false;
  maskTexture.needsUpdate = true;
  const flatMat = makeWater({ mask: {
    texture: maskTexture, toGrid: [ax, bx, cx, dx],
    x0: FLAT_WATER.x0, z0: FLAT_WATER.z0, width: FLAT_WATER.width, height: FLAT_WATER.height, spacing: FLAT_WATER.spacing,
  } });
  const pos = [], sh = [], fm = [], dp = [], idx = [];
  let sheets = 0;
  for (const c of FLAT_WATER.components) {
    if (c.uncoveredCells === 0) continue;
    /* meeting a modelled body at ITS level, so the two sheets are one plane */
    const y = c.knownCells > 0 ? c.level : c.level + 0.15;
    const corners = [[c.bounds.x0, c.bounds.z0], [c.bounds.x1, c.bounds.z0], [c.bounds.x1, c.bounds.z1], [c.bounds.x0, c.bounds.z1]];
    const base = pos.length / 3;
    for (const [gx, gz] of corners) {
      const [lx, lz] = bridge.toLegacy(gx, gz);
      pos.push(lx, y, lz); sh.push(40); fm.push(1); dp.push(3);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    sheets++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(sh, 1));
  g.setAttribute('aFoam', new THREE.Float32BufferAttribute(fm, 1));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dp, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, flatMat);
  m.renderOrder = 6;
  m.userData.tag = 'water-flat';
  scene.add(m);
  WATER_MESHES.push(m);
  stats.draws++;
  stats.flatWaterSheets = sheets;
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

/* Confirmed bridge decks use their observed footprints and end axes. Only the
   horizontal geometry is mapped: elevation, deck thickness and the neutral
   material below are rendering estimates. Unmeasured rails are left undetailed. */
{
  const V = [], K = [], rendered = [];
  const topColour = L(0x8a8b86), sideColour = L(0x666964);
  const tri = (a, b, c, col) => { V.push(...a, ...b, ...c); K.push(...col, ...col, ...col); };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  for (const bridge of M.infra.bridges || []) {
    const ring = bridge.ring, axis = bridge.line;
    if (!ring || ring.length < 3 || !axis || axis.length < 2) continue;
    const a = axis[0], b = axis[axis.length - 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
    if (length2 < 0.01) continue;
    const length = Math.sqrt(length2), ux = dx / length, uz = dz / length;
    // Sample the visible deck ends and a short approach beyond each end, so a
    // water-carved centre cell cannot pull the deck down into the channel bed.
    const ha = Math.max(meshH(...a), meshH(a[0] - ux * 0.8, a[1] - uz * 0.8)) + 0.10;
    const hb = Math.max(meshH(...b), meshH(b[0] + ux * 0.8, b[1] + uz * 0.8)) + 0.10;
    if (!Number.isFinite(ha) || !Number.isFinite(hb)) continue;
    const point = ([x, z], drop = 0) => {
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2));
      return [x, ha + (hb - ha) * t - drop, z];
    };
    const faces = triangulate(ring);
    if (!faces.length) continue;
    for (const [i, j, k] of faces) tri(point(ring[i]), point(ring[k]), point(ring[j]), topColour);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      quad(point(p, 0.18), point(q, 0.18), point(q), point(p), sideColour);
    }
    rendered.push({ id: bridge.id, railsObserved: bridge.railsObserved === true,
      verticalDimensions: 'estimated', deckThicknessM: 0.18, approachLiftM: 0.10,
      elevationSource: 'rendered terrain sampled at visible deck ends and approaches',
      material: 'neutral rendering material; physical deck material unverified' });
  }
  if (V.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(K, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide,
    }));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.renderOrder = 7;
    mesh.userData = { tag: 'mapped-bridge-footprints', features: rendered };
    scene.add(mesh); stats.draws++;
    stats.verts += V.length / 3; stats.tris += V.length / 9;
  }
  stats.mappedBridges = rendered.length;
  stats.bridges = rendered.length;
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
lapStart();

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
    /* five whorls tapering to a leader -- the fifth part used to be a ball of
       radius 1.5 m on the tip, a birch crown glued on a conifer */
    for (let i = 0; i < 5; i++) {
      const t = i / 4, r = 4.2 - t * 2.7, hh = 2.8 - t * 0.9;
      const g = new THREE.ConeGeometry(r, hh, 12, 1);
      g.translate((t - 0.5) * 0.6, 8.5 + t * 3.5, (t * 0.5 - 0.25));
      p.push(g);
    }
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
/* What a template stands for at scale 1, so a measured tree can be drawn at
   its measured height and crown radius rather than at a hashed size. */
for (const spec of SPECIES) {
  spec.crown.computeBoundingBox();
  const box = spec.crown.boundingBox;
  spec.templateHeight = box.max.y;
  spec.templateRadius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z);
}

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

lap('reeds (lattice + SHORE field)', { reeds: stats.reeds | 0 });
const trees = [[], [], []];
/* Phase 0 of the vegetation plan (docs/puttom-v2-lidar-tree-placement-plan.md):
   every planted tree remembers WHY it stands there -- the OSM forest polygon,
   a scrub ring, the satellite canopy raster or the shore belt -- so the
   baseline export can measure the legacy population source by source, which
   is how the v2 cutover will be measured population by population instead of
   eyeballed. The reason changes nothing about where a tree lands. */
const treeWhy = [[], [], []];
const WHY_FOREST_RING = 1, WHY_SCRUB_RING = 2, WHY_SATELLITE = 3, WHY_SHORE = 4, WHY_V2_INDIVIDUAL = 5, WHY_V2_STAND = 6;
/* The v2 populations are planned BEFORE the lattice runs, so the lattice can
   stay out of every tile they own: inside verified coverage only the registry
   individuals and the measured stand field plant; outside it the legacy
   population is untouched. Both come from docs/puttom-v2-lidar-tree-placement-plan.md. */
/* A 10 m woodland class informs the mesh mix only. It never adds/moves trees
   or identifies a species: the existing verified canopy still owns placement. */
let woodlandAt = () => null;
const mappedTreeSpecies = ({ r, x, z, h }) =>
  woodlandSpeciesPrior({ r, context: woodlandAt(x, z) }) ??
  SCENERY?.species?.({ r, x, z, h, ringSD, RES });
let V2_VEG_PLAN = null, V2_VEG_COVER = null;
if (V2_VEGETATION) {
  if (TERRAIN_PREVIEW.ready && TERRAIN_PREVIEW.bridge) {
    const { createFrameMapper, createCoverage, planV2Vegetation } = V2_VEGETATION.mod;
    const mapper = createFrameMapper({ bridge: TERRAIN_PREVIEW.bridge, frameOrigin: V2_VEGETATION.loaded.frameOrigin });
    woodlandAt = createWoodlandContextSampler(M.scenery?.woodlandContext, { toEpsg: mapper.toEpsg });
    if (M.scenery?.woodlandContext) stats.woodlandContext = { sourceVersion: M.scenery.woodlandContext.sourceVersion, nativeResolutionMetres: 10, role: 'leaf-type rendering prior; individual species unknown' };
    V2_VEG_COVER = createCoverage(V2_VEGETATION.loaded, mapper);
    V2_VEG_PLAN = planV2Vegetation(V2_VEGETATION.loaded, {
      mapper,
      groundHeightAt: (x, z) => terrainH(x, z),
      shoreDistanceAt: (x, z) => SHORE(x, z),
      lowQuality: LOWQ,
      verticalDatumOffsetMetres: TERRAIN_PREVIEW.bridge.verticalDatumOffsetMetres || 0,
      /* the course's own species rule, where one exists -- the same hook the
         legacy lattice consumes below, closed over ringSD/RES here so the
         vegetation runtime never imports a scenery module */
      species: M.scenery?.woodlandContext || SCENERY?.species ? mappedTreeSpecies : null,
    });
  } else {
    /* the registry is placed through the v2 terrain's own bridge; without
       that terrain there is no frame to place it in, and require would have
       thrown before this point */
    V2_VEGETATION_ERROR = 'v2-terrain-not-ready';
  }
}
lap('v2 vegetation: plan individuals + stand trees');
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
    if (V2_VEG_COVER && V2_VEG_COVER.covers(px, pz)) continue;
    let wood = 0, kindScrub = false, why = 0;
    for (const v of VI.at(px, pz)) {
      if (v.kind === 'forest' || v.kind === 'wood') {
        const sd = ringSD(px, pz, v.ring, 26);   /* exact to where the smoothstep saturates */
        if (sd < 3.5) {
          const w = sd < 0 ? 0.42 + 0.58 * smooth(-26, -12, sd) : 0.3 * (1 - sd / 3.5);
          if (w > wood) { wood = w; why = WHY_FOREST_RING; }
        }
      }
      else if (v.kind === 'scrub') { const sd = ringSD(px, pz, v.ring, 1); if (sd < 0) { if (0.4 > wood) { wood = 0.4; why = WHY_SCRUB_RING; } kindScrub = true; } }
    }
    /* The imagery is the authority in BOTH directions now. Satellite canopy plants
       where no polygon was surveyed -- and where the satellite sees open ground
       inside an OSM forest polygon (30% of their area), the stand thins to the
       scattered singles the club's own aerials show. OSM drew rooms; the imagery
       knows how much of each room is actually furnished. */
    const cvHere = coverAt(px, pz);
    /* the imagery's authority fades to the rings' at its own edge, so the
       stand does not change character along a straight line */
    const cvWeight = cvHere ? coverEdgeFade(px, pz) : 0;
    if (wood < 0.05 && cvHere === 3) {
      /* density follows the LOCAL canopy fraction, not the single cell: solid
         raster plants a wall, speckle plants the scattered singles it depicts */
      let hits = 1;
      for (const [ox, oz] of [[4.5, 0], [-4.5, 0], [0, 4.5], [0, -4.5]])
        if (coverAt(px + ox, pz + oz) === 3) hits++;
      wood = 0.95 * Math.pow(hits / 5, 1.3) * cvWeight;
      why = WHY_SATELLITE;
    }
    if (cvHere === 2 && wood > 0.05) wood *= lerp(1, 0.07, cvWeight);
    /* Lone singles used to be a random sprinkle; the satellite raster's own
       speckle now says where they really stand, so the invented ones are gone --
       the club's aerial shows the mown expanse carrying literally none. A
       candidate with no woodland can still be a shore birch, so the early-out
       waits for the belt. */
    const dW = SHORE(px, pz);
    /* birches walk down to the waterline the way they do on every Norrland shore --
       thinner where the imagery says the shore is bare */
    const belt = dW < 28;
    if (belt) {
      const w = 0.4 * (1 - smooth(18, 28, dW)) * (cvHere === 2 ? 0.22 : 1);
      if (w > wood) { wood = w; why = WHY_SHORE; }
    }
    /* what the surroundings say cannot stand here: cleared power-line corridors,
       the traced clear-fells (a few seed trees survive a hygge), working ground,
       hay meadows, and the open fields */
    if (wood > 0.05) {
      for (const hv of hvBB) {
        if (px < hv.bb.x0 - 15 || px > hv.bb.x1 + 15 || pz < hv.bb.z0 - 15 || pz > hv.bb.z1 + 15) continue;
        if (distToLine(px, pz, hv.line) < 14) { wood *= 0.12; break; }
      }
      for (const q of SI.at(px, pz)) if (ringSD(px, pz, q.ring, 1) < 0)
        wood *= q.kind === 'cut' ? 0.06 : 0;
      for (const q of LI.at(px, pz))
        if ((q.kind === 'farmland' || q.kind === 'farmyard') && ringSD(px, pz, q.ring, 1) < 0) wood = 0;
    }
    /* thin toward the ring's edge, where the far cones take over */
    wood *= midrEdgeFade(px, pz);
    if (wood < 0.05) continue;
    const c = classify(px, pz);
    if (c.fair > 0.05 || c.green > 0.02 || c.tee > 0.02 || c.sand > 0.05 || c.path > 0.15) continue;
    if (c.dLine < 15) continue;
    const h = terrainH(px, pz);
    let wet = false;
    for (const w of WI.at(px, pz)) {
      if (w.stream) { if (distToLine(px, pz, w.line, w.w * 3) < w.w * 3) wet = true; }
      else if (ringSD(px, pz, w.ring, 3) < 3 || h < w.level + 0.5) wet = true;
    }
    if (!wet && typeof terrainV2.isFlatWaterAt === 'function' && terrainV2.isFlatWaterAt(px, pz)) wet = true;
    if (wet) continue;
    let bldNear = false;
    for (const q of II.at(px, pz)) if (ringSD(px, pz, q.ring, 6) < 6) { bldNear = true; break; }
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
             : (mappedTreeSpecies({ r, x: px, z: pz, h }) ?? (r < 0.56 ? 1 : r < 0.83 ? 0 : 2));
    let s = SPECIES[sp].sc[0] + rnd(i + 61, j + 3) * (SPECIES[sp].sc[1] - SPECIES[sp].sc[0]);
    if (wood < 0.3) s *= 1.2;                    /* a lone tree grows a full crown */
    const sk = s * (kindScrub ? 0.42 : 1);
    trees[sp].push(px, h - 0.25, pz, sk, rnd(i + 3, j + 41) * TAU, sk);
    treeWhy[sp].push(why);
    }
  }
}
lap('legacy tree lattice');
if (V2_VEG_PLAN) {
  /* measured trees: height and crown radius from the registry or the stand
     field, drawn with the same three templates as the lattice so the woods
     stay one material and one look; only their sizes are no longer hashed */
  for (const t of V2_VEG_PLAN.instances) {
    const spec = SPECIES[t.species];
    trees[t.species].push(t.x, t.y - 0.25, t.z, t.height / spec.templateHeight, t.rotation, t.radius / spec.templateRadius);
    treeWhy[t.species].push(t.kind === 'individual' ? WHY_V2_INDIVIDUAL : WHY_V2_STAND);
  }
}
/* The baseline export the vegetation plan's Phase 0 asks for: the legacy
   population counted by species, by the source that planted it, by hole and
   by a PROVISIONAL zone -- distance to the nearest hole line, until the
   plan's zone-A geometry is approved -- with the instances themselves on
   request. Computed on demand, never at boot. */
const LEGACY_TREE_REASONS = ['none', 'forestRing', 'scrubRing', 'satellite', 'shore', 'v2Individual', 'v2Stand'];
const LEGACY_ZONE_A_METRES = 90, LEGACY_ZONE_B_METRES = 300;
/* the third band, for the tier-by-zone rule: decimated crowns out to here, impostors beyond */
const ZONE_C_METRES = 700;
function legacyTreeExport(withInstances = false) {
  const names = ['spruce', 'pine', 'birch'];
  const out = {
    total: 0, species: {}, reasons: {}, zones: { A: 0, B: 0, C: 0 },
    holes: HOLES.map(h => ({ n: h.n, count: 0 })),
    zoning: `provisional: A within ${LEGACY_ZONE_A_METRES} m of a hole line, B within ${LEGACY_ZONE_B_METRES} m, else C`,
    v2: V2_VEG_PLAN ? { ...V2_VEG_PLAN.stats, coverageTiles: V2_VEG_COVER ? V2_VEG_COVER.tiles : 0 } : null,
    legacyInsideCoverage: 0,
    instances: withInstances ? [] : null,
  };
  for (const reason of LEGACY_TREE_REASONS) out.reasons[reason] = 0;
  for (let sp = 0; sp < 3; sp++) {
    const T = trees[sp], W = treeWhy[sp], n = T.length / 6;
    out.species[names[sp]] = n;
    out.total += n;
    for (let k = 0; k < n; k++) {
      const x = T[k * 6], y = T[k * 6 + 1], z = T[k * 6 + 2];
      if (V2_VEG_COVER && W[k] < WHY_V2_INDIVIDUAL && V2_VEG_COVER.covers(x, z)) out.legacyInsideCoverage++;
      let best = Infinity, nearest = -1;
      for (let i = 0; i < HOLES.length; i++) {
        const d = distToLine(x, z, HOLES[i].line);
        if (d < best) { best = d; nearest = i; }
      }
      const zone = best <= LEGACY_ZONE_A_METRES ? 'A' : best <= LEGACY_ZONE_B_METRES ? 'B' : 'C';
      out.zones[zone]++;
      if (nearest >= 0 && zone !== 'C') out.holes[nearest].count++;
      out.reasons[LEGACY_TREE_REASONS[W[k]] || 'none']++;
      if (withInstances) {
        out.instances.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +T[k * 6 + 3].toFixed(3),
                            +T[k * 6 + 4].toFixed(3), sp, W[k], zone, +T[k * 6 + 5].toFixed(3)]);
      }
    }
  }
  return out;
}
lap('v2 vegetation: push planned trees');
/* ------------------------------------------------------------ tree tiers
   Every tree used to be the same 204-436 triangle template at every distance,
   in six InstancedMeshes whose bounding spheres were the whole course, so
   nothing was ever culled and 92,000 trees were drawn twice a frame (once
   for the camera, once into the shadow map). docs/tree-lod-plan.md is the
   plan; this is its phase 1: two tiers, chosen per 128 m cell by the height
   a nominal tree projects to, with hysteresis, and cells outside the frustum
   in no tier at all.

   The container is deliberately NOT BatchedMesh: on the WebGPU backend a
   BatchedMesh is one draw command per instance inside the pass, and on
   WebGL2 it needs WEBGL_multi_draw. One InstancedMesh per (species, part,
   tier) is one instanced draw on both backends -- twelve draws for the
   forest -- and an instance moves between tiers by a swap-remove in one
   tier's slot list and an append in the other's, with the matrix copied
   from a table built once at boot. Placement never changes: trees[] and
   treeWhy[] are what the baseline and the fingerprint read, and they are
   untouched. The far cones beyond MIDR are unchanged until phase 2 (the
   impostors) replaces them. */
/* ?lodpin=a,b overrides the course corridor's tier floors (4,4 switches them off) */
const LODPIN = (() => {
  const q = new URLSearchParams(location.search).get('lodpin'), v = q ? q.split(',').map(Number) : null;
  return v && v.length === 2 && v.every(x => x >= 1 && x <= 4) ? [v[0] | 0, v[1] | 0] : null;
})();
/* ?lodreach=hero,full overrides how far the corridor floors reach, in metres */
const LODMODE = new URLSearchParams(location.search).get('lodmode') === 'screen' ? 'screen' : 'zone';
const LODREACH = (() => {
  const q = new URLSearchParams(location.search).get('lodreach'), v = q ? q.split(',').map(Number) : null;
  return v && v.length === 2 && v.every(x => x > 0) ? v : null;
})();
/* ?lodpx=hero,full,impostor overrides the three tier boundaries for a sweep */
const LODPX = (() => {
  const q = new URLSearchParams(location.search).get('lodpx'), v = q ? q.split(',').map(Number) : null;
  return v && v.length === 3 && v.every(x => x > 0) ? { hero: v[0], full: v[1], impostor: v[2] } : null;
})();
const TREE_LOD = {
  cell: 128, cells: [], tiers: [], mats: [], imp: [], atlases: [], ready: false,
  /* Phase 4 (docs/tree-lod-plan.md): the tier is decided PER TREE from the
     pixels its own drawn height projects to -- hero above heroPx, the full
     template above switchPx, decimated above impostorPx, an impostor below --
     with a hysteresis band on every boundary; nominalHeight is only what the
     tools quote a boundary distance for. A switch is a CROSSFADE of fadeS
     seconds (engine/tree-fade.mjs): 0 under ?det=1, so every deterministic
     gate renders instant switches. fadeClock is the shader's clock, epoch-
     relative and rebased below FADE_EPOCH_S; queue holds every fade in flight
     until its OUT entry can go. frozen and clockDriven belong to the harness:
     a frozen update leaves every tier as it is, a driven clock advances only
     when the harness says so. */
  fadeS: DET ? 0 : (LOWQ ? 0.25 : 0.3), fadeClock: 0, clockDriven: false, queue: [], qHead: 0, frozen: false, resetPending: false,
  /* the harness's "before": decide per CELL from a nominal tree at the cell box, as phases 1-3 did */
  cellMode: false,
  /* desktop defaults 64 / 24 / 8 px, measured on the RTX 3070 at 1080p (docs/tree-lod-plan.md,
     phase 4): a 12 m tree is hero to ~230 m, the full template to ~600 m, decimated to the
     middle ring's edge, at most a millisecond a frame over the 110 / 40 / 14 the plan
     started from; a phone keeps 200 / 60 / 22 until one is measured */
  nominalHeight: 12, heroPx: LODPX?.hero ?? (LOWQ ? 200 : 64), switchPx: LODPX?.full ?? (LOWQ ? 60 : 24), impostorPx: LODPX?.impostor ?? (LOWQ ? 22 : 8), hysteresis: 0.1,
  /* The tier by ZONE: the owner's rule. A tree on the corridors (zone A) is
     hero, in the close surroundings (B) full, out to 700 m (C) decimated,
     beyond that an impostor -- fixed for the visit, whatever the camera does,
     so no tree ever changes its detail while the picture moves. The
     screen-size tiers, floors, hysteresis and dwell below are the other mode
     (?lodmode=screen), kept for the before and for the harness that measures
     switching. Phones take one tier coarser in every band. */
  lodMode: LODMODE,
  zoneTiers: LOWQ ? [2, 3, 4, 4] : [1, 2, 3, 4],
  /* frames a tree must want its new tier for before it switches: a fast camera
     wobbles a tree's size across a threshold and back within a fade, and each
     wobble was a crossfade -- 450 a second in a flight, most of them reversals */
  dwell: 6,
  /* The course corridor keeps its detail whatever the distance. Screen-size
     LOD is right for a forest and wrong for the trees a golfer is looking
     at: as the camera moves around a course every tree at the boundary
     distance dissolves into its next tier, and however soft each dissolve
     is, the course never stops changing. So a tree within zone A (90 m of a
     hole line) never drops below floors[0] and one within zone B (300 m)
     never below floors[1] -- hero and full on the desktop, 5,036 and 18,084
     trees at Puttom -- and only the forest beyond is tiered by screen size.
     A phone floors zone A at the full template and leaves zone B alone. */
  floors: LODPIN ?? (LOWQ ? [2, 4] : [1, 2]),
  /* how far from the camera the floors reach: the hero floor to the first
     distance, the full-template floor to the second, screen size beyond. Past
     500 m a 12 m tree is 29 px and past 900 m it is 16 px, where the hero
     crown is the full template and the full template is the decimated one, so
     a switch there does not show; pinning further only costs -- from the 12th
     tee a floor with no reach held 3,676 hero trees and a third more
     triangles. ?lodreach=hero,full overrides. */
  floorReach: LODREACH ?? (LOWQ ? [250, 500] : [500, 900]),
  /* ?lod=1|2|3|4 forces every visible cell into one tier (hero, full,
     decimated, impostor), so a tier can be looked at up close and judged on
     its own; nothing else changes */
  force: [1, 2, 3, 4].includes(+new URLSearchParams(location.search).get("lod")) ? +new URLSearchParams(location.search).get("lod") : 0,
  /* tier0 is the hero tier, tier1 the full template, tier2 decimated, tier3 the impostor */
  stats: { tier0: 0, tier1: 0, tier2: 0, tier3: 0, cells: 0, cellsVisible: 0, moves: 0, switches: 0, reversals: 0, updates: 0, bakeMs: 0, fading: 0, updateMs: 0, zoneA: 0, zoneB: 0 },
  /* ?impdbg=normal|albedo|mask|world draws the impostors unlit, one term at a time */
  debug: new URLSearchParams(location.search).get("impdbg") || null,
};
{
  /* the decimated templates: the same silhouettes and the same crown noise
     (so the colour variance matches across the switch) at a quarter of the
     triangles -- 56 / 44 / 80 against 204 / 212 / 436 */
  const decimated = (() => {
    const spruce = grownCrown(mergeGeos((() => {
      const p = [];
      for (let i = 0; i < 3; i++) {
        const t = i / 2, r = 3.5 * (1 - t * 0.8) + 0.45, hh = 3.6 * (1 - t * 0.35) * 2.2;
        const g = new THREE.ConeGeometry(r, hh, 6, 1);
        g.translate(0, 2.6 + t * 9.6, 0);
        p.push(g);
      }
      return p;
    })()), 1, 0.15, 0.13);
    const pine = grownCrown(mergeGeos((() => {
      const p = [];
      /* three tall whorls standing in for the five, tapering to the same leader */
      for (let i = 0; i < 3; i++) {
        const t = i / 2, r = 4.2 - t * 2.7, hh = (2.8 - t * 0.9) * 1.3;
        const g = new THREE.ConeGeometry(r, hh, 6, 1);
        g.translate((t - 0.5) * 0.6, 8.5 + t * 3.5, (t * 0.5 - 0.25));
        p.push(g);
      }
      return p;
    })()), 2, 0.2, 0.15);
    const birch = grownCrown(mergeGeos((() => {
      const p = [];
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU;
        const g = new THREE.IcosahedronGeometry(2.4 - (i % 2) * 0.4, 0);
        g.translate(Math.cos(a) * 1.4, 7.6 + (i % 2) * 1.6, Math.sin(a) * 1.4);
        p.push(g);
      }
      return p;
    })()), 3, 0.22, 0.17);
    const trunk = (r0, r1, h) => { const g = new THREE.CylinderGeometry(r0, r1, h, 5); g.translate(0, h / 2, 0); return g; };
    return [
      { crown: spruce, trunk: trunk(0.18, 0.42, 3.2) },
      { crown: pine, trunk: trunk(0.22, 0.46, 9.0) },
      { crown: birch, trunk: trunk(0.16, 0.30, 7.4) },
    ];
  })();
  /* --- the hero tier: what a tree a golfer stands beside is made of ---
     The plan's alpha-tested needle and leaf cards were built and taken out
     again: hung on a flat-shaded cone they read as debris stuck to the
     tree, not as foliage -- these are low-poly trees, and a photographic
     sprig on a clean facet is a clash, not a detail. The hero tier is the
     same crown GROWN AT A FINER SUBDIVISION (the same cones and blobs, the
     same noise, six times the facets), so a near tree is rounder and more
     organic and still unmistakably the tree it becomes at 120 m; and a
     12-segment trunk with a bark bump and a root flare. */
  /* bark: vertical fissures, the same field for the bump and the colour */
  const BARK = canvasTex(256, (g, S) => {
    const im = g.createImageData(S, S), d = im.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = fbm(x * 0.09, y * 0.012, 3) * 0.5 + 0.5, fine = fbm(x * 0.3, y * 0.05, 2) * 0.5 + 0.5;
      const b = Math.min(1, Math.max(0, v * 0.7 + fine * 0.3));
      d[i] = d[i + 1] = d[i + 2] = b * 255; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { srgb: false, rep: 1 });
  /* a 12-segment trunk with a root flare, uv'd for the bark */
  const heroTrunk = (r0, r1, h) => {
    const shaft = new THREE.CylinderGeometry(r0, r1, h, 12, 1, true); shaft.translate(0, h / 2, 0);
    const flare = new THREE.CylinderGeometry(r1, r1 * 1.7, 0.6, 12, 1, true); flare.translate(0, 0.3, 0);
    const cap = new THREE.CircleGeometry(r0, 12); cap.rotateX(-Math.PI / 2); cap.translate(0, h, 0);
    return mergeGeos([flare, shaft, cap]);
  };
  const fineCrowns = (() => {
    const spruce = grownCrown(mergeGeos((() => {
      const p = [];
      for (let i = 0; i < 7; i++) {
        const t = i / 6, r = 3.5 * (1 - t * 0.8) + 0.45, hh = 3.6 * (1 - t * 0.35);
        const g = new THREE.ConeGeometry(r, hh, 24, 3);
        g.translate(0, 2.6 + t * 9.6, 0);
        p.push(g);
      }
      return p;
    })()), 1, 0.15, 0.13);
    const pine = grownCrown(mergeGeos((() => {
      const p = [];
      /* five whorls tapering to a leader -- the fifth part used to be a ball of
         radius 1.5 m on the tip, a birch crown glued on a conifer */
      for (let i = 0; i < 5; i++) {
        const t = i / 4, r = 4.2 - t * 2.7, hh = 2.8 - t * 0.9;
        const g = new THREE.ConeGeometry(r, hh, 24, 2);
        g.translate((t - 0.5) * 0.6, 8.5 + t * 3.5, (t * 0.5 - 0.25));
        p.push(g);
      }
      return p;
    })()), 2, 0.2, 0.15);
    const birch = grownCrown(mergeGeos((() => {
      const p = [];
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU;
        const g = new THREE.IcosahedronGeometry(2.3 - (i % 2) * 0.5, 2);
        g.translate(Math.cos(a) * 1.6, 7.2 + (i % 3) * 1.5, Math.sin(a) * 1.6);
        p.push(g);
      }
      return p;
    })()), 3, 0.22, 0.17);
    return [spruce, pine, birch];
  })();
  const hero = [
    { crown: fineCrowns[0], trunk: heroTrunk(0.18, 0.42, 3.2) },
    { crown: fineCrowns[1], trunk: heroTrunk(0.22, 0.46, 9.0) },
    { crown: fineCrowns[2], trunk: heroTrunk(0.16, 0.30, 7.4) },
  ];
  const barkMaterial = hex => {
    const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: 0.95, metalness: 0, bumpMap: BARK, bumpScale: 0.05 });
    const bark = texture(BARK, uv().mul(vec2(3, 1.5))).r;
    mat.colorNode = color(hex).mul(bark.mul(0.6).add(0.62));
    mat.positionNode = windSway(false);
    return attachTreeFade(mat);
  };
  const crownMaterial = (s, hex, sway) => {
    const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: 0.92, metalness: 0, flatShading: true });
    /* the same back-lit term the turf uses, so a treeline glows against a low sun
       instead of reading as a black cutout; birch crowns take the season's colour */
    const V = normalize(cameraPosition.sub(positionWorld));
    const cbase = s === 2 ? uLeaf : color(hex);
    mat.colorNode = cbase.mul(attribute('color', 'vec3')).mul(float(1).add(
      pow(saturate(V.dot(uSun.negate())), 2.6).mul(0.55)));
    if (sway) mat.positionNode = windSway(true);
    return attachTreeFade(mat);
  };
  const trunkMaterial = (hex, sway) => {
    const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: 0.95, metalness: 0, flatShading: true });
    if (sway) mat.positionNode = windSway(false);
    return attachTreeFade(mat);
  };
  /* GPU-only harmonic wind sway with zero CPU matrix updates: trunk roots at
     y=0 stay rigid, while crown upper branches gently bend. The near tier
     only: at the distance the decimated tier draws, sway is sub-pixel. */
  function windSway(isCrown) {
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
    return positionLocal.add(vec3(swayX, float(0.0), swayZ));
  }

  /* the impostor atlases: pictures of these very templates from the
     hemi-octahedron's vertices, albedo in one and tree-frame normal in the
     other, lit at draw time (engine/tree-impostor.mjs) */
  {
    const bakeStarted = performance.now();
    for (let s = 0; s < 3; s++) {
      TREE_LOD.atlases.push(bakeImpostorAtlas(renderer, { crown: SPECIES[s].crown, trunk: SPECIES[s].trunk, trunkColor: SPECIES[s].tc }));
    }
    TREE_LOD.stats.bakeMs = Math.round(performance.now() - bakeStarted);
    span('tree impostor atlases (3 species, 64 views each)', bakeStarted);
  }
  const impostorBatch = (s, capacity, label) => {
    const geo = createImpostorGeometry(capacity);
    const mat = createImpostorMaterial(TREE_LOD.atlases[s], {
      crownBase: s === 2 ? uLeaf : color(SPECIES[s].cc), sunDirection: uSun, debug: TREE_LOD.debug, fade: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.tag = 'trees';
    mesh.name = `trees-${['spruce', 'pine', 'birch'][s]}-impostor-${label}`;
    scene.add(mesh);
    stats.draws++;
    return { mesh, geo, pos: geo.getAttribute('aImpostorPos'), par: geo.getAttribute('aImpostorParam'), fade: [geo.getAttribute('aFade')],
             slots: new Int32Array(capacity), count: 0, dirtyM: [], dirtyF: [], idx: 0 };
  };
  const cellOf = new Map();
  const cell = (x, z) => {
    const i = Math.floor((x - MIDR.x0) / TREE_LOD.cell), j = Math.floor((z - MIDR.z0) / TREE_LOD.cell);
    const key = i + ',' + j;
    let c = cellOf.get(key);
    if (!c) {
      const x0 = MIDR.x0 + i * TREE_LOD.cell, z0 = MIDR.z0 + j * TREE_LOD.cell;
      c = { x0, z0, x1: x0 + TREE_LOD.cell, z1: z0 + TREE_LOD.cell, y0: Infinity, y1: -Infinity,
            lists: [[], [], []], visible: false, box: new THREE.Box3() };
      cellOf.set(key, c);
      TREE_LOD.cells.push(c);
    }
    return c;
  };
  /* the course corridor, rasterised once on a 12 m grid over the middle ring:
     1 within zone A of a hole line, 2 within zone B, 0 beyond -- a capsule
     stamped per segment, the same zones legacyTreeExport reports */
  const courseZone = (() => {
    const cell = 12, x0 = MIDR.x0, z0 = MIDR.z0;
    const nx = Math.ceil((MIDR.x1 - x0) / cell) + 1, nz = Math.ceil((MIDR.z1 - z0) / cell) + 1;
    const grid = new Uint8Array(nx * nz);
    const stamp = (ax, az, bx, bz, r, v) => {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + r - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + r - z0) / cell));
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell, pz = z0 + (j + 0.5) * cell;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
        const ex = ax + dx * t - px, ez = az + dz * t - pz;
        if (ex * ex + ez * ez <= r * r) { const at = j * nx + i; if (!grid[at] || v < grid[at]) grid[at] = v; }
      }
    };
    for (const [r, v] of [[ZONE_C_METRES, 3], [LEGACY_ZONE_B_METRES, 2], [LEGACY_ZONE_A_METRES, 1]]) {
      for (const h of HOLES) for (let i = 0; i + 1 < h.line.length; i++) stamp(h.line[i][0], h.line[i][1], h.line[i + 1][0], h.line[i + 1][1], r, v);
    }
    return (x, z) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i < 0 || j < 0 || i >= nx || j >= nz ? 0 : grid[j * nx + i]; };
  })();
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (let s = 0; s < 3; s++) {
    const T = trees[s], W = treeWhy[s];
    const n = T.length / 6;
    const mats = new Float32Array(n * 16);
    const imp = new Float32Array(n * 6);   /* x, y, z, yaw, scaleXZ, scaleY */
    TREE_LOD.mats.push(mats);
    TREE_LOD.imp.push(imp);
    /* each tree's drawn height and the height of its crown centre: the tier
       is decided from the pixels THIS tree projects to, not a nominal one */
    const treeH = new Float32Array(n), treeCY = new Float32Array(n);
    /* which course zone each tree stands in (0 beyond, 1 A, 2 B, 3 C): in zone mode it IS the tier, in screen mode the floor */
    const zone = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      pos.set(T[k * 6], T[k * 6 + 1], T[k * 6 + 2]);
      const sy = T[k * 6 + 3], sxz = T[k * 6 + 5];
      /* the lattice keeps its hashed height variation; a measured tree is
         drawn at its measured height and crown, with nothing added */
      const varied = W[k] >= WHY_V2_INDIVIDUAL ? 1 : (0.86 + (k % 7) * 0.045);
      treeH[k] = SPECIES[s].templateHeight * sy * varied;
      treeCY[k] = pos.y + treeH[k] * 0.5;
      zone[k] = courseZone(pos.x, pos.z);
      if (zone[k] === 1) TREE_LOD.stats.zoneA++; else if (zone[k] === 2) TREE_LOD.stats.zoneB++;
      scl.set(sxz, sy * varied, sxz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), T[k * 6 + 4]);
      mtx.compose(pos, q, scl).toArray(mats, k * 16);
      imp.set([pos.x, pos.y, pos.z, T[k * 6 + 4], sxz, sy * varied], k * 6);
      const c = cell(pos.x, pos.z);
      c.lists[s].push(k);
      if (pos.y < c.y0) c.y0 = pos.y;
      if (pos.y + 14 * sy * varied > c.y1) c.y1 = pos.y + 14 * sy * varied;
    }
    if (!n) { TREE_LOD.tiers.push(null); continue; }
    const spec = SPECIES[s], deci = decimated[s];
    /* a mesh tier is one InstancedMesh per part (crown, trunk, and for the
       hero its cards), every part sharing the tier's slot list */
    const tier = (parts, label) => {
      const meshes = parts.map(([name, geo, mat]) => {
        /* the crossfade's per-instance (start time, mask code); a fifth
           vertex buffer at most, against WebGPU's eight */
        geo.setAttribute('aFade', createFadeAttribute(n));
        const im = new THREE.InstancedMesh(geo, mat, n);
        im.count = 0;
        im.castShadow = true;
        im.receiveShadow = name === 'trunk';
        /* culled per cell by the tier update; the mesh's own sphere would be the whole course */
        im.frustumCulled = false;
        /* NOT DynamicDrawUsage: three's WebGPU path re-uploads such an attribute whole every frame; the tiers upload their dirty ranges through needsUpdate (flushRanges) */
        im.userData.tag = 'trees';
        im.name = `trees-${['spruce', 'pine', 'birch'][s]}-${name}-${label}`;
        scene.add(im);
        stats.draws++;
        return im;
      });
      return { parts: meshes, fade: meshes.map(im => im.geometry.getAttribute('aFade')), slots: new Int32Array(n), count: 0,
               dirtyM: [], dirtyF: [], idx: 0 };
    };
    const hr = hero[s];
    const rec = {
      n, treeH, treeCY, zone,
      where: new Int32Array(n).fill(-1),
      tierOf: new Uint8Array(n),
      pend: new Uint8Array(n), pendN: new Uint8Array(n),
      /* the OUT half of a crossfade: which tier still draws the tree, and where */
      outTier: new Uint8Array(n), whereOut: new Int32Array(n).fill(-1),
      fadeT0: new Float32Array(n), fadeCode: new Uint8Array(n),
      t: [null,
        tier([['crown', hr.crown, crownMaterial(s, spec.cc, true)], ['trunk', hr.trunk, barkMaterial(spec.tc)]], 't0'),
        tier([['crown', spec.crown, crownMaterial(s, spec.cc, true)], ['trunk', spec.trunk, trunkMaterial(spec.tc, true)]], 't1'),
        tier([['crown', deci.crown, crownMaterial(s, spec.cc, false)], ['trunk', deci.trunk, trunkMaterial(spec.tc, false)]], 't2'),
        impostorBatch(s, n, 't3')],
    };
    for (let i = 1; i <= 4; i++) rec.t[i].idx = i;
    TREE_LOD.tiers.push(rec);
    stats.trees += n;
  }
  for (const c of TREE_LOD.cells) {
    if (!Number.isFinite(c.y0)) { c.y0 = 0; c.y1 = 20; }
    /* dilated by a crown's reach, so a tree straddling the cell edge is not
       culled while its crown is still in frame */
    c.box.min.set(c.x0 - 8, c.y0 - 2, c.z0 - 8);
    c.box.max.set(c.x1 + 8, c.y1 + 2, c.z1 + 8);
    c.lists = c.lists.map(l => Int32Array.from(l));
  }
  TREE_LOD.stats.cells = TREE_LOD.cells.length;
  TREE_LOD.ready = true;
}

/* A tree is drawn by up to two tiers at once: its IN tier (tierOf, where)
   and, while a crossfade runs, its OUT tier (outTier, whereOut). Each tier's
   slot list is swap-removed and appended as before; what changed is that an
   entry also carries aFade = (fade start time, mask code), which the shader
   reads to decide per pixel which of a tree's two entries owns it
   (engine/tree-fade.mjs). The matrix and impostor writes copy from the
   tables built at boot, so a move never touches trees[]. */
function treeFadeWrite(tier, slot, t0, code) {
  for (const a of tier.fade) { a.array[slot * 2] = t0; a.array[slot * 2 + 1] = code; }
  tier.dirtyF.push(slot);
}
function treeTierWrite(s, tier, slot, k, t0, code) {
  if (tier.mesh) {
    const imp = TREE_LOD.imp[s];
    tier.pos.array.set(imp.subarray(k * 6, k * 6 + 3), slot * 3);
    tier.par.array[slot * 4] = imp[k * 6 + 3];
    tier.par.array[slot * 4 + 1] = imp[k * 6 + 4];
    tier.par.array[slot * 4 + 2] = imp[k * 6 + 5];
    tier.par.array[slot * 4 + 3] = 0;
  } else {
    const mats = TREE_LOD.mats[s];
    for (const im of tier.parts) im.instanceMatrix.array.set(mats.subarray(k * 16, k * 16 + 16), slot * 16);
  }
  tier.dirtyM.push(slot);
  treeFadeWrite(tier, slot, t0, code);
}
/* the slots written this frame, as runs: a swap-remove touches one slot at
   each end of a tier, and one range from the lowest to the highest slot
   uploaded the whole tier between them -- 640 KB a frame for the pine tier
   on a walk that switches ten trees a frame */
function flushRanges(attrs, dirty, stride) {
  if (!dirty.length) return;
  dirty.sort((a, b) => a - b);
  const runs = [];
  let start = dirty[0], end = dirty[0];
  for (let i = 1; i < dirty.length; i++) {
    const v = dirty[i];
    if (v === end || v === end + 1) { end = v; continue; }
    runs.push([start, end]); start = end = v;
  }
  runs.push([start, end]);
  for (const a of attrs) {
    a.clearUpdateRanges();
    if (runs.length > 96) a.addUpdateRange(runs[0][0] * stride, (runs[runs.length - 1][1] - runs[0][0] + 1) * stride);
    else for (const [s0, s1] of runs) a.addUpdateRange(s0 * stride, (s1 - s0 + 1) * stride);
    a.needsUpdate = true;
  }
  dirty.length = 0;
}
/* swap-remove: the tree moved into the freed slot may hold this tier as its IN entry or as its OUT entry */
function tierRemove(s, tier, slot) {
  const sp = TREE_LOD.tiers[s], last = --tier.count;
  if (slot !== last) {
    const m = tier.slots[last];
    tier.slots[slot] = m;
    const isIn = sp.tierOf[m] === tier.idx;
    if (isIn) sp.where[m] = slot; else sp.whereOut[m] = slot;
    treeTierWrite(s, tier, slot, m, sp.fadeT0[m], isIn ? sp.fadeCode[m] : PAIR[sp.fadeCode[m]]);
  }
}
function tierAppend(s, tier, k, t0, code) {
  const slot = tier.count++;
  tier.slots[slot] = k;
  treeTierWrite(s, tier, slot, k, t0, code);
  return slot;
}
/* move one tree from tier `from` to tier `to` (0 = not drawn). With a fade
   in effect the old entry stays as the OUT half of a crossfade and the new
   one is appended as the IN half, both stamped with the same start time;
   a tree asked to go back while its fade runs swaps the two roles in place
   with the masks continuous; a tree asked for a THIRD tier finishes its
   pending OUT at once (a partial pop, only at cuts and hole jumps). */
function treeTierMove(s, k, from, to) {
  const sp = TREE_LOD.tiers[s], dur = TREE_LOD.fadeS, clock = TREE_LOD.fadeClock;
  TREE_LOD.stats.moves++;
  if (from && to) TREE_LOD.stats.switches++;
  if (dur > 0 && to && sp.outTier[k] === to && sp.tierOf[k] === from) {
    /* a switch back to the tier it is still fading out of: the tree wobbled across a threshold within one fade */
    TREE_LOD.stats.reversals++;
    const { t0, inCode } = reversedFade(clock, sp.fadeT0[k], dur, sp.fadeCode[k]);
    const wIn = sp.where[k], wOut = sp.whereOut[k];
    sp.where[k] = wOut; sp.whereOut[k] = wIn; sp.tierOf[k] = to; sp.outTier[k] = from;
    sp.fadeT0[k] = t0; sp.fadeCode[k] = inCode;
    treeFadeWrite(sp.t[to], wOut, t0, inCode);
    treeFadeWrite(sp.t[from], wIn, t0, PAIR[inCode]);
    TREE_LOD.queue.push({ s, k, t0: sp.fadeT0[k], drainAt: drainAt(sp.fadeT0[k], dur) });
    return;
  }
  if (sp.outTier[k]) { tierRemove(s, sp.t[sp.outTier[k]], sp.whereOut[k]); sp.outTier[k] = 0; }
  if (!to) {
    /* left the frustum: gone now, both halves */
    if (from) tierRemove(s, sp.t[from], sp.where[k]);
    sp.where[k] = -1; sp.tierOf[k] = 0; sp.fadeCode[k] = 0;
  } else if (!from || dur <= 0) {
    /* entered the frustum, or an instant switch */
    if (from) tierRemove(s, sp.t[from], sp.where[k]);
    sp.fadeCode[k] = 0; sp.fadeT0[k] = 0;
    sp.where[k] = tierAppend(s, sp.t[to], k, 0, 0); sp.tierOf[k] = to;
  } else {
    /* the crossfade: polarity alternates per tree so neighbours do not flip in step */
    const inCode = (k & 1) ? 2 : 1, t0 = Math.fround(clock);
    sp.outTier[k] = from; sp.whereOut[k] = sp.where[k];
    treeFadeWrite(sp.t[from], sp.whereOut[k], t0, PAIR[inCode]);
    sp.fadeT0[k] = t0; sp.fadeCode[k] = inCode;
    sp.where[k] = tierAppend(s, sp.t[to], k, t0, inCode); sp.tierOf[k] = to;
    TREE_LOD.queue.push({ s, k, t0, drainAt: drainAt(t0, dur) });
  }
}
/* fades whose OUT entry is fully discarded by now: drop the entry. An entry
   whose tree has since been re-timed (a reversal, a later fade) is stale
   and is skipped; the newer entry drains it. A reversed entry may sit
   behind later ones and drain a little late -- invisible, only a draw. */
function drainTreeFades() {
  const Q = TREE_LOD.queue;
  let changed = false;
  while (TREE_LOD.qHead < Q.length && Q[TREE_LOD.qHead].drainAt <= TREE_LOD.fadeClock) {
    const e = Q[TREE_LOD.qHead++], sp = TREE_LOD.tiers[e.s];
    if (sp.outTier[e.k] && sp.fadeT0[e.k] === e.t0) {
      tierRemove(e.s, sp.t[sp.outTier[e.k]], sp.whereOut[e.k]);
      sp.outTier[e.k] = 0; sp.fadeCode[e.k] = 0;
      treeFadeWrite(sp.t[sp.tierOf[e.k]], sp.where[e.k], 0, 0);
      changed = true;
    }
  }
  if (TREE_LOD.qHead > 4096) { TREE_LOD.queue = Q.slice(TREE_LOD.qHead); TREE_LOD.qHead = 0; }
  return changed;
}
/* the clock is an f32 in the shader: past FADE_EPOCH_S it is wound back by
   an epoch, together with every fade in flight, so a twelve-minute bansafari
   never runs it out of precision */
function rebaseFadeClock() {
  if (TREE_LOD.fadeClock < FADE_EPOCH_S) return;
  const E = FADE_EPOCH_S, Q = TREE_LOD.queue;
  TREE_LOD.fadeClock -= E;
  for (let i = TREE_LOD.qHead; i < Q.length; i++) {
    const e = Q[i], sp = TREE_LOD.tiers[e.s];
    const live = sp.outTier[e.k] && sp.fadeT0[e.k] === e.t0;
    e.t0 = Math.fround(e.t0 - E); e.drainAt -= E;
    if (live) {
      sp.fadeT0[e.k] = e.t0;
      treeFadeWrite(sp.t[sp.tierOf[e.k]], sp.where[e.k], e.t0, sp.fadeCode[e.k]);
      treeFadeWrite(sp.t[sp.outTier[e.k]], sp.whereOut[e.k], e.t0, PAIR[sp.fadeCode[e.k]]);
    }
  }
}
/* the harness's consistency check: every drawn slot belongs to exactly one
   tree as its IN or OUT entry, and no tree holds both in one tier */
function treeTierAudit() {
  const out = { ok: true, species: [] };
  for (let s = 0; s < 3; s++) {
    const sp = TREE_LOD.tiers[s];
    if (!sp) continue;
    let sumCount = 0, inCount = 0, outCount = 0, roundTrip = true, noSelfPair = true;
    for (let i = 1; i <= 4; i++) {
      const tier = sp.t[i];
      sumCount += tier.count;
      for (let slot = 0; slot < tier.count; slot++) {
        const k = tier.slots[slot];
        if (!((sp.tierOf[k] === i && sp.where[k] === slot) || (sp.outTier[k] === i && sp.whereOut[k] === slot))) roundTrip = false;
      }
    }
    for (let k = 0; k < sp.n; k++) {
      if (sp.tierOf[k]) inCount++;
      if (sp.outTier[k]) { outCount++; if (sp.outTier[k] === sp.tierOf[k]) noSelfPair = false; }
    }
    const ok = sumCount === inCount + outCount && roundTrip && noSelfPair;
    out.species.push({ sumCount, inCount, outCount, roundTrip, noSelfPair, ok });
    if (!ok) out.ok = false;
  }
  return out;
}

const TREE_FRUSTUM = new THREE.Frustum(), TREE_PROJ = new THREE.Matrix4();
/* per frame: a cell outside the frustum draws nothing; inside it every tree
   is tiered from the pixels its own height projects to at its own distance
   (to the crown centre, height included: from 330 m straight up a tree
   under the camera is 330 m away), with the hysteresis band on each
   boundary; only trees whose tier changed move, and a move is a crossfade */
function updateTreeTiers() {
  if (!TREE_LOD.ready || TREE_LOD.frozen) return;
  const tStart = performance.now();
  rebaseFadeClock();
  let changed = drainTreeFades();
  TREE_PROJ.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  TREE_FRUSTUM.setFromProjectionMatrix(TREE_PROJ, renderer.coordinateSystem, camera.reversedDepth ?? false);
  const viewportH = renderer.domElement.height || innerHeight;
  const Kpx = viewportH / (2 * Math.tan(camera.fov * 0.5 * Math.PI / 180));
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const thr = [TREE_LOD.heroPx, TREE_LOD.switchPx, TREE_LOD.impostorPx], hy = TREE_LOD.hysteresis;
  const force = TREE_LOD.force, reset = TREE_LOD.resetPending, cellMode = TREE_LOD.cellMode;
  const floorA = TREE_LOD.floors[0], floorB = TREE_LOD.floors[1], reachH = TREE_LOD.floorReach[0], reachF = TREE_LOD.floorReach[1], floorAFar = Math.max(floorA, 2);
  const cells = TREE_LOD.cells;
  let visible = 0;
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci];
    if (!TREE_FRUSTUM.intersectsBox(c.box)) {
      if (c.visible) {
        for (let s = 0; s < 3; s++) {
          const sp = TREE_LOD.tiers[s];
          if (!sp) continue;
          const L = c.lists[s];
          for (let i = 0; i < L.length; i++) { const k = L[i]; if (sp.tierOf[k]) treeTierMove(s, k, sp.tierOf[k], 0); }
        }
        c.visible = false; changed = true;
      }
      continue;
    }
    c.visible = true; visible++;
    let pxCell = 0;
    if (cellMode) {
      const dx = Math.max(c.x0 - cx, 0, cx - c.x1), dy = Math.max(c.y0 - cy, 0, cy - c.y1), dz = Math.max(c.z0 - cz, 0, cz - c.z1);
      pxCell = TREE_LOD.nominalHeight * Kpx / Math.max(1, Math.hypot(dx, dy, dz));
    }
    for (let s = 0; s < 3; s++) {
      const sp = TREE_LOD.tiers[s];
      if (!sp) continue;
      const imp = TREE_LOD.imp[s], L = c.lists[s], H = sp.treeH, CY = sp.treeCY, T = sp.tierOf, Z = sp.zone, PD = sp.pend, PN = sp.pendN, dwell = TREE_LOD.dwell;
      const zoneMode = TREE_LOD.lodMode === 'zone', ZT = TREE_LOD.zoneTiers;
      for (let i = 0; i < L.length; i++) {
        const k = L[i];
        const dx = imp[k * 6] - cx, dy = CY[k] - cy, dz = imp[k * 6 + 2] - cz;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const px = cellMode ? pxCell : H[k] * Kpx / d;
        const cur = T[k];
        let want;
        if (force) want = force;
        else if (zoneMode) want = ZT[Z[k] ? Z[k] - 1 : 3];
        else if (!cur || reset) { want = 1; while (want < 4 && px < thr[want - 1]) want++; }
        else {
          want = cur;
          while (want > 1 && px > thr[want - 2] * (1 + hy)) want--;
          while (want < 4 && px < thr[want - 1] * (1 - hy)) want++;
        }
        /* the corridor's floor, unless a forced tier is being judged on its own */
        /* the floors are zone A's and B's; the outer band (3) exists for the zone rule and has no floor here */
        if (!force && !zoneMode && Z[k] && Z[k] <= 2) {
          /* the reaches carry the same 10% band as the pixel boundaries, so a tree at a reach does not flip */
          const rH = reachH * (cur === floorA ? 1.1 : 1), rF = reachF * (cur && cur <= 2 ? 1.1 : 1);
          const fl = Z[k] === 1 ? (d < rH ? floorA : d < rF ? floorAFar : 4) : (d < rF ? floorB : 4);
          if (want > fl) want = fl;
        }
        if (want !== cur) {
          /* a tree entering the frustum, a reset or a forced tier switches at once; otherwise
             the new tier has to be wanted for dwell frames running */
          if (!cur || reset || force || dwell <= 0 || (PD[k] === want && PN[k] >= dwell - 1)) { treeTierMove(s, k, cur, want); changed = true; PN[k] = 0; }
          else if (PD[k] === want) PN[k]++;
          else { PD[k] = want; PN[k] = 1; }
        } else PN[k] = 0;
      }
    }
  }
  TREE_LOD.resetPending = false;
  TREE_LOD.stats.cellsVisible = visible;
  TREE_LOD.stats.fading = TREE_LOD.queue.length - TREE_LOD.qHead;
  TREE_LOD.stats.updateMs = performance.now() - tStart;
  if (!changed) return;
  TREE_LOD.stats.updates++;
  TIER_FRAME = FRAME_NO;
  let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
  for (const species of TREE_LOD.tiers) {
    if (!species) continue;
    for (let i = 1; i <= 4; i++) {
      const tier = species.t[i];
      if (tier.dirtyM.length || tier.dirtyF.length) treeUploadsThisFrame++;
      if (tier.mesh) {
        tier.geo.instanceCount = tier.count;
        tier.mesh.visible = tier.count > 0;
        const dirty = tier.dirtyM.slice();
        flushRanges([tier.pos], dirty.slice(), 3);
        flushRanges([tier.par], dirty, 4);
        tier.dirtyM.length = 0;
      } else {
        for (const im of tier.parts) im.count = tier.count;
        flushRanges(tier.parts.map(im => im.instanceMatrix), tier.dirtyM, 16);
      }
      flushRanges(tier.fade, tier.dirtyF, 2);
    }
    t0 += species.t[1].count; t1 += species.t[2].count; t2 += species.t[3].count; t3 += species.t[4].count;
  }
  TREE_LOD.stats.tier0 = t0; TREE_LOD.stats.tier1 = t1; TREE_LOD.stats.tier2 = t2; TREE_LOD.stats.tier3 = t3;
}

lap('tree tiers (18 InstancedMesh + 3 impostor batches, cells)', { trees: stats.trees | 0, cells: TREE_LOD.cells.length });
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
      if (q.kind !== 'industrial' && q.kind !== 'commercial' && ringSD(px, pz, q.ring, 1) < 0) return true;
    for (const q of SI.at(px, pz)) if (ringSD(px, pz, q.ring, 1) < 0) return true;
    return false;
  };
  /* the same test every planter makes: never on a lake, never on its shore
     band, never below its water. These two rings had only the flat sea floor
     to go by, which on an inland course is the lowest lake and says nothing
     about the others -- cones stood in Stor-Rössjön as soon as the ground
     under them was measured rather than carved. */
  const inWater = (px, pz, h) => {
    for (const w of WI.at(px, pz)) {
      if (w.stream) continue;
      if (ringSD(px, pz, w.ring, 3) < 3 || h < w.level + 0.5) return true;
    }
    /* and the water only the ground knows: flat lake surfaces past the rings */
    return typeof terrainV2.isFlatWaterAt === 'function' && terrainV2.isFlatWaterAt(px, pz);
  };
  const cvx1 = cv.x0 + cv.nx * cv.cell, cvz1 = cv.z0 + cv.nz * cv.cell;
  /* the data ring: where the plans or the survey still reach */
  const GAP2 = LOWQ ? 18 : 13;
  for (let z = cv.z0; z < cvz1; z += GAP2) {
    if (shouldYieldWork()) await yieldWork();
    for (let x = cv.x0; x < cvx1; x += GAP2) {
      const i = Math.floor(x / GAP2), j = Math.floor(z / GAP2);
      /* inside the planted ring a cone stands only where the planter has
         thinned out: its chance is the complement of the planter's */
      if (x > MIDR.x0 + inset && x < MIDR.x1 - inset &&
          z > MIDR.z0 + inset && z < MIDR.z1 - inset &&
          rnd2(i + 61, j + 47) < midrEdgeFade(x, z)) continue;
      const px = x + (rnd2(i, j) - 0.5) * GAP2 * 1.6;
      const pz = z + (rnd2(i + 7, j + 3) - 0.5) * GAP2 * 1.6;
      if (V2_VEG_COVER && V2_VEG_COVER.covers(px, pz)) continue;
      const cvv = coverAt(px, pz);
      let wooded = cvv === 3;
      /* the surveyed rings only speak where the imagery has no answer */
      if (!wooded && cvv === 0) for (const v of VI.at(px, pz)) {
        if ((v.kind === 'forest' || v.kind === 'wood') && ringSD(px, pz, v.ring, 1) < 0) { wooded = true; break; }
      }
      if (!wooded) continue;
      if (openLand(px, pz)) continue;
      if (rnd2(i + 19, j + 13) > 0.8) continue;
      const h = terrainH(px, pz);
      if (h < GEO.seaLevel + 0.5) continue;
      if (inWater(px, pz, h)) continue;
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
      if (inWater(px, pz, h)) continue;
      pts.push(px, h - 0.5, pz, 1.5 + rnd2(i + 3, j + 71) * 1.1);
    }
  }
  const n = pts.length / 4;
  VISTA_PTS = pts;
  if (n && TREE_LOD.atlases.length === 3) {
    /* the same pictures the planted forest fades into, so the far ring and
       the middle ring are one forest: a cone that stood 12 m x s becomes a
       tree of the same height, species by hash, yaw by hash */
    const perSpecies = [[], [], []];
    for (let k = 0; k < n; k++) {
      const r = hash2(k * 7919 + 3, k * 104729 + 11);
      perSpecies[r < 0.58 ? 1 : r < 0.9 ? 0 : 2].push(k);
    }
    for (let s = 0; s < 3; s++) {
      const list = perSpecies[s];
      if (!list.length) continue;
      const geo = createImpostorGeometry(list.length);
      const mat = createImpostorMaterial(TREE_LOD.atlases[s], { crownBase: s === 2 ? uLeaf : color(SPECIES[s].cc), sunDirection: uSun, debug: TREE_LOD.debug });
      const posA = geo.getAttribute('aImpostorPos'), parA = geo.getAttribute('aImpostorParam');
      const th = SPECIES[s].templateHeight || 13;
      list.forEach((k, i) => {
        const s0 = pts[k * 4 + 3], sy = 12 * s0 * (0.85 + (k % 5) * 0.07) / th;
        posA.array.set([pts[k * 4], pts[k * 4 + 1], pts[k * 4 + 2]], i * 3);
        parA.array.set([hash2(k * 31 + 7, k * 17 + 5) * TAU, s0 * 0.9, sy, 0], i * 4);
      });
      posA.needsUpdate = parA.needsUpdate = true;
      geo.instanceCount = list.length;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
      mesh.userData.tag = 'vista';
      mesh.name = `vista-${['spruce', 'pine', 'birch'][s]}-impostor`;
      scene.add(mesh);
      stats.draws++;
    }
    stats.vista = n;
  } else if (n) {
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

lap('far vista cones', { vista: stats.vista | 0 });
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
    for (const q of II.at(px, pz)) if (ringSD(px, pz, q.ring, 3) < 3) { yard = true; break; }
    if (!yard) for (const q of LI.at(px, pz))
      if (q.kind !== 'industrial' && q.kind !== 'commercial' && ringSD(px, pz, q.ring, 1) < 0) { yard = true; break; }
    if (!yard) for (const q of SI.at(px, pz))
      if (q.kind === 'yard' && ringSD(px, pz, q.ring, 1) < 0) { yard = true; break; }
    if (yard) continue;                                  /* mown, cropped or worked ground */
    /* the clubhouse lawn is mown: no tussocks, no boulders on it */
    if (CLUB && Math.hypot(px - CLUB.cx, pz - CLUB.cz) < 52) continue;
    /* a clear-fell keeps its stumps: pale cut faces where the stand used to be */
    let cut = false;
    for (const q of SI.at(px, pz)) if (q.kind === 'cut' && ringSD(px, pz, q.ring, 1) < 0) { cut = true; break; }
    if (cut) {
      if (rnd(i, j, 8) < 0.55) STU.push(px, terrainH(px, pz) - 0.04, pz, 0.8 + rnd(i, j, 7) * 0.5, rnd(i, j, 5) * TAU);
      continue;
    }
    const h = terrainH(px, pz);
    let wet = false;
    for (const w of WI.at(px, pz)) {
      if (w.stream) { if (distToLine(px, pz, w.line, w.w * 3) < w.w * 3) wet = true; }
      else if (ringSD(px, pz, w.ring, 3) < 3 || h < w.level + 0.4) wet = true;
    }
    if (!wet && typeof terrainV2.isFlatWaterAt === 'function' && terrainV2.isFlatWaterAt(px, pz)) wet = true;
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

lap('ground cover (tufts, bushes, stones, stumps)');
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

/*@MAPPED_OBJECT_SELECTORS*/
/* Explicit support tags determine placement and asset type. A bend in an OSM
   power way is not evidence of a tower, nor is missing voltage evidence of a pole. */
function mappedPowerSupports(power) {
  const found = new Map();
  for (const [kind, points] of [['tower', power.towers || []], ['pole', power.poles || []]]) {
    for (const value of points) {
      const p = Array.isArray(value) ? value : value.c;
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new Error('Invalid mapped power support');
      const key = p.join(',');
      if (found.has(key)) continue;
      let yaw = 0;
      for (const way of power.lines || []) {
        const i = way.line.findIndex(q => q[0] === p[0] && q[1] === p[1]);
        if (i < 0) continue;
        const a = way.line[Math.max(0, i - 1)], b = way.line[Math.min(way.line.length - 1, i + 1)];
        yaw = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        break;
      }
      found.set(key, { c: p.slice(), kind, yaw });
    }
  }
  return [...found.values()];
}
function mappedPointObjects(points) {
  const found = new Map();
  for (const p of points || []) {
    const t = p.tags || {};
    const kind = t.amenity === 'fountain' ? 'fountain' : t.barrier === 'gate' ? 'gate' :
      t.man_made === 'mast' ? 'mast' : t.man_made === 'flagpole' ? 'flagpole' : null;
    if (!kind) continue; // OSM tree points must not duplicate the LiDAR crown layer.
    if (!p.id || !Array.isArray(p.c) || p.c.length !== 2 || !p.c.every(Number.isFinite)) throw new Error('Invalid mapped point object');
    if (!found.has(p.id)) found.set(p.id, { id: p.id, c: p.c.slice(), kind, tags: { ...t }, prov: p.prov || 'osm' });
  }
  return [...found.values()];
}
/*@/MAPPED_OBJECT_SELECTORS*/

/* --------------------------------------------------------- power and rail
   Two 130 kV corridors cross the property diagonally -- surveyed tower by tower in
   OSM -- and the Mellansel branch railway runs on its embankment just north of the
   E4. Both are the kind of thing a local sees without seeing; their absence is what
   made the middle distance read as nowhere in particular. */
{
  const PW = M.infra.power || { lines: [], towers: [], poles: [] };
  const mappedOnly = M.infra.objectPlacement === 'mapped-only';
  const supports = mappedOnly ? mappedPowerSupports(PW) : [];
  const supportByPoint = new Map(supports.map(p => [p.c.join(','), p]));
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
  for (const support of supports) {
    const [x, z] = support.c;
    (support.kind === 'tower' ? towers : polesArr).push([x, terrainH(x, z) - 0.3, z, support.yaw]);
  }
  for (const ln of PW.lines) {
    const big = mappedOnly ? ln.line.some(p => supportByPoint.get(p.join(','))?.kind === 'tower') : (ln.voltage || 0) >= 100000;
    const attach = big ? 19.5 : 8.2; // Rendering estimate; source support heights are unknown.
    const L = mappedOnly ? ln.line.filter(p => supportByPoint.has(p.join(','))) : ln.line;
    if (!mappedOnly) for (let i = 0; i < L.length; i++) {
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
      if (!mappedOnly && !IN(x0, z0) && !IN(x1, z1)) continue;
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
    if (mappedOnly) im.userData = { tag: 'mapped-power-support', placement: 'explicit OSM support point', dimensions: 'estimated height and asset geometry', orientation: 'estimated from mapped power way' };
    scene.add(im);
    stats.draws++;
  };
  inst(towerGeo, towers, 0x7d8287);
  inst(poleGeo, polesArr, 0x5c5148);
  stats.pylons = towers.length + polesArr.length;
  stats.mappedPowerTowers = mappedOnly ? towers.length : 0;
  stats.mappedPowerPoles = mappedOnly ? polesArr.length : 0;

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
/* One draw per kind of furniture. Each of these used to be its own Mesh --
   288 objects at Puttom, tee markers and plates and posts and poles -- and
   three's per-object work (matrices, bindings, a uniform buffer write each)
   ran twice a frame for every one of them, shadow pass and main pass: at
   rest, with nothing moving, that was most of the frame's CPU time, and an
   uneven frame cadence is what the water's animation shows as jitter. Same
   geometry, same material, same transforms, in an InstancedMesh per kind. */
const instancedFurniture = (geo, mat, list, { cast = false, colour = false, into, tag = 'furniture' } = {}) => {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length), M = new THREE.Matrix4();
  list.forEach((e, i) => { M.makeRotationY(e.rot || 0); M.setPosition(e.x, e.y, e.z); im.setMatrixAt(i, M); if (colour) im.setColorAt(i, e.colour); });
  im.instanceMatrix.needsUpdate = true;
  if (colour) im.instanceColor.needsUpdate = true;
  im.castShadow = cast; im.userData.tag = tag;
  im.computeBoundingSphere();
  into.add(im);
  return im;
};
const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);
const plateSites = [];
if (M.infra.objectPlacement !== 'mapped-only') {
  const plateGeo = new THREE.BoxGeometry(0.4, 0.28, 0.06);
  plateGeo.translate(0, 0.62, 0);
  const postGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.62, 5);
  postGeo.translate(0, 0.31, 0);
  const postMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x6b6154), roughness: 0.9 });
  const PLATES = [[100, 0xd8443c], [150, 0xe8c33a], [200, 0xf2f0e8]];
  const plateInst = new Map(PLATES.map(([, col]) => [col, []])), postInst = [];
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
       distance used to jump at a polyline vertex because the lateral offset
       inherited one segment's bearing and then the next one's. Use a centred
       six-metre secant for furniture only: it mitres the corridor edge through
       a dogleg without altering the authored route or any playing distance. */
    for (let s = 0; s <= total; s += 0.25) {
      const f = 1 - s / total;
      const p = alongLine(line, f);
      const before = alongLine(line, f - 3 / total);
      const after = alongLine(line, f + 3 / total);
      p.b = Math.atan2(after.x - before.x, after.z - before.z);
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
        const rot = p.b + Math.PI / 2;
        plateInst.get(col).push({ x, y, z, rot });
        postInst.push({ x, y, z, rot });
        /* recorded where they are PLANTED, so the gate measures the plate that
           was drawn rather than re-deriving where it ought to be -- a checker
           that restates the formula agrees with the bug */
        plateSites.push({ hole: h.n, says: dist, x, z, side });
      }
    }
  }
  for (const [, col] of PLATES) instancedFurniture(plateGeo, new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(col), roughness: 0.5, emissive: new THREE.Color(col), emissiveIntensity: 0.1 }), plateInst.get(col), { cast: true, into: furnitureGroup, tag: 'plates' });
  instancedFurniture(postGeo, postMat, postInst, { into: furnitureGroup, tag: 'plates' });
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
const FURN = { poles: [], cups: [], markers: [] };
for (const h of HOLES) {
  const [x, z] = h.pin;
  const y = terrainH(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  FURN.poles.push({ x, y: y + 1.3, z });
  /* the club flies yellow flags with its badge, not red-and-amber halves */
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.5, 8, 3),
    new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xf2d24b),
      roughness: 0.85, side: THREE.DoubleSide }));
  cloth.position.set(0.39, 2.28, 0);
  g.add(cloth);
  /* the cup, which is the thing that makes a green read as a green up close */
  FURN.cups.push({ x, y: y + 0.02, z });
  flagGroup.add(g);
  pins.push({ hole: h.n, cloth, g });

  /* tee markers: a pair per card tee, straddling the line */
  /* A pair of markers per card tee, set the width of a tee apart rather than the
     width of a stance, because that is how far apart they really are and at 0.13 m
     across they are otherwise unreadable from the deck behind them. */
  // The nominal references still drive the HUD and camera; physical marker
  // pairs require their own evidence when this ground uses mapped placement.
  const mk = M.infra.objectPlacement === 'mapped-only' ? [] : h.tees.marks;
  for (let k = 0; k < mk.length; k++) {
    const m = mk[k], b = m.b * Math.PI / 180, R = rightOf(b);
    const colour = new THREE.Color(TEE_COLS[k]);
    for (const s of [-2.6, 2.6]) {
      const mx = m.c[0] + R[0] * s, mz = m.c[1] + R[1] * s;
      FURN.markers.push({ x: mx, y: terrainH(mx, mz) + 0.11, z: mz, colour });
    }
  }
}
/* the furniture's draws: one for every pole, one for every cup, one for every
   marker (the colour rides on the instance; a white material times it is the
   colour the material used to carry) */
instancedFurniture(new THREE.CylinderGeometry(0.035, 0.045, 2.6, 6),
  new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xf2f4f2), roughness: 0.35, metalness: 0.5 }), FURN.poles, { cast: true, into: flagGroup, tag: 'pins' });
instancedFurniture(new THREE.CylinderGeometry(0.054, 0.054, 0.12, 12),
  new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x11170f), roughness: 1 }), FURN.cups, { into: flagGroup, tag: 'pins' });
instancedFurniture(new THREE.SphereGeometry(0.13, 8, 6),
  new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xffffff), roughness: 0.45, metalness: 0.15 }), FURN.markers, { cast: true, colour: true, into: flagGroup, tag: 'markers' });

/* Mapped OSM point identities, anchored to their source coordinates. Generic
   dimensions and orientations below are rendering estimates, not measurements.
   A flagpole does not establish a flag design; a fountain does not establish an
   ornamental basin; neither detail is invented here. */
if (M.infra.objectPlacement === 'mapped-only') {
  const objects = mappedPointObjects(M.infra.mappedPoints);
  const metal = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x737a7b), roughness: 0.65, metalness: 0.3 });
  const spray = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xd9ebef), roughness: 0.1, transparent: true, opacity: 0.7 });
  const numericMetres = value => {
    const match = typeof value === 'string' && value.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:m)?$/);
    return match && +match[1] > 0 ? +match[1] : null;
  };
  const nearPathBearing = (x, z) => {
    let distance = Infinity, yaw = 0;
    for (const way of [...M.infra.paths, ...M.infra.tracks, ...M.infra.roads]) {
      for (let i = 1; i < way.line.length; i++) {
        const a = way.line[i - 1], b = way.line[i], dx = b[0] - a[0], dz = b[1] - a[1];
        const length2 = dx * dx + dz * dz;
        if (!length2) continue;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2));
        const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
        if (d < distance) { distance = d; yaw = Math.atan2(dx, dz); }
      }
    }
    return yaw;
  };
  for (const object of objects) {
    const [x, z] = object.c, group = new THREE.Group();
    let base = terrainH(x, z);
    if (object.kind === 'fountain') {
      for (const water of WI.at(x, z)) if (!water.stream && ringSD(x, z, water.ring) <= 0) base = Math.max(base, water.level);
    }
    group.position.set(x, base, z);
    group.userData = { tag: 'mapped-point-object', sourceId: object.id, kind: object.kind,
      placement: 'OSM point; absolute position accuracy unknown',
      dimensions: 'generic rendering estimate unless an explicit metre-valued source tag is present',
      elevation: 'terrain or water sampled; not measured object elevation' };
    const cylinder = (radius, height, ox = 0, oz = 0, mat = metal) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 6), mat);
      mesh.position.set(ox, height / 2, oz); mesh.castShadow = object.kind !== 'fountain';
      group.add(mesh); stats.draws++;
    };
    if (object.kind === 'fountain') {
      cylinder(0.05, numericMetres(object.tags.height) || 1.4, 0, 0, spray);
    } else if (object.kind === 'gate') {
      const width = numericMetres(object.tags.width) || 3, height = numericMetres(object.tags.height) || 1;
      cylinder(0.055, height, -width / 2); cylinder(0.055, height, width / 2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, 0.07), metal);
      bar.position.y = height * 0.8; group.add(bar); stats.draws++;
      group.rotation.y = nearPathBearing(x, z);
      group.userData.orientation = 'estimated perpendicular to nearest mapped route';
    } else {
      const height = numericMetres(object.tags.height) || (object.kind === 'flagpole' ? 6 : 15);
      cylinder(object.kind === 'flagpole' ? 0.05 : 0.14, height);
    }
    scene.add(group);
  }
  stats.mappedPointObjects = objects.length;
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
  /* a square post from four quads: the batch's pole helper is declared further
     down this block and the buildings are built before it exists */
  function stick(x, y0, z, h, r, col) {
    const c = [[-r, -r], [r, -r], [r, r], [-r, r]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4];
      quad([x + ax, y0, z + az], [x + bx, y0, z + bz], [x + bx, y0 + h, z + bz], [x + ax, y0 + h, z + az], col);
    }
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

  /* An open shelter: a roof on posts with one back wall -- the covered bays at
     the end of a range tee line, a shed with its front open. Traced as a
     building of kind "roof". The back wall is the side away from the range
     field when there is one, else the longest side. */
  function canopy(ring, hgt) {
    const { base } = houseBase(ring);
    const n = ring.length;
    const DARK = L(0x3a3632);
    for (const p of ring) stick(p[0], base - 0.3, p[1], hgt + 0.3, 0.07, DARK);
    const faces = triangulate(ring);
    for (const [a, b2, c2] of faces) {
      tri([ring[a][0], base + hgt, ring[a][1]], [ring[c2][0], base + hgt, ring[c2][1]],
          [ring[b2][0], base + hgt, ring[b2][1]], ROOFA);
      tri([ring[a][0], base + hgt + 0.22, ring[a][1]], [ring[b2][0], base + hgt + 0.22, ring[b2][1]],
          [ring[c2][0], base + hgt + 0.22, ring[c2][1]], ROOFA);
    }
    const field = (M.scenery.range || [])[0];
    const away = field ? centroidOf(field) : null;
    let back = 0, score = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const s2 = away ? Math.hypot(mx - away[0], mz - away[1]) : Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s2 > score) { score = s2; back = i; }
    }
    const a = ring[back], b = ring[(back + 1) % n];
    quad([a[0], base - 0.3, a[1]], [b[0], base - 0.3, b[1]], [b[0], base + hgt, b[1]], [a[0], base + hgt, a[1]], L(0x6b4a3a));
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      quad([p[0], base + hgt - 0.3, p[1]], [q[0], base + hgt - 0.3, q[1]], [q[0], base + hgt + 0.22, q[1]], [p[0], base + hgt + 0.22, p[1]], TRIM);
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
    if (b.kind === 'roof') { canopy(b.ring, b.h || 3.0); continue; }
    const hgt = b.h || (isClub ? CLUB_LOOK.height
              : b.kind === 'industrial' ? 5.5 : b.kind === 'commercial' ? 4.2
              : b.kind === 'house' || b.kind === 'residential' ? 3.0
              : areaOf(b.ring) < 45 ? 2.6 : 3.4);
    /* a course module may state one building's real colours by its id -- the
       annex that continues the clubhouse's blue, a shed with a dark roof --
       where the generic hashed palette would guess */
    const look = (SCENERY && SCENERY.buildingLooks && b.id && SCENERY.buildingLooks[b.id]) || null;
    house(b.ring, hgt, isClub ? L(CLUB_LOOK.wall) : look?.wall ? L(look.wall) : wallOf(cx, cz, b.kind, b.name),
          isClub ? L(CLUB_LOOK.roof) : look?.roof ? L(look.roof) : roofOf(cx, cz), isClub && !CLUB_LOOK.gable);
    let glazedEdge = -1;
    /* an outbuilding the course knows has a row of white-framed windows on
       every wall long enough to carry them, the way the red buildings round a
       Norrland clubhouse do; the generic pass draws blank walls */
    if (!isClub && look?.windows) {
      const { base } = houseBase(b.ring);
      const GLASS2 = L(0x212830);
      const sill = look.windowSill ?? 1.3;
      for (let e = 0; e < b.ring.length; e++) {
        const a0 = b.ring[e], a1 = b.ring[(e + 1) % b.ring.length];
        const ex = a1[0] - a0[0], ez = a1[1] - a0[1], el = Math.hypot(ex, ez);
        if (el < 5) continue;
        const ux = ex / el, uz = ez / el, nx = -uz, nz = ux;
        const nWin = Math.floor((el - 2.0) / 2.6);
        for (const sgn of [1, -1]) for (let w2 = 0; w2 < nWin; w2++) {
          const t0 = 1.0 + w2 * 2.6 + 0.8;
          const W = (tt, off, y) => [a0[0] + ux * tt + nx * off * sgn, y, a0[1] + uz * tt + nz * off * sgn];
          quad(W(t0 - 0.62, 0.08, base + sill - 0.1), W(t0 + 0.62, 0.08, base + sill - 0.1),
               W(t0 + 0.62, 0.08, base + sill + 1.3), W(t0 - 0.62, 0.08, base + sill + 1.3), TRIM);
          quad(W(t0 - 0.5, 0.12, base + sill), W(t0 + 0.5, 0.12, base + sill),
               W(t0 + 0.5, 0.12, base + sill + 1.12), W(t0 - 0.5, 0.12, base + sill + 1.12), GLASS2);
        }
      }
    }
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
        /* A two-tone facade: the lower storey in its own colour, a band laid a
           whisker proud of the wall so the joint reads as a change of material. */
        if (CLUB_LOOK.lowerWall && CLUB_LOOK.lowerHeight > 0) {
          const LOW = L(CLUB_LOOK.lowerWall);
          for (let e = 0; e < b.ring.length; e++) {
            const a0 = b.ring[e], a1 = b.ring[(e + 1) % b.ring.length];
            const ex = a1[0] - a0[0], ez = a1[1] - a0[1], el = Math.hypot(ex, ez) || 1;
            const ox = -ez / el * 0.03, oz = ex / el * 0.03;
            for (const sgn of [1, -1])
              quad([a0[0] + ox * sgn, base - 0.5, a0[1] + oz * sgn], [a1[0] + ox * sgn, base - 0.5, a1[1] + oz * sgn],
                   [a1[0] + ox * sgn, base + CLUB_LOOK.lowerHeight, a1[1] + oz * sgn], [a0[0] + ox * sgn, base + CLUB_LOOK.lowerHeight, a0[1] + oz * sgn], LOW);
          }
        }
        /* The glazed gable: the whole end of the building that faces the course
           is a window wall up into the gable, with a balcony along it at first
           floor. The end is chosen by where the course is -- the mean of the
           green centres -- so the module states a fact and not a coordinate. */
        if (CLUB_LOOK.gable && CLUB_LOOK.glazedGable) {
          let tx = 0, tz = 0, tn = 0;
          for (const h of HOLES) if (h.green && h.green.c) { tx += h.green.c[0]; tz += h.green.c[1]; tn++; }
          const T = tn ? [tx / tn, tz / tn] : [B.cx, B.cz];
          const sgn = ((T[0] - B.cx) * c + (T[1] - B.cz) * s) >= 0 ? 1 : -1;
          const hw = B.hw + 0.35, hd = B.hd;
          const rise = clampf(Math.tan(0.52) * B.hd, 1.2, 3.4);
          const yLow = base + Math.max(0.3, CLUB_LOOK.lowerHeight), yEave = base + hgt, yRidge = yEave + rise - 0.25;
          const u = sgn * (hw + 0.06);
          const E = (v, y) => P(u, v, y);
          /* the glass: a rectangle to the eaves and the triangle above it */
          quad(E(-(hd - 0.5), yLow), E(hd - 0.5, yLow), E(hd - 0.5, yEave), E(-(hd - 0.5), yEave), GLASS);
          tri(E(-(hd - 0.5), yEave), E(hd - 0.5, yEave), E(0, yRidge), GLASS);
          tri(E(hd - 0.5, yEave), E(-(hd - 0.5), yEave), E(0, yRidge), GLASS);
          /* white mullions and the floor line, the frame that reads from the fairway */
          const uf = sgn * (hw + 0.1);
          for (let v = -(hd - 0.5); v <= hd - 0.5 + 0.01; v += (2 * hd - 1) / Math.max(2, Math.round((2 * hd - 1) / 1.9))) {
            const top = yEave + (rise - 0.25) * Math.max(0, 1 - Math.abs(v) / (hd - 0.5));
            quad(P(uf, v - 0.06, yLow), P(uf, v + 0.06, yLow), P(uf, v + 0.06, top), P(uf, v - 0.06, top), TRIM);
          }
          for (const y of [yLow + (yEave - yLow) * 0.5, yEave - 0.1])
            quad(P(uf, -(hd - 0.5), y - 0.06), P(uf, hd - 0.5, y - 0.06), P(uf, hd - 0.5, y + 0.06), P(uf, -(hd - 0.5), y + 0.06), TRIM);
          quad(P(uf, -(hd - 0.5), yLow - 0.06), P(uf, hd - 0.5, yLow - 0.06), P(uf, hd - 0.5, yLow + 0.06), P(uf, -(hd - 0.5), yLow + 0.06), TRIM);
          /* the balcony: a slab out from the glass at first-floor level, a rail on posts */
          if (CLUB_LOOK.balcony && M.infra.objectPlacement !== 'mapped-only') {
            const out = 2.2, y0 = yLow - 0.05, y1 = yLow + 0.22;
            const S = (du, v, y) => P(sgn * (hw + du), v, y);
            const bv0 = -(hd - 0.4), bv1 = hd - 0.4;
            quad(S(0, bv0, y1), S(out, bv0, y1), S(out, bv1, y1), S(0, bv1, y1), L(0x8a7d70));
            quad(S(0, bv1, y0), S(out, bv1, y0), S(out, bv0, y0), S(0, bv0, y0), L(0x5b5148));
            quad(S(out, bv0, y0), S(out, bv1, y0), S(out, bv1, y1), S(out, bv0, y1), L(0x5b5148));
            const railY = y1 + 1.05;
            for (let v = bv0; v <= bv1 + 0.01; v += 1.5) { const p = S(out - 0.08, v, y1); stick(p[0], y1, p[2], 1.05, 0.025, TRIM); }
            for (const side of [[bv0, bv1, out - 0.08, out - 0.08], [bv0, bv0, 0, out - 0.08], [bv1, bv1, 0, out - 0.08]]) {
              const [va, vb, da, db] = side;
              quad(S(da, va, railY - 0.04), S(db, vb, railY - 0.04), S(db, vb, railY + 0.04), S(da, va, railY + 0.04), TRIM);
            }
          }
          /* the ring's own end wall under the glass keeps no windows */
          let bestDot = -Infinity;
          for (let e = 0; e < b.ring.length; e++) {
            const a0 = b.ring[e], a1 = b.ring[(e + 1) % b.ring.length];
            const mx = (a0[0] + a1[0]) / 2 - B.cx, mz = (a0[1] + a1[1]) / 2 - B.cz;
            const d = (mx * c + mz * s) * sgn;
            if (d > bestDot) { bestDot = d; glazedEdge = e; }
          }
        }
        /* windows hang on the ring's own walls, not the bounding box -- the first
           two attempts floated them across the gaps where the footprint steps back */
        for (let e = 0; e < b.ring.length; e++) {
          const a0 = b.ring[e], a1 = b.ring[(e + 1) % b.ring.length];
          const ex = a1[0] - a0[0], ez = a1[1] - a0[1];
          const el = Math.hypot(ex, ez);
          if (el < 6 || e === glazedEdge) continue;
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
        /* The two default chimney positions are decorative, not mapped. */
        for (const uC of M.infra.objectPlacement === 'mapped-only' ? [] : [Lb * 0.28, Lb * 0.72]) {
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
        /* This generic terrace, four stairs and six flagpoles have inferred
           positions. A mapped-only ground keeps its source building silhouette
           and renders additional physical objects only from their own evidence. */
        if (M.infra.objectPlacement !== 'mapped-only') {
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

  /* Landuse describes a residential area, not individual house footprints.
     Retain this historical filler only for grounds permitting inferred objects;
     mapped buildings and source-derived far-building boxes above/below remain. */
  stats.inferredBuildings = 0;
  for (const q of (M.infra.landuse || [])) {
    if (M.infra.objectPlacement === 'mapped-only' || q.kind !== 'residential') continue;
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
      stats.inferredBuildings++;
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
  if (rng && !(M.scenery.mappedFeatures || []).some(f => f.kind === 'range_target_surface')) {
    /* the tee bays stand on the field's WEST edge and the balls fly east */
    /* The tee end is the end of the field you walk to from the clubhouse. Deriving it
       beats writing it down: five of these six pages carried Norrfallsvikens hut
       coordinate, and a range traced anywhere else put its flags in another field. */
    const hut = (() => {
      /* a course that has MEASURED its tee line says so, and is believed —
         Ribbingsfors's bays are a 369 m2 laser-flat bench at the field's south
         end, which is the far end from its clubhouse */
      if (M.scenery.rangeTee) return M.scenery.rangeTee;
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
  /* The tee line, where a course has traced one: a mat every bay pitch along
     the line with a divider between bays, a low kerb behind, and the safety
     net on its poles along the sides the trace names. The net is its own
     mesh because it is see-through; everything else joins the batch. */
  const RF = M.scenery.rangeFacilities;
  if (RF && RF.bays && RF.bays.length >= 2) {
    const MAT = L(0x2c5a2b), DIV = L(0xe8e6df), DIVCAP = L(0x2f6f3a), KERB = L(0x8d8a82), STEEL = L(0x4a4d50);
    const STRIP = C.hard.map(v => v * 1.18);
    const pitch = RF.bayPitch || 3;
    const { P: TL } = resamp(RF.bays, pitch);
    const fieldC = centroidOf(rng || RF.bays);
    /* The tee line is one prepared strip -- pale hardstanding four metres
       deep along the whole line, a kerb at its back -- and the mats and
       dividers stand on it. Drawn as a strip rather than per mat, so it
       reads as a tee line from the clubhouse and not as a row of specks. */
    const side = i => {
      const p = TL[i], q = TL[Math.min(TL.length - 1, i + 1)], o = TL[Math.max(0, i - 1)];
      let ux = q[0] - o[0], uz = q[1] - o[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      let nx = -uz, nz = ux;                                  /* towards the field */
      if ((fieldC[0] - p[0]) * nx + (fieldC[1] - p[1]) * nz < 0) { nx = -nx; nz = -nz; }
      return { p, ux, uz, nx, nz, y: terrainH(p[0], p[1]) + 0.05 };
    };
    for (let i = 0; i < TL.length - 1; i++) {
      const a = side(i), b = side(i + 1);
      const A = (bb, yy) => [a.p[0] + a.nx * bb, yy ?? a.y, a.p[1] + a.nz * bb];
      const Bq = (bb, yy) => [b.p[0] + b.nx * bb, yy ?? b.y, b.p[1] + b.nz * bb];
      quad(A(-1.6), Bq(-1.6), Bq(2.4), A(2.4), STRIP);
      /* the kerb at the back of the strip */
      quad(A(-1.6, a.y), Bq(-1.6, b.y), Bq(-1.6, b.y + 0.2), A(-1.6, a.y + 0.2), KERB);
      quad(A(-1.8, a.y + 0.2), Bq(-1.8, b.y + 0.2), Bq(-1.6, b.y + 0.2), A(-1.6, a.y + 0.2), KERB);
    }
    for (let i = 0; i < TL.length; i++) {
      const { p, ux, uz, nx, nz, y } = side(i);
      const M4 = (a, bb, yy) => [p[0] + ux * a + nx * bb, yy ?? y + 0.03, p[1] + uz * a + nz * bb];
      if (i < TL.length - 1) {
        /* the mat, and a white tee-marker line at its front edge */
        quad(M4(-0.9, -0.1), M4(0.9, -0.1), M4(0.9, 1.7), M4(-0.9, 1.7), MAT);
        quad(M4(-0.9, 1.7), M4(0.9, 1.7), M4(0.9, 1.85), M4(-0.9, 1.85), DIV);
      }
      /* the divider on the bay boundary: a white panel standing across the
         line with a green cap, 1.1 m tall and a metre and a half deep */
      const D = (bb, yy) => [p[0] + ux * (-pitch / 2 + 0.02) + nx * bb, yy, p[1] + uz * (-pitch / 2 + 0.02) + nz * bb];
      if (i > 0) {
        quad(D(-0.4, y), D(1.3, y), D(1.3, y + 1.05), D(-0.4, y + 1.05), DIV);
        quad(D(1.3, y), D(-0.4, y), D(-0.4, y + 1.05), D(1.3, y + 1.05), DIV);
        quad(D(-0.4, y + 1.05), D(1.3, y + 1.05), D(1.3, y + 1.15), D(-0.4, y + 1.15), DIVCAP);
        quad(D(1.3, y + 1.05), D(-0.4, y + 1.05), D(-0.4, y + 1.15), D(1.3, y + 1.15), DIVCAP);
      }
    }
    for (const net of (RF.nets || [])) {
      const H = RF.netHeight || 10;
      const { P: NP } = resamp(net, 12);
      const pos = [], idx = [];
      for (let i = 0; i < NP.length; i++) {
        const p = NP[i], y0 = terrainH(p[0], p[1]);
        pole(p[0], y0 - 0.4, p[1], H + 0.4, 0.14, STEEL);
        pos.push(p[0], y0 + 0.15, p[1], p[0], y0 + H, p[1]);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const netMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0x1d2622), transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(g, netMat);
      m.userData.tag = 'range-net';
      scene.add(m);
      stats.draws++;
      stats.rangeNets = (stats.rangeNets || 0) + 1;
    }
  }
  /* The cart fleet, in a row on the gravel where the course puts it: a body,
     a roof on four posts, and a windscreen -- the shape a golf cart is from
     twenty metres. White with a blue one, like the club's own photograph. */
  const CP = M.scenery.cartPark;
  if (CP && CP.line && CP.line.length >= 2) {
    const [a, b] = [CP.line[0], CP.line[CP.line.length - 1]];
    const n = Math.max(1, CP.count || 6);
    let ux = b[0] - a[0], uz = b[1] - a[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const nx = -uz, nz = ux;
    const box = (cx, y0, cz, w, h, d, col) => {
      /* w across the row (u), d along the cart (n) */
      const C = (du, dn, y) => [cx + ux * du + nx * dn, y, cz + uz * du + nz * dn];
      const hw = w / 2, hd = d / 2;
      quad(C(-hw, -hd, y0), C(hw, -hd, y0), C(hw, -hd, y0 + h), C(-hw, -hd, y0 + h), col);
      quad(C(hw, hd, y0), C(-hw, hd, y0), C(-hw, hd, y0 + h), C(hw, hd, y0 + h), col);
      quad(C(hw, -hd, y0), C(hw, hd, y0), C(hw, hd, y0 + h), C(hw, -hd, y0 + h), col);
      quad(C(-hw, hd, y0), C(-hw, -hd, y0), C(-hw, -hd, y0 + h), C(-hw, hd, y0 + h), col);
      quad(C(-hw, -hd, y0 + h), C(hw, -hd, y0 + h), C(hw, hd, y0 + h), C(-hw, hd, y0 + h), col);
    };
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      const cx = a[0] + (b[0] - a[0]) * t, cz = a[1] + (b[1] - a[1]) * t;
      const y = terrainH(cx, cz);
      const body = k === n - 1 ? L(0x2f5fa8) : L(0xe9e9e6);
      box(cx, y + 0.28, cz, 1.2, 0.55, 2.3, body);
      box(cx, y + 0.28, cz, 1.25, 0.35, 0.9, L(0x1a1a1a));           /* the seat block */
      quad([cx + ux * -0.62 + nx * -0.9, y + 0.83, cz + uz * -0.62 + nz * -0.9], [cx + ux * 0.62 + nx * -0.9, y + 0.83, cz + uz * 0.62 + nz * -0.9],
           [cx + ux * 0.62 + nx * -0.9, y + 1.75, cz + uz * 0.62 + nz * -0.9], [cx + ux * -0.62 + nx * -0.9, y + 1.75, cz + uz * -0.62 + nz * -0.9], L(0x9fb3c2));
      for (const [du, dn] of [[-0.58, -1.05], [0.58, -1.05], [-0.58, 1.0], [0.58, 1.0]])
        pole(cx + ux * du + nx * dn, y + 0.8, cz + uz * du + nz * dn, 1.0, 0.03, L(0x2a2a2a));
      box(cx, y + 1.8, cz, 1.3, 0.06, 2.35, L(0xf2f2ef));
      for (const dn of [-0.85, 0.85]) for (const du of [-0.55, 0.55])
        box(cx + ux * du + nx * dn, y + 0.02, cz + uz * du + nz * dn, 0.2, 0.45, 0.45, L(0x1a1a1a));
    }
    stats.carts = n;
  }
  /* Motorhomes on a lot that says so (the ställplats west of Puttom's
     clubhouse): white boxes with a dark cab and a window band, nose to the
     lot's long axis, every second bay taken. */
  {
    let vans = 0;
    for (const p of (M.infra.parking || [])) {
      if (p.vehicles !== 'motorhome' || !p.ring || p.ring.length < 3) continue;
      const B = obb2(p.ring);
      if (!B || B.hw < 4) continue;
      const c = Math.cos(B.ang), s = Math.sin(B.ang);
      /* bays run across the long axis, two rows when the lot is deep enough */
      const rows = B.hd > 8 ? [-(B.hd - 4.2), B.hd - 4.2] : [0];
      const box = (cx, cz, du, dn, w, h, d, y0, col) => {
        const ux = c, uz = s, nx = -s, nz = c;
        const X = (a, b, y) => [cx + ux * a + nx * b, y, cz + uz * a + nz * b];
        const hw = w / 2, hd = d / 2;
        quad(X(du - hw, dn - hd, y0), X(du + hw, dn - hd, y0), X(du + hw, dn - hd, y0 + h), X(du - hw, dn - hd, y0 + h), col);
        quad(X(du + hw, dn + hd, y0), X(du - hw, dn + hd, y0), X(du - hw, dn + hd, y0 + h), X(du + hw, dn + hd, y0 + h), col);
        quad(X(du + hw, dn - hd, y0), X(du + hw, dn + hd, y0), X(du + hw, dn + hd, y0 + h), X(du + hw, dn - hd, y0 + h), col);
        quad(X(du - hw, dn + hd, y0), X(du - hw, dn - hd, y0), X(du - hw, dn - hd, y0 + h), X(du - hw, dn + hd, y0 + h), col);
        quad(X(du - hw, dn - hd, y0 + h), X(du + hw, dn - hd, y0 + h), X(du + hw, dn + hd, y0 + h), X(du - hw, dn + hd, y0 + h), col);
      };
      for (const v of rows) {
        for (let u = -B.hw + 2.2; u <= B.hw - 2.2; u += 3.6) {
          const x = B.cx + u * c - v * s, z = B.cz + u * s + v * c;
          if (ringSD(x, z, p.ring) > -1.6) continue;
          if (hash2(Math.round(x * 2), Math.round(z * 2)) > 0.62) continue;
          const y = terrainH(x, z);
          const facing = v >= 0 ? 1 : -1;
          box(x, z, 0, 0, 2.3, 2.7, 6.8, y + 0.35, L(0xf1f0ea));
          box(x, z, 0, facing * 2.9, 2.2, 1.7, 1.2, y + 0.4, L(0x3a3d42));       /* the cab */
          box(x, z, 0, -facing * 0.6, 2.36, 0.55, 4.6, y + 1.55, L(0x2a2f36));   /* the window band */
          for (const du of [-0.85, 0.85]) for (const dn of [-2.3, 2.1])
            box(x, z, du, dn, 0.28, 0.5, 0.7, y + 0.02, L(0x1a1a1a));
          vans++;
        }
      }
    }
    stats.motorhomes = vans;
  }
  /* Legacy inferred crossings remain for grounds without a reviewed bridge
     inventory. A mapped-only ground renders only its confirmed deck footprints. */
  if (M.infra.bridgePlacement !== 'mapped-only') {
    const PLANK = L(0x8a7455), BEAM = L(0x5a4633);
    let bridges = 0;
    const cross = (p, q, a, b) => {
      const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
      if (Math.abs(d) < 1e-9) return null;
      const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
      const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
    };
    for (const pth of (M.infra.paths || []).concat(M.infra.tracks || [])) {
      const L2 = pth.line;
      if (!L2 || L2.length < 2) continue;
      const w = pth.kind === 'path' ? 1.5 : 1.9;
      for (let i = 0; i < L2.length - 1; i++) {
        const p = L2[i], q = L2[i + 1];
        const hits = [];
        for (const wq of WI.at((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) {
          const segs = wq.stream ? wq.line : wq.ring;
          if (!segs) continue;
          const m = wq.stream ? segs.length - 1 : segs.length;
          for (let j = 0; j < m; j++) {
            const t = cross(p, q, segs[j], segs[(j + 1) % segs.length]);
            if (t !== null) hits.push({ t, level: wq.stream ? null : wq.level });
          }
        }
        if (!hits.length) continue;
        hits.sort((x, y) => x.t - y.t);
        const t0 = Math.max(0, hits[0].t - 1.2 / hyp(p, q)), t1 = Math.min(1, hits[hits.length - 1].t + 1.2 / hyp(p, q));
        const A = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0], Bp = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
        const level = hits.find(h => h.level !== null)?.level;
        const yA = terrainH(A[0], A[1]), yB = terrainH(Bp[0], Bp[1]);
        const deck = Math.max(level !== undefined ? level + 0.45 : -1e9, Math.max(yA, yB) + 0.08);
        let ux = Bp[0] - A[0], uz = Bp[1] - A[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        const nx = -uz, nz = ux, hw = w / 2 + 0.4;
        const D = (s2, side, y) => [A[0] + ux * s2 + nx * side, y, A[1] + uz * s2 + nz * side];
        quad(D(0, -hw, deck), D(ul, -hw, deck), D(ul, hw, deck), D(0, hw, deck), PLANK);
        quad(D(0, hw, deck - 0.22), D(ul, hw, deck - 0.22), D(ul, hw, deck), D(0, hw, deck), BEAM);
        quad(D(ul, -hw, deck - 0.22), D(0, -hw, deck - 0.22), D(0, -hw, deck), D(ul, -hw, deck), BEAM);
        for (const side of [-hw + 0.06, hw - 0.06]) {
          for (let s2 = 0; s2 <= ul + 0.01; s2 += Math.max(1.2, ul / Math.max(1, Math.round(ul / 1.6)))) {
            const pp = D(Math.min(s2, ul), side, deck);
            pole(pp[0], deck, pp[2], 0.95, 0.04, BEAM);
          }
          quad(D(0, side, deck + 0.9), D(ul, side, deck + 0.9), D(ul, side, deck + 0.98), D(0, side, deck + 0.98), PLANK);
        }
        bridges++;
      }
    }
    stats.bridges = (stats.bridges || 0) + bridges;
  }
  /* Norrfällsvikens kapell -- the fishing village's white wooden chapel of 1649,
     on its surveyed OSM footprint (way 185982798) down by the harbour. It is the
     village's icon and the one built thing on this cape that earns a bespoke
     shape.

     Two things here were WRONG until a photograph and the kommun's own adopted
     kulturmiljöplan were looked at, and both were wrong in the direction this
     repo keeps warning about -- a roof read as dark because it was in shadow,
     and a bell tower assumed to be part of the building because most churches'
     are.

     Kramfors kommun's kulturmiljöplan describes it as "byggnad med sadeltak
     målad i vitt med en fristående klockstapel", and the riksintresse Y 29 text
     adds that it "ligger i ett fritt läge på höjden ovan vattnet ... omgivet av
     en öppen gistvall". So: white, gabled, and its bell frame STANDS CLEAR of
     it. The roof is an orange-red pantile, measured off a ground-level
     photograph at rgb(177,90,48) against walls at rgb(225,225,225) -- not the
     near-black shingle drawn here before.

     One trap worth leaving written down: a travel blog covering this coast
     shows a white chapel with a GREY shingle roof and a big RED TRIPOD bell
     frame. That is Bönhamn's chapel, not this one. Nordingrå parish has four
     fiskekapell and they are easy to swap.

     What is NOT known is where the klockstapel stands, to the metre -- OSM
     carries only the chapel footprint. It is placed off the seaward gable,
     clear of the walls, which is what the photograph shows; the FORM is
     documented, the exact position is not. */
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
      /* MEASURED off a ground-level photograph: roof rgb(177,90,48), the
         orange-red pantile of this coast, and not the near-black shingle this
         used to draw. TRIM is the dark boarding of the bell frame's cap. */
      const WALLH = 3.1, RIDGE = 6.4, TILE = L(0xb15a30), TRIM = L(0x3a332c);
      quad(P(-hw, -hd, y0), P(hw, -hd, y0), P(hw, -hd, y0 + WALLH), P(-hw, -hd, y0 + WALLH), WHITE);
      quad(P(hw, hd, y0), P(-hw, hd, y0), P(-hw, hd, y0 + WALLH), P(hw, hd, y0 + WALLH), WHITE);
      tri(P(hw, -hd, y0 + WALLH), P(hw, hd, y0 + WALLH), P(hw, 0, y0 + RIDGE), WHITE);
      tri(P(-hw, hd, y0 + WALLH), P(-hw, -hd, y0 + WALLH), P(-hw, 0, y0 + RIDGE), WHITE);
      quad(P(hw, -hd, y0), P(hw, hd, y0), P(hw, hd, y0 + WALLH), P(hw, -hd, y0 + WALLH), WHITE);
      quad(P(-hw, hd, y0), P(-hw, -hd, y0), P(-hw, -hd, y0 + WALLH), P(-hw, hd, y0 + WALLH), WHITE);
      quad(P(-hw - 0.25, -hd - 0.3, y0 + WALLH - 0.1), P(hw + 0.25, -hd - 0.3, y0 + WALLH - 0.1),
           P(hw + 0.25, 0, y0 + RIDGE), P(-hw - 0.25, 0, y0 + RIDGE), TILE);
      quad(P(hw + 0.25, hd + 0.3, y0 + WALLH - 0.1), P(-hw - 0.25, hd + 0.3, y0 + WALLH - 0.1),
           P(-hw - 0.25, 0, y0 + RIDGE), P(hw + 0.25, 0, y0 + RIDGE), TILE);
      /* The FRISTÅENDE klockstapel: four splayed legs carrying an open bell
         stage under a small boarded pyramid cap, standing clear of the gable
         rather than growing out of it. Its footprint is inferred; its form is
         what the kulturmiljöplan and the photograph both describe. */
      const su = -hw - 3.4;
      const SX = c[0] + ux * su, SZ = c[1] + uz * su;
      const sy = terrainH(SX, SZ) - 0.1;
      const SPREAD = 1.5, WAIST = 0.62, LEGTOP = 4.2, STAGE = 5.4, CAP = 7.0;
      for (let k4 = 0; k4 < 4; k4++) {
        const aa = k4 / 4 * TAU + TAU / 8;
        const fx = Math.cos(aa) * SPREAD, fz = Math.sin(aa) * SPREAD;
        const tx = Math.cos(aa) * WAIST, tz = Math.sin(aa) * WAIST;
        /* each leg as a thin splayed board, wide at the foot and narrow at the
           stage, which is what reads as a klockstapel at any distance */
        quad([SX + fx - Math.sin(aa) * 0.16, sy, SZ + fz + Math.cos(aa) * 0.16],
             [SX + fx + Math.sin(aa) * 0.16, sy, SZ + fz - Math.cos(aa) * 0.16],
             [SX + tx + Math.sin(aa) * 0.10, sy + LEGTOP, SZ + tz - Math.cos(aa) * 0.10],
             [SX + tx - Math.sin(aa) * 0.10, sy + LEGTOP, SZ + tz + Math.cos(aa) * 0.10], WHITE);
      }
      /* the open bell stage: four corner posts and the boarded parapet under them */
      for (let k4 = 0; k4 < 4; k4++) {
        const aa = k4 / 4 * TAU + TAU / 8, ab = (k4 + 1) / 4 * TAU + TAU / 8;
        quad([SX + Math.cos(aa) * WAIST, sy + LEGTOP, SZ + Math.sin(aa) * WAIST],
             [SX + Math.cos(ab) * WAIST, sy + LEGTOP, SZ + Math.sin(ab) * WAIST],
             [SX + Math.cos(ab) * WAIST, sy + LEGTOP + 0.55, SZ + Math.sin(ab) * WAIST],
             [SX + Math.cos(aa) * WAIST, sy + LEGTOP + 0.55, SZ + Math.sin(aa) * WAIST], WHITE);
        pole(SX + Math.cos(aa) * WAIST, sy + LEGTOP, SZ + Math.sin(aa) * WAIST, STAGE - LEGTOP, 0.07, WHITE);
        tri([SX + Math.cos(aa) * (WAIST + 0.18), sy + STAGE, SZ + Math.sin(aa) * (WAIST + 0.18)],
            [SX + Math.cos(ab) * (WAIST + 0.18), sy + STAGE, SZ + Math.sin(ab) * (WAIST + 0.18)],
            [SX, sy + CAP, SZ], TRIM);
      }
      pole(SX, sy + CAP - 0.1, SZ, 0.9, 0.05, WHITE);
      quad([SX - ux * 0.30, sy + CAP + 0.52, SZ - uz * 0.30], [SX + ux * 0.30, sy + CAP + 0.52, SZ + uz * 0.30],
           [SX + ux * 0.30, sy + CAP + 0.65, SZ + uz * 0.30], [SX - ux * 0.30, sy + CAP + 0.65, SZ - uz * 0.30], WHITE);
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
/* ?post=0 renders the scene straight to the canvas, no bloom: the harness's way to tell a scene fault from a pipeline fault */
if (!LOWQ && new URLSearchParams(location.search).get('post') !== '0') {
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

/* The shadow camera follows the player, because a 2 km ortho frustum spends its
   whole resolution on ground nobody is looking at -- and it follows in a way
   that does not swim. Two rules: the box is one of a few FIXED sizes, chosen
   with hysteresis, so its texel size changes rarely (a re-fit in 14 m steps
   re-sampled the whole map at every step); and it moves only in whole texels
   of its own map, measured in the light's view space, so the map samples the
   same world points from one frame to the next. With the sun fixed the shadow
   camera's rotation is constant and the rounding is exact; three's
   LightShadow.updateMatrices builds that camera from the light's position and
   its target with y up, which is the basis used here. The normal bias scales
   with the fit, a texel's worth of push whatever the size.
   ?shadowsnap=0 and V3D.setShadowSnap switch the snap off for a before/after. */
const SHADOW_FITS = [260, 400, 600, 850, 1150];
let shadowSnap = new URLSearchParams(location.search).get('shadowsnap') !== '0';
let shadowRadiusOverride = null;   /* a harness stepping a flight pose by pose gives it the flight's fixed fit */
const SUN_BASIS = { d: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), m: new THREE.Matrix4(),
                    o: new THREE.Vector3(), texel: 0, remainder: 0, R: 0 };
/* What moves a shadow: the sun or its box (placeSun), a tree changing tier or
   fading (an upload this frame, or a fade queue still draining), the terrain
   (a tile arriving or leaving, and the 240 ms morph after it), a flight -- and
   once a second regardless, so anything not on this list still catches up
   within a second. Nothing else in the scene casts and moves: the flag cloths
   wave but do not cast. At rest none of it fires and the pass is skipped. */
function shadowRest(now) {
  const S = SHADOW_REST_STATE; S.frames++; S.sinceRender++;
  if (!SHADOW_REST) return;
  let why = '';
  if (!sun.position.equals(S.sunPos) || !sun.target.position.equals(S.target)) { S.sunPos.copy(sun.position); S.target.copy(sun.target.position); why = 'sun'; }
  const batches = terrainV2.runtime?.layer?.batches;
  if (batches) {
    let tiles = 0, uploads = 0, morphStart = -1, morphMs = 240;
    for (const b of batches.values()) {
      tiles += b.layersByTile.size; uploads += b.textureUploads; morphMs = b.morphDurationMilliseconds;
      for (const t of b.morphStartByTile.values()) if (t !== null && t > morphStart) morphStart = t;
    }
    if (tiles !== S.tiles || uploads !== S.uploads || morphStart !== S.morphStart) { S.tiles = tiles; S.uploads = uploads; S.morphStart = morphStart; S.dirtyUntil = now + morphMs + 80; }
  }
  if (!why && now < S.dirtyUntil) why = 'terrain';
  /* a fade under way changes the dither every frame with no upload at all -- the clock is a uniform -- so the map follows the queue, whoever drives the clock */
  if (!why && (treeUploadsThisFrame > 0 || TREE_LOD.queue.length !== TREE_LOD.qHead)) why = 'trees';
  if (!why && flying > 0) why = 'flight';
  if (!why && S.sinceRender >= 60) why = 'tick';
  treeUploadsThisFrame = 0;
  if (why) { sun.shadow.needsUpdate = true; S.renders++; S.sinceRender = 0; S.why = why; }
}

function placeSun() {
  const t = controls.target;
  const d = uSun.value;
  const c = sun.shadow.camera;
  const want = shadowRadiusOverride ?? (flying > 0 ? 580 : clampf(camera.position.distanceTo(t) * 1.15 + 90, 260, 1150));
  /* the fit: the smallest fixed size that holds the want; it grows at once and
     shrinks only once the want is well under the next size down */
  let R = c.top || 0;
  if (!R || want > R) R = SHADOW_FITS.find(f => f >= want) ?? SHADOW_FITS[SHADOW_FITS.length - 1];
  else { const i = SHADOW_FITS.indexOf(R); if (i > 0 && want < SHADOW_FITS[i - 1] * 0.9) R = SHADOW_FITS.find(f => f >= want) ?? R; }
  if (R !== c.top) {
    c.left = -R; c.right = R; c.top = R; c.bottom = -R;
    c.near = 200; c.far = 2400;
    c.updateProjectionMatrix();
    sun.shadow.normalBias = 0.22 * Math.min(2.5, R / 260);
  }
  const B = SUN_BASIS, texel = 2 * R / sun.shadow.mapSize.width;
  if (!B.d.equals(d)) {
    B.d.copy(d);
    B.m.lookAt(d, B.o, THREE.Object3D.DEFAULT_UP);
    B.right.setFromMatrixColumn(B.m, 0);
    B.up.setFromMatrixColumn(B.m, 1);
  }
  let ox = 0, oy = 0;
  if (shadowSnap) {
    const u = t.dot(B.right), v = t.dot(B.up);
    ox = Math.round(u / texel) * texel - u;
    oy = Math.round(v / texel) * texel - v;
  }
  B.texel = texel; B.R = R; B.remainder = Math.hypot(ox, oy) / texel;
  const cx = t.x + B.right.x * ox + B.up.x * oy, cy = t.y + B.right.y * ox + B.up.y * oy, cz = t.z + B.right.z * ox + B.up.z * oy;
  sun.position.set(cx + d.x * 1200, cy + d.y * 1200, cz + d.z * 1200);
  sun.target.position.set(cx, cy, cz);
  sun.target.updateMatrixWorld();
}

/* ------------------------------------------------------------------- ui */
/* A course opens on its YELLOW tee -- the tee most members play -- which the
   manifest names per course as `tees.def`, since the yellow one is second on a
   five-tee card, first at Norrfallsviken and third on the two six-tee cards.
   An old manifest without the field still opens on the back tee. */
const DEF_TEE = CMETA.tees.def ?? 0;
let hole = 1, teeIdx = DEF_TEE, camMode = 'orbit', flying = 0;
const TEE_NAMES = CMETA.tees.names;

const holesBar = document.getElementById('holes');
for (let n = 1; n <= NHOLES; n++) {
  const b = document.createElement('button');
  b.className = 'hb'; b.textContent = n;
  b.onclick = () => goHole(n, true);
  holesBar.appendChild(b);
}
const prevBtn = document.getElementById('holePrevBtn');
const nextBtn = document.getElementById('holeNextBtn');
if (prevBtn) {
  prevBtn.onclick = () => {
    const target = hole <= 1 ? NHOLES : hole - 1;
    goHole(target, true);
  };
}
if (nextBtn) {
  nextBtn.onclick = () => {
    const target = hole >= NHOLES ? 1 : hole + 1;
    goHole(target, true);
  };
}
const teesEl = document.getElementById('tees');

function drawCard() {
  const h = HOLES[hole - 1];
  document.getElementById('cno').textContent = h.n;
  document.getElementById('cnm').textContent = h.name || `Hål ${h.n}`;
  /* A korthalsbana is not rated, so it has no stroke index and none is invented:
     h.idx is null there and the line is just the par. Printing "Index null"
     would state something about a real club that no source supports. */
  const cardLine = h.idx == null ? `Par ${h.par}` : `Par ${h.par} · Index ${h.idx}`;
  document.getElementById('cpi').textContent =
    CMETA.cardStatus ? `${cardLine} · Preliminärt kort` : cardLine;
  teesEl.innerHTML = '';
  h.t.forEach((m, k) => {
    const d = document.createElement('div');
    d.className = 'tee' + (k === teeIdx ? ' on' : '');
    d.innerHTML = `<b>${m}</b><i>${TEE_NAMES[k]}</i>`;
    d.onclick = () => {
      teeIdx = k;
      drawCard();
      buildStrategy();
      if (camMode === 'tee') setCam('tee');
      if (kik) kikRender();
    };
    teesEl.appendChild(d);
  });
  const rise = h.elev.rise;
  let factsHtml = `Tee <b>${h.elev.tee.toFixed(0)} m</b> · Green <b>${h.elev.green.toFixed(0)} m</b> ö.h.`;
  if (CMETA.cardStatus) factsHtml += `<br><span class="data-status">${CMETA.cardStatus}</span>`;
  if (BOOTQ.get('debug') === '1') {
    factsHtml += `<br><span class="debug-pipeline">Ritad <b>${h.lineLen.toFixed(0)} m</b> · kortet <b>${h.t[0]} m</b></span>`;
  }
  document.getElementById('facts').innerHTML = factsHtml;

  const rHoleNum = document.getElementById('railHoleNum');
  if (rHoleNum) rHoleNum.textContent = `HÅL ${h.n}`;
  const rHolePar = document.getElementById('railHolePar');
  if (rHolePar) rHolePar.textContent = `PAR ${h.par}`;
  const rHoleDist = document.getElementById('railHoleDist');
  if (rHoleDist) rHoleDist.textContent = `${(h.t && h.t[teeIdx ?? 0]) || (h.lineLen ? h.lineLen.toFixed(0) : 350)} M`;
  const rHoleIndex = document.getElementById('railHoleIndex');
  const rHoleIndexDot = document.getElementById('railHoleIndexDot');
  if (h.idx != null) {
    if (rHoleIndex) { rHoleIndex.textContent = `INDEX ${h.idx}`; rHoleIndex.style.display = ''; }
    if (rHoleIndexDot) rHoleIndexDot.style.display = '';
  } else {
    if (rHoleIndex) rHoleIndex.style.display = 'none';
    if (rHoleIndexDot) rHoleIndexDot.style.display = 'none';
  }
  const rHoleSub = document.getElementById('railHoleSub');
  if (rHoleSub) {
    rHoleSub.innerHTML = `Spelas <b>${Math.abs(rise).toFixed(0)} m ${rise >= 0 ? 'uppför' : 'nedför'}</b>`;
  }
  document.getElementById('nnm').textContent = h.name || `Hål ${h.n}`;
  document.getElementById('ntx').textContent = h.note || h.shape || '';
  document.querySelectorAll('.hb').forEach((b, i) => b.classList.toggle('on', i + 1 === hole));
  drawMini();
}

const camTween = { on: false, t: 0, dur: 1.5, from: new THREE.Vector3(), to: new THREE.Vector3(),
                   lookFrom: new THREE.Vector3(), lookTo: new THREE.Vector3() };
/* The ground keeps the camera out of itself gently (engine/camera-clamp.mjs):
   eye height is eased toward, a rise ahead along the camera's own motion is
   climbed before it arrives, and what the ground lifted it gives back when
   the ground falls away. A snap to eye height kicked the view up on every
   bump of the 1 m heightfield -- measured at the 5th tee, 5.6 cm steps under
   a pan and 48 cm steps under an orbit -- which is what "terrain jitter"
   felt like at a tee. */
const groundClamp = createGroundClamp({ heightAt: (x, z) => terrainH(x, z) });

function flyTo(pos, look, dur = 1.5) {
  groundClamp.reset();
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
  const activeBtn = holesBar?.children[hole - 1];
  if (activeBtn && holesBar) {
    activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  kikClear();
  if (kik) kikRender();
  buildStrategy();
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
    if (teeIdx !== DEF_TEE) sp.set('tee', teeIdx + 1); else sp.delete('tee');
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
  const railEl = document.getElementById('rail');
  const tog = document.getElementById('uiToggle');
  const railCloseBtn = document.getElementById('railCloseBtn');
  const railBackdrop = document.getElementById('railBackdrop');
  const miniEl = document.getElementById('mini');
  const noteEl = document.getElementById('note');
  const miniTog = document.getElementById('mobileMiniToggle');
  const noteTog = document.getElementById('mobileNoteToggle');
  const miniCloseBtn = document.getElementById('miniCloseBtn');
  const noteCloseBtn = document.getElementById('noteCloseBtn');

  const closeMobileSheet = () => {
    railEl?.classList.remove('open');
    tog?.classList.remove('on');
    railBackdrop?.classList.remove('open');
  };
  const closeMini = () => {
    miniEl?.classList.remove('mobile-open');
    miniTog?.classList.remove('on');
  };
  const closeNote = () => {
    noteEl?.classList.remove('mobile-open');
    noteTog?.classList.remove('on');
  };

  if (tog) {
    tog.onclick = (e) => {
      e?.stopPropagation();
      const open = railEl?.classList.toggle('open');
      tog.classList.toggle('on', open);
      railBackdrop?.classList.toggle('open', open);
      if (open) {
        closeMini();
        closeNote();
      }
    };
  }

  if (railCloseBtn) railCloseBtn.onclick = (e) => { e?.stopPropagation(); closeMobileSheet(); };
  if (railBackdrop) railBackdrop.onclick = () => closeMobileSheet();

  if (miniTog) {
    miniTog.onclick = (e) => {
      e?.stopPropagation();
      const open = miniEl?.classList.toggle('mobile-open');
      miniTog.classList.toggle('on', open);
      if (open) {
        closeMobileSheet();
        closeNote();
        kikSheet(false);
        drawMini();
      }
    };
  }
  if (miniCloseBtn) miniCloseBtn.onclick = (e) => { e?.stopPropagation(); closeMini(); };

  if (noteTog) {
    noteTog.onclick = (e) => {
      e?.stopPropagation();
      const open = noteEl?.classList.toggle('mobile-open');
      noteTog.classList.toggle('on', open);
      if (open) {
        closeMobileSheet();
        closeMini();
        kikSheet(false);
      }
    };
  }
  if (noteCloseBtn) noteCloseBtn.onclick = (e) => { e?.stopPropagation(); closeNote(); };

  railEl?.querySelectorAll('.btn').forEach(b =>
    b.addEventListener('click', () => { if (window.matchMedia('(max-width:768px)').matches) closeMobileSheet(); }));
}
document.getElementById('flyBtn').onclick = () => {
  if (flying > 0) {
    stopFlight();
    setCam(camMode);
  } else {
    initHoleFlight(HOLES[hole - 1]);
    showTourCard();
    flying = 1e-4;
  }
};

/* ------------------------------------------------------------ ren vy */
function setClean(on) {
  document.body.classList.toggle('clean', on);
}
document.getElementById('cleanExit').onclick = () => { if (tour) endTour(); else setClean(false); };

/* ------------------------------------------------------- bansafari & PGA Tour TV flight
   One continuous drone shot per hole, flown the way a broadcast flyover is
   flown: a slow push off from behind the tee, a climb to a cruise high enough
   to read the whole hole, a descent into the approach with the pin held in
   frame, and a wide sweep round the green that ends on the reverse angle,
   looking back down the hole. The shot is decided at build time as a table of
   STATIONS every FL.ds metres -- position, look point, lens -- and the frame
   loop only walks it. Four things make it read as television:

   - the ground under the flight is an ENVELOPE, not the terrain: the highest
     ground across a 24 m swath, lifted where the swath is forest, limited to a
     12 degree climb so no ridge is a bump, then filtered. The drone glides over
     what is there instead of tracing it.
   - speed is a function of distance, integrated once into a time table, so
     the whole shot has one velocity profile (push-off, cruise, ease into the
     sweep, settle) and no seam at the green.
   - the camera is oriented by an explicit lookAt every frame. OrbitControls'
     update() is what used to turn it and that call is skipped while flying, so
     the earlier flight moved the camera along its spline staring in one fixed
     direction -- the "wrong angles" it was known for.
   - position and look point pass through critically damped springs with
     different time constants (a gimbal is slower than an airframe), which is
     what makes a pan start and stop without a kick.                          */
const FL = {
  ds: 3,             // station spacing, m
  preTee: 44,        // the push-off starts this far behind the tee
  altTee: 24,        // metres above the envelope at the tee
  lead: 100,         // the look point runs this far ahead down the line
  orbitDeg: 180,     // the sweep round the green; 180 ends on the reverse angle
  vOrbit: 12,        // m/s on the sweep, at least ...
  sweepRate: 13.5,   // ... and degrees per second round the pin, which is what the eye sees
  sweepPitch: 26,    // degrees down to the PIN on the sweep at the design radius ...
  sweepPitchMax: 33, // ... steepening to this much before the radius widens to clear the trees
  sweepAimBelow: 7,  // the pin sits this many degrees below the frame centre: horizon in, green low
  sweepClear: 14,    // metres the sweep keeps above the envelope, by widening
  swath: 12,         // half-width of the ground swath under the flight
  canopy: 18,        // how much forest lifts the envelope
  climb: 0.22,       // slope limit of the envelope (tan 12.4 degrees)
  fovCruise: 52, fovOrbit: 46,
  offset: 8,         // lateral offset off the line on the fairway
  hold: 1.0,         // seconds on the closing frame before the travel shot leaves
  vTransit: 36,      // m/s between holes ...
  altTransit: 30,    // ... this far above the envelope (crowns included), over whatever lies between
  lookAhead: 110,    // the travel shot looks this far along its route
  lineUp: 40,        // the straight run behind the push-off point the route arrives along
  panMax: 17,        // degrees per second of heading change a bend on the hole may be flown at ...
  panMaxTransit: 28, // ... and on the travel shot, where only the gimbal rate (swingRate) is what the viewer sees
  swingRate: 18,     // degrees per second the gimbal pans on the travel shot ...
  tiltRate: 10,      // ... and tilts
  accel: 3.5,        // m/s^2 the drone brakes and accelerates at around a bend
};
const tourFlight = {
  st: null,                  // the station table
  t: 0, duration: 0, orbitT: 0, holdTimer: 0,
  pos: new THREE.Vector3(), look: new THREE.Vector3(),
  posV: new THREE.Vector3(),
  yaw: 0, pitch: 0, dist: 60, yawV: 0, pitchV: 0, distV: 0,   // the gimbal, about the camera
  fov: 48, fovV: 0, baseFov: camera.fov,
  initialized: false, cardPending: false,
  fairwayRatio: 0.6,
};

/* critically damped spring toward a moving target (Unity's SmoothDamp) */
const _sdC = new THREE.Vector3();
function smoothDamp(cur, vel, target, smoothTime, dt) {
  const w = 2 / Math.max(1e-4, smoothTime), x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  _sdC.subVectors(cur, target);
  const tx = (vel.x + w * _sdC.x) * dt, ty = (vel.y + w * _sdC.y) * dt, tz = (vel.z + w * _sdC.z) * dt;
  vel.x = (vel.x - w * tx) * e; vel.y = (vel.y - w * ty) * e; vel.z = (vel.z - w * tz) * e;
  cur.x = target.x + (_sdC.x + tx) * e; cur.y = target.y + (_sdC.y + ty) * e; cur.z = target.z + (_sdC.z + tz) * e;
}
function smoothDampF(cur, vel, target, smoothTime, dt) {
  const w = 2 / Math.max(1e-4, smoothTime), x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const c = cur - target, tmp = (vel + w * c) * dt;
  return [target + (c + tmp) * e, (vel - w * tmp) * e];
}
/* a polyline [x, z, a] resampled at an even step; the attribute rides along */
function resampleXZ(P, step) {
  const out = [P[0].slice()];
  let need = step;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    let pos = 0;
    while (pos + need <= L) {
      pos += need; need = step;
      const f = pos / L;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
    need -= L - pos;
  }
  const last = P[P.length - 1], o = out[out.length - 1];
  if (Math.hypot(last[0] - o[0], last[1] - o[1]) > step * 0.5) out.push(last.slice());
  return out;
}
/* box-filter the xz of a polyline, endpoints pinned, corners rounded */
function boxSmoothXZ(P, half, passes) {
  let cur = P;
  for (let p = 0; p < passes; p++) {
    const n = cur.length, out = cur.map(q => q.slice());
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half), b = Math.min(n - 1, i + half);
      let sx = 0, sz = 0;
      for (let j = a; j <= b; j++) { sx += cur[j][0]; sz += cur[j][1]; }
      const m = b - a + 1, w = Math.min(1, Math.min(i, n - 1 - i) / half);
      out[i][0] = cur[i][0] + (sx / m - cur[i][0]) * w;
      out[i][1] = cur[i][1] + (sz / m - cur[i][1]) * w;
    }
    cur = out;
  }
  return cur;
}
const boxSmooth1 = (A, half) => A.map((_, i) => {
  const a = Math.max(0, i - half), b = Math.min(A.length - 1, i + half);
  let s = 0; for (let j = a; j <= b; j++) s += A[j];
  return s / (b - a + 1);
});
/* max(a, b) without the kink: a smooth maximum over a band of `k` metres */
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
/* the tallest crown top per 10 m cell of the planted population, built once
   per population (its size is the cache key, since v2 stands arrive later) */
let treeTops = null;
function treeTopGrid() {
  const total = trees[0].length + trees[1].length + trees[2].length;
  if (treeTops && treeTops.total === total) return treeTops;
  const cell = 10, m = new Map(), key = (i, j) => (i + 50000) * 100000 + (j + 50000);
  for (let sp = 0; sp < 3; sp++) {
    const T = trees[sp], th = SPECIES[sp].templateHeight || 14;
    for (let k = 0; k < T.length; k += 6) {
      const top = T[k + 1] + T[k + 3] * th, kk = key(Math.floor(T[k] / cell), Math.floor(T[k + 2] / cell));
      const v = m.get(kk);
      if (v === undefined || top > v) m.set(kk, top);
    }
  }
  treeTops = {
    total, cell,
    at: (x, z) => {
      const i0 = Math.floor(x / cell), j0 = Math.floor(z / cell);
      let t = -Infinity;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const v = m.get(key(i0 + di, j0 + dj));
        if (v !== undefined && v > t) t = v;
      }
      return t;
    },
  };
  return treeTops;
}

/* `from` is the pose the previous hole's shot ended in ({pos, look, dir}); when
   given, the table starts with a TRAVEL SHOT from there to behind this tee and
   the springs are carried across, so the tour is one continuous take. */
function initHoleFlight(h, from = null) {
  tourFlight.st = null;
  if (!h || !h.line || h.line.length < 2) return;
  const gc = h.green.c, pin = h.pin || gc;
  const L = h.line.map(p => [p[0], p[1]]);
  if (hyp(L[L.length - 1], gc) > 4) L.push([gc[0], gc[1]]);
  const lineLen = polyLen(L);
  if (lineLen < 40) return;

  /* the hole line at 2 m, rounded through its doglegs the way a pilot flies them;
     index i is the parameter s = 2i along the ORIGINAL line, kept through the
     smoothing so a distance down the hole still names the same place */
  const line = boxSmoothXZ(resampleXZ(L.map(p => [p[0], p[1], 0]), 2), 9, 2);
  const lineAt = s => {
    const f = clampf(s / 2, 0, line.length - 1), i = Math.floor(f), t = f - i, j = Math.min(line.length - 1, i + 1);
    return [line[i][0] + (line[j][0] - line[i][0]) * t, line[i][1] + (line[j][1] - line[i][1]) * t];
  };
  const bearingAt = s => { const a = lineAt(Math.max(0, s - 8)), b = lineAt(Math.min(lineLen, s + 8)); return Math.atan2(b[0] - a[0], b[1] - a[1]); };

  /* the envelope sample: the highest ground across the swath and the tallest
     PLANTED crown over it -- the trees themselves, not a forest class, because
     the planter reads the satellite raster and the v2 registry and a class
     lookup misses most of what it stood up. The class-based canopy lift stays
     as the fallback where a stand is not in the population (a far ring). What
     a drone must clear, not what is under it. */
  const tops = treeTopGrid();
  const envAt = (x, z, b) => {
    const rb = rightOf(b);
    let hm = -Infinity, canopy = 0;
    for (const o of [-1, -0.5, 0, 0.5, 1]) {
      const sx = x + rb[0] * o * FL.swath, sz = z + rb[1] * o * FL.swath;
      const g = terrainH(sx, sz);
      hm = Math.max(hm, g, tops.at(sx, sz));
      canopy = Math.max(canopy, g + FL.canopy * (classify(sx, sz).forest || 0));
    }
    return Math.max(hm, canopy);
  };

  /* geometry of the sweep. The side is chosen by MEASURING the envelope on
     both candidate arcs -- the drone sweeps where there is air, not where a
     convention says. The pitch down to the pin is FIXED: where trees or a
     bank behind the green would force the camera up, the radius widens
     instead, because a sweep that climbs over the canopy ends up looking
     straight down at a disc of green with no horizon. */
  const pinY = terrainH(pin[0], pin[1]);
  const tanPitch = Math.tan(FL.sweepPitch * Math.PI / 180);
  const R0 = clampf(34 + lineLen * 0.03, 38, 50);
  const nArc = Math.max(6, Math.round(FL.orbitDeg / 10));
  const arcEnv = (dir, R, phi0) => {
    let mean = 0, max = -Infinity;
    for (let k = 0; k <= nArc; k++) {
      const a = phi0 + dir * (k / nArc) * FL.orbitDeg * Math.PI / 180;
      const e = envAt(pin[0] + Math.sin(a) * R, pin[1] + Math.cos(a) * R, a + dir * Math.PI / 2);
      mean += e / (nArc + 1); max = Math.max(max, e);
    }
    return { mean, max };
  };
  /* Hn is the height the sweep must fly above the pin: the design pitch at the
     design radius, or whatever clears the tallest thing on the arc. The pitch
     may steepen to sweepPitchMax before the radius gives way; past that the
     arc widens, and past the widest arc the height simply rises. */
  const tanMax = Math.tan(FL.sweepPitchMax * Math.PI / 180);
  let R = R0, Hn = R0 * tanPitch, dir = 1, sEnd = 0, phi0 = 0;
  for (let pass = 0; pass < 3; pass++) {
    const dApp = clampf(R + 12, 30, lineLen * 0.45);
    sEnd = lineLen - dApp;
    const pApp = lineAt(sEnd);
    phi0 = Math.atan2(pApp[0] - pin[0], pApp[1] - pin[1]);
    const eP = arcEnv(1, R, phi0), eN = arcEnv(-1, R, phi0);
    if (pass === 0) dir = eP.mean <= eN.mean ? 1 : -1;
    const eMax = (dir > 0 ? eP : eN).max;
    Hn = Math.max(R0 * tanPitch, eMax + FL.sweepClear - pinY);
    R = clampf(Hn / tanMax, R0, 85);
  }
  const bEnd = bearingAt(sEnd);
  const pApp = lineAt(sEnd);
  const arcLen = R * FL.orbitDeg * Math.PI / 180;
  const orbitY = pinY + Hn;
  /* the frame centre aims above the pin so the horizon stays inside the top
     of frame: 7 degrees on a shallow sweep, up to 11 where trees steepened it */
  const pitchPin = Math.atan2(Hn, R);
  const aimBelow = clampf(pitchPin * 180 / Math.PI - 19, FL.sweepAimBelow, FL.sweepAimBelow + 4);
  const lookPin = [pin[0], orbitY - R * Math.tan(pitchPin - aimBelow * Math.PI / 180), pin[1]];
  const a1 = phi0 + dir * 0.2;
  const rEnd = rightOf(bEnd);
  const side = ((Math.sin(a1) * R + pin[0] - pApp[0]) * rEnd[0] + (Math.cos(a1) * R + pin[1] - pApp[1]) * rEnd[1]) >= 0 ? 1 : -1;

  /* waypoints [x, z, lineS]: push-off, the fairway a little off-axis on the
     sweep's side, then the arc. lineS is the distance down the hole a station
     corresponds to, negative behind the tee, past lineLen on the sweep. */
  const W = [];
  const b0 = bearingAt(0), F0 = [Math.sin(b0), Math.cos(b0)], p0 = lineAt(0);
  const preS = -FL.preTee;
  if (from) {
    /* the travel shot: carry the sweep's heading for a beat, cross to a line-up
       point straight behind the next tee, and arrive along the hole's own axis.
       lineS keeps counting down behind the push-off point so every rule that
       reads it (altitude, look, lens) sees the transit as "before the tee". */
    const A = [from.pos[0], from.pos[2]];
    const B = [p0[0] - F0[0] * (FL.preTee + FL.lineUp), p0[1] - F0[1] * (FL.preTee + FL.lineUp)];
    /* The route must ARRIVE at B heading down the hole, and the previous
       green is as often in front of the next tee as behind it -- so the
       last leg is a turning circle tangent to the hole's axis at B, on A's
       side of it, reached from A along its tangent (the straight-then-arc
       path a pilot flies), and the first leg bends out of the sweep's
       heading with a Hermite whose end tangent lies along that straight, so
       nothing in it can overshoot. A single curve straight to B folded into
       a hairpin whenever the tee lay behind the heading. */
    const Rv = rightOf(b0);
    const ang = P => Math.atan2(P[0] - C[0], P[1] - C[1]);
    let Rt = 42, side = Math.sign((A[0] - B[0]) * Rv[0] + (A[1] - B[1]) * Rv[1]) || 1;
    let C = [B[0] + side * Rt * Rv[0], B[1] + side * Rt * Rv[1]];
    let D = Math.hypot(A[0] - C[0], A[1] - C[1]);
    if (D < Rt * 1.05) {
      side = -side; C = [B[0] + side * Rt * Rv[0], B[1] + side * Rt * Rv[1]]; D = Math.hypot(A[0] - C[0], A[1] - C[1]);
      if (D < Rt * 1.05) { Rt = Math.max(12, D * 0.9); C = [B[0] + side * Rt * Rv[0], B[1] + side * Rt * Rv[1]]; D = Math.hypot(A[0] - C[0], A[1] - C[1]); }
    }
    /* increasing angle round C runs to the LEFT of the radius, so the circle
       on the right of the heading (side +1) is flown with decreasing angle */
    const rot = -side, alpha = Math.acos(Math.min(1, Rt / D)), angA = ang(A);
    const headingAt = a => [-rot * -Math.cos(a), -rot * Math.sin(a)];   /* rot * -rightOf(a) */
    let Tp = null, best = -Infinity;
    for (const a of [angA + alpha, angA - alpha]) {
      const P = [C[0] + Math.sin(a) * Rt, C[1] + Math.cos(a) * Rt];
      const dx = P[0] - A[0], dz = P[1] - A[1], L = Math.hypot(dx, dz) || 1, h = headingAt(a);
      const fit = (dx * h[0] + dz * h[1]) / L;
      if (fit > best) { best = fit; Tp = P; }
    }
    const pts = [];
    const dT = Math.hypot(Tp[0] - A[0], Tp[1] - A[1]);
    if (dT > 12) {
      const m = clampf(0.4 * dT, 20, 120), u = [(Tp[0] - A[0]) / dT, (Tp[1] - A[1]) / dT];
      const T0 = [from.dir[0] * m, from.dir[1] * m], T1 = [u[0] * m, u[1] * m];
      const nH = Math.max(3, Math.ceil(dT / 6));
      for (let k = 0; k < nH; k++) {
        const t = k / nH, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        pts.push([h00 * A[0] + h10 * T0[0] + h01 * Tp[0] + h11 * T1[0], h00 * A[1] + h10 * T0[1] + h01 * Tp[1] + h11 * T1[1]]);
      }
    } else pts.push(A);
    let sweep = (ang(B) - ang(Tp)) * rot;
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const nA = Math.max(2, Math.ceil(Rt * sweep / 6));
    for (let k = 0; k <= nA; k++) {
      const a = ang(Tp) + rot * sweep * k / nA;
      pts.push([C[0] + Math.sin(a) * Rt, C[1] + Math.cos(a) * Rt]);
    }
    const ls = new Array(pts.length);
    ls[pts.length - 1] = preS - FL.lineUp;
    for (let k = pts.length - 2; k >= 0; k--) ls[k] = ls[k + 1] - Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    pts.forEach((p, k) => W.push([p[0], p[1], ls[k]]));
  }
  W.push([p0[0] - F0[0] * FL.preTee, p0[1] - F0[1] * FL.preTee, -FL.preTee]);
  W.push([p0[0] - F0[0] * FL.preTee * 0.5, p0[1] - F0[1] * FL.preTee * 0.5, -FL.preTee * 0.5]);
  for (let s = 0; s <= sEnd + 1e-6; s += 6) {
    const ss = Math.min(s, sEnd), p = lineAt(ss), rb = rightOf(bearingAt(ss));
    const off = FL.offset * side * smooth(0, 120, ss) * smooth(sEnd, sEnd - 100, ss);
    W.push([p[0] + rb[0] * off, p[1] + rb[1] * off, ss]);
  }
  for (let k = 1; k <= nArc; k++) {
    const a = phi0 + dir * (k / nArc) * FL.orbitDeg * Math.PI / 180;
    W.push([pin[0] + Math.sin(a) * R, pin[1] + Math.cos(a) * R, sEnd + (k / nArc) * arcLen]);
  }
  const path = resampleXZ(boxSmoothXZ(resampleXZ(W, 2), 8, 2), FL.ds);
  const n = path.length;

  /* the envelope along the path: max ground, slope-limited both ways, filtered */
  const hRaw = new Float64Array(n), env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    hRaw[i] = envAt(path[i][0], path[i][1], Math.atan2(b[0] - a[0], b[1] - a[1]));
  }
  env.set(hRaw);
  for (let i = 1; i < n; i++) env[i] = Math.max(env[i], env[i - 1] - FL.climb * FL.ds);
  for (let i = n - 2; i >= 0; i--) env[i] = Math.max(env[i], env[i + 1] - FL.climb * FL.ds);
  const envS = boxSmooth1(Array.from(env), 15);

  /* altitude: tee height above the envelope, a climb to cruise, then a descent
     that lands on the sweep's LEVEL height over the last 120 m of approach.
     Cruise scales with the hole so a par 5 reads whole and a par 3 stays close. */
  const cruise = clampf(24 + lineLen * 0.045, 30, 48);
  const altOf = ls => ls < preS ? lerp(FL.altTransit, FL.altTee, smooth(preS - 160, preS, ls))
    : ls < 0 ? FL.altTee : lerp(FL.altTee, cruise, smooth(0, 160, ls));
  /* the floor is applied against the slope-limited envelope BEFORE the filter,
     so a crown the level sweep did not know about becomes a gentle rise and
     not a pop; the smooth-max after it is a safety net that should not fire */
  let y = path.map((p, i) => Math.max(env[i] + 13, lerp(envS[i] + altOf(p[2]), orbitY, smooth(sEnd - 120, sEnd, p[2]))));
  y = boxSmooth1(y, 6).map((v, i) => smax(v, hRaw[i] + 12, 4));
  /* a travel shot leaves from exactly where the last one stopped */
  if (from) y = y.map((v, i) => lerp(from.pos[1], v, smooth(0, 90, i * FL.ds)));

  /* one velocity profile over path distance, integrated into a time table */
  let iOrbit = n - 1;
  for (let i = 0; i < n; i++) if (path[i][2] >= sEnd - 0.5) { iOrbit = i; break; }
  const sOrbit = iOrbit * FL.ds, sTotal = (n - 1) * FL.ds;
  const vFair = clampf(12 + lineLen * 0.04, 16, 30);
  const vOrbit = Math.max(FL.vOrbit, R * FL.sweepRate * Math.PI / 180);
  /* with a travel shot in front, the route is flown at transit speed and the
     drone all but hovers at the push-off point before the hole's own profile
     takes over -- the beat behind the tee that a flyover opens with */
  let iPre = 0;
  if (from) for (let i = 0; i < n; i++) if (path[i][2] >= preS - 0.5) { iPre = i; break; }
  const sPre = iPre * FL.ds;
  const base = s => s < sPre ? lerp(FL.vTransit, vFair, smooth(sPre - 100, sPre, s))
    : lerp(vFair, vOrbit, smooth(sOrbit - 70, sOrbit + 10, s));
  const dip = s => from ? 1 - 0.6 * Math.exp(-((s - sPre) / 35) * ((s - sPre) / 35)) : 1;
  const vAt = s => base(s) * dip(s)
    * (0.25 + 0.75 * smooth(0, 45, s)) * (0.30 + 0.70 * smooth(sTotal, sTotal - 40, s));
  /* the profile is then capped by the path's own curvature -- a bend is flown
     no faster than FL.panMax degrees per second of heading change -- with the
     cap propagated both ways at FL.accel so the drone brakes into a turn and
     picks up again out of it, never at the turn itself */
  const vCap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    /* heading change over a two-station baseline, so the resampling's own
       jitter does not read as a bend; the first stations are exempt because
       the shot starts from rest there anyway */
    const a = path[Math.max(0, i - 2)], b = path[i], c = path[Math.min(n - 1, i + 2)];
    let dh = Math.atan2(c[0] - b[0], c[1] - b[1]) - Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
    const kappa = i < 3 ? 0 : Math.abs(dh) / (2 * FL.ds);
    const panMax = path[i][2] < preS ? FL.panMaxTransit : FL.panMax;
    vCap[i] = Math.min(vAt(i * FL.ds), panMax * Math.PI / 180 / Math.max(kappa, 1e-4));
  }
  for (let i = n - 2; i >= 0; i--) vCap[i] = Math.min(vCap[i], Math.sqrt(vCap[i + 1] * vCap[i + 1] + 2 * FL.accel * FL.ds));
  for (let i = 1; i < n; i++) vCap[i] = Math.min(vCap[i], Math.sqrt(vCap[i - 1] * vCap[i - 1] + 2 * FL.accel * FL.ds));
  const times = new Float64Array(n);
  for (let i = 1; i < n; i++) times[i] = times[i - 1] + FL.ds / Math.max(0.5, 0.5 * (vCap[i] + vCap[i - 1]));

  /* the look point: a lead down the line, settling on the pin, which then sits
     a little below the frame centre for the whole sweep. On the travel shot the
     gimbal comes off the pin it was holding, looks 80 m ahead along the route,
     and by the line-up point is looking down the next hole. */
  /* interpolate two look points as seen from the camera at cam [x, z]: bearing
     by the shorter arc, distance and height linearly */
  const blendLook = (cam, a, b, k, turn) => {
    /* a blend that is not yet active tracks nothing: the branch it will keep
       is chosen at the first station where it moves, or the swing found by
       the time it engages has drifted round the long way */
    if (k <= 0) { if (turn) turn.d = null; return a.slice(); }
    const ax = a[0] - cam[0], az = a[2] - cam[1], bx = b[0] - cam[0], bz = b[2] - cam[1];
    const a0 = Math.atan2(ax, az), a1 = Math.atan2(bx, bz);
    let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    /* when the two bearings are near opposite, "the shorter arc" changes
       sides from one station to the next as the camera moves, and the table
       stepped 172 degrees between two stations 3 m apart. The swing is
       therefore UNWRAPPED against the previous station's: the branch chosen
       at the first station is the one the whole blend keeps. */
    if (turn) {
      if (turn.d !== null) {
        while (da - turn.d > Math.PI) da -= 2 * Math.PI;
        while (da - turn.d < -Math.PI) da += 2 * Math.PI;
      }
      turn.d = da;
    }
    const ang = a0 + da * k, d = lerp(Math.hypot(ax, az), Math.hypot(bx, bz), k);
    return [cam[0] + Math.sin(ang) * d, lerp(a[1], b[1], k), cam[1] + Math.cos(ang) * d];
  };
  const turnIn = { d: null };
  /* the heading the gimbal is holding as the travel shot leaves: the swing
     starts from THAT, held as the aircraft moves, not from the pin itself --
     a route that passes close by the last green would otherwise whip the
     bearing to the pin round at 30-40 degrees a second while it still counted */
  let hold0 = null, track = null;
  if (from) {
    const dx = from.look[0] - from.pos[0], dy = from.look[1] - from.pos[1], dz = from.look[2] - from.pos[2];
    hold0 = { b: Math.atan2(dx, dz), t: dy / (Math.hypot(dx, dz) || 1) };
  }
  const lookFair = ls => {
    const lookS = Math.min(lineLen, Math.max(ls, 0) + FL.lead);
    const q = lineAt(lookS), k = smooth(lineLen - 40, lineLen, lookS);
    return [lerp(q[0], lookPin[0], k), lerp(terrainH(q[0], q[1]) + 2, lookPin[1], k), lerp(q[1], lookPin[2], k)];
  };
  const looks = path.map((p, i) => {
    const ls = p[2];
    if (ls >= sEnd) return lookPin;
    /* the tracker stays in charge past the tee until it has CONVERGED on the
       hole's own look (it hands over the first station it could reach it in
       one step), so the handover is never a jump */
    if (from && !(track && track.done) && ls < 150) {
      /* the route point FL.lookAhead on, pushed out to exactly that far
         horizontally so a bend never puts the look point under the camera.
         The blends between look points are ANGULAR about the camera: a
         straight lerp from the pin behind to the route ahead passes through
         the camera's own footprint and pitched the shot to 89 degrees. */
      const q = path[Math.min(n - 1, i + Math.round(FL.lookAhead / FL.ds))];
      let dx = q[0] - p[0], dz = q[1] - p[1];
      if (Math.hypot(dx, dz) < 1e-3) { const nx = path[Math.min(n - 1, i + 1)]; dx = nx[0] - p[0]; dz = nx[1] - p[1]; }
      const L = Math.hypot(dx, dz) || 1, gx = p[0] + dx / L * FL.lookAhead, gz = p[1] + dz / L * FL.lookAhead;
      const cam = [p[0], p[1]];
      const ahead = ls < preS
        ? blendLook(cam, [gx, terrainH(gx, gz) + 2, gz], lookFair(preS), smooth(preS - 120, preS, ls), turnIn)
        : lookFair(ls);
      /* The gimbal on the travel shot is a RATE-LIMITED tracker of that target:
         starting from the heading it held over the last green, it pans toward
         the route at no more than FL.swingRate degrees a second, whatever the
         route itself is doing under it. A blend on distance or time stacked
         its own swing on the turning arc's rotation and reached 34 deg/s. */
      const tb = Math.atan2(ahead[0] - p[0], ahead[2] - p[1]);
      const tp = Math.atan2(ahead[1] - y[i], Math.hypot(ahead[0] - p[0], ahead[2] - p[1]));
      if (track === null) track = { b: hold0.b, p: Math.atan(hold0.t) };
      else {
        const dtS = Math.max(1e-3, times[i] - times[i - 1]);
        let db = tb - track.b; if (db > Math.PI) db -= 2 * Math.PI; if (db < -Math.PI) db += 2 * Math.PI;
        const stepB = FL.swingRate * Math.PI / 180 * dtS, stepP = FL.tiltRate * Math.PI / 180 * dtS;
        if (ls >= preS && Math.abs(db) <= stepB && Math.abs(tp - track.p) <= stepP) { track = { done: true }; return lookFair(ls); }
        track.b += clampf(db, -stepB, stepB);
        track.p += clampf(tp - track.p, -stepP, stepP);
      }
      const cpv = Math.cos(track.p);
      return [p[0] + Math.sin(track.b) * cpv * FL.lookAhead, y[i] + Math.sin(track.p) * FL.lookAhead, p[1] + Math.cos(track.b) * cpv * FL.lookAhead];
    }
    return lookFair(ls);
  });
  const fovs = path.map(p => lerp(FL.fovCruise, FL.fovOrbit, smooth(sEnd - 140, sEnd + 20, p[2])));


  tourFlight.st = { path, y, looks, fovs, times, n, sTotal, sOrbit, sPre, R, dir };
  tourFlight.duration = times[n - 1];
  tourFlight.orbitT = times[iOrbit];
  tourFlight.transitT = times[iPre];
  tourFlight.fairwayRatio = tourFlight.orbitT / tourFlight.duration;
  tourFlight.t = 0;
  tourFlight.holdTimer = 0;
  tourFlight.cardPending = !!from;
  if (!from) {
    tourFlight.initialized = false;
    tourFlight.posV.set(0, 0, 0); tourFlight.yawV = tourFlight.pitchV = tourFlight.distV = tourFlight.fovV = 0;
  }
}
/* where the shot is right now, in the form the next hole's travel shot starts from */
function flightPose() {
  /* the TABLE's end, not the spring's: the springs lag a metre or two behind
     it and carry over untouched, so the next table starting from the station
     keeps the route's heading exact and the camera's motion continuous */
  const st = tourFlight.st, a = st.path[Math.max(0, st.n - 2)], b = st.path[st.n - 1];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { pos: [b[0], st.y[st.n - 1], b[1]], look: st.looks[st.n - 1].slice(), dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
}

/* Catmull-Rom across the uniformly spaced stations, by path distance */
function stationAt(s) {
  const st = tourFlight.st, f = clampf(s / FL.ds, 0, st.n - 1), i = Math.floor(f), t = f - i;
  const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(st.n - 1, i + 1), i3 = Math.min(st.n - 1, i + 2);
  const cr = (p0, p1, p2, p3) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const P = st.path, Y = st.y, K = st.looks;
  return {
    pos: [cr(P[i0][0], P[i1][0], P[i2][0], P[i3][0]), cr(Y[i0], Y[i1], Y[i2], Y[i3]), cr(P[i0][1], P[i1][1], P[i2][1], P[i3][1])],
    look: [cr(K[i0][0], K[i1][0], K[i2][0], K[i3][0]), cr(K[i0][1], K[i1][1], K[i2][1], K[i3][1]), cr(K[i0][2], K[i1][2], K[i2][2], K[i3][2])],
    fov: cr(st.fovs[i0], st.fovs[i1], st.fovs[i2], st.fovs[i3]),
    ls: lerp(P[i1][2], P[i2][2], t),
  };
}
function flightDistAt(t) {
  const T = tourFlight.st.times, n = tourFlight.st.n;
  if (t <= 0) return 0;
  if (t >= T[n - 1]) return (n - 1) * FL.ds;
  let a = 0, b = n - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (T[m] <= t) a = m; else b = m; }
  return (a + (t - T[a]) / (T[b] - T[a])) * FL.ds;
}
const _flT = new THREE.Vector3();
/* advance the shot by dt and settle the gimbal; the caller applies the result */
function flightStep(dt) {
  const tf = tourFlight;
  tf.t += dt;
  const k = stationAt(flightDistAt(tf.t));
  _flT.set(k.pos[0], k.pos[1], k.pos[2]);
  /* The gimbal is smoothed in PAN, TILT and RANGE about the camera, not in
     space: a look point damped in x, y, z cuts the chord when its target
     swings round the camera, and on a 180 degree swing that chord runs
     through the camera's own footprint -- the shot pitched to 78 degrees
     and whipped through 990 degrees a second on the way out of the 7th. */
  const rel = (L, P) => {
    const dx = L[0] - P.x, dy = L[1] - P.y, dz = L[2] - P.z, hz = Math.hypot(dx, dz);
    return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, hz), dist: Math.hypot(hz, dy) };
  };
  if (!tf.initialized) {
    tf.pos.copy(_flT); tf.fov = k.fov;
    const r = rel(k.look, tf.pos);
    tf.yaw = r.yaw; tf.pitch = r.pitch; tf.dist = r.dist;
    tf.posV.set(0, 0, 0); tf.yawV = tf.pitchV = tf.distV = tf.fovV = 0;
    tf.initialized = true;
  } else {
    smoothDamp(tf.pos, tf.posV, _flT, 0.28, dt);
    const r = rel(k.look, tf.pos);
    let ty = r.yaw;
    while (ty - tf.yaw > Math.PI) ty -= 2 * Math.PI;
    while (ty - tf.yaw < -Math.PI) ty += 2 * Math.PI;
    [tf.yaw, tf.yawV] = smoothDampF(tf.yaw, tf.yawV, ty, 0.85, dt);
    [tf.pitch, tf.pitchV] = smoothDampF(tf.pitch, tf.pitchV, r.pitch, 0.85, dt);
    [tf.dist, tf.distV] = smoothDampF(tf.dist, tf.distV, r.dist, 0.85, dt);
    [tf.fov, tf.fovV] = smoothDampF(tf.fov, tf.fovV, k.fov, 1.2, dt);
  }
  const cp = Math.cos(tf.pitch);
  tf.look.set(tf.pos.x + Math.sin(tf.yaw) * cp * tf.dist, tf.pos.y + Math.sin(tf.pitch) * tf.dist, tf.pos.z + Math.cos(tf.yaw) * cp * tf.dist);
  return { u: Math.min(1, tf.t / tf.duration), done: tf.t >= tf.duration, ls: k.ls };
}
function applyFlightCamera() {
  camera.position.copy(tourFlight.pos);
  controls.target.copy(tourFlight.look);
  camera.lookAt(tourFlight.look);
  if (Math.abs(camera.fov - tourFlight.fov) > 1e-3) { camera.fov = tourFlight.fov; camera.updateProjectionMatrix(); }
}
/* leave the shot: the lens goes back to the player's */
function stopFlight() {
  flying = 0;
  tourFlight.st = null;
  tourFlight.cardPending = false;
  if (Math.abs(camera.fov - tourFlight.baseFov) > 1e-3) { camera.fov = tourFlight.baseFov; camera.updateProjectionMatrix(); }
  const el = document.getElementById('tourCard');
  if (el) el.classList.remove('show');
}
/* run a hole's shot offline at a fixed step and return the camera track, so a
   harness can measure clearance, speed and pan rate instead of watching it */
function flightSim(n, step = 1 / 60, transit = false) {
  if (flying > 0) return null;
  const hn = Math.min(NHOLES, Math.max(1, n));
  const h = HOLES[hn - 1];
  const run = () => {
    const track = [];
    for (let guard = 0; guard < 30000; guard++) {
      const r = flightStep(step);
      const p = tourFlight.pos, l = tourFlight.look;
      track.push({ t: tourFlight.t, x: p.x, y: p.y, z: p.z, lx: l.x, ly: l.y, lz: l.z,
        fov: tourFlight.fov, clear: p.y - terrainH(p.x, p.z) });
      if (r.done) break;
    }
    return track;
  };
  /* with `transit`, the previous hole is flown first (untracked) so this shot
     starts with the travel from its reverse angle, as the tour flies it */
  let from = null;
  if (transit && hn > 1) {
    initHoleFlight(HOLES[hn - 2]);
    if (!tourFlight.st) return null;
    run();
    from = flightPose();
  }
  initHoleFlight(h, from);
  if (!tourFlight.st) return null;
  const track = run();
  const st = tourFlight.st;
  const out = { hole: h.n, duration: tourFlight.duration, orbitT: tourFlight.orbitT, transitT: tourFlight.transitT,
    stations: st.n, sTotal: st.sTotal, sOrbit: st.sOrbit, sPre: st.sPre, R: st.R, dir: st.dir, track,
    table: { path: st.path, y: Array.from(st.y), looks: st.looks, times: Array.from(st.times) } };
  tourFlight.st = null;
  tourFlight.initialized = false;
  return out;
}

let tour = 0;
function showTourCard() {
  const h = HOLES[hole - 1], el = document.getElementById('tourCard');
  if (!el) return;

  const rise = (h.elev && h.elev.green && h.elev.tee) ? (h.elev.green - h.elev.tee) : 0;
  const elevEl = document.getElementById('tourElev');
  if (elevEl) elevEl.textContent = `${Math.abs(rise).toFixed(0)} m ${rise >= 0 ? 'uppför' : 'nedför'}`;

  const tno = el.querySelector('.tno');
  if (tno) tno.textContent = `HÅL ${h.n}`;

  const parEl = document.getElementById('tourPar');
  if (parEl) parEl.textContent = `PAR ${h.par}`;

  const distEl = document.getElementById('tourDist');
  if (distEl) distEl.textContent = `${(h.t && h.t[0]) || (h.lineLen ? h.lineLen.toFixed(0) : 350)} M`;

  const tnm = el.querySelector('.tnm');
  if (tnm) {
    const rawName = (h.name || '').trim();
    // Do not repeat "Hål N" if name is missing or identical to hole number
    const isDup = !rawName || new RegExp(`^hål\\s*${h.n}$`, 'i').test(rawName) || /^hål\s*\d+$/i.test(rawName);
    if (isDup) {
      tnm.textContent = '';
      tnm.style.display = 'none';
    } else {
      tnm.textContent = rawName;
      tnm.style.display = 'block';
    }
  }

  const ttx = el.querySelector('.ttx');
  if (ttx) ttx.textContent = h.note || h.shape || h.desc || 'Följ hålets spellinje mot green.';

  el.classList.add('show');
  // Stays visible all the way until the green!
}

/* the bar runs TEE to GREEN, so it starts counting when the travel shot from
   the previous hole has arrived behind the tee, not when it left the last green */
function updateTourProgress() {
  const t0 = tourFlight.transitT || 0, span = Math.max(1e-3, tourFlight.duration - t0);
  const u = clampf((tourFlight.t - t0) / span, 0, 1);
  const fill = document.getElementById('tourProgressFill');
  if (fill) fill.style.width = Math.min(100, Math.round(u * 100)) + '%';
  const lbl = document.getElementById('tourProgressDist');
  if (lbl) {
    const r = clampf((tourFlight.orbitT - t0) / span, 0.05, 0.95);
    if (u < r) {
      lbl.textContent = `FLYGNING ${Math.round((u / r) * 100)}%`;
    } else {
      lbl.textContent = `GREENSVEP ${Math.round(((u - r) / (1.0 - r)) * 100)}%`;
    }
  }
}

function startTour() {
  tour = 1;
  document.body.classList.add('tour');
  setClean(true);
  goHole(1, false);
  initHoleFlight(HOLES[0]);
  showTourCard();
  flying = 1e-4;
}

function endTour() {
  tour = 0;
  stopFlight();
  document.body.classList.remove('tour');
  setClean(false);
  setCam(camMode);
}
document.getElementById('tourBtn').onclick = startTour;

/* ------------------------------------------------------- personal caddie
   One local bag drives both the labels painted on the hole and Kikaren's club
   recommendation. It never leaves the device. The 3D strategy is derived from
   the selected tee, the routed centreline and explicit distances in the club's
   note (for example "max 200 meter"), so it works for every current pack while
   leaving room for authored per-hole strategy data later. */
const BAG_KEY = 'banvy-caddie-bag-v1';
const htmlEsc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let playerBag;
try { playerBag = parseBag(localStorage.getItem(BAG_KEY)); }
catch { playerBag = normalizeBag(DEFAULT_BAG); }

const bagDialog = document.getElementById('bagDialog');
const bagForm = document.getElementById('bagForm');
const bagList = document.getElementById('bagList');
const bagCount = document.getElementById('bagCount');
const bagAddBtn = document.getElementById('bagAddBtn');

function bagDraftFromRows() {
  return [...bagList.querySelectorAll('.bag-row')].map((row, i) => ({
    id: row.dataset.clubId || `club-${i + 1}`,
    name: row.querySelector('.bag-name').value,
    carry: row.querySelector('.bag-distance').value,
  }));
}

function syncBagEditor() {
  const count = bagList.querySelectorAll('.bag-row').length;
  bagCount.innerHTML = `<b>${count}</b> / ${MAX_BAG_CLUBS} klubbor`;
  bagCount.classList.toggle('limit', count >= MAX_BAG_CLUBS);
  bagAddBtn.disabled = count >= MAX_BAG_CLUBS;
  bagAddBtn.textContent = count >= MAX_BAG_CLUBS ? 'Bagen är full' : '+ Lägg till klubba';
  for (const button of bagList.querySelectorAll('.bag-remove')) button.disabled = count <= 2;
}

function renderBagForm(value = playerBag) {
  bagList.innerHTML = normalizeBag(value).map((club, i) => `
    <div class="bag-row" data-club-id="${htmlEsc(club.id)}">
      <span class="bag-rank">${String(i + 1).padStart(2, '0')}</span>
      <input class="bag-name" value="${htmlEsc(club.name)}" maxlength="24" aria-label="Klubba ${i + 1}" required>
      <span class="bag-carry"><input class="bag-distance" type="number" inputmode="numeric" min="20" max="350"
        value="${club.carry}" aria-label="Carry för ${htmlEsc(club.name)} i meter" required><span>m</span></span>
      <button class="bag-remove" type="button" aria-label="Ta bort ${htmlEsc(club.name)}" title="Ta bort">×</button>
    </div>`).join('');
  syncBagEditor();
}
function openBag() {
  renderBagForm();
  if (typeof bagDialog.showModal === 'function') bagDialog.showModal();
  else bagDialog.setAttribute('open', '');
  requestAnimationFrame(() => bagList.querySelector('input')?.focus({ preventScroll: true }));
}
document.getElementById('bagBtn').onclick = openBag;
document.getElementById('bagResetBtn').onclick = () => renderBagForm(DEFAULT_BAG);
bagAddBtn.onclick = () => {
  const draft = bagDraftFromRows();
  if (draft.length >= MAX_BAG_CLUBS) return;
  const shortest = Math.min(...draft.map(club => Number(club.carry)).filter(Number.isFinite));
  draft.push({
    id: `custom-${Date.now().toString(36)}`,
    name: 'Ny klubba',
    carry: Math.max(20, Number.isFinite(shortest) ? shortest - 10 : 80),
  });
  renderBagForm(draft);
  const input = bagList.querySelector('.bag-row:last-child .bag-name');
  input?.focus({ preventScroll: true });
  input?.select();
  input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};
bagList.addEventListener('click', event => {
  const button = event.target.closest('.bag-remove');
  if (!button) return;
  const draft = bagDraftFromRows();
  if (draft.length <= 2) return;
  const index = [...bagList.querySelectorAll('.bag-row')].indexOf(button.closest('.bag-row'));
  draft.splice(index, 1);
  renderBagForm(draft);
  bagList.querySelectorAll('.bag-name')[Math.min(index, draft.length - 1)]?.focus({ preventScroll: true });
});
bagForm.addEventListener('submit', event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  playerBag = normalizeBag(bagDraftFromRows()).sort((a, b) => b.carry - a.carry);
  try { localStorage.setItem(BAG_KEY, JSON.stringify({ version: 2, clubs: playerBag })); }
  catch { /* private storage may be unavailable; the in-memory bag still works */ }
  bagDialog.close?.();
  buildStrategy();
  if (kik) kikRender();
  toast('Bagen är sparad · klubbvalen är uppdaterade');
});
bagDialog.addEventListener('click', event => {
  if (event.target === bagDialog) bagDialog.close?.('cancel');
});

const STRATEGY_KEY = 'banvy-strategy-visible-v1';
let strategyOn = true, strategyGroup = null, currentStrategy = null;
try { strategyOn = localStorage.getItem(STRATEGY_KEY) !== 'off'; }
catch { /* local preference is optional */ }
let strategyAnimation = null;
const strategyMotionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let strategyReducedMotion = DET || strategyMotionPreference.matches;
const strategyBtn = document.getElementById('strategyBtn');
strategyBtn.classList.toggle('on', strategyOn);
strategyBtn.setAttribute('aria-pressed', String(strategyOn));

function strategyClear() {
  if (!strategyGroup) return;
  const staleGroup = strategyGroup;
  scene.remove(staleGroup);
  strategyGroup = null;
  strategyAnimation = null;
  /* Do not call dispose() here. Three's WebGPU post pipeline can retain an
     encoded command which names these buffers even after multiple frames and
     GPUQueue.onSubmittedWorkDone(). Destroying them produces "Buffer used in
     submit while destroyed" and freezes only the 3D canvas while the DOM and
     minimap keep running. Once detached and unreferenced, Three's WeakMaps and
     the browser GC release this tiny transient layer at a safe lifetime point. */
}

function sampledRoute(line, from, to, step = 4) {
  const points = [];
  for (let d = from; d < to; d += step) points.push(pointAlongLine(line, d));
  points.push(pointAlongLine(line, to));
  return points.filter(Boolean);
}

function strategyRibbon(points, width, colour, opacity, lift = 0.12) {
  const positions = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    const corners = [[a[0] + nx, a[1] + nz], [a[0] - nx, a[1] - nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz]];
    const push = index => {
      const p = corners[index];
      positions.push(p[0], terrainH(p[0], p[1]) + lift, p[1]);
    };
    push(0); push(1); push(2); push(2); push(1); push(3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(colour), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  material.polygonOffset = true; material.polygonOffsetFactor = DEPTH_SIGN * 4; material.polygonOffsetUnits = DEPTH_SIGN * 8;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.baseOpacity = opacity;
  mesh.userData.strategyWidth = width;
  mesh.renderOrder = 5;
  return mesh;
}

function strategyLine(points, colour, opacity = 0.9, lift = 0.18) {
  const positions = points.map(p => new THREE.Vector3(p[0], terrainH(p[0], p[1]) + lift, p[1]));
  const material = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(colour), transparent: true, opacity, depthWrite: false });
  const geometry = new THREE.BufferGeometry().setFromPoints(positions);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length * 2), 2));
  const line = new THREE.Line(geometry, material);
  line.userData.baseOpacity = opacity;
  line.renderOrder = 6;
  return line;
}

function strategyLabel(title, subtitle, point, colour = '#b7dfc0', scale = 1, quiet = false) {
  const canvas = document.createElement('canvas');
  canvas.width = quiet ? 224 : 512;
  canvas.height = quiet ? 72 : 120;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!quiet) {
    const fill = ctx.createLinearGradient(0, 0, 512, 120);
    fill.addColorStop(0, 'rgba(4,12,8,.88)');
    fill.addColorStop(1, 'rgba(10,24,16,.76)');
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(3, 3, 506, 114, 25); ctx.fill();
    ctx.strokeStyle = 'rgba(220,240,225,.22)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.roundRect(26, 23, 6, 74, 3); ctx.fill();
    ctx.fillStyle = '#f3f7f4'; ctx.font = '700 27px Outfit, sans-serif';
    ctx.fillText(title, 270, subtitle ? 45 : 61);
    if (subtitle) {
      ctx.fillStyle = 'rgba(224,235,227,.72)'; ctx.font = '500 18px Outfit, sans-serif';
      ctx.fillText(subtitle, 270, 79);
    }
  } else {
    ctx.shadowColor = 'rgba(2,8,5,.9)'; ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(236,244,238,.82)'; ctx.font = '650 27px Outfit, sans-serif';
    ctx.fillText(title, 112, 37);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteNodeMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  const width = quiet ? 13 : 30, height = quiet ? 4.15 : 7.05;
  sprite.scale.set(width * scale, height * scale, 1);
  sprite.position.set(point[0], terrainH(point[0], point[1]) + (quiet ? 2.2 : 3.8) * scale, point[1]);
  sprite.userData.baseOpacity = quiet ? 0.68 : 0.92;
  sprite.userData.restY = sprite.position.y;
  sprite.renderOrder = 7;
  return sprite;
}

function strategyEllipse(strategy, zone, colour) {
  const before = pointAlongLine(strategy.line, Math.max(0, zone.distance - 5));
  const after = pointAlongLine(strategy.line, Math.min(strategy.total, zone.distance + 5));
  const dx = after[0] - before[0], dz = after[1] - before[1], length = Math.hypot(dx, dz) || 1;
  const fx = dx / length, fz = dz / length, rx = -fz, rz = fx;
  const ring = [];
  for (let i = 0; i < 48; i++) {
    const angle = i / 48 * TAU;
    ring.push([
      zone.point[0] + fx * Math.cos(angle) * zone.radiusAlong + rx * Math.sin(angle) * zone.radiusAcross,
      zone.point[1] + fz * Math.cos(angle) * zone.radiusAlong + rz * Math.sin(angle) * zone.radiusAcross,
    ]);
  }
  const positions = [];
  for (let i = 0; i < ring.length; i++) {
    for (const p of [zone.point, ring[i], ring[(i + 1) % ring.length]]) positions.push(p[0], terrainH(p[0], p[1]) + 0.16, p[1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  const material = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  material.polygonOffset = true; material.polygonOffsetFactor = DEPTH_SIGN * 5; material.polygonOffsetUnits = DEPTH_SIGN * 10;
  const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 5;
  const outline = strategyLine(ring.concat([ring[0]]), colour, zone.kind === 'approach' ? 0.24 : 0.32, 0.19);
  const dotMaterial = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const dot = new THREE.Mesh(new THREE.CircleGeometry(zone.kind === 'approach' ? 0.72 : 1.05, 24), dotMaterial);
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(zone.point[0], terrainH(zone.point[0], zone.point[1]) + 0.22, zone.point[1]);
  dot.renderOrder = 7;
  const visual = {
    fill: material, fillOpacity: zone.kind === 'approach' ? 0.035 : 0.05,
    outline: outline.material, outlineOpacity: outline.userData.baseOpacity,
    dot, dotOpacity: zone.kind === 'approach' ? 0.34 : 0.58,
  };
  material.opacity = 0;
  outline.material.opacity = 0;
  strategyGroup.add(mesh, outline, dot);
  return visual;
}

const strategyEase = value => 1 - Math.pow(1 - clampf(value, 0, 1), 3);

function settleStrategyAnimation() {
  if (!strategyAnimation) return;
  for (const item of strategyAnimation.layers) item.object.material.opacity = item.opacity;
  for (const item of strategyAnimation.fades) item.material.opacity = item.opacity;
  for (const visual of strategyAnimation.zones) {
    visual.fill.opacity = visual.fillOpacity;
    visual.outline.opacity = visual.outlineOpacity;
    visual.dot.material.opacity = visual.dotOpacity;
    visual.dot.scale.setScalar(1);
  }
  for (const label of strategyAnimation.labels) {
    label.material.opacity = label.userData.baseOpacity;
    label.position.y = label.userData.restY;
  }
  strategyAnimation.sweep.visible = false;
  strategyAnimation.settled = true;
}

function startStrategyAnimation() {
  if (!strategyAnimation) return;
  strategyAnimation.started = performance.now();
  strategyAnimation.settled = false;
  for (const item of strategyAnimation.layers) item.object.material.opacity = item.opacity;
  for (const item of strategyAnimation.fades) item.material.opacity = item.opacity;
  for (const visual of strategyAnimation.zones) {
    visual.fill.opacity = visual.fillOpacity;
    visual.outline.opacity = visual.outlineOpacity;
    visual.dot.material.opacity = visual.dotOpacity;
    visual.dot.scale.setScalar(0.96);
  }
  for (const label of strategyAnimation.labels) {
    label.material.opacity = label.userData.baseOpacity;
    label.position.y = label.userData.restY - 0.4;
  }
  strategyAnimation.sweep.visible = true;
  if (strategyReducedMotion) settleStrategyAnimation();
}

strategyMotionPreference.addEventListener?.('change', event => {
  strategyReducedMotion = DET || event.matches;
  if (strategyReducedMotion) settleStrategyAnimation();
  else if (strategyOn) startStrategyAnimation();
});

function buildStrategy() {
  strategyClear();
  currentStrategy = strategyForHole(HOLES[hole - 1], teeIdx, playerBag);
  if (!currentStrategy || !strategyOn) { drawMini(); return; }
  strategyGroup = new THREE.Group();
  strategyGroup.name = 'tactical-guide';
  strategyGroup.visible = strategyOn;

  /* The complete route is context, not decoration. A small guide marker travels
     it once; after 900 ms every strategy object is static and updateStrategy is
     a no-op, so orbiting the course pays only the overlay's draw calls. */
  const full = sampledRoute(currentStrategy.line, 0, currentStrategy.total, 4);
  const primary = sampledRoute(currentStrategy.line, 0, currentStrategy.primaryDistance, 2.5);
  const seam = strategyRibbon(full, 0.2, 0x91b398, 0.07, 0.105);
  const active = strategyRibbon(primary, 0.27, 0x8fc19a, 0.27, 0.145);
  strategyGroup.add(seam, active);

  const zoneVisuals = [];
  const labels = [];

  currentStrategy.zones.forEach((zone, index) => {
    const colour = zone.kind === 'approach' ? 0xd8bf82 : 0x9fd7aa;
    zoneVisuals.push(strategyEllipse(currentStrategy, zone, colour));
    if (index === 0) {
      const title = zone.kind === 'green'
        ? `Green · ${Math.round(zone.distance)} m`
        : currentStrategy.maxCarry
          ? `Sikta här · max ${Math.round(currentStrategy.maxCarry)} m`
          : `Sikta här · ${Math.round(zone.distance)} m`;
      const subtitle = zone.kind === 'green'
        ? `${zone.club?.name || 'Klubbval'} · till mitten`
        : `${zone.club?.name || 'Klubbval'} · ${Math.round(zone.remain)} m kvar`;
      labels.push(strategyLabel(title, subtitle, zone.point, '#acdcb5'));
    } else {
      labels.push(strategyLabel(`${Math.round(zone.remain)} m kvar`, '', zone.point, '#dcc895', 0.76, true));
    }
  });
  for (const label of labels) strategyGroup.add(label);

  const fades = [{ material: seam.material, opacity: seam.userData.baseOpacity }];
  const layers = [active].map(object => ({ object, opacity: object.userData.baseOpacity }));

  const primaryHazards = lineHazards(currentStrategy.origin, currentStrategy.primary, kikKindAt);
  const hazardMaterials = [];
  if (primaryHazards.length) {
    const hazard = primaryHazards[0];
    const point = pointAlongLine(currentStrategy.line, hazard.from);
    const ring = [];
    for (let i = 0; i < 40; i++) {
      const angle = i / 40 * TAU;
      ring.push([point[0] + Math.cos(angle) * 7, point[1] + Math.sin(angle) * 7]);
    }
    const pulse = strategyLine(ring.concat([ring[0]]), hazard.type === 'vatten' ? 0x7bc2d5 : 0xd8bd82, 0.34, 0.2);
    hazardMaterials.push({ material: pulse.material, opacity: pulse.userData.baseOpacity });
    strategyGroup.add(pulse);
  }

  const sweepMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xdaf1df, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  const sweep = new THREE.Mesh(new THREE.CircleGeometry(0.82, 20), sweepMaterial);
  sweep.rotation.x = -Math.PI / 2; sweep.renderOrder = 8; sweep.visible = false;
  sweep.position.set(currentStrategy.origin[0], terrainH(currentStrategy.origin[0], currentStrategy.origin[1]) + 0.24, currentStrategy.origin[1]);
  strategyGroup.add(sweep);

  strategyAnimation = {
    started: performance.now(), settled: false, layers,
    fades: fades.concat(hazardMaterials), zones: zoneVisuals, labels,
    sweep, primaryDistance: currentStrategy.primaryDistance, line: currentStrategy.line,
    arcCount: 0,
  };
  scene.add(strategyGroup);
  startStrategyAnimation();
  drawMini();
}

function updateStrategy(now) {
  if (!strategyAnimation || !strategyOn || strategyReducedMotion || strategyAnimation.settled) return;
  const elapsed = now - strategyAnimation.started;
  const targetFade = strategyEase((elapsed - 180) / 480);
  for (const visual of strategyAnimation.zones) {
    visual.dot.scale.setScalar(0.96 + targetFade * 0.04);
  }
  for (const label of strategyAnimation.labels) {
    label.position.y = label.userData.restY - (1 - targetFade) * 0.4;
  }

  if (elapsed < 900) {
    const travel = strategyEase(elapsed / 820);
    const point = pointAlongLine(strategyAnimation.line, strategyAnimation.primaryDistance * travel);
    strategyAnimation.sweep.position.set(point[0], terrainH(point[0], point[1]) + 0.24, point[1]);
    const pulse = Math.sin(Math.PI * clampf(elapsed / 900, 0, 1));
    strategyAnimation.sweep.scale.setScalar(0.72 + pulse * 0.28);
  } else {
    settleStrategyAnimation();
  }
}

strategyBtn.onclick = () => {
  strategyOn = !strategyOn;
  strategyBtn.classList.toggle('on', strategyOn);
  strategyBtn.setAttribute('aria-pressed', String(strategyOn));
  try { localStorage.setItem(STRATEGY_KEY, strategyOn ? 'on' : 'off'); }
  catch { /* local preference is optional */ }
  if (strategyGroup) strategyGroup.visible = strategyOn;
  if (strategyOn) {
    if (strategyGroup) startStrategyAnimation();
    else buildStrategy();
  }
  drawMini();
  toast(strategyOn ? 'Spellinje på · följ den ljusa linjen till målområdet' : 'Spellinje av');
};

/* ------------------------------------------------------------ live GPS
   WGS84 fixes enter through the exact flat-earth frame declared by every pack.
   Hole changes use a 28 m hysteresis so two adjacent fairways cannot make the
   UI flicker. GPS is opt-in per visit and never starts from stored state. */
const gpsState = { active: false, watchId: null, point: null, accuracy: null, follow: true, firstFix: true };
let gpsGroup = null;
const gpsBtn = document.getElementById('gpsBtn');
const mobileGpsBtn = document.getElementById('mobileGpsToggle');
const gpsStatus = document.getElementById('gpsStatus');
const gpsStatusText = document.getElementById('gpsStatusText');
const gpsFollowBtn = document.getElementById('gpsFollowBtn');

function syncGpsUi(state, detail) {
  gpsStatus.hidden = false;
  gpsStatus.dataset.state = state;
  gpsStatusText.textContent = detail;
  gpsBtn.classList.toggle('on', gpsState.active);
  mobileGpsBtn?.classList.toggle('on', gpsState.active);
  gpsFollowBtn.classList.toggle('on', gpsState.follow);
  gpsFollowBtn.setAttribute('aria-pressed', String(gpsState.follow));
  gpsFollowBtn.setAttribute('aria-label', gpsState.follow ? 'Kameran följer dig · tryck för att släppa' : 'Följ min position');
  gpsFollowBtn.title = gpsFollowBtn.getAttribute('aria-label');
  /* no fix, no camera to steer: the button only exists while there is a position */
  gpsFollowBtn.hidden = !gpsState.active;
  document.body.classList.toggle('gps-on', gpsState.active);
}

function gpsMarkerClear() {
  if (!gpsGroup) return;
  scene.remove(gpsGroup);
  gpsGroup.traverse(object => { object.geometry?.dispose?.(); object.material?.dispose?.(); });
  gpsGroup = null;
}

function drawGpsMarker() {
  gpsMarkerClear();
  if (!gpsState.point) return;
  const [x, z] = gpsState.point, y = terrainH(x, z);
  const radius = clampf(gpsState.accuracy || 6, 3, 60);
  gpsGroup = new THREE.Group(); gpsGroup.name = 'live-gps-position';
  const ring = [];
  for (let i = 0; i < 64; i++) {
    const angle = i / 64 * TAU;
    const px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
    ring.push(new THREE.Vector3(px, terrainH(px, pz) + 0.32, pz));
  }
  ring.push(ring[0].clone());
  const ringMat = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0x79e99b), transparent: true, opacity: 0.8, depthWrite: false });
  const ringGeometry = new THREE.BufferGeometry().setFromPoints(ring);
  ringGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ring.length * 2), 2));
  gpsGroup.add(new THREE.Line(ringGeometry, ringMat));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xb4ffc4) }));
  dot.position.set(x, y + 1.25, z); gpsGroup.add(dot);
  scene.add(gpsGroup);
}

/* the hole view: behind and above the player, looking up the line to the
   green, high and far enough back that both the player and the green are in
   frame however far apart they are -- the picture every GPS app opens on,
   here with the real ground so the slope reads in the shading. The framing
   is set once per fix; later fixes only translate the camera, so a pinch or
   a drag to look closer survives walking. */
function focusGps(instant = false) {
  if (!gpsState.point) return;
  const h = HOLES[hole - 1], p = gpsState.point, target = h.green.c;
  const dx = target[0] - p[0], dz = target[1] - p[1], length = Math.hypot(dx, dz) || 1;
  const fx = dx / length, fz = dz / length;
  const back = 34 + length * 0.2, up = 18 + length * 0.14;
  /* the frame centre sits 7° above the player, so the player stands just over
     the sheet at the bottom of a phone screen and the green has the rest */
  const aim = Math.max(10, up / Math.tan(Math.atan2(up, back) - 7 * Math.PI / 180) - back);
  const px = p[0] - fx * back - fz * 8, pz = p[1] - fz * back + fx * 8;
  const ax = p[0] + fx * aim, az = p[1] + fz * aim;
  flyTo(V3(px, Math.max(terrainH(px, pz) + 12, terrainH(p[0], p[1]) + up), pz),
        V3(ax, terrainH(ax, az) + 3, az),
        instant || RMOTION ? 0 : 1.1);
}

function receiveGps(position) {
  if (!gpsState.active) return;
  const local = gpsToLocal(position.coords, GEO);
  const nearby = nearestHole(local, HOLES, hole);
  const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0;
  if (!nearby || nearby.distance > 450) {
    gpsState.point = null; gpsState.accuracy = accuracy;
    gpsMarkerClear();
    syncGpsUi('error', nearby ? `${Math.round(nearby.distance)} m från närmaste hål` : 'Positionen ligger utanför banan');
    if (kik) kikRender();
    return;
  }

  const previous = gpsState.point;
  gpsState.point = local; gpsState.accuracy = accuracy;
  if (nearby.distance <= 120 && nearby.hole !== hole) goHole(nearby.hole, false);
  drawGpsMarker();
  const weak = accuracy > 35 ? ' · svag noggrannhet' : '';
  syncGpsUi('live', `Hål ${nearby.hole} · ±${Math.max(1, Math.round(accuracy))} m${weak}`);
  if (gpsState.follow) {
    if (gpsState.firstFix || !previous) focusGps();
    else {
      const dx = local[0] - previous[0], dz = local[1] - previous[1];
      const dy = terrainH(local[0], local[1]) - terrainH(previous[0], previous[1]);
      camera.position.add(V3(dx, dy, dz)); controls.target.add(V3(dx, dy, dz)); camTween.on = false;
    }
  }
  gpsState.firstFix = false;
  if (kik) kikRender();
  drawMini();
}

function gpsFailure(error) {
  if (!gpsState.active) return;
  if (gpsState.watchId !== null) navigator.geolocation.clearWatch(gpsState.watchId);
  gpsState.watchId = null; gpsState.active = false; gpsState.point = null;
  gpsMarkerClear();
  const detail = error?.code === 1 ? 'Platsåtkomst nekades · tillåt plats i webbläsaren'
    : error?.code === 2 ? 'Ingen GPS-position hittades'
      : 'GPS svarade inte · försök igen';
  syncGpsUi('error', detail);
}

function startGps() {
  if (!navigator.geolocation) {
    syncGpsUi('error', 'Den här webbläsaren saknar platsåtkomst');
    return;
  }
  gpsState.active = true; gpsState.firstFix = true;
  syncGpsUi('waiting', 'Söker din position…');
  setKik(true, true);
  try {
    gpsState.watchId = navigator.geolocation.watchPosition(receiveGps, gpsFailure, {
      enableHighAccuracy: true, maximumAge: 4000, timeout: 15000,
    });
  } catch (error) { gpsFailure(error); }
}

function stopGps(announce = true) {
  if (gpsState.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsState.watchId);
  gpsState.watchId = null; gpsState.active = false; gpsState.point = null; gpsState.firstFix = true;
  gpsMarkerClear();
  gpsStatus.hidden = true;
  gpsBtn.classList.remove('on'); mobileGpsBtn?.classList.remove('on');
  document.body.classList.remove('gps-on');
  if (kik) kikRender();
  if (announce) toast('GPS-läge avslutat · Kikaren står kvar');
}

const toggleGps = () => gpsState.active ? stopGps() : startGps();
gpsBtn.onclick = toggleGps;
if (mobileGpsBtn) mobileGpsBtn.onclick = toggleGps;
document.getElementById('gpsStopBtn').onclick = () => stopGps();
gpsFollowBtn.onclick = () => {
  gpsState.follow = !gpsState.follow;
  syncGpsUi(gpsState.point ? 'live' : 'waiting', gpsStatusText.textContent);
  if (gpsState.follow) focusGps();
};
addEventListener('pagehide', () => {
  if (gpsState.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsState.watchId);
});

/* --------------------------------------------------------------- kikaren
   Tap the course and get what a caddie would say. The ball starts on the
   current tee; a long press (or "Mät härifrån") moves it to where you pressed,
   a tap measures to the tapped point. Always on the card: front, centre and
   back of the green from the ball, what the straight line to it crosses, and
   the layups that leave a full approach. For a tapped point: the distance, the
   climb, what the ball lands in, every hazard the shot crosses with the layup
   that stays short and the carry that clears it, and the plays-like number with
   its parts -- slope a metre per metre, wind from a live reading, temperature
   off 21 °C. The arithmetic and its tests live in engine/rangefinder.js and
   engine/weather.js. The ray marches terrainH so a tree canopy cannot steal the
   hit. */
let kik = false, kikGroup = null, kikPt = null, kikBall = null, kikWx = null, kikWxBusy = false;
const kikBtn = document.getElementById('rangeBtn');
const kikOut = document.getElementById('kikOut');
/* the readout is three surfaces, not one card: the green distances in a stack
   at the screen's edge, the tapped distance floating at the point itself, and
   the sheet with everything else -- which on a phone rests as a single row so
   the course stays in view. Each is rewritten only when its text changes, so a
   GPS fix every few seconds never resets a sheet someone is reading. */
const kikGreen = document.getElementById('kikGreen');
const kikTag = document.getElementById('kikTag');
const kikTagBox = kikTag.querySelector('.kt-box');
const kikTagV = new THREE.Vector3();
const kikTagXY = { x: NaN, y: NaN, visible: false };
const kikHtml = new Map();
const kikSwap = (el, html) => { if (kikHtml.get(el) !== html) { el.innerHTML = html; kikHtml.set(el, html); } };
function kikSheet(open) {
  kikOut.classList.toggle('open', open);
  kikOut.querySelector('.kik-head')?.setAttribute('aria-expanded', String(open));
}
function setKik(on, quiet = false) {
  kik = Boolean(on);
  kikBtn.classList.toggle('on', kik);
  const toolHint = document.getElementById('toolHint');
  if (toolHint) {
    toolHint.style.display = kik ? 'block' : '';
    toolHint.textContent = kik
      ? 'Kikaren aktiv · tryck för mål, håll kvar för boll'
      : 'Tryck på banan för att mäta med Kikaren';
  }
  if (!kik) { kikClear(); return; }
  if (!quiet) toast('Tryck på banan för att mäta · håll kvar för att flytta bollen');
  kikRender();
}
kikBtn.onclick = () => setKik(!kik);
function kikClear() {
  kikErase();
  kikPt = null; kikBall = null;
  kikOut.classList.remove('show');
  kikGreen.classList.remove('show');
  kikTag.hidden = true; kikTagXY.visible = false;
  const toolHint = document.getElementById('toolHint');
  if (toolHint && !kik) toolHint.style.display = '';
}
function kikErase() {
  if (!kikGroup) return;
  scene.remove(kikGroup);
  kikGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  kikGroup = null;
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
/* the live reading for this course: fetched when the card first opens, again
   when the half-hour cache has run out, never twice at once */
function kikWeather() {
  if (kikWxBusy || !GEO.origin) return;
  if (kikWx && Number.isFinite(kikWx.fetchedAt) && Date.now() - kikWx.fetchedAt < WEATHER_TTL_MS) return;
  kikWxBusy = true;
  fetchWeather(GEO.origin.lat, GEO.origin.lon)
    .then(w => { kikWxBusy = false; if (w && w !== kikWx) { kikWx = w; if (kik) kikRender(); } })
    .catch(() => { kikWxBusy = false; });
}
/* what a straight shot crosses: water at its own level, sand */
function kikKindAt(x, z) {
  for (const w of WI.at(x, z)) if (!w.stream && ringSD(x, z, w.ring) < 0 && terrainH(x, z) < w.level + 0.3) return 'vatten';
  for (const b of BI.at(x, z)) if (inRing(x, z, b.ring)) return 'bunker';
  return null;
}
function kikLie(x, z, y) {
  let over = false;
  for (const w of WI.at(x, z)) if (!w.stream && ringSD(x, z, w.ring) < 0 && y < w.level + 0.3) over = true;
  if (over) return 'vatten';
  const c = classify(x, z);
  return c.green > 0.5 ? 'green' : c.sand > 0.4 ? 'bunker' : c.tee > 0.5 ? 'tee' : c.fair > 0.4 ? 'fairway'
       : c.path > 0.4 ? 'stig' : c.forest > 0.5 ? 'skog' : 'ruff';
}
/* every number on the card, with no DOM in it, so the harness can ask for the
   same thing: V3D.rangefinder(origin, target) */
function kikCompute(origin = null, target = null) {
  const h = HOLES[hole - 1];
  const mk = h.tees.marks[teeIdx] || h.tees.marks[0];
  const gpsOrigin = !origin && gpsState.active && gpsState.point ? gpsState.point : null;
  const o = origin || gpsOrigin || kikBall || mk.c;
  const fromGps = Boolean(gpsOrigin);
  const fromTee = !origin && !gpsOrigin && !kikBall;
  const oy = terrainH(o[0], o[1]);
  const wx = kikWx;
  const bTo = p => compassBearing(o[0], o[1], p[0], p[1]);
  const windFor = p => (wx ? windAlong(bTo(p), wx.windFromDeg, wx.windMs) : { head: 0, cross: 0 });
  const tempC = wx ? wx.tempC : null;
  const green = greenDistances(o, h.green);
  const gc = h.green.c;
  const gWind = windFor(gc);
  const toGreen = { dist: green.centre, dh: terrainH(gc[0], gc[1]) - oy, hazards: lineHazards(o, gc, kikKindAt), wind: gWind };
  toGreen.plays = playsLike({ dist: toGreen.dist, dh: toGreen.dh, head: gWind.head, tempC });
  const t = target || kikPt;
  let shot = null;
  if (t) {
    const dist = Math.hypot(t[0] - o[0], t[1] - o[1]);
    const ty = terrainH(t[0], t[1]);
    const wind = windFor(t);
    shot = { target: t, dist, dh: ty - oy, lie: kikLie(t[0], t[1], ty), hazards: lineHazards(o, t, kikKindAt), wind,
             plays: playsLike({ dist, dh: ty - oy, head: wind.head, tempC }) };
  }
  return { origin: o, fromTee, fromGps, gpsAccuracy: fromGps ? gpsState.accuracy : null,
           tee: TEE_NAMES[teeIdx], green, toGreen, layups: layupTargets(green.centre), shot, weather: wx };
}
function kikClubAdvice(r) {
  const playsDistance = r.shot ? r.shot.plays.total : r.toGreen.plays.total;
  const advice = recommendClub(playsDistance, playerBag);
  if (!advice) return '';
  const delta = advice.delta;
  const context = advice.beyondBag
    ? 'Green är utom räckhåll · välj en säker landningsyta'
    : Math.abs(delta) <= 6
      ? `Bra match för ${Math.round(playsDistance)} m spelas-som`
      : delta > 0
        ? `${Math.round(delta)} m kort i full carry`
        : `Kan gå ${Math.round(Math.abs(delta))} m långt`;
  return `<div class="kik-recommend">
    <div class="kik-club">${htmlEsc(advice.club.name)}</div>
    <div class="kik-club-copy"><b>${advice.club.carry} m carry</b><span>${context}</span></div>
    <button class="kik-btn" data-act="bag" aria-label="Ändra klubbor">Ändra</button>
  </div>`;
}
function kikRender() {
  kikWeather();
  const r = kikCompute();
  const m = v => `${Math.round(v)}`;
  const sgn = v => (v > 0 ? '+' : '−') + m(Math.abs(v));
  const parts = p => {
    const s = [];
    if (Math.abs(p.slope) >= 1) s.push(`${sgn(p.slope)} höjd`);
    if (Math.abs(p.wind) >= 1) s.push(`${sgn(p.wind)} vind`);
    if (Math.abs(p.temp) >= 1) s.push(`${sgn(p.temp)} temp`);
    return s.length ? ` <small>(${s.join(', ')})</small>` : '';
  };
  const haz = H => H.map(z => z.type === 'vatten'
    ? `<span class="kik-haz water">vatten · kort om <b>${m(z.from)}</b> · bär <b>${m(z.to)}</b> m</span>`
    : `<span class="kik-haz sand">bunker <b>${m(z.from)}–${m(z.to)}</b> m</span>`).join('<br>');

  /* the green: back over centre over front, the way it lies ahead of the ball */
  kikSwap(kikGreen, r.green.front !== null
    ? `<div class="kg-row back"><i>Bak</i><b>${m(r.green.back)}</b></div>` +
      `<div class="kg-row mid"><i>Mitt</i><b>${m(r.green.centre)}<em>m</em></b></div>` +
      `<div class="kg-row front"><i>Fram</i><b>${m(r.green.front)}</b></div>`
    : `<div class="kg-row mid"><i>Green</i><b>${m(r.green.centre)}<em>m</em></b></div>`);
  kikGreen.classList.add('show');

  /* the tapped point carries its own number, where the eye already is */
  const s = r.shot;
  if (s) {
    const rise = Math.abs(s.dh) >= 1 ? ` · ${m(Math.abs(s.dh))} m ${s.dh > 0 ? 'upp' : 'ned'}` : '';
    const over = s.hazards.length ? ` · över ${s.hazards.some(z => z.type === 'vatten') ? '<u>vatten</u>' : 'bunker'}` : '';
    kikSwap(kikTagBox, `<b>${m(s.dist)}<em>m</em></b><span>spelas <i>${m(s.plays.total)}</i>${rise}${over} · ${s.lie}</span>`);
    kikTag.hidden = false;
    kikTagUpdate();
  } else { kikTag.hidden = true; kikTagXY.visible = false; }

  /* the sheet: head, the row that is always shown, the rest behind a tap on a phone */
  const originLabel = r.fromGps ? `GPS · ±${Math.max(1, Math.round(r.gpsAccuracy || 0))} m`
    : r.fromTee ? `från tee ${r.tee}` : 'från bollen';
  let html = `<div class="kik-grab"></div><div class="kik-head" role="button" tabindex="0" aria-expanded="${kikOut.classList.contains('open')}">` +
             `<b>Kikaren</b><span class="${r.fromGps ? 'kik-live' : ''}">${originLabel}</span>` +
             `${r.fromTee || r.fromGps ? '' : '<button class="kik-btn" data-act="tee">Från tee</button>'}` +
             `<svg class="kik-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg></div>`;
  html += '<div class="kik-peek">';
  if (s) {
    html += `<div class="kik-line"><span>Till punkten <b>${m(s.dist)}</b> m · spelas som <b>${m(s.plays.total)}</b>${parts(s.plays)} · ${s.lie}</span>` +
            `<button class="kik-btn" data-act="ball">Mät härifrån</button></div>`;
    if (s.hazards.length) html += `<div class="kik-row">${haz(s.hazards)}</div>`;
  } else {
    html += `<div class="kik-line"><span>Till green spelas som <b>${m(r.toGreen.plays.total)}</b> m${parts(r.toGreen.plays)}</span></div>`;
    if (r.toGreen.hazards.length) html += `<div class="kik-row">På linjen: ${haz(r.toGreen.hazards)}</div>`;
  }
  html += kikClubAdvice(r);
  html += '</div><div class="kik-body">';
  if (r.layups.length) html += `<div class="kik-row">Lägg upp: ${r.layups.map(l => `${l.remain} m kvar → <b>${m(l.shot)}</b> m`).join(' · ')}</div>`;
  html += kikWxLine(r);
  html += '</div>';
  kikSwap(kikOut, html);
  kikOut.classList.add('show');
  kikDraw(r);
}
/* the floating number follows its point through every camera move; off screen
   it fades rather than sticking to an edge */
function kikTagUpdate() {
  if (!kik || !kikPt || kikTag.hidden) return;
  const v = kikTagV.set(kikPt[0], terrainH(kikPt[0], kikPt[1]) + 1.1, kikPt[1]).project(camera);
  const off = v.z > 1 || v.x < -1.04 || v.x > 1.04 || v.y < -1.04 || v.y > 1.04;
  kikTag.style.opacity = off ? '0' : '1';
  kikTagXY.visible = !off;
  if (off) return;
  const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
  kikTagXY.x = x; kikTagXY.y = y;
  kikTag.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
}
function kikWxLine(r) {
  const w = r.weather;
  if (!w) return `<div class="kik-wx">Ingen vinddata${typeof navigator !== 'undefined' && navigator.onLine === false ? ' (offline)' : ''} · spelas-som räknar bara höjd</div>`;
  const rel = r.shot ? r.shot.wind : r.toGreen.wind;
  const relTxt = Math.abs(rel.head) >= 0.5 ? `${rel.head > 0 ? 'motvind' : 'medvind'} ${Math.abs(rel.head).toFixed(1)}` : 'sidvind';
  const t = w.time ? w.time.slice(11, 16) : '';
  return `<div class="kik-wx">${weatherWord(w.code)} · vind <b>${w.windMs.toFixed(1)} m/s</b> från ${compassName(w.windFromDeg)} (${relTxt})` +
         ` · ${Math.round(w.tempC)} °C${t ? ` · ${t}` : ''}${w.stale ? ' · gammal avläsning' : ''}</div>`;
}
/* the shot in the scene: the arc from the ball to the point, a tick where each
   hazard starts and ends, and the ball itself when it is not on the tee */
function kikDraw(r) {
  kikErase();
  kikGroup = new THREE.Group();
  const [ox, oz] = r.origin, oy = terrainH(ox, oz);
  if (!r.fromTee && !r.fromGps) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xffffff) }));
    ball.position.set(ox, oy + 0.7, oz);
    kikGroup.add(ball);
  }
  if (r.shot) {
    const [tx, tz] = r.shot.target, ty = terrainH(tx, tz), dist = r.shot.dist;
    const P = [];
    const rise = Math.min(30, 4 + dist * 0.055);
    for (let i = 0; i <= 30; i++) {
      const f = i / 30;
      const x = ox + (tx - ox) * f, z = oz + (tz - oz) * f;
      P.push(new THREE.Vector3(x, oy + 1.4 + (ty + 0.4 - oy - 1.4) * f + Math.sin(f * Math.PI) * rise, z));
    }
    kikGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(P),
      new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0xffdf8a), transparent: true, opacity: 0.95 })));
    const mark = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xffdf8a) }));
    mark.position.set(tx, ty + 0.9, tz);
    kikGroup.add(mark);
    const ux = (tx - ox) / dist, uz = (tz - oz) / dist;
    for (const z of r.shot.hazards) {
      const col = new THREE.Color(z.type === 'vatten' ? 0x4bb4d8 : 0xe2cf9a);
      for (const s of [z.from, z.to]) {
        const x = ox + ux * s, zz = oz + uz * s, y = terrainH(x, zz);
        kikGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y + 0.2, zz), new THREE.Vector3(x, y + 4, zz)]),
          new THREE.LineBasicNodeMaterial({ color: col })));
      }
    }
  }
  scene.add(kikGroup);
}
function kikMeasure(clientX, clientY) {
  const hit = groundHit(clientX, clientY);
  if (!hit) return;
  kikPt = hit;
  kikRender();
}
function kikPlaceBall(clientX, clientY) {
  const hit = groundHit(clientX, clientY);
  if (!hit) return;
  if (gpsState.active) stopGps(false);
  kikBall = hit;
  toast('Bollen ligger här nu · tryck för att mäta');
  kikRender();
}
kikOut.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) {
    if (e.target.closest('.kik-head')) kikSheet(!kikOut.classList.contains('open'));
    return;
  }
  if (b.dataset.act === 'tee') kikBall = null;
  else if (b.dataset.act === 'ball' && kikPt) { if (gpsState.active) stopGps(false); kikBall = kikPt; kikPt = null; }
  else if (b.dataset.act === 'bag') { openBag(); return; }
  kikRender();
});
kikOut.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.kik-head') && !e.target.closest('[data-act]')) {
    e.preventDefault(); kikSheet(!kikOut.classList.contains('open'));
  }
});
/* ------------------------------------------------- greengrid (yardage book & slope visualization)
   Professional golf simulation green reading:
   - High-density terrain-conforming grid lines closely masked to the green boundary
   - Continuous slope gradient coloring (cyan -> lime green -> amber -> fiery red)
   - Real-time animated moving dots (beads) gliding downhill along the fall-line
   - Directional slope break arrows (stem + barb chevrons) showing exact break
   - Concentric 1m, 2m, and 3m pin proximity target rings with compass crosshairs */
let gridOn = false;
let gridGroup = null;
let beadsMesh = null;
let beadsData = [];
const beadDummy = new THREE.Object3D();

function getSlopeAt(x, z) {
  const delta = 0.45;
  const hL = terrainH(x - delta, z);
  const hR = terrainH(x + delta, z);
  const hD = terrainH(x, z - delta);
  const hU = terrainH(x, z + delta);
  const gx = (hR - hL) / (delta * 2);
  const gz = (hU - hD) / (delta * 2);
  const s = Math.hypot(gx, gz);
  const dirX = s > 1e-4 ? -gx / s : 0;
  const dirZ = s > 1e-4 ? -gz / s : 0;
  return { gx, gz, s, dirX, dirZ };
}

function slopeColor(s) {
  if (s < 0.015) {
    // 0 - 1.5%: Calm Electric Cyan (Flat / Minimal break)
    return [0.06, 0.85, 0.95];
  } else if (s < 0.035) {
    // 1.5% - 3.5%: Vibrant Lime Green (Gentle break)
    const t = (s - 0.015) / 0.02;
    return [0.06 + t * 0.16, 0.85 + t * 0.12, 0.95 - t * 0.72];
  } else if (s < 0.055) {
    // 3.5% - 5.5%: Golden Amber / Yellow (Moderate break)
    const t = (s - 0.035) / 0.02;
    return [0.22 + t * 0.76, 0.97 - t * 0.15, 0.23 - t * 0.13];
  } else if (s < 0.085) {
    // 5.5% - 8.5%: Bright Orange (Heavy break)
    const t = (s - 0.055) / 0.03;
    return [0.98 + t * 0.02, 0.82 - t * 0.38, 0.10 - t * 0.02];
  } else {
    // > 8.5%: Fiery Crimson Red (Severe slope)
    return [1.0, 0.18, 0.14];
  }
}

function gridClear() {
  if (gridGroup) {
    scene.remove(gridGroup);
    gridGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
    gridGroup = null;
  }
  beadsMesh = null;
  beadsData = [];
}

function updateGreenGrid(dt, now) {
  if (!beadsMesh || beadsData.length === 0) return;
  const timeSec = now * 0.001;

  for (let i = 0; i < beadsData.length; i++) {
    const b = beadsData[i];
    // Smooth progress along downhill cycle
    const u = ((timeSec * b.speed + b.phase) % 1.0 + 1.0) % 1.0;
    const sinU = Math.sin(u * Math.PI);
    const envelope = sinU * sinU;

    const travel = (u - 0.5) * b.travelDist;
    const curX = b.cx + b.vx * travel;
    const curZ = b.cz + b.vz * travel;
    const curY = meshH(curX, curZ) + 0.046;

    const s = envelope * b.baseScale;
    beadDummy.position.set(curX, curY, curZ);
    beadDummy.rotation.y = b.angle;
    beadDummy.scale.set(s, s * 0.75, s * (1.1 + b.slope * 6.0));
    beadDummy.updateMatrix();
    beadsMesh.setMatrixAt(i, beadDummy.matrix);
  }
  beadsMesh.instanceMatrix.needsUpdate = true;
}

function buildGreenGrid() {
  gridClear();
  const h = HOLES[hole - 1];
  if (!h || !h.green || !h.green.ring) return;

  const ring = h.green.ring;
  const bb = ringBBox(ring);
  const pad = 1.0;
  const x0 = bb.x0 - pad, x1 = bb.x1 + pad;
  const z0 = bb.z0 - pad, z1 = bb.z1 + pad;
  const width = x1 - x0;
  const depth = z1 - z0;

  const CELL = 1.0;
  const nx = Math.max(8, Math.ceil(width / CELL));
  const nz = Math.max(8, Math.ceil(depth / CELL));
  const dx = width / nx;
  const dz = depth / nz;

  gridGroup = new THREE.Group();
  gridGroup.renderOrder = 7;

  const linePositions = [];
  const lineColors = [];
  const beadsList = [];

  let totalSlope = 0;
  let maxSlope = 0;
  let slopeCount = 0;

  // 1. Grid Lines (LineSegments closely hugging terrain and clipped to green)
  const SUB = 2; // Subdivide each 1m cell into 2 segments for smooth terrain conformance
  const stepX = dx / SUB;
  const stepZ = dz / SUB;

  // Lines along X
  for (let j = 0; j <= nz; j++) {
    const z = z0 + j * dz;
    for (let i = 0; i < nx * SUB; i++) {
      const ax = x0 + i * stepX;
      const bx = ax + stepX;
      const mx = (ax + bx) * 0.5;
      const sd = ringSD(mx, z, ring);
      if (sd > 0.40) continue;

      const edgeFade = clampf((-sd + 0.25) / 0.75, 0.0, 1.0);
      if (edgeFade <= 0.02) continue;

      const slopeA = getSlopeAt(ax, z);
      const slopeB = getSlopeAt(bx, z);
      const colA = slopeColor(slopeA.s).map(c => c * edgeFade);
      const colB = slopeColor(slopeB.s).map(c => c * edgeFade);

      const ay = meshH(ax, z) + 0.032;
      const by = meshH(bx, z) + 0.032;

      linePositions.push(ax, ay, z, bx, by, z);
      lineColors.push(...colA, ...colB);
    }
  }

  // Lines along Z
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * dx;
    for (let j = 0; j < nz * SUB; j++) {
      const az = z0 + j * stepZ;
      const bz = az + stepZ;
      const mz = (az + bz) * 0.5;
      const sd = ringSD(x, mz, ring);
      if (sd > 0.40) continue;

      const edgeFade = clampf((-sd + 0.25) / 0.75, 0.0, 1.0);
      if (edgeFade <= 0.02) continue;

      const slopeA = getSlopeAt(x, az);
      const slopeB = getSlopeAt(x, bz);
      const colA = slopeColor(slopeA.s).map(c => c * edgeFade);
      const colB = slopeColor(slopeB.s).map(c => c * edgeFade);

      const ay = meshH(x, az) + 0.032;
      const by = meshH(x, bz) + 0.032;

      linePositions.push(x, ay, az, x, by, bz);
      lineColors.push(...colA, ...colB);
    }
  }

  // 2. Cell Analysis: Animated Moving Slope Beads
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = x0 + (i + 0.5) * dx;
      const cz = z0 + (j + 0.5) * dz;
      const sd = ringSD(cx, cz, ring);
      if (sd > -0.05) continue; // Inside the green putting surface

      const { s, dirX, dirZ } = getSlopeAt(cx, cz);
      totalSlope += s;
      slopeCount++;
      if (s > maxSlope) maxSlope = s;

      const col = slopeColor(s);

      // Animated Moving Bead along the fall line
      if (s >= 0.003) {
        beadsList.push({
          cx, cz,
          vx: dirX, vz: dirZ,
          angle: Math.atan2(dirX, dirZ),
          slope: s,
          speed: clampf(s * 15 + 0.28, 0.38, 1.8),
          phase: (hash2(Math.round(cx * 10), Math.round(cz * 10)) % 1000) / 1000,
          travelDist: Math.min(dx, dz) * 0.88,
          baseScale: clampf(0.85 + s * 6.0, 0.75, 1.25),
          color: col,
        });
      }
    }
  }

  // Create Grid Lines Mesh
  if (linePositions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const mat = new THREE.LineBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = DEPTH_SIGN * 5;
    mat.polygonOffsetUnits = DEPTH_SIGN * 10;
    const linesMesh = new THREE.LineSegments(geo, mat);
    gridGroup.add(linesMesh);
  }

  // Create Animated Beads InstancedMesh (The Moving Dots)
  if (beadsList.length > 0) {
    beadsData = beadsList;
    const bGeo = new THREE.SphereGeometry(0.082, 10, 8);
    const bMat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    bMat.polygonOffset = true;
    bMat.polygonOffsetFactor = DEPTH_SIGN * 7;
    bMat.polygonOffsetUnits = DEPTH_SIGN * 14;
    beadsMesh = new THREE.InstancedMesh(bGeo, bMat, beadsList.length);
    const cObj = new THREE.Color();
    for (let k = 0; k < beadsList.length; k++) {
      cObj.setRGB(...beadsList[k].color);
      beadsMesh.setColorAt(k, cObj);
    }
    if (beadsMesh.instanceColor) beadsMesh.instanceColor.needsUpdate = true;
    gridGroup.add(beadsMesh);
  }

  // 3. Pin Proximity Target Rings (1m, 2m, 3m around cup)
  if (h.pin) {
    const [px, pz] = h.pin;
    const ringConfigs = [
      { radius: 1.0, col: [1.0, 1.0, 1.0], opacity: 0.65, crosshairs: true },
      { radius: 2.0, col: [0.18, 0.95, 0.45], opacity: 0.45, crosshairs: false },
      { radius: 3.0, col: [0.10, 0.80, 0.95], opacity: 0.32, crosshairs: false },
    ];
    const SEGS = 48;

    for (const rc of ringConfigs) {
      const pos = [];
      for (let s = 0; s < SEGS; s++) {
        const a1 = (s / SEGS) * Math.PI * 2;
        const a2 = ((s + 1) / SEGS) * Math.PI * 2;
        const x1 = px + Math.cos(a1) * rc.radius, z1 = pz + Math.sin(a1) * rc.radius;
        const x2 = px + Math.cos(a2) * rc.radius, z2 = pz + Math.sin(a2) * rc.radius;
        pos.push(x1, meshH(x1, z1) + 0.040, z1, x2, meshH(x2, z2) + 0.040, z2);
      }

      if (rc.crosshairs) {
        for (let a = 0; a < 4; a++) {
          const ang = (a / 4) * Math.PI * 2;
          const cosA = Math.cos(ang), sinA = Math.sin(ang);
          const t1x = px + cosA * (rc.radius - 0.15), t1z = pz + sinA * (rc.radius - 0.15);
          const t2x = px + cosA * (rc.radius + 0.15), t2z = pz + sinA * (rc.radius + 0.15);
          pos.push(t1x, meshH(t1x, t1z) + 0.040, t1z, t2x, meshH(t2x, t2z) + 0.040, t2z);
        }
      }

      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const pMat = new THREE.LineBasicNodeMaterial({
        color: new THREE.Color(...rc.col),
        transparent: true,
        opacity: rc.opacity,
        depthWrite: false,
      });
      pMat.polygonOffset = true;
      pMat.polygonOffsetFactor = DEPTH_SIGN * 6;
      pMat.polygonOffsetUnits = DEPTH_SIGN * 12;
      gridGroup.add(new THREE.LineSegments(pGeo, pMat));
    }
  }

  scene.add(gridGroup);

  // Update HUD facts with slope insights
  if (slopeCount > 0) {
    const meanSlope = (totalSlope / slopeCount) * 100;
    const maxSlopePct = maxSlope * 100;
    const factsEl = document.getElementById('facts');
    if (factsEl) {
      factsEl.innerHTML += `<br>Greenlutning: snitt <b>${meanSlope.toFixed(1)}%</b> · max <b>${maxSlopePct.toFixed(1)}%</b>`;
    }
  }
}

const gridBtn = document.getElementById('gridBtn');
gridBtn.onclick = () => {
  gridOn = !gridOn;
  gridBtn.classList.toggle('on', gridOn);
  if (gridOn) {
    buildGreenGrid();
    /* Inspect move: fly in over green to read break */
    setCam('green');
    const h = HOLES[hole - 1], c = h.green.c;
    const p = alongLine(h.line, 0.9);
    const F = [Math.sin(p.b), Math.cos(p.b)];
    const gy = terrainH(c[0], c[1]);
    flyTo(V3(c[0] - F[0] * 26, gy + 21, c[1] - F[1] * 26), V3(c[0], gy + 1, c[1]), RMOTION ? 0 : 1.4);
    toast('Greengrid aktiv · Rörliga punkter visar fallinjen');
  } else {
    gridClear();
  }
};

/* a click is a click only if the pointer did not drag (OrbitControls owns drags) */
{
  let px0 = 0, py0 = 0, pt0 = 0, fingers = 0, pinched = false;
  renderer.domElement.addEventListener('pointerdown', e => {
    px0 = e.clientX; py0 = e.clientY; pt0 = performance.now();
    /* a second finger makes the gesture a pinch for as long as any finger is
       down: neither finger's release is a tap, and a slow pinch is not a long
       press -- it used to move the ball and drop GPS mode when a zoom ended */
    fingers++; if (fingers > 1) pinched = true;
    if (tour) endTour();
  });
  const release = () => { fingers = Math.max(0, fingers - 1); if (fingers === 0) pinched = false; };
  renderer.domElement.addEventListener('pointercancel', release);
  renderer.domElement.addEventListener('pointerup', e => {
    const wasPinch = pinched; release();
    if (wasPinch) return;
    const held = performance.now() - pt0, moved = Math.hypot(e.clientX - px0, e.clientY - py0);
    /* in kikaren a long press without a drag puts the ball where the finger is */
    if (kik && moved < 8 && held >= 450 && held < 3000) { kikPlaceBall(e.clientX, e.clientY); return; }
    if (held < 450 && moved < 8) {
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
  if (e.key === 'ArrowRight' || e.key === 'n') goHole(hole >= NHOLES ? 1 : hole + 1, true);
  if (e.key === 'ArrowLeft' || e.key === 'p') goHole(hole <= 1 ? NHOLES : hole - 1, true);
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
    /* a course that NAMES its practice greens (scenery.practiceGreens -- Johannesberg,
       whose nine finishes 47 m from the clubhouse) is believed; the rest fall back
       to every scenery green within 200 m */
    const near = (M.scenery.practiceGreens || M.scenery.greens || []).map(centroidOf).filter(c => hyp(c, [k.x, k.z]) < 200);
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
  mctx.strokeStyle = strategyOn ? 'rgba(205,231,211,.34)' : '#8cf0a8';
  mctx.lineWidth = strategyOn ? 1.5 : 3.2; mctx.lineJoin = 'round';
  mctx.beginPath();
  h.line.forEach((p, i) => i ? mctx.lineTo(MX(p[0]), MZ(p[1])) : mctx.moveTo(MX(p[0]), MZ(p[1])));
  mctx.stroke();
  if (strategyOn && currentStrategy) {
    mctx.save();
    const primary = sampledRoute(currentStrategy.line, 0, currentStrategy.primaryDistance, 5);
    mctx.strokeStyle = 'rgba(178,225,188,.82)'; mctx.lineWidth = 2.6; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
    mctx.beginPath();
    primary.forEach((p, i) => i ? mctx.lineTo(MX(p[0]), MZ(p[1])) : mctx.moveTo(MX(p[0]), MZ(p[1])));
    mctx.stroke();
    for (const zone of currentStrategy.zones) {
      const before = pointAlongLine(currentStrategy.line, Math.max(0, zone.distance - 5));
      const after = pointAlongLine(currentStrategy.line, Math.min(currentStrategy.total, zone.distance + 5));
      const angle = Math.atan2(after[1] - before[1], after[0] - before[0]);
      mctx.translate(MX(zone.point[0]), MZ(zone.point[1]));
      mctx.rotate(angle);
      mctx.fillStyle = zone.kind === 'approach' ? 'rgba(216,191,130,.09)' : 'rgba(159,215,170,.12)';
      mctx.strokeStyle = zone.kind === 'approach' ? 'rgba(216,191,130,.58)' : 'rgba(178,225,188,.72)'; mctx.lineWidth = 1;
      mctx.beginPath(); mctx.ellipse(0, 0, zone.radiusAlong * MS, zone.radiusAcross * MS, 0, 0, TAU); mctx.fill(); mctx.stroke();
      mctx.fillStyle = zone.kind === 'approach' ? 'rgba(216,191,130,.75)' : 'rgba(190,231,199,.88)';
      mctx.beginPath(); mctx.arc(0, 0, 2.1, 0, TAU); mctx.fill();
      mctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    mctx.restore();
  }
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
  if (gpsState.active && gpsState.point) {
    const px = MX(gpsState.point[0]), pz = MZ(gpsState.point[1]);
    mctx.fillStyle = 'rgba(121,233,155,.12)'; mctx.strokeStyle = 'rgba(121,233,155,.72)'; mctx.lineWidth = 1.3;
    mctx.beginPath(); mctx.arc(px, pz, clampf((gpsState.accuracy || 4) * MS, 3, 26), 0, TAU); mctx.fill(); mctx.stroke();
    mctx.fillStyle = '#b4ffc4'; mctx.strokeStyle = '#0b2514'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(px, pz, 4.2, 0, TAU); mctx.fill(); mctx.stroke();
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
    else {
      document.getElementById('rail')?.classList.remove('open');
      document.getElementById('uiToggle')?.classList.remove('on');
      document.getElementById('railBackdrop')?.classList.remove('open');
      document.getElementById('mini')?.classList.remove('mobile-open');
      document.getElementById('mobileMiniToggle')?.classList.remove('on');
      document.getElementById('note')?.classList.remove('mobile-open');
      document.getElementById('mobileNoteToggle')?.classList.remove('on');
      navDrawer.open();
    }
  };
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (navDrawer.isOpen()) { navDrawer.close(); return; }
    if (railOpen) { closeRail(); return; }
    const inGameRail = document.getElementById('rail');
    if (inGameRail?.classList.contains('open')) {
      inGameRail.classList.remove('open');
      document.getElementById('uiToggle')?.classList.remove('on');
      document.getElementById('railBackdrop')?.classList.remove('open');
      return;
    }
    const mini = document.getElementById('mini');
    if (mini?.classList.contains('mobile-open')) {
      mini.classList.remove('mobile-open');
      document.getElementById('mobileMiniToggle')?.classList.remove('on');
      return;
    }
    const note = document.getElementById('note');
    if (note?.classList.contains('mobile-open')) {
      note.classList.remove('mobile-open');
      document.getElementById('mobileNoteToggle')?.classList.remove('on');
      return;
    }
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
/* frames rendered since boot, monotonic: what a harness waits on after
   changing anything, because under a software renderer a frame can take
   longer than any fixed wait and a screenshot shows the LAST frame drawn */
let FRAME_NO = 0, TIER_FRAME = 0;   /* the frame the tree tiers last changed on */
const FRAME_MS = new Float32Array(120);   /* the last frames' intervals, for the harness (V3D.frameTimes) */
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  terrainV2.tick(now);
  /* the world graph streams by screen-space error against the real camera */
  if (terrainV2.kind === 'graph' && terrainV2.active) {
    terrainV2.update({ camera, viewportHeightPixels: renderer.domElement.height || innerHeight, activeHoleNumber: hole });
  }
  /* the crossfade clock: real time, a fixed 1/60 under det, or whatever the harness set */
  if (!TREE_LOD.clockDriven) TREE_LOD.fadeClock += DET ? 1 / 60 : dt;
  treeFadeClock.value = TREE_LOD.fadeClock;
  treeFadeDuration.value = TREE_LOD.fadeS;
  updateTreeTiers();
  FRAME_MS[FRAME_NO % FRAME_MS.length] = now - last;
  last = now; frames++; acc += dt; FRAME_NO++;
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
    if (!tourFlight.st) initHoleFlight(HOLES[hole - 1]);
    if (!tourFlight.st) stopFlight();
    else {
      const r = flightStep(dt);
      applyFlightCamera();
      camTween.on = false;
      flying = Math.max(1e-4, r.u);
      updateTourProgress();
      /* the next hole's card comes up as the travel shot lines up behind its tee */
      if (tourFlight.cardPending && r.ls >= -FL.preTee - 25) { showTourCard(); tourFlight.cardPending = false; }
      if (r.done) {
        tourFlight.holdTimer += dt;
        if (tourFlight.holdTimer >= FL.hold) {
          if (tour && hole < NHOLES) {
            /* no cut: the camera leaves the reverse angle and flies to the next tee */
            const from = flightPose();
            const card = document.getElementById('tourCard');
            if (card) card.classList.remove('show');
            goHole(hole + 1, false);
            initHoleFlight(HOLES[hole - 1], from);
            if (!tourFlight.st) { endTour(); }
            flying = 1e-4;
          } else if (tour) {
            endTour();
          } else {
            stopFlight();
            setCam('green');
          }
        }
      }
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
  if (flying === 0) {
    controls.update();
    /* never underground, and never so close to it that the near plane clips through -- eased, see groundClamp */
    groundClamp.step(camera.position, dt);
  } else groundClamp.reset();
  placeSun();
  shadowRest(now);
  if (skyMesh) skyMesh.position.copy(camera.position);
  if (skyDome) skyDome.position.copy(camera.position);
  updateSky();
  updateStrategy(now);
  kikTagUpdate();
  drawMini();
  if (gridOn) updateGreenGrid(dt, now);
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

if (terrainV2.kind === 'graph' && terrainV2.active && typeof terrainV2.settle === 'function') {
  const settleStarted = performance.now();
  const settled = await terrainV2.settle(60_000);
  span('v2 stream: first frontier fully resident (after the overlap)', settleStarted, settled ? { tiles: settled.renderedTiles } : {});
}
await tick('klar', 1.0);
renderer.setAnimationLoop(() => {
  /* the first frames' wall times, for the profiler: shader compiles and
     texture uploads land here and no stage mark sees them */
  if (BOOT_PERF.firstFrames.length < 12) {
    const t = performance.now();
    frame();
    BOOT_PERF.firstFrames.push({ atMs: +(t - bootStarted).toFixed(1), ms: +(performance.now() - t).toFixed(1),
      tris: renderer.info?.render?.triangles ?? null, draws: renderer.info?.render?.drawCalls ?? null,
      tiers: TREE_LOD.ready ? { t0: TREE_LOD.stats.tier0, t1: TREE_LOD.stats.tier1, t2: TREE_LOD.stats.tier2, t3: TREE_LOD.stats.tier3 } : null });
  } else frame();
});
document.getElementById('hdsub').textContent =
  `${CMETA.tag} · ${IS_GPU ? 'WebGPU' : 'WebGL2'}${terrainV2.rendererState.status === 'ready' ? ' · 1 m preview' : ''}`;
stats.draws = renderer.info?.render?.drawCalls || stats.draws;
BOOT_PERF.totalMs = +(performance.now() - bootStarted).toFixed(1);

/* The manifest-driven streaming runtime is measured, not selected. Declared
   here and STARTED below the V3D assignment: a measurement must never be what
   stands between a harness and the debug surface it is waiting on. */
let v2StreamProbe = null;

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

/* one frame into an RGBA8 target and back: the pixels, no encoding */
async function captureRaw() {
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
    const rawPixels = await renderer.readRenderTargetPixelsAsync(
      captureReadbackTarget, 0, 0, width, height,
    );
    const pixels = contiguousRgba8Readback(rawPixels, width, height);
    return { pixels, rawPixels, width, height };
  } finally {
    renderer.setRenderTarget(previousTarget);
    captureRenderLocked = false;
    renderActivePipeline();
    await waitForSubmittedGpuWork();
  }
}

async function captureReadback() {
  const { pixels, rawPixels, width, height } = await captureRaw();
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
    readbackBytes: rawPixels.byteLength,
    rowPaddingStripped: rawPixels.byteLength !== pixels.byteLength,
    encodedBytes: encoded.byteLength,
    provisional: true,
    performanceEvidence: false,
  });
}

/* the pop meter's instrument: how many pixels changed since the last call,
   counted in the page so nothing but three numbers crosses to the harness
   (a 1600x900 frame is 5.8 MB over the protocol, and a meter takes hundreds) */
let pixelDeltaPrev = null, pixelDeltaRef = null;
async function pixelDelta(threshold = 24, sinceMark = false, band = null) {
  const { pixels: cur, width, height } = await captureRaw();
  const prev = sinceMark ? pixelDeltaRef : pixelDeltaPrev, primed = !!(prev && prev.length === cur.length);
  /* band = [top, bottom] as fractions of the height: only those rows are counted (the far
     ground under the horizon, where camera parallax is sub-pixel and a shadow's swim is not) */
  const rowA = band ? Math.floor(band[0] * height) : 0, rowB = band ? Math.ceil(band[1] * height) : height;
  /* besides the per-pixel count, the change averaged over 16 x 16 blocks: a
     whole crown popping moves its blocks by the full step, a dither level
     flipping one pixel in sixteen moves them by a sixteenth -- the eye
     works closer to the block than to the pixel */
  const B = 16, bw = Math.ceil(width / B), bh = Math.ceil(height / B), blocks = new Float32Array(bw * bh), counts = new Float32Array(bw * bh);
  let changed = 0, max = 0, counted = 0;
  if (primed) for (let y = rowA; y < rowB; y++) for (let x = 0; x < width; x++) {
    counted++;
    const i = (y * width + x) * 4;
    const d = Math.max(Math.abs(cur[i] - prev[i]), Math.abs(cur[i + 1] - prev[i + 1]), Math.abs(cur[i + 2] - prev[i + 2]));
    if (d > threshold) changed++;
    if (d > max) max = d;
    const b = ((y / B) | 0) * bw + ((x / B) | 0);
    blocks[b] += d; counts[b]++;
  }
  let blockMax = 0, blocksChanged = 0;
  if (primed) for (let b = 0; b < blocks.length; b++) { const m = blocks[b] / counts[b]; if (m > blockMax) blockMax = m; if (m > 6) blocksChanged++; }
  if (sinceMark) pixelDeltaRef = cur; else pixelDeltaPrev = cur;
  return { changed, total: band ? counted : cur.length / 4, max, blockMax: +blockMax.toFixed(2), blocksChanged, blocks: blocks.length, frame: FRAME_NO, primed };
}

/* published before the boot marker, not after: anything waiting on the marker acts
   the instant it appears, and an interface that is not there yet fails silently */
window.V3D = {
  stats: { verts: stats.verts | 0, tris: stats.tris | 0, trees: stats.trees, vista: stats.vista | 0,
           tufts: stats.tufts | 0, bushes: stats.bushes | 0, stones: stats.stones | 0,
           reeds: stats.reeds | 0, cars: stats.cars | 0, pylons: stats.pylons | 0, stumps: stats.stumps | 0,
           draws: stats.draws | 0, surfaceOverlays: stats.surfaceOverlays | 0,
           backend: IS_GPU ? 'webgpu' : 'webgl2' },
  goHole, setCam, setPreset, terrainH, demH, classify, groundAt, horizonAO, HOLES, M, GEO,
  /* the rangefinder numbers for a ball and a target, no DOM: [x, z] each, null = the current tee / no target */
  rangefinder: (origin = null, target = null) => kikCompute(origin, target),
  caddie: () => ({
    bag: playerBag.map(club => ({ ...club })),
    strategyOn,
    visual: strategyAnimation ? {
      activeWidths: strategyAnimation.layers.map(item => item.object.userData.strategyWidth),
      arcCount: strategyAnimation.arcCount,
      labelCount: strategyAnimation.labels.length,
      reducedMotion: strategyReducedMotion,
      settled: strategyAnimation.settled,
    } : null,
    strategy: currentStrategy ? {
      origin: [...currentStrategy.origin], primary: [...currentStrategy.primary],
      primaryDistance: currentStrategy.primaryDistance, arcs: [...currentStrategy.arcs],
      zones: currentStrategy.zones.map(zone => ({ ...zone, point: [...zone.point], club: zone.club ? { ...zone.club } : null })),
    } : null,
    gps: { active: gpsState.active, point: gpsState.point ? [...gpsState.point] : null,
           accuracy: gpsState.accuracy, follow: gpsState.follow },
    kik: { on: kik, point: kikPt ? [...kikPt] : null, ball: kikBall ? [...kikBall] : null,
           sheetOpen: kikOut.classList.contains('open'), tag: kikTagXY.visible ? { x: kikTagXY.x, y: kikTagXY.y } : null },
  }),
  perf: () => ({ ...BOOT_PERF, marks: BOOT_PERF.marks.map(mark => ({ ...mark })),
                 spans: BOOT_PERF.spans.map(s => ({ ...s })), firstFrames: BOOT_PERF.firstFrames.map(f => ({ ...f })), tintMs: stats.tintMs | 0 }),
  /* the tint rasters' bytes, so a boot can be fingerprinted against another */
  groundTint: () => GROUND_TINT ? { near: GROUND_TINT.near.texture.image.data, far: GROUND_TINT.far.texture.image.data } : null,
  groundInfo: () => ({
    mode: groundMode,
    bounds: groundAtlas ? { ...groundAtlas.bounds } : null,
    classCounts: groundAtlas ? Array.from(groundAtlas.data.classCounts) : null,
  }),
  groundSample: (x, z) => groundAtlas?.sampleAt(x, z) || null,
  v2SurfaceProbe: (x, z) => TERRAIN_PREVIEW.surfaceAtlas?.probeAt(x, z) || null,
  /* every drawn world tile with the bytes the GPU holds for it; harness only */
  v2WorldInventory: () => (typeof terrainV2.inventory === 'function' ? terrainV2.inventory() : []),
  v2WorldPlan: () => (typeof terrainV2.plan === 'function' ? terrainV2.plan() : null),
  v2WorldVisible: () => (typeof terrainV2.visibleTileIds === 'function' ? terrainV2.visibleTileIds() : []),
  v2WorldFrustum: () => (typeof terrainV2.frustumReport === 'function' ? terrainV2.frustumReport() : null),
  vistaPoints: () => (VISTA_PTS ? Array.from(VISTA_PTS) : []),
  setWaterVisible: on => { for (const m of WATER_MESHES) m.visible = on !== false; return WATER_MESHES.length; },
  /* hide or show meshes by tag, instance count or material type, to find what draws what */
  setMeshesVisible: ({ tag, minInstances, material, world } = {}, on = true) => {
    let n = 0;
    if (world !== undefined) { if (terrainV2.group) { terrainV2.group.visible = on; n++; } return n; }
    scene.traverse(object => {
      if (!object.isMesh) return;
      if (tag !== undefined && object.userData?.tag !== tag) return;
      if (minInstances !== undefined && !((object.count ?? object.geometry?.instanceCount ?? 0) >= minInstances)) return;
      if (material !== undefined && object.material?.type !== material) return;
      object.visible = on; n++;
    });
    return n;
  },
  /* every mesh in the scene with its footprint, to find what is drawing where */
  sceneInventory: () => {
    const out = [];
    const box = new THREE.Box3();
    scene.traverse(object => {
      if (!object.isMesh) return;
      box.setFromObject(object);
      const size = new THREE.Vector3(); box.getSize(size);
      out.push({
        name: object.name || null, tag: object.userData?.tag ?? null, parentTag: object.parent?.userData?.tag ?? object.parent?.name ?? null,
        material: object.material?.type ?? null, transparent: !!object.material?.transparent, order: object.renderOrder, visible: object.visible,
        instances: object.count ?? object.geometry?.instanceCount ?? null,
        vertices: object.geometry?.getAttribute?.('position')?.count ?? null,
        bbox: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(v => (Number.isFinite(v) ? Math.round(v) : null)),
      });
    });
    return out;
  },
  /* push the tint rasters to the GPU again, or recreate them, to see whether what it holds is what was filled */
  tintRefresh: (mode = 'update') => {
    if (!GROUND_TINT) return null;
    const report = {};
    for (const key of ['near', 'far']) {
      const layer = GROUND_TINT[key];
      const d = layer.texture.image.data;
      let sum = 0; for (let i = 0; i < d.length; i += 4013) sum += d[i];
      report[key] = { version: layer.texture.version, n: layer.n, sampleSum: sum, colorSpace: layer.texture.colorSpace, format: layer.texture.format, type: layer.texture.type };
      if (mode === 'dispose') layer.texture.dispose();
      layer.texture.needsUpdate = true;
    }
    return report;
  },
  /* switch parts of the world material off to see which one paints a view */
  v2WorldMaterial: ({ fog, roughness, emissiveBoost, colour, flatNormal, unlit } = {}) => {
    const batches = terrainV2.runtime?.layer?.batches;
    if (!batches) return 0;
    let n = 0;
    for (const batch of batches.values()) {
      const m = batch.material;
      if (fog !== undefined) m.fog = fog;
      if (roughness !== undefined) m.roughnessNode = float(roughness);
      if (emissiveBoost !== undefined) m.emissiveNode = emissiveBoost ? vec3(0.02, 0.02, 0.02) : null;
      if (colour) m.colorNode = vec3(colour[0], colour[1], colour[2]);
      if (flatNormal) m.normalNode = null;
      if (unlit !== undefined) m.lights = !unlit;
      m.needsUpdate = true;
      n++;
    }
    return n;
  },
  v2WorldGroup: () => (terrainV2.group
    ? terrainV2.group.children.map(o => ({ name: o.name, tag: o.userData?.tag ?? null, visible: o.visible, instances: o.geometry?.instanceCount ?? null, material: o.material?.type ?? null, castShadow: o.castShadow }))
    : []),
  /* what the world says about one point: height, the tint bytes under it,
     whether the ground calls it flat or water, and which rings claim it */
  /* the carved lake beds: field membership, depth and level at a legacy point */
  waterBedAt: (x, z) => {
    const bed = terrainV2.waterBed ?? null;
    const grid = TERRAIN_PREVIEW.bridge?.toGrid?.(x, z) ?? null;
    if (!bed || !grid) return null;
    return { inWater: bed.inWater(grid[0], grid[1]), depth: bed.depthAt(grid[0], grid[1]), level: bed.levelAt(grid[0], grid[1]),
      flat: terrainV2.flatWater?.isFlatAt(grid[0], grid[1]) ?? null, ground: terrainH(x, z), adapter: terrainV2.heightAt?.(x, z) ?? null,
      world: terrainV2.worldHeightAt?.(x, z) ?? null };
  },
  /* every water sheet: its level and the depth attribute its vertices carry */
  waterSheets: () => WATER_MESHES.map(m => {
    const dp = m.geometry.getAttribute('aDepth');
    let min = Infinity, max = -Infinity, sum = 0;
    for (let i = 0; i < dp.count; i++) { const v = dp.getX(i); if (v < min) min = v; if (v > max) max = v; sum += v; }
    const bb = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox);
    return { name: m.name, vertices: dp.count, level: +m.position.y.toFixed(2), y: +bb.min.y.toFixed(2),
      depthMin: +min.toFixed(2), depthMax: +max.toFixed(2), depthMean: +(sum / dp.count).toFixed(2),
      bounds: [bb.min.x, bb.min.z, bb.max.x, bb.max.z].map(v => Math.round(v)) };
  }),
  carvedGpuTiles: () => terrainV2.carvedGpuTiles ?? null,
  probeGround: (x, z) => {
    const h = terrainH(x, z);
    const tintAt = layer => {
      if (!layer) return null;
      const i = Math.floor((x - layer.bounds.x0) / layer.dx), j = Math.floor((z - layer.bounds.z0) / layer.dx);
      if (i < 0 || j < 0 || i >= layer.n || j >= layer.n) return null;
      const o = (j * layer.n + i) * 4;
      return [layer.texture.image.data[o], layer.texture.image.data[o + 1], layer.texture.image.data[o + 2]];
    };
    const grid = TERRAIN_PREVIEW.bridge?.toGrid?.(x, z) ?? null;
    return {
      h: +h.toFixed(2),
      slope: +(Math.hypot(terrainH(x + 8, z) - h, terrainH(x, z + 8) - h) / 8).toFixed(3),
      tintNear: tintAt(GROUND_TINT?.near), tintFar: tintAt(GROUND_TINT?.far),
      flat: grid && terrainV2.flatWater ? terrainV2.flatWater.isFlatAt(grid[0], grid[1]) : null,
      water: typeof terrainV2.isFlatWaterAt === 'function' ? terrainV2.isFlatWaterAt(x, z) : null,
      rings: WI.at(x, z).filter(w => !w.stream && ringSD(x, z, w.ring) < 0).map(w => w.level),
      landuse: LI.at(x, z).filter(q => ringSD(x, z, q.ring) < 0).map(q => q.kind),
      cover: typeof coverAt === 'function' ? coverAt(x, z) : null,
    };
  },
  flatWater: () => (terrainV2.flatWater
    ? { spacing: terrainV2.flatWater.spacing, sheets: stats.flatWaterSheets | 0, components: terrainV2.flatWater.components.map(c => ({ hectares: c.hectares, level: +c.level.toFixed(2), surface: +c.surfaceHeight.toFixed(2), known: c.knownCells, uncovered: c.uncoveredCells, bounds: c.bounds })) }
    : null),
  cameraInfo: () => ({ fov: camera.fov, near: camera.near, far: camera.far, aspect: camera.aspect, coordinateSystem: camera.coordinateSystem, reversedDepth: camera.reversedDepth ?? null, position: camera.position.toArray() }),
  /* put the camera anywhere, at once: the harness stands where a person stood */
  placeCamera: (p, t) => flyTo(V3(p[0], p[1], p[2]), V3(t[0], t[1], t[2]), 0),
  waterLevels: () => M.water.filter(w => !w.stream).map(w => ({
    id: w.id ?? null, name: w.name ?? null, level: w.level, isLake: !!w.isLake, points: w.ring?.length ?? 0,
    bb: w.ring?.length ? ringBBox(w.ring) : null,
  })),
  v2Terrain: () => ({
    requested: TERRAIN_PREVIEW.requested,
    ready: TERRAIN_PREVIEW.ready,
    status: terrainV2.rendererState.status,
    /* 'graph' when the whole world is the ring graph and no legacy ground is built */
    kind: terrainV2.kind || 'fixed-frontier',
    courseSurfaceOverlayMeshes: stats.surfaceOverlays | 0,
    surfaceDebugMode,
    surfaceRepresentation: TERRAIN_PREVIEW.surfaceAtlas?.data?.representation ||
      (TERRAIN_PREVIEW.surfacePolicy === 'legacy-ground-atlas' ? 'legacy-ground-atlas' : null),
    surfacePolicy: terrainV2.surfacePolicy || 'v2-atlas',
    reason: TERRAIN_PREVIEW.reason,
    selection: {
      mode: V2_SELECTION.mode,
      requestMode: V2_SELECTION.requestMode,
      defaulted: V2_SELECTION.defaulted,
      publishedGraphSlugs: [...V2_SELECTION.publishedGraphSlugs],
      graph: V2_SELECTION.graph ? { slug: V2_SELECTION.graph.slug, ...V2_SELECTION.graph.summary } : null,
      graphError: V2_SELECTION.graphError,
    },
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
    /* two rectangles, deliberately: `bounds` is the tiles' own EPSG:3006
       rectangle, `legacyBounds` the axis-aligned legacy one inscribed in it
       once the bridge has rotated it -- which is the region the legacy CORE
       actually gave up. */
    bounds: TERRAIN_PREVIEW.bounds ? { ...TERRAIN_PREVIEW.bounds } : null,
    legacyBounds: TERRAIN_PREVIEW.legacyBounds ? { ...TERRAIN_PREVIEW.legacyBounds } : null,
    bridge: TERRAIN_PREVIEW.bridge ? {
      translateX: TERRAIN_PREVIEW.bridge.translateX,
      translateY: TERRAIN_PREVIEW.bridge.translateY,
      translateZ: TERRAIN_PREVIEW.bridge.translateZ,
      rotationRadians: TERRAIN_PREVIEW.bridge.rotationRadians,
      scaleX: TERRAIN_PREVIEW.bridge.scaleX,
      scaleZ: TERRAIN_PREVIEW.bridge.scaleZ,
    } : null,
    source: TERRAIN_PREVIEW.stats(),
    adapter: terrainV2.snapshot(),
    renderer: { ...terrainV2.rendererState },
    stream: v2StreamProbe,
    backend: IS_GPU ? 'webgpu' : 'webgl2',
  }),
  classifyAnalytic,
  /* the vegetation plan's Phase 0 instruments: the legacy population, and the
     object-layer state the v2 selection saw (today: no renderer, no tiles) */
  legacyTrees: ({ instances = false } = {}) => legacyTreeExport(instances),
  /* the tree tiers' live state: how many trees are drawn full, decimated, and how many cells changed */
  treeTiers: () => ({ ...TREE_LOD.stats, heroPx: TREE_LOD.heroPx, switchPx: TREE_LOD.switchPx, impostorPx: TREE_LOD.impostorPx,
    hysteresis: TREE_LOD.hysteresis, nominalHeight: TREE_LOD.nominalHeight, cell: TREE_LOD.cell, force: TREE_LOD.force,
    fadeS: TREE_LOD.fadeS, frozen: TREE_LOD.frozen, clockDriven: TREE_LOD.clockDriven, cellMode: TREE_LOD.cellMode, floors: [...TREE_LOD.floors] }),
  /* force every visible tree into one tier (1-4) at run time, 0 for the automatic choice */
  setTreeLod: n => { TREE_LOD.force = [1, 2, 3, 4].includes(n | 0) ? n | 0 : 0; },
  /* the tier boundaries in projected pixels, changeable at run time for a
     sweep; reset re-tiers every visible tree with no hysteresis */
  setTreeLodPx: (o = {}) => {
    for (const [key, prop] of [['hero', 'heroPx'], ['full', 'switchPx'], ['impostor', 'impostorPx'], ['hysteresis', 'hysteresis'], ['dwell', 'dwell']]) {
      if (Number.isFinite(o[key])) TREE_LOD[prop] = +o[key];
    }
    if (o.mode === 'zone' || o.mode === 'screen') TREE_LOD.lodMode = o.mode;
    if (o.reset) TREE_LOD.resetPending = true;
    return window.V3D.treeLodPx();
  },
  treeLodPx: () => ({ mode: TREE_LOD.lodMode, zoneTiers: [...TREE_LOD.zoneTiers], hero: TREE_LOD.heroPx, full: TREE_LOD.switchPx, impostor: TREE_LOD.impostorPx, hysteresis: TREE_LOD.hysteresis, dwell: TREE_LOD.dwell, floors: [...TREE_LOD.floors], reach: [...TREE_LOD.floorReach] }),
  /* the corridor floors (zone A, zone B) as tier numbers 1-4; 4 is no floor */
  setTreeLodPin: (a, b, reachHero, reachFull) => {
    TREE_LOD.floors = [Math.min(4, Math.max(1, a | 0 || 4)), Math.min(4, Math.max(1, b | 0 || 4))];
    if (reachHero > 0) TREE_LOD.floorReach[0] = +reachHero;
    if (reachFull > 0) TREE_LOD.floorReach[1] = +reachFull;
    TREE_LOD.resetPending = true;
    return { floors: [...TREE_LOD.floors], reach: [...TREE_LOD.floorReach] };
  },
  /* the crossfade: its length, and the harness's hold on its clock */
  setTreeFade: s => { TREE_LOD.fadeS = Math.max(0, +s || 0); },
  setTreeFadeClock: t => { TREE_LOD.fadeClock = +t || 0; },
  driveTreeFadeClock: on => { TREE_LOD.clockDriven = !!on; },
  freezeTreeTiers: on => { TREE_LOD.frozen = !!on; },
  setTreeLodCellMode: on => { TREE_LOD.cellMode = !!on; TREE_LOD.resetPending = true; },
  treeTierAudit,
  /* triangles per instance of every (species, tier, part), from the built geometries */
  treeTriangles: () => TREE_LOD.tiers.map(sp => sp ? [1, 2, 3].map(i => sp.t[i].parts.map(im =>
    (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3)) : null),
  pixelDelta: IS_GPU ? pixelDelta : null,
  /* the same count against a MARKED frame: mark before an event, read after it, and the answer is the event's whole change however it was spread over frames */
  pixelDeltaMark: IS_GPU ? () => pixelDelta(24, true) : null,
  /* the renderer's own per-frame counters, read in a rAF callback after the frame that produced them */
  rendererInfo: () => ({ ...renderer.info.render, memory: { ...renderer.info.memory },
    drawingBuffer: [renderer.domElement.width, renderer.domElement.height], pixelRatio: renderer.getPixelRatio() }),
  frameTimes: () => ({ ms: Array.from(FRAME_MS), frame: FRAME_NO, tris: renderer.info.render.triangles, draws: renderer.info.render.drawCalls }),
  setFov: f => { camera.fov = +f; camera.updateProjectionMatrix(); return camera.fov; },
  setShadowRadius: r => { shadowRadiusOverride = r > 0 ? +r : null; return shadowRadiusOverride; },
  /* the shadow map's fit and snap, for the harness: the size, the texel, and how far the box was moved to land on a texel */
  shadowFit: () => ({ R: SUN_BASIS.R, texel: +SUN_BASIS.texel.toFixed(4), snap: shadowSnap, remainderTexels: +SUN_BASIS.remainder.toFixed(3),
                      normalBias: sun.shadow.normalBias, fits: [...SHADOW_FITS], reversedDepth: renderer.reversedDepthBuffer === true }),
  setShadowSnap: on => { shadowSnap = !!on; return shadowSnap; },
  /* the harness's bisection switch: the terrain's level morph length in ms (0 pops) */
  v2WorldMorph: ms => { const batches = terrainV2.runtime?.layer?.batches; if (!batches) return null; for (const b of batches.values()) b.morphDurationMilliseconds = Math.max(0, +ms || 0); return Math.max(0, +ms || 0); },
  /* the terrain stream's last plan and residency, for a harness that watches tiles come and go: desired, rendered (fallbacks included), requested, retained, and what is ready or loading */
  v2Plan: () => { const c = terrainV2.runtime?.controller, p = c?.lastPlan; if (!c || !p) return null; const snap = c.snapshot(); return { desired: [...p.desiredTileIds], render: [...p.renderTileIds], requests: p.requests.map(r => r.tileId), retain: [...(p.retainTileIds || [])], ready: [...snap.readyTileIds], loading: [...snap.loadingTileIds] }; },
  quality: () => ({ lowfx, lowq: LOWQ, phone: phoneDevice, autoQualityDone, pixelRatio: renderer.getPixelRatio(),
                    bloom: renderer.__bloomNode ? renderer.__bloomNode.strength.value : null }),
  /* GPU milliseconds since the previous resolve, summed over every render
     pass (shadow, scene, bloom); null unless the page booted with ?gputime=1 */
  gpuTimingEnabled: () => renderer.backend?.trackTimestamp === true,
  gpuTime: GPU_TIME ? async () => { await renderer.resolveTimestampsAsync('render'); return { ms: renderer.info.render.timestamp, frame: FRAME_NO }; } : null,
  /* with ?impdbg=1: which term the impostors show (engine/tree-impostor.mjs) */
  setImpostorDebug: n => { impostorDebugMode.value = n | 0; },
  setImpostorBend: k => { impostorBend.value = +k || 0; },
  frame: () => FRAME_NO,
  /* the impostor atlases as the GPU holds them, for the harness: one
     frame of one species' albedo or normal target, decoded to floats
     (row 0 is whichever row the backend's readback puts first) */
  treeAtlas: async (s, kind = 'albedo', i = 0, j = 0) => {
    const atlas = TREE_LOD.atlases[s];
    if (!atlas) return null;
    const rt = atlas.targets[kind === 'normal' ? 1 : 0], fs = atlas.frameSize;
    const raw = await renderer.readRenderTargetPixelsAsync(rt, i * fs, j * fs, fs, fs);
    const half = h => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1;
      return e === 0 ? sg * m * 2 ** -24 : e === 31 ? (m ? NaN : sg * Infinity) : sg * (1 + m / 1024) * 2 ** (e - 15); };
    const data = raw instanceof Uint16Array ? Array.from(raw, half) : Array.from(raw);
    return { frameSize: fs, framesPerSide: atlas.framesPerSide, size: atlas.size, radius: atlas.radius,
             centreY: atlas.centreY, height: atlas.height, data };
  },
  /* the crown colour the mesh tiers multiply in, per species: what an
     impostor's crown must average to before the season and the light */
  treeTemplates: (dx = 0, dy = 0, dz = -1) => SPECIES.map(sp => {
    const c = sp.crown.getAttribute('color'); let r = 0, g = 0, b = 0;
    for (let k = 0; k < c.count; k++) { r += c.getX(k); g += c.getY(k); b += c.getZ(k); }
    /* the crown's mean FACE normal as seen from direction d, each face
       weighted by the area it shows to d -- what an atlas frame from d
       must average to */
    const pos = sp.crown.getAttribute('position'), idx = sp.crown.getIndex();
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
    let nx = 0, ny = 0, nz = 0, wsum = 0;
    for (let f = 0; f < idx.count; f += 3) {
      A.fromBufferAttribute(pos, idx.getX(f)); B.fromBufferAttribute(pos, idx.getX(f + 1)); C.fromBufferAttribute(pos, idx.getX(f + 2));
      N.subVectors(B, A).cross(C.clone().sub(A));
      const area2 = N.length(); if (!area2) continue;
      N.divideScalar(area2);
      const facing = N.x * dx + N.y * dy + N.z * dz;
      if (facing <= 0) continue;
      const w = area2 * facing;
      nx += N.x * w; ny += N.y * w; nz += N.z * w; wsum += w;
    }
    return { cc: sp.cc, tc: sp.tc, vertexColour: [r / c.count, g / c.count, b / c.count], height: sp.templateHeight,
             meanFaceNormal: [nx / wsum, ny / wsum, nz / wsum] };
  }),
  v2Objects: () => ({
    rendererActivated: true,
    gate: V2_OBJECT_LAYER_GATE,
    loaded: V2_VEGETATION ? {
      ...V2_VEGETATION.loaded.counts,
      bytes: V2_VEGETATION.loaded.bytes,
      frameFingerprint: V2_VEGETATION.loaded.frameFingerprint,
    } : null,
    planned: V2_VEG_PLAN ? V2_VEG_PLAN.stats : null,
    coverageTiles: V2_VEG_COVER ? V2_VEG_COVER.tiles : 0,
    error: V2_VEGETATION_ERROR,
    graphObjectTiles: V2_SELECTION.graph?.summary?.objectTiles ?? null,
    graphStandTiles: V2_SELECTION.graph?.summary?.standTiles ?? null,
    graphEncodedObjectBytes: V2_SELECTION.graph?.summary?.encodedObjectBytes ?? null,
    graphError: V2_SELECTION.graphError,
  }),
  plates: () => plateSites.map(p => ({ ...p })),
  course: () => ({ ...CMETA }),
  /* what the shot harness waits on: no camera tween, and the tree tiers'
     last change drawn twice -- under a software renderer the frame that
     compiles a tier's materials can outlast any fixed wait */
  settled: () => !camTween.on && FRAME_NO >= TIER_FRAME + 2 && (TREE_LOD.clockDriven || TREE_LOD.queue.length === TREE_LOD.qHead),
  /* the bansafari, measurable: simulate a hole's shot offline, or fly it live */
  flightSim: (n, step, transit) => flightSim(n, step, transit),
  flightState: () => ({ flying, tour, t: tourFlight.t, duration: tourFlight.duration, orbitT: tourFlight.orbitT,
    fov: camera.fov, transitT: tourFlight.transitT, cardPending: tourFlight.cardPending, hole }),
  fly: () => { if (flying > 0) return; initHoleFlight(HOLES[hole - 1]); showTourCard(); flying = 1e-4; },
  heightSample: (x, z) => groundHeightSampler.inspectAt(x, z),
  probeH: (x, z) => renderedGroundH(x, z),
  setView: (px, py, pz, lx, ly, lz) => { flyTo(V3(px, py, pz), V3(lx, ly, lz), 0); },
  /* world -> CSS pixel on the canvas, so a harness can read back the pixel it
     drew for a world point and compare it with what the CPU probe says */
  project: (x, y, z) => {
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3(x, y, z).project(camera);
    const el = renderer.domElement;
    return { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - v.y) / 2 * el.clientHeight,
             depth: v.z, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  },
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
  camExact: () => ({ pos: camera.position.toArray(), look: controls.target.toArray(), ground: terrainH(camera.position.x, camera.position.z) }),
  groundClamp: () => ({ lift: +groundClamp.lift.toFixed(4), ...GROUND_CLAMP }),
  /* the water shader's probe gains: {glint, chop}, each 1 by default */
  water: (o = {}) => { if (o.glint != null) uWaterGlint.value = +o.glint; if (o.chop != null) uWaterChop.value = +o.chop; return { glint: uWaterGlint.value, chop: uWaterChop.value }; },
  /* the sun's shadow map: re-rendered every frame (three's default) or frozen as it is, for the cost bisection */
  setShadowUpdate: on => { sun.shadow.autoUpdate = !!on; if (on) sun.shadow.needsUpdate = true; return sun.shadow.autoUpdate; },
  /* the on-demand shadow map: how many frames rendered it, and why the last one did */
  shadowRest: () => ({ enabled: SHADOW_REST, renders: SHADOW_REST_STATE.renders, frames: SHADOW_REST_STATE.frames, sinceRender: SHADOW_REST_STATE.sinceRender, why: SHADOW_REST_STATE.why }),
  /* what is in the scene, by kind: visible objects with geometry, grouped by type, tag and material, with their draw and triangle counts (instances counted once) */
  census: () => { const by = new Map(); scene.traverse(o => { if (!o.visible || !o.geometry) return; const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position?.count || 0) / 3; const inst = o.isInstancedMesh ? o.count : 1; const key = [o.type, o.userData?.tag || '', o.material?.type || '', o.name || '', o.parent?.name || '', o.isInstancedMesh ? 'inst' : '', Math.round(tris), o.castShadow ? 'cast' : '', o.matrixAutoUpdate ? 'auto' : ''].join('|'); const e = by.get(key) || { objects: 0, instances: 0, tris: 0 }; e.objects++; e.instances += inst; e.tris += tris * inst; by.set(key, e); }); return [...by.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.objects - a.objects); },
  fps: () => fps,
  prepareCapture,
  captureReadback: IS_GPU ? captureReadback : null,
  /* the drawing buffer as RGBA bytes, for an in-page metric that must not pay for a PNG each frame */
  captureRaw: IS_GPU ? captureRaw : null,
  startTour, endTour, kikMeasure,
  /* the GPS hole view, and where a world point lands on the screen (NDC z > 1 = behind the camera) */
  gpsFocus: (instant = true) => focusGps(instant),
  toScreen: (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z }; },
  setSky, skyState: () => skyState, eachSky: fn => skySprites.forEach(fn),
  /* the CANVAS positions, not the world ones: where a marker is actually drawn is
     what a collision check has to measure */
  skyMarks: () => ({
    ppm: MS, r: SKY_R, w: mini.width,
    holes: SKY.holes.map(m => { const p = skyXY(m); return { id: String(m.n), f: +m.f.toFixed(3), px: +p[0].toFixed(1), py: +p[1].toFixed(1) }; }),
    fac: SKY.fac.map(f => { const p = skyXY(f); return { id: f.ch, px: +p[0].toFixed(1), py: +p[1].toFixed(1) }; }) }),
};

/* Only for ?v2stream=1 on a course whose graph resolved, only after boot has
   finished so it cannot colour boot timings, and only into a detached scene.
   Activation needs shell/active-hole evidence plus a statement that the
   streaming worker decode reproduces the heights the verified pilot already
   renders — both obtainable without putting one streamed triangle in front of
   anyone. V3D is already published above, so a harness can see the debug
   surface immediately and wait for `stream` to become non-null. */
if (V2_SELECTION.graph && v2StreamProbeRequested(location.search)) {
  const { runV2StreamProbe } = await import('./engine/v2-stream-probe-run.mjs');
  v2StreamProbe = await runV2StreamProbe({
    graph: V2_SELECTION.graph,
    camera,
    backend: IS_GPU ? 'webgpu' : 'webgl2',
    mobile: LOWQ,
    baseUrl: new URL(import.meta.env.BASE_URL, location.href).href,
    activeHoleNumber: hole,
    viewportHeightPixels: Math.max(1, Math.round(innerHeight)),
    /* v2 against v2: the streamed chunks and the pilot tiles are cut on the
       same EPSG:3006 grid, so this parity comparison stays in that frame and
       never crosses the legacy bridge. Crossing it on one side only is how a
       3.5 degree rotation would read as a terrain mismatch. */
    pilotBounds: TERRAIN_PREVIEW.bounds,
    pilotHeightAt: (x, z) => {
      if (!terrainV2.active) return Number.NaN;
      const sample = TERRAIN_PREVIEW.heightAtGrid(x, z);
      return Number.isFinite(sample) ? sample : sample?.height ?? Number.NaN;
    },
  });
  console.info('v2 streaming probe:', v2StreamProbe);
}

addEventListener('pagehide', () => {
  captureReadbackTarget?.dispose();
  captureReadbackTarget = null;
}, { once: true });

BOOT_PERF.doneAtMs = +(performance.now() - bootStarted).toFixed(1);
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
      autoQualityDone = true;
      if (bad >= 6) {
        lowfx = true;
        /* not under det: a harness run on a software rasterizer is always slow,
           and it must not leave a verdict behind that changes the next visit.

           And NOT when the URL explicitly asked for hi. This verdict is
           STICKY -- it is read back as rememberedQuality on every later visit
           and forces LOWQ, which drops the canvas to devicePixelRatio 1 and
           lets the browser upscale the whole 3D frame (2.6x on a phone). A
           player who reaches for ?q=hi is overruling exactly that, so writing
           'lo' underneath them means the override cannot survive its own
           session, and nothing in the UI says why the picture is soft.
           Reported as "still blurry on both q low and q hi", and the badge in
           the screenshot read "2 m mesh" -- the tell that LOWQ won anyway. */
        if (!DET && qualityParam !== 'hi') {
          try { localStorage.setItem('banvy-quality', 'lo'); } catch {}
        }
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
