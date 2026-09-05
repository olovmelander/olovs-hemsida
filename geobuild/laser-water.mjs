/* Veckefjärden's water, read off the laser ground.

   The model's water rings are OpenStreetMap's: a surveyed lake shore drawn in
   straight runs that average 15 m and reach 48 m round the island 14th, and
   ponds traced by whoever last looked at an aerial. The 1 m Markhöjdmodell
   knows the real waterline: laser does not penetrate water, so the DTM over
   Veckefjärden is the lake's SURFACE -- a plate flat to the quantum at
   0.280 m RH 2000 (the fjärd is a regulated lake behind the 1939 lock, within
   a metre of the Gulf) -- while the shore climbs away from it at once. The
   silt shallows the page draws as pale margins are UNDER that surface and
   read as the plate too, which is right: they are water.

   This follows angsobuild/laser-water.mjs: find the flats in the raster, keep
   the ones that are the lake (within 0.2 m of the level, large, or within
   60 m of a large one across a flight-strip seam), trace the mask boundary,
   simplify it, and then -- the part Ängsö did not need -- SPLICE the laser
   shoreline into the model's own OSM lake ring: every part of the OSM ring
   that lies inside the DTM window is replaced by the laser shore, the ring
   outside the window is kept verbatim, and the two meet along the window's
   edge. The splice is a boolean on the window boundary, not a nearest-vertex
   match: the spliced region is (OSM water outside the window) ∪ (laser water
   inside it), and its boundary is the OSM runs outside, the laser shore runs
   inside, and the arcs of the window edge that exactly one of the two touches.
   Assembled by perimeter position, that is one simple polygon whatever the
   two shorelines' topology, and the tool proves it with a segment test.

   Every pond ring is measured the same way (median and p05–p95 of the DTM
   inside it), and traced where a plate exists. Where none does the file says
   so and keeps null; nothing here is guessed.

   Frames: all raster work is in the DTM's own grid (EPSG:3006, 1 m, the
   window is 2049 × 2049 m); every coordinate written is in the legacy frame
   (x east, z south) through the derived bridge dtm-lib carries. The window is
   a rectangle rotated 3.28° in that frame, so "inside the window" is tested
   in grid space, never against a legacy bbox.

       node geobuild/laser-water.mjs        -> geobuild/laser-water.json       */
import fs from 'node:fs';
import path from 'node:path';
import { loadTerrain, DATUM, inRing, bboxOf, lineD, ringD, median, quant, areaOf, meanPt } from './dtm-lib.mjs';
import { ROOT, simplifyDP, r1 } from './lib.mjs';
import { detectFlatWater } from '../apps/golf/src/engine/v2-flat-water.mjs';
import { squaredDistanceTransform } from '../packages/course-v2/distance-transform.mjs';

export const LAKE_LEVEL_RH2000 = 0.280;   /* the plate, measured: every lake cell in the window reads it */
export const LEVEL_BAND = 0.20;           /* a component this close to the level may be the lake */
export const EDGE_BAND = 0.10;            /* an un-flat cell this close to the plate, beside it, is its shore cell */
export const FLAT_TOL = 0.03;             /* neighbours closer than this are one flat surface */
export const LARGE_HECTARES = 10;
export const SEAM_METRES = 60;
export const SEAM_MIN_HECTARES = 0.1;     /* a strip seam splits the plate into big pieces; a 25 m² puddle beside the shore is not the lake */
export const NEAR_COURSE = 300;           /* m from a hole line: vertices every 2 m, DP 0.5 m; beyond: 6 m, 1.5 m */
export const NEAR = { step: 2, tol: 0.5 }, FAR = { step: 6, tol: 1.5 };
export const KEYHOLE_HECTARES = 0.05;
export const POND_PLATE = { band: 0.075, fraction: 0.60, flood: 0.10, margin: 60, openMetres: 2 };
export const REPORT_METRES = 15;

const OUT = path.join(ROOT, 'geobuild', 'laser-water.json');

export function main({ log = console.log } = {}) {
  const T = loadTerrain('veckefjarden');
  const { dem, W, H, E0, N1 } = T;
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'geobuild', 'course-model.json'), 'utf8'));
  const holeLines = model.holes.map(h => h.line);
  const nearCourse = (x, z) => holeLines.some(L => lineD(x, z, L) <= NEAR_COURSE);
  const nearestHole = (x, z) => { let best = null, bd = 1e9; for (const h of model.holes) { const d = lineD(x, z, h.line); if (d < bd) { bd = d; best = h.n; } } return { hole: best, d: bd }; };

  /* raster <-> legacy. A cell (c, r) has its centre at grid (E0 + c, N1 - r);
     loop corners sit at half-integers. */
  const rasToLegacy = (cf, rf) => T.gridToLegacy(E0 + cf, N1 - rf);
  const legToRas = (x, z) => { const [e, n] = T.legacyToGrid(x, z); return [e - E0, N1 - n]; };
  /* the clip: the interior cells 1..W-2 -- detectFlatWater never flats the rim */
  const box = { cmin: 0.5, cmax: W - 1.5, rmin: 0.5, rmax: H - 1.5 };
  const inClip = (c, r) => c >= 1 && c <= W - 2 && r >= 1 && r <= H - 2;

  /* --- 1. the flats ------------------------------------------------------------ */
  const flats = detectFlatWater({ raster: { width: W, height: H, spacing: 1, x0: 0, z0: 0, heights: dem }, knownBodies: [], flatToleranceMetres: FLAT_TOL, minimumCells: 25 });
  const inBand = flats.components.filter(c => Math.abs(c.surfaceHeight - LAKE_LEVEL_RH2000) <= LEVEL_BAND);
  const accepted = new Set(inBand.filter(c => c.hectares >= LARGE_HECTARES).map(c => c.id));
  for (let pass = 0; pass < 4; pass++) {
    const before = accepted.size;
    const dist = squaredDistanceTransform(W, H, i => accepted.has(flats.label[i]));
    for (const c of inBand) {
      if (accepted.has(c.id) || c.hectares < SEAM_MIN_HECTARES) continue;
      let near = false;
      for (let i = 0; i < dist.length && !near; i++) if (flats.label[i] === c.id && dist[i] <= SEAM_METRES * SEAM_METRES) near = true;
      if (near) accepted.add(c.id);
    }
    if (accepted.size === before) break;
  }
  const rejected = inBand.filter(c => !accepted.has(c.id)).sort((a, b) => b.cells - a.cells);
  const lakeMask = new Uint8Array(W * H);
  for (let i = 0; i < lakeMask.length; i++) if (accepted.has(flats.label[i])) lakeMask[i] = 1;
  const grown = dilateToBand(lakeMask, dem, W, H, LAKE_LEVEL_RH2000, EDGE_BAND);
  const plate = [];
  for (let i = 0; i < lakeMask.length; i++) if (lakeMask[i]) plate.push(dem[i]);
  const lakeCells = plate.length;
  log(`lake: ${accepted.size} flat component(s) accepted, ${(lakeCells / 1e4).toFixed(2)} ha of plate in the window (+${grown} shore cells within ${EDGE_BAND} m); ` +
      `${rejected.length} in-band flats rejected (largest ${rejected.length ? Math.max(...rejected.map(c => c.cells)) : 0} m²); ` +
      `plate median ${median(plate).toFixed(3)} p05 ${quant(plate, 0.05).toFixed(3)} p95 ${quant(plate, 0.95).toFixed(3)} m RH 2000`);

  /* --- 2. trace the lake ------------------------------------------------------- */
  const loops = traceMask(lakeMask, W, H, inClip);
  const { outers, holes } = classifyLoops(loops);
  log(`lake: ${loops.length} loops traced -> ${outers.length} outer, ${holes.length} island(s)`);

  /* runs of each outer: shore runs between window-edge runs, in legacy metres */
  const toLegacyLoop = loop => loop.pts.map(([c, r]) => rasToLegacy(c, r));
  const laserOuters = outers.map(loop => splitRuns(loop, box));
  const shoreRuns = [];            /* every shore run of every outer, simplified, for the splice and the report */
  for (const o of laserOuters) {
    for (const run of o.runs) {
      if (run.kind !== 'shore') continue;
      const leg = run.pts.map(([c, r]) => rasToLegacy(c, r));
      run.legacy = simplifyShore(leg, nearCourse, run.closed);
      shoreRuns.push(run);
    }
  }
  const shoreVertexCount = shoreRuns.reduce((s, r) => s + r.legacy.length, 0);
  log(`lake: ${shoreRuns.length} shore run(s), ${shoreVertexCount} vertices after simplification (raw ${shoreRuns.reduce((s, r) => s + r.pts.length, 0)})`);

  /* --- 3. the OSM lake ring, and the splice ------------------------------------ */
  const osmLake = model.water.find(w => w.isLake);
  if (!osmLake) throw new Error('the model has no isLake ring');
  const osm = osmLake.ring.map(([x, z]) => ({ leg: [x, z], ras: legToRas(x, z) }));
  const osmSign = Math.sign(shoelace(osm.map(p => p.ras)));
  if (osmSign < 0) osm.reverse();            /* positive in (col,row), like the traced outers */
  const spliceResult = splice(osm, laserOuters, box, rasToLegacy, log);
  let spliced = spliceResult.loops.length ? spliceResult.loops.reduce((a, b) => areaOf(a.pts) >= areaOf(b.pts) ? a : b) : null;
  const otherLoops = spliceResult.loops.filter(l => l !== spliced);
  if (osmSign < 0 && spliced) spliced.pts.reverse();   /* hand it back in the orientation the model had */

  /* islands: keyhole the ones worth a shoreline, report the rest */
  const islands = [];
  for (const hole of holes) {
    const leg = toLegacyLoop(hole);
    const ha = areaOf(leg) / 1e4;
    const [cx, cz] = meanPt(leg);
    let crest = -1e9;
    for (const [c, r] of hole.pts) { const h = dem[Math.round(r) * W + Math.round(c)]; if (Number.isFinite(h)) crest = Math.max(crest, h); }
    /* crest from the land cells inside the hole */
    const bb = bboxOf(hole.pts);
    for (let r = Math.ceil(bb.z0); r <= Math.floor(bb.z1); r++) for (let c = Math.ceil(bb.x0); c <= Math.floor(bb.x1); c++) if (!lakeMask[r * W + c] && inRing(c, r, hole.pts)) crest = Math.max(crest, dem[r * W + c]);
    const rec = { hectares: +ha.toFixed(3), m2: Math.round(ha * 1e4), x: Math.round(cx), z: Math.round(cz), crestRH2000: +crest.toFixed(2), crestAboveLake: +(crest - LAKE_LEVEL_RH2000).toFixed(2), ...nearestHole(cx, cz) };
    if (ha < KEYHOLE_HECTARES || !spliced) { rec.treatment = 'flooded-by-mesh'; islands.push(rec); continue; }
    const island = simplifyShore(leg, nearCourse, true);
    const k = keyhole(spliced.pts, island);
    if (!k) { rec.treatment = 'skipped'; islands.push(rec); continue; }
    spliced.pts = k.ring; rec.treatment = 'keyholed'; rec.slitMetres = +k.slit.toFixed(1); islands.push(rec);
  }
  const crossings = spliced ? selfIntersections(spliced.pts) : [];
  if (spliced) log(`splice: ${spliced.pts.length} vertices (${spliced.osmKept} OSM vertices kept outside the window, ${spliced.laserVertices} laser, ${spliced.arcs} window-edge arc(s)); self-intersections: ${crossings.length}; area ${(areaOf(spliced.pts) / 1e4).toFixed(1)} ha vs OSM ${(areaOf(osmLake.ring) / 1e4).toFixed(1)} ha`);
  for (const c of crossings.slice(0, 10)) log(`  crossing near (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) segments ${c.i}/${c.j}`);

  /* --- 4. the report: OSM shore against the laser shore --------------------- */
  const laserSegs = [];
  for (const run of shoreRuns) for (let i = 0; i + 1 < run.legacy.length; i++) laserSegs.push([run.legacy[i], run.legacy[i + 1]]);
  const isLaserWater = (x, z) => { const [c, r] = legToRas(x, z); const ci = Math.round(c), ri = Math.round(r); return inClip(ci, ri) && lakeMask[ri * W + ci] === 1; };
  const osmInWindow = osmLake.ring.map((p, i) => ({ p, i, ras: legToRas(p[0], p[1]) })).filter(v => v.ras[0] > box.cmin && v.ras[0] < box.cmax && v.ras[1] > box.rmin && v.ras[1] < box.rmax);
  for (const v of osmInWindow) { v.near = nearCourse(v.p[0], v.p[1]); v.d = distToSegs(v.p[0], v.p[1], laserSegs); v.inWater = isLaserWater(v.p[0], v.p[1]); }
  const nearV = osmInWindow.filter(v => v.near);
  const lakeStats = {
    osmVerticesInWindow: osmInWindow.length, osmVerticesNearCourse: nearV.length,
    osmToLaserNear: { median: r1(median(nearV.map(v => v.d))), p95: r1(quant(nearV.map(v => v.d), 0.95)), max: r1(Math.max(...nearV.map(v => v.d))) },
    osmToLaserAll: { median: r1(median(osmInWindow.map(v => v.d))), p95: r1(quant(osmInWindow.map(v => v.d), 0.95)), max: r1(Math.max(...osmInWindow.map(v => v.d))) },
  };
  /* the converse: laser shore vertices against the OSM ring, near the course */
  const laserV = [];
  for (const run of shoreRuns) for (const p of run.legacy) if (nearCourse(p[0], p[1])) laserV.push({ p, d: ringD(p[0], p[1], osmLake.ring), inOsm: inRing(p[0], p[1], osmLake.ring) });
  lakeStats.laserToOsmNear = { vertices: laserV.length, median: r1(median(laserV.map(v => v.d))), p95: r1(quant(laserV.map(v => v.d), 0.95)), max: r1(Math.max(...laserV.map(v => v.d))) };
  log(`lake: OSM vertices in the window ${osmInWindow.length} (${nearV.length} near the course): distance to the laser shore near the course median ${lakeStats.osmToLaserNear.median} m, p95 ${lakeStats.osmToLaserNear.p95} m, max ${lakeStats.osmToLaserNear.max} m; ` +
      `laser shore vertices near the course ${laserV.length}: to the OSM ring median ${lakeStats.laserToOsmNear.median} m, p95 ${lakeStats.laserToOsmNear.p95} m, max ${lakeStats.laserToOsmNear.max} m`);

  /* corrections: places where the two shorelines are more than REPORT_METRES apart */
  const corrections = [];
  const osmClusters = clusterRuns(osmInWindow.map(v => ({ ...v, key: v.i })), v => v.d > REPORT_METRES, osmLake.ring.length);
  for (const cl of osmClusters) {
    const worst = cl.reduce((a, b) => a.d > b.d ? a : b);
    const [cx, cz] = meanPt(cl.map(v => v.p));
    const wet = cl.filter(v => v.inWater).length;
    corrections.push({ from: 'osm', at: [r1(cx), r1(cz)], worstAt: [r1(worst.p[0]), r1(worst.p[1])], metres: r1(worst.d), vertices: cl.length, near: cl.some(v => v.near), ...nearestHole(cx, cz),
      sense: wet > cl.length / 2 ? 'OSM shore stands in laser water: the lake reaches further inland here' : 'OSM shore stands on laser land: the lake stops short of the OSM ring here' });
  }
  /* laser vertices far from OSM, grouped along each run */
  for (const run of shoreRuns) {
    const seq = run.legacy.map((p, i) => ({ p, i, d: ringD(p[0], p[1], osmLake.ring), near: nearCourse(p[0], p[1]), inOsm: inRing(p[0], p[1], osmLake.ring) }));
    for (const cl of clusterRuns(seq, v => v.d > REPORT_METRES, run.closed ? seq.length : 0)) {
      const worst = cl.reduce((a, b) => a.d > b.d ? a : b);
      const [cx, cz] = meanPt(cl.map(v => v.p));
      const inside = cl.filter(v => v.inOsm).length;
      const len = cl.reduce((s, v, k) => k ? s + Math.hypot(v.p[0] - cl[k - 1].p[0], v.p[1] - cl[k - 1].p[1]) : 0, 0);
      corrections.push({ from: 'laser', at: [r1(cx), r1(cz)], worstAt: [r1(worst.p[0]), r1(worst.p[1])], metres: r1(worst.d), runMetres: r1(len), vertices: cl.length, near: cl.some(v => v.near), ...nearestHole(cx, cz),
        sense: inside > cl.length / 2 ? 'laser shore lies inside the OSM ring: land (or reeds above the plate) where OSM drew water' : 'laser shore lies outside the OSM ring: water where OSM drew land' });
    }
  }
  corrections.sort((a, b) => (b.near - a.near) || b.metres - a.metres);
  log(`corrections (> ${REPORT_METRES} m between the shorelines): ${corrections.length}, ${corrections.filter(c => c.near).length} near the course`);
  for (const c of corrections) log(`  ${c.near ? 'NEAR' : 'far '} ${c.from.padEnd(5)} hole ${String(c.hole).padStart(2)} (${c.d.toFixed(0)} m off its line) at (${c.at[0]}, ${c.at[1]}): ${c.metres} m${c.runMetres ? ` over ${c.runMetres} m of shore` : ` at ${c.vertices} OSM vertex/vertices`} -- ${c.sense}`);

  /* --- 5. the ponds ----------------------------------------------------------- */
  const ponds = [];
  for (const w of model.water) {
    if (w.isLake) continue;
    const rec = measurePond(w, { T, dem, W, H, flats, legToRas, rasToLegacy, inClip, nearCourse, log });
    ponds.push(rec);
  }

  /* --- 6. write ---------------------------------------------------------------- */
  const cornersLeg = [[box.cmin, box.rmin], [box.cmax, box.rmin], [box.cmax, box.rmax], [box.cmin, box.rmax]].map(([c, r]) => rasToLegacy(c, r).map(r1));
  const wb = bboxOf(cornersLeg);
  const out = {
    source: 'Lantmäteriet Markhöjdmodell 1 m (RH 2000), the 64 published level-0 tiles of the veckefjarden v2 ground, sampled through the derived legacy bridge (geobuild/dtm-lib.mjs); the model\'s OSM rings from geobuild/course-model.json',
    method: `flat cells (4-neighbours within ${FLAT_TOL} m) labelled; the lake = components within ${LEVEL_BAND} m of ${LAKE_LEVEL_RH2000} m RH 2000 that are >= ${LARGE_HECTARES} ha or within ${SEAM_METRES} m of one; one shore cell within ${EDGE_BAND} m of the plate added at the edge; the mask boundary traced, smoothed once (3-tap), Douglas-Peucker ${NEAR.tol} m within ${NEAR_COURSE} m of a hole line / ${FAR.tol} m beyond, densified to ${NEAR.step} m / ${FAR.step} m. The spliced ring is the boolean (OSM water outside the DTM window) ∪ (laser water inside it), assembled along the window edge by perimeter position. Ponds: DTM inside the OSM ring, median and p05-p95; a plate exists when >= ${POND_PLATE.fraction * 100}% of the interior lies within ±${POND_PLATE.band} m of the median, and is then flooded from the interior through cells within ${POND_PLATE.flood} m of it and traced.`,
    datum: { legacyMinusRH2000: DATUM, note: 'levelLegacy = levelRH2000 + DATUM; the model\'s lakeLevel 21.59 is AWS Terrarium on an unknown datum' },
    lake: {
      id: osmLake.id, name: osmLake.name,
      levelRH2000: LAKE_LEVEL_RH2000, levelLegacy: +(LAKE_LEVEL_RH2000 + DATUM).toFixed(3),
      window: { x0: r1(wb.x0), z0: r1(wb.z0), x1: r1(wb.x1), z1: r1(wb.z1), quad: cornersLeg, grid: { E0: E0 + 1, E1: E0 + W - 2, N0: N1 - H + 2, N1: N1 - 1, epsg: 3006 }, note: 'the DTM window is a rectangle rotated 3.28° in the legacy frame; quad is its outline, x0..z1 its bbox' },
      ringsLaser: laserOuters.map((o, k) => ({
        touchesWindow: o.runs.some(r => r.kind === 'window'),
        hectares: +(areaOf(toLegacyLoop(o.loop)) / 1e4).toFixed(2),
        runs: o.runs.filter(r => r.kind === 'shore').map(r => ({ closed: !!r.closed, ring: r.legacy.map(p => p.map(r1)) })),
      })),
      spliced: spliced ? spliced.pts.map(p => p.map(r1)) : null,
      splicedOther: otherLoops.map(l => ({ hectares: +(areaOf(l.pts) / 1e4).toFixed(2), ring: l.pts.map(p => p.map(r1)) })),
      islands,
      stats: {
        plateCells: lakeCells, plateHectaresInWindow: +(lakeCells / 1e4).toFixed(2),
        plateMedianRH2000: +median(plate).toFixed(3), plateP05: +quant(plate, 0.05).toFixed(3), plateP95: +quant(plate, 0.95).toFixed(3),
        flatComponentsAccepted: accepted.size, inBandRejected: rejected.map(c => ({ m2: c.cells, h: +c.surfaceHeight.toFixed(3) })),
        shoreRuns: shoreRuns.length, shoreVertices: shoreVertexCount,
        splicedVertices: spliced ? spliced.pts.length : 0, osmVerticesKept: spliced ? spliced.osmKept : 0, osmVerticesReplaced: osmInWindow.length,
        selfIntersections: crossings.length,
        splicedHectares: spliced ? +(areaOf(spliced.pts) / 1e4).toFixed(2) : null, osmHectares: +(areaOf(osmLake.ring) / 1e4).toFixed(2),
        ...lakeStats,
        corrections,
      },
    },
    ponds,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)`);
  return out;
}

/* --- pond measurement ------------------------------------------------------------- */
function measurePond(w, { T, dem, W, H, flats, legToRas, rasToLegacy, inClip, nearCourse, log }) {
  const rec = { id: w.id, name: w.name || null, levelOsmLegacy: w.level, osmM2: Math.round(areaOf(w.ring)), levelRH2000: null, levelLegacy: null, plateFound: false, ringLaser: null, ringOsm: w.ring, spreadInside: null, note: '' };
  const bb = bboxOf(w.ring);
  const inside = [];        /* interior cells, raster coords */
  let cellsInWindow = 0, cellsTotal = 0;
  for (let z = Math.floor(bb.z0); z <= Math.ceil(bb.z1); z++) for (let x = Math.floor(bb.x0); x <= Math.ceil(bb.x1); x++) {
    if (!inRing(x, z, w.ring)) continue;
    cellsTotal++;
    const [c, r] = legToRas(x, z); const ci = Math.round(c), ri = Math.round(r);
    if (!inClip(ci, ri)) continue;
    cellsInWindow++;
    inside.push({ ci, ri, h: dem[ri * W + ci], edge: ringD(x, z, w.ring) <= 1.5 });
  }
  if (!cellsInWindow) { rec.note = 'outside the DTM window: not measured'; log(`pond ${w.id}: outside the DTM window`); return rec; }
  const core = inside.filter(s => !s.edge).map(s => s.h);
  const hs = core.length >= 20 ? core : inside.map(s => s.h);
  const med = median(hs), p05 = quant(hs, 0.05), p95 = quant(hs, 0.95);
  const within = hs.filter(h => Math.abs(h - med) <= POND_PLATE.band).length / hs.length;
  rec.levelRH2000 = +med.toFixed(3); rec.levelLegacy = +(med + DATUM).toFixed(3);
  rec.spreadInside = { p05: +p05.toFixed(3), p50: +med.toFixed(3), p95: +p95.toFixed(3), spread: +(p95 - p05).toFixed(3), fractionWithinBand: +within.toFixed(3), cells: hs.length, cellsInWindow, cellsTotal };
  const partial = cellsInWindow < cellsTotal;
  const near = nearCourse(...meanPt(w.ring));
  if (within < POND_PLATE.fraction) {
    rec.note = `no laser plate: only ${(within * 100).toFixed(0)}% of the interior lies within ±${POND_PLATE.band} m of the median (p05-p95 spread ${(p95 - p05).toFixed(2)} m)${partial ? '; ring partly outside the DTM window' : ''} -- a marsh, a dry hollow, or water under canopy the laser reads as ground`;
    log(`pond ${w.id}: ${rec.note}`);
    return rec;
  }
  rec.plateFound = true;
  if (partial) {
    rec.note = `laser plate at ${med.toFixed(2)} m RH 2000 (${(med + DATUM).toFixed(2)} legacy; OSM level ${w.level}) over ${cellsInWindow} of ${cellsTotal} interior cells, but the ring runs outside the DTM window: level measured, outline not traced`;
    log(`pond ${w.id}: ${rec.note}`);
    return rec;
  }
  /* flood the plate from the interior through cells near its level, within the OSM bbox + margin */
  const [c0, r0] = legToRas(bb.x0, bb.z0), [c1, r1b] = legToRas(bb.x1, bb.z1), [c2, r2] = legToRas(bb.x0, bb.z1), [c3, r3] = legToRas(bb.x1, bb.z0);
  const cmin = Math.max(1, Math.floor(Math.min(c0, c1, c2, c3) - POND_PLATE.margin)), cmax = Math.min(W - 2, Math.ceil(Math.max(c0, c1, c2, c3) + POND_PLATE.margin));
  const rmin = Math.max(1, Math.floor(Math.min(r0, r1b, r2, r3) - POND_PLATE.margin)), rmax = Math.min(H - 2, Math.ceil(Math.max(r0, r1b, r2, r3) + POND_PLATE.margin));
  const mask = new Uint8Array(W * H);
  const st = [];
  for (const s of inside) if (Math.abs(s.h - med) <= POND_PLATE.band && !mask[s.ri * W + s.ci]) { mask[s.ri * W + s.ci] = 1; st.push(s.ri * W + s.ci); }
  let n = 0, hitMargin = false;
  while (st.length) {
    const i = st.pop(); n++;
    const c = i % W, r = (i - c) / W;
    if (c === cmin || c === cmax || r === rmin || r === rmax) hitMargin = true;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (cc < cmin || cc > cmax || rr < rmin || rr > rmax) continue;
      const j = rr * W + cc;
      if (mask[j] || Math.abs(dem[j] - med) > POND_PLATE.flood) continue;
      mask[j] = 1; st.push(j);
    }
  }
  /* a pond's plate continues up any ditch that feeds it at the same level; an
     opening of POND_PLATE.openMetres drops what is narrower than twice that,
     and the plate is then the opened cells reachable from the ring's interior */
  const opened = openMask(mask, W, H, POND_PLATE.openMetres, { cmin, cmax, rmin, rmax });
  const plateMask = new Uint8Array(W * H);
  const st2 = [];
  for (const s of inside) { const i = s.ri * W + s.ci; if (opened[i] && !plateMask[i]) { plateMask[i] = 1; st2.push(i); } }
  let nPlate = 0;
  while (st2.length) {
    const i = st2.pop(); nPlate++;
    for (const j of [i - 1, i + 1, i - W, i + W]) { if (opened[j] && !plateMask[j]) { plateMask[j] = 1; st2.push(j); } }
  }
  const trimmed = n - nPlate;
  const loops = traceMask(plateMask, W, H, (c, r) => c >= cmin && c <= cmax && r >= rmin && r <= rmax);
  const { outers, holes } = classifyLoops(loops);
  if (!outers.length) { rec.plateFound = false; rec.note = 'plate flood produced no loop'; return rec; }
  /* every plate loop the OSM interior reaches -- a dumbbell pond whose neck the
     opening cuts comes out as two rings at one level, and both are kept */
  const rings = outers.map(o => { const leg = o.pts.map(([c, r]) => rasToLegacy(c, r)); return simplifyShore(leg, () => near, true).map(p => p.map(r1)); })
    .map(ring => ({ ring, m2: Math.round(areaOf(ring)) })).filter(x => x.m2 >= 20).sort((a, b) => b.m2 - a.m2);
  const ring = rings[0].ring;
  rec.ringLaser = ring;
  rec.ringsLaser = rings;
  rec.laserM2 = rings.reduce((s, x) => s + x.m2, 0);
  rec.laserIslands = holes.map(h => { const l = h.pts.map(([c, r]) => rasToLegacy(c, r)); return { m2: Math.round(areaOf(l)), at: meanPt(l).map(r1) }; });
  const dOsm = w.ring.map(p => Math.min(...rings.map(x => ringD(p[0], p[1], x.ring))));
  const dLaser = rings.flatMap(x => x.ring).map(p => ringD(p[0], p[1], w.ring));
  rec.osmToLaser = { median: r1(median(dOsm)), p95: r1(quant(dOsm, 0.95)), max: r1(Math.max(...dOsm)) };
  rec.laserToOsm = { median: r1(median(dLaser)), p95: r1(quant(dLaser, 0.95)), max: r1(Math.max(...dLaser)) };
  rec.centreShift = r1(Math.hypot(...meanPt(ring).map((v, k) => v - meanPt(w.ring)[k])));
  rec.near = near;
  rec.note = `laser plate at ${med.toFixed(2)} m RH 2000 (${(med + DATUM).toFixed(2)} legacy; OSM level ${w.level}), ${nPlate} m² plate vs ${rec.osmM2} m² OSM${trimmed ? ` (${trimmed} m² of level channels narrower than ${2 * POND_PLATE.openMetres} m dropped by the opening${hitMargin ? ', the flood having reached the search margin along one' : ''})` : ''}${partial ? '; ring partly outside the DTM window' : ''}${rings.length > 1 ? `; ${rings.length} plate loops (${rings.map(x => x.m2 + ' m²').join(', ')}), ringLaser is the largest and ringsLaser carries all` : ''}`;
  log(`pond ${w.id}: ${rec.note}; OSM->laser median ${rec.osmToLaser.median} m p95 ${rec.osmToLaser.p95} m max ${rec.osmToLaser.max} m; laser->OSM max ${rec.laserToOsm.max} m; ${ring.length} vertices`);
  return rec;
}

/* --- raster helpers ----------------------------------------------------------------- */
/** Add to the mask every non-mask cell 4-adjacent to it whose height is within `band` of the level. */
function dilateToBand(mask, dem, W, H, level, band) {
  const add = [];
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    const i = r * W + c;
    if (mask[i] || Math.abs(dem[i] - level) > band) continue;
    if (mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W]) add.push(i);
  }
  for (const i of add) mask[i] = 1;
  return add.length;
}

/** Morphological opening (erode then dilate by `r` cells, Euclidean) of a mask within a cell box. */
function openMask(mask, W, H, r, { cmin, cmax, rmin, rmax }) {
  const toLand = squaredDistanceTransform(W, H, i => mask[i] === 0);
  const eroded = new Uint8Array(W * H);
  for (let rr = rmin; rr <= rmax; rr++) for (let c = cmin; c <= cmax; c++) { const i = rr * W + c; if (mask[i] && toLand[i] > r * r) eroded[i] = 1; }
  const toCore = squaredDistanceTransform(W, H, i => eroded[i] === 1);
  const out = new Uint8Array(W * H);
  for (let rr = rmin; rr <= rmax; rr++) for (let c = cmin; c <= cmax; c++) { const i = rr * W + c; if (mask[i] && toCore[i] <= r * r) out[i] = 1; }
  return out;
}

/** Trace the boundary of mask cells inside the clip into directed loops of corner
    vertices at half-integers, water on the right of travel (positive shoelace
    in (col, row) for outers). Each loop carries an edge type per vertex: the
    edge LEAVING vertex i is 'shore' (the neighbour is land inside the clip) or
    'window' (the neighbour is outside the clip). At a checkerboard corner the
    right turn is taken so a loop hugs its own cell instead of merging. */
export function traceMask(mask, W, H, inClip) {
  const inside = (c, r) => inClip(c, r) && mask[r * W + c] === 1;
  const key = (c, r) => r * (W + 1) + c;      /* corner (c - 0.5, r - 0.5) */
  const out = new Map();                        /* corner -> [{to, dir, type}] */
  const push = (k, e) => { const a = out.get(k); if (a) a.push(e); else out.set(k, [e]); };
  const E = 0, S = 1, Wd = 2, N = 3;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!inside(c, r)) continue;
    const t = (cc, rr) => inClip(cc, rr) ? 'shore' : 'window';
    if (!inside(c, r - 1)) push(key(c, r), { to: key(c + 1, r), dir: E, type: t(c, r - 1) });
    if (!inside(c + 1, r)) push(key(c + 1, r), { to: key(c + 1, r + 1), dir: S, type: t(c + 1, r) });
    if (!inside(c, r + 1)) push(key(c + 1, r + 1), { to: key(c, r + 1), dir: Wd, type: t(c, r + 1) });
    if (!inside(c - 1, r)) push(key(c, r + 1), { to: key(c, r), dir: N, type: t(c - 1, r) });
  }
  const loops = [];
  for (const [start, edges] of out) {
    for (const first of edges) {
      if (first.used) continue;
      const pts = [], types = [];
      let k = start, e = first;
      while (e && !e.used) {
        e.used = true;
        const c = k % (W + 1), r = (k - c) / (W + 1);
        pts.push([c - 0.5, r - 0.5]); types.push(e.type);
        k = e.to;
        const cand = out.get(k);
        if (!cand) { e = null; break; }
        const want = (e.dir + 1) % 4;
        e = cand.find(x => !x.used && x.dir === want) || cand.find(x => !x.used) || null;
      }
      if (pts.length >= 4) loops.push({ pts, types });
    }
  }
  return loops;
}

/** Outers and holes by containment depth (orientation-free), cross-checked against the sign. */
export function classifyLoops(loops) {
  const sorted = [...loops].sort((a, b) => Math.abs(shoelace(b.pts)) - Math.abs(shoelace(a.pts)));
  const probe = loop => { /* a point strictly inside the loop: the cell centre on its interior side of the first edge */
    const [c, r] = loop.pts[0], [c2, r2] = loop.pts[1];
    const dc = c2 - c, dr = r2 - r;                /* interior is to the right for positive loops: (−dr, dc)... choose by sign */
    const s = Math.sign(shoelace(loop.pts));
    return [c + dc / 2 + s * (-dr) * 0.5, r + dr / 2 + s * dc * 0.5];
  };
  const depth = sorted.map((loop, i) => { const p = probe(loop); let d = 0; for (let j = 0; j < i; j++) if (inRing(p[0], p[1], sorted[j].pts)) d++; return d; });
  const outers = [], holes = [];
  sorted.forEach((loop, i) => {
    const hole = depth[i] % 2 === 1;
    const sign = Math.sign(shoelace(loop.pts));
    if ((sign < 0) !== hole) throw new Error(`loop ${i}: containment says ${hole ? 'hole' : 'outer'}, orientation says ${sign < 0 ? 'hole' : 'outer'}`);
    (hole ? holes : outers).push(loop);
  });
  return { outers, holes };
}

/** Split an outer loop into alternating shore / window runs (each run's endpoints on the box). */
function splitRuns(loop, box) {
  const n = loop.pts.length;
  if (!loop.types.includes('window')) return { loop, runs: [{ kind: 'shore', closed: true, pts: loop.pts.slice() }] };
  /* rotate so the loop starts at the first shore edge after a window edge */
  let s = 0; while (!(loop.types[(s - 1 + n) % n] === 'window' && loop.types[s] === 'shore')) s = (s + 1) % n;
  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (s + k) % n;
    const type = loop.types[i], p = loop.pts[i];
    if (!cur || cur.kind !== type) { if (cur) cur.pts.push(p); cur = { kind: type, pts: [p] }; runs.push(cur); }
    else cur.pts.push(p);
  }
  cur.pts.push(loop.pts[s]);
  for (const r of runs) { r.t0 = perimeterT(r.pts[0], box); r.t1 = perimeterT(r.pts[r.pts.length - 1], box); }
  return { loop, runs };
}

/** Perimeter position of a point on the box, in the positive (col+, row+, col-, row-) sense. */
export function perimeterT([c, r], box) {
  const { cmin, cmax, rmin, rmax } = box, wdt = cmax - cmin, hgt = rmax - rmin;
  const eps = 1e-6;
  if (Math.abs(r - rmin) < eps) return c - cmin;
  if (Math.abs(c - cmax) < eps) return wdt + (r - rmin);
  if (Math.abs(r - rmax) < eps) return wdt + hgt + (cmax - c);
  if (Math.abs(c - cmin) < eps) return 2 * wdt + hgt + (rmax - r);
  return NaN;
}
function pointAtT(t, box) {
  const { cmin, cmax, rmin, rmax } = box, wdt = cmax - cmin, hgt = rmax - rmin, P = 2 * (wdt + hgt);
  t = ((t % P) + P) % P;
  if (t <= wdt) return [cmin + t, rmin];
  if (t <= wdt + hgt) return [cmax, rmin + (t - wdt)];
  if (t <= 2 * wdt + hgt) return [cmax - (t - wdt - hgt), rmax];
  return [cmin, rmax - (t - 2 * wdt - hgt)];
}
/** The box corners strictly between t0 and t1 going in the +t sense. */
function cornersBetween(t0, t1, box) {
  const { cmin, cmax, rmin, rmax } = box, wdt = cmax - cmin, hgt = rmax - rmin, P = 2 * (wdt + hgt);
  const cs = [0, wdt, wdt + hgt, 2 * wdt + hgt];
  const span = ((t1 - t0) % P + P) % P;
  const res = [];
  for (const ct of cs) { const d = ((ct - t0) % P + P) % P; if (d > 1e-9 && d < span - 1e-9) res.push({ d, p: pointAtT(ct, box) }); }
  return res.sort((a, b) => a.d - b.d).map(x => x.p);
}

/* --- the splice --------------------------------------------------------------------- */
function splice(osm, laserOuters, box, rasToLegacy, log) {
  const n = osm.length;
  const { cmin, cmax, rmin, rmax } = box, wdt = cmax - cmin, hgt = rmax - rmin, P = 2 * (wdt + hgt);
  const insideBox = ([c, r]) => c > cmin && c < cmax && r > rmin && r < rmax;
  /* OSM outside runs with their crossings */
  const osmRuns = [];
  const k0 = osm.findIndex(v => !insideBox(v.ras));
  if (k0 < 0) { log('splice: the whole OSM ring lies inside the window; the laser shore replaces it entirely'); }
  let cur = k0 >= 0 ? { start: null, t0: NaN, pts: [osm[k0].leg] } : null;
  let first = cur;
  let state = k0 >= 0;   /* outside */
  for (let i = 0; i < n && k0 >= 0; i++) {
    const a = osm[(k0 + i) % n], b = osm[(k0 + i + 1) % n];
    for (const x of segmentBoxCrossings(a.ras, b.ras, box)) {
      const t = perimeterT(x.p, box);
      const leg = rasToLegacy(x.p[0], x.p[1]);
      if (state) { cur.end = leg; cur.t1 = t; osmRuns.push(cur); cur = null; state = false; }
      else { cur = { start: leg, t0: t, pts: [] }; state = true; }
    }
    if (state) cur.pts.push(b.leg);
  }
  if (cur && first && cur !== first) {   /* merge the wrap-around run into the first */
    first.start = cur.start; first.t0 = cur.t0; first.pts = [...cur.pts.slice(0, -1), ...first.pts];
  } else if (cur === first && first) { /* never crossed: entirely outside */
    log('splice: the OSM ring never enters the window'); return { loops: [{ pts: osm.map(v => v.leg), osmKept: n, laserVertices: 0, arcs: 0 }] };
  }
  const osmRasRing = osm.map(v => v.ras);
  /* boundary intervals */
  const breaks = new Set();
  for (const r of osmRuns) { breaks.add(r.t0); breaks.add(r.t1); }
  const laserIntervals = [];
  const laserRuns = [];
  for (const o of laserOuters) for (const run of o.runs) {
    if (run.kind === 'window') {
      if (run.t1 >= run.t0) laserIntervals.push([run.t0, run.t1]); else { laserIntervals.push([run.t0, P]); laserIntervals.push([0, run.t1]); }
      breaks.add(run.t0); breaks.add(run.t1);
    } else if (!run.closed) laserRuns.push(run);
  }
  const tb = [...breaks].sort((a, b) => a - b);
  const inLaser = t => laserIntervals.some(([a, b]) => t > a && t < b);
  const arcs = [];
  for (let i = 0; i < tb.length; i++) {
    const t0 = tb[i], t1 = i + 1 < tb.length ? tb[i + 1] : tb[0] + P;
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const pm = pointAtT(tm, box);
    const osmIn = inRing(pm[0], pm[1], osmRasRing);
    const lasIn = inLaser(((tm % P) + P) % P);
    if (osmIn === lasIn) continue;
    const a = pointAtT(t0, box), b = pointAtT(t1, box);
    const mids = cornersBetween(t0, t1 % P, box);
    const pts = [a, ...mids, b].map(p => rasToLegacy(p[0], p[1]));
    const T0 = ((t0 % P) + P) % P, T1 = ((t1 % P) + P) % P;
    if (lasIn) arcs.push({ kind: 'arc', owner: 'laser', t0: T0, t1: T1, pts });
    else arcs.push({ kind: 'arc', owner: 'osm', t0: T1, t1: T0, pts: pts.slice().reverse() });
  }
  /* assemble */
  const edges = [
    ...osmRuns.map(r => ({ kind: 'osm', t0: r.t0, t1: r.t1, pts: [r.start, ...r.pts, r.end], osmCount: r.pts.length })),
    ...laserRuns.map(r => ({ kind: 'laser', t0: r.t0, t1: r.t1, pts: r.legacy })),
    ...arcs,
  ];
  const keyT = t => Math.round((((t % P) + P) % P) * 1e4);
  const byStart = new Map();
  for (const e of edges) { const k = keyT(e.t0); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(e); }
  const loops = [];
  let unmatched = 0;
  for (const e0 of edges) {
    if (e0.used) continue;
    const loop = { pts: [], osmKept: 0, laserVertices: 0, arcs: 0 };
    let e = e0;
    while (e && !e.used) {
      e.used = true;
      if (e.kind === 'osm') loop.osmKept += e.osmCount; else if (e.kind === 'laser') loop.laserVertices += e.pts.length; else loop.arcs++;
      /* append, dropping a repeated joint */
      for (const p of e.pts) { const q = loop.pts[loop.pts.length - 1]; if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6) continue; loop.pts.push(p); }
      const cands = (byStart.get(keyT(e.t1)) || []).filter(x => !x.used);
      if (!cands.length) {
        /* tolerant fallback: nearest unused start along the perimeter */
        let best = null, bd = 1e9;
        for (const x of edges) if (!x.used) { const d = Math.min(Math.abs(x.t0 - e.t1), P - Math.abs(x.t0 - e.t1)); if (d < bd) { bd = d; best = x; } }
        if (best && bd < 0.01) { e = best; continue; }
        if (keyT(e.t1) !== keyT(e0.t0)) unmatched++;
        e = null;
      } else e = cands[0];
    }
    const q = loop.pts[0], p = loop.pts[loop.pts.length - 1];
    if (q && p && Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6) loop.pts.pop();
    if (loop.pts.length >= 3) loops.push(loop);
  }
  log(`splice: ${osmRuns.length} OSM run(s) outside the window, ${laserRuns.length} laser shore run(s), ${arcs.length} window-edge arc(s) (${arcs.filter(a => a.owner === 'laser').length} laser-owned, ${arcs.filter(a => a.owner === 'osm').length} OSM-owned) -> ${loops.length} loop(s)${unmatched ? `, ${unmatched} UNMATCHED joints` : ''}`);
  for (const a of arcs) { const L = a.pts.reduce((s, p, k) => k ? s + Math.hypot(p[0] - a.pts[k - 1][0], p[1] - a.pts[k - 1][1]) : 0, 0); log(`  arc ${a.owner.padEnd(5)} ${L.toFixed(1)} m at (${a.pts[0].map(v => v.toFixed(0)).join(', ')})`); }
  return { loops, osmRuns, arcs };
}

/** Parametric crossings of segment a->b with the box, in order along the segment (strictly interior parameters). */
function segmentBoxCrossings(a, b, box) {
  const { cmin, cmax, rmin, rmax } = box;
  const dc = b[0] - a[0], dr = b[1] - a[1];
  const res = [];
  const tryS = (s, p, ok) => { if (s > 1e-12 && s < 1 - 1e-12 && ok) res.push({ s, p }); };
  if (dr !== 0) {
    for (const rr of [rmin, rmax]) { const s = (rr - a[1]) / dr; const c = a[0] + s * dc; tryS(s, [c, rr], c >= cmin && c <= cmax); }
  }
  if (dc !== 0) {
    for (const cc of [cmin, cmax]) { const s = (cc - a[0]) / dc; const r = a[1] + s * dr; tryS(s, [cc, r], r >= rmin && r <= rmax); }
  }
  res.sort((p, q) => p.s - q.s);
  /* a crossing exactly at a corner appears twice */
  return res.filter((x, i) => !i || Math.abs(x.s - res[i - 1].s) > 1e-12);
}

/* --- simplification ------------------------------------------------------------------ */
/** One 3-tap smoothing pass (endpoints of an open run fixed), then Douglas-Peucker
    with the near/far tolerance, then densify to the near/far spacing. */
export function simplifyShore(pts, isNear, closed) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const sm = pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return p;
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
  });
  const seq = closed ? [...sm, sm[0]] : sm;
  const near = seq.map(p => isNear(p[0], p[1]));
  /* split where near/far changes; DP each piece with its own tolerance */
  const out = [];
  let s = 0;
  for (let i = 1; i <= seq.length; i++) {
    if (i === seq.length || near[i] !== near[s]) {
      const piece = seq.slice(s, Math.min(i + 1, seq.length));   /* share the joint vertex */
      const simp = simplifyDP(piece, near[s] ? NEAR.tol : FAR.tol);
      for (let k = 0; k < simp.length; k++) { if (out.length && k === 0) continue; out.push(simp[k]); }
      s = i;
    }
  }
  /* densify */
  const dense = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i]; dense.push(p);
    if (i === out.length - 1) break;
    const q = out[i + 1];
    const step = (isNear(p[0], p[1]) || isNear(q[0], q[1])) ? NEAR.step : FAR.step;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const k = Math.ceil(L / step);
    for (let j = 1; j < k; j++) dense.push([p[0] + (q[0] - p[0]) * j / k, p[1] + (q[1] - p[1]) * j / k]);
  }
  if (closed) dense.pop();
  return dense;
}

/* --- geometry --------------------------------------------------------------------- */
export function shoelace(ring) { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function distToSegs(x, z, segs) { let d = 1e9; for (const [A, B] of segs) { const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz; let t = l2 ? ((x - A[0]) * dx + (z - A[1]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const e = Math.hypot(x - A[0] - dx * t, z - A[1] - dz * t); if (e < d) d = e; } return d; }

/** Runs of consecutive items (cyclic when `period` > 0 and items carry `key`) satisfying `pred`. */
function clusterRuns(items, pred, period) {
  const cl = []; let cur = null;
  for (let i = 0; i < items.length; i++) {
    const v = items[i];
    const consecutive = cur && (v.key !== undefined ? (v.key - items[i - 1].key === 1) : true);
    if (pred(v)) { if (cur && consecutive) cur.push(v); else { cur = [v]; cl.push(cur); } }
    else cur = null;
  }
  /* cyclic join of the last and first clusters */
  if (period && cl.length > 1) {
    const a = cl[0], b = cl[cl.length - 1];
    const ka = a[0].key ?? a[0].i, kb = b[b.length - 1].key ?? b[b.length - 1].i;
    if ((kb + 1) % period === ka) { cl[0] = [...b, ...a]; cl.pop(); }
  }
  return cl;
}

/** Slit an island into the ring at the nearest vertex pair. */
function keyhole(ring, island) {
  let best = null;
  for (let i = 0; i < ring.length; i++) for (let j = 0; j < island.length; j++) {
    const d = Math.hypot(ring[i][0] - island[j][0], ring[i][1] - island[j][1]);
    if (!best || d < best.d) best = { d, i, j };
  }
  if (!best) return null;
  /* the island must run opposite to the outer for the slit polygon to stay simple */
  const isl = Math.sign(shoelace(island)) === Math.sign(shoelace(ring)) ? island.slice().reverse() : island.slice();
  const j = isl.findIndex(p => p === island[best.j]);
  const rotated = [...isl.slice(j), ...isl.slice(0, j)];
  return { ring: [...ring.slice(0, best.i + 1), ...rotated, isl[j], ...ring.slice(best.i)], slit: best.d };
}

/** Every pair of non-adjacent segments that properly intersect, by a bucket grid. */
export function selfIntersections(ring) {
  const n = ring.length;
  const cell = 25;
  const buckets = new Map();
  const bb = bboxOf(ring);
  const kOf = (x, z) => Math.floor((x - bb.x0) / cell) + ':' + Math.floor((z - bb.z0) / cell);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    segs.push([a, b]);
    const x0 = Math.floor((Math.min(a[0], b[0]) - bb.x0) / cell), x1 = Math.floor((Math.max(a[0], b[0]) - bb.x0) / cell);
    const z0 = Math.floor((Math.min(a[1], b[1]) - bb.z0) / cell), z1 = Math.floor((Math.max(a[1], b[1]) - bb.z0) / cell);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k = gx + ':' + gz; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
  }
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hits = new Map();
  for (const list of buckets.values()) {
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const i = list[u], j = list[v];
      if (i === j || (i + 1) % n === j || (j + 1) % n === i) continue;
      const [a, b] = segs[i], [c, d] = segs[j];
      const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) {
        const key = Math.min(i, j) + '/' + Math.max(i, j);
        if (!hits.has(key)) hits.set(key, { i: Math.min(i, j), j: Math.max(i, j), x: (a[0] + b[0] + c[0] + d[0]) / 4, z: (a[1] + b[1] + c[1] + d[1]) / 4 });
      }
    }
  }
  return [...hits.values()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
