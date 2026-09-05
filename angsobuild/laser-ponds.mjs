/* Every pond on the course, re-traced off the laser plate.

   The Mälaren work established the rule for a big lake (laser-water.mjs): a
   water body returns no laser, so Markhöjdmodell over it is its SURFACE, flat
   to a few centimetres, and the shore climbs away at once. The same is true
   of a golf pond, and it matters just as much -- the model's pond rings come
   from OSM or from a satellite trace, both drawn on a boundary an eye picked,
   and angsobuild/terrain-check.mjs measured them sitting up to several metres
   off their own laser plate with banks of 0.4 to 1.0 m.

   For each pond of the model: take its measured surface (the median of the
   laser inside its ring), grow the connected flat at that level from the
   ring's interior at 1 m, and trace the component's boundary. A pond that
   does not read as a plate -- reeds, an overhanging crown, a ring that is
   mostly bank -- is REFUSED and keeps its traced ring, with the reason.

     node angsobuild/laser-ponds.mjs   -> angsobuild/laser-ponds.json         */
import path from 'node:path';
import { readJSON, writeJSON, simplifyDP } from './lib.mjs';
import { loadTerrain } from './dtm.mjs';
import { inRing, bboxOf, median, quant, areaOf } from '../geobuild/dtm-lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const m = readJSON(path.join(HERE, 'course-model.json'));
const T = loadTerrain();
const { hAt } = T;
console.log(`terrain: ${T.tiles} tiles at 1 m`);

const STEP = 1;                         /* the DTM's own resolution */
const FLAT = 0.12;                      /* a plate is flat to this, per pond */
const ponds = [], out = [];
for (const w of m.water) {
  if (w.isLake) continue;               /* Mälaren has its own tracer */
  const b = bboxOf(w.ring);
  const inside = [];
  for (let z = b.z0; z <= b.z1; z += STEP) for (let x = b.x0; x <= b.x1; x += STEP) { if (!inRing(x, z, w.ring)) continue; const h = hAt(x, z); if (Number.isFinite(h)) inside.push(h); }
  /* A ring only partly inside the published window would come back TRUNCATED,
     and a truncated shoreline is worse than a hand-drawn one: the OSM ring
     w1508749365 holds 49,279 interior cells and the laser answers for 15,761
     of them, so two thirds of that water lies outside the 4,096 m ground. */
  const cells = Math.round(areaOf(w.ring));
  if (inside.length < 12 || inside.length < 0.95 * cells) { out.push({ id: w.id, verdict: 'refused', reason: `the laser answers for ${inside.length} of ${cells} interior cells (${Math.round(100 * inside.length / Math.max(1, cells))}%): the ring runs outside the 4,096 m published window and would be traced truncated` }); continue; }
  const lvl = median(inside), spread = quant(inside, 0.9) - quant(inside, 0.1);
  /* grow the flat at that level from every interior cell, 1 m, 8-connected */
  const pad = 40;
  const X0 = Math.floor(b.x0 - pad), Z0 = Math.floor(b.z0 - pad);
  const W = Math.ceil(b.x1 + pad) - X0 + 1, H = Math.ceil(b.z1 + pad) - Z0 + 1;
  const flat = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const h = hAt(X0 + c, Z0 + r); if (Number.isFinite(h) && Math.abs(h - lvl) <= FLAT) flat[r * W + c] = 1; }
  const st = [];
  for (let z = b.z0; z <= b.z1; z += STEP) for (let x = b.x0; x <= b.x1; x += STEP) { if (!inRing(x, z, w.ring)) continue; const c = Math.round(x) - X0, r = Math.round(z) - Z0; const i = r * W + c; if (i >= 0 && i < flat.length && flat[i] && !seen[i]) { seen[i] = 1; st.push(i); } }
  const comp = [];
  while (st.length) { const i = st.pop(); comp.push(i); const cy = (i / W) | 0, cx = i % W; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = cy + dy, xx = cx + dx; if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue; const j = yy * W + xx; if (flat[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
  const area = comp.length * STEP * STEP;
  const seed = Math.round(areaOf(w.ring));
  /* Water is FLAT. A ring whose interior climbs through more than half a metre
     is not reading as a water surface at all -- it is reeds, a bank the ring
     took in, or a crown over the water -- and the plate grown from it would be
     a piece of ground, so it is refused and keeps the ring it had. */
  if (spread > 0.5) { out.push({ id: w.id, verdict: 'refused', reason: `the ring's interior spreads ${spread.toFixed(2)} m about ${lvl.toFixed(2)} m: not a water surface (a plate is flat to a few centimetres)`, level: +lvl.toFixed(2), spread: +spread.toFixed(2) }); continue; }
  if (comp.length < 20) { out.push({ id: w.id, verdict: 'refused', reason: `the ring's interior holds no flat at its own median ${lvl.toFixed(2)} m (spread ${spread.toFixed(2)} m)`, level: +lvl.toFixed(2), spread: +spread.toFixed(2) }); continue; }
  if (area > 6 * seed + 400) { out.push({ id: w.id, verdict: 'refused', reason: `the flat at ${lvl.toFixed(2)} m runs to ${Math.round(area)} m² from a ${seed} m² ring -- it leaks into the ground beside it`, level: +lvl.toFixed(2), plateArea: Math.round(area) }); continue; }
  /* boundary of the component, marching the cell edges, then simplified */
  /* Fill the speckle first. A metre of emergent reed or an overhanging crown
     returns a laser point and punches a one-cell hole in the plate; traced as
     drawn those became dozens of "island loops". A hole under 12 m² that the
     plate encloses is noise and is filled; anything larger is a real island
     and is counted and reported rather than quietly closed over. */
  const inC = new Uint8Array(W * H); for (const i of comp) inC[i] = 1;
  const outside = new Uint8Array(W * H); const oq = [];
  for (let c = 0; c < W; c++) { for (const i of [c, (H - 1) * W + c]) if (!inC[i] && !outside[i]) { outside[i] = 1; oq.push(i); } }
  for (let r = 0; r < H; r++) { for (const i of [r * W, r * W + W - 1]) if (!inC[i] && !outside[i]) { outside[i] = 1; oq.push(i); } }
  while (oq.length) { const i = oq.pop(); const cy = (i / W) | 0, cx = i % W; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (!inC[j] && !outside[j]) { outside[j] = 1; oq.push(j); } } }
  let filled = 0; const islands = [];
  const hseen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (inC[i] || outside[i] || hseen[i]) continue;
    const hole = [i]; hseen[i] = 1;
    for (let k = 0; k < hole.length; k++) { const j = hole[k], cy = (j / W) | 0, cx = j % W; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const n = yy * W + xx; if (!inC[n] && !outside[n] && !hseen[n]) { hseen[n] = 1; hole.push(n); } } }
    if (hole.length < 12) { for (const j of hole) { inC[j] = 1; comp.push(j); } filled += hole.length; }
    else islands.push(hole.length);
  }
  const edges = new Map();
  const key = (x, z) => `${x},${z}`;
  for (const i of comp) {
    const cy = (i / W) | 0, cx = i % W, x = X0 + cx, z = Z0 + cy;
    const at = (dx, dy) => { const xx = cx + dx, yy = cy + dy; return xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : inC[yy * W + xx]; };
    if (!at(0, -1)) edges.set(key(x - 0.5, z - 0.5), [x + 0.5, z - 0.5]);
    if (!at(1, 0)) edges.set(key(x + 0.5, z - 0.5), [x + 0.5, z + 0.5]);
    if (!at(0, 1)) edges.set(key(x + 0.5, z + 0.5), [x - 0.5, z + 0.5]);
    if (!at(-1, 0)) edges.set(key(x - 0.5, z + 0.5), [x - 0.5, z - 0.5]);
  }
  const loops = [];
  const left = new Map(edges);
  while (left.size) {
    const [k0, v0] = left.entries().next().value;
    const loop = [k0.split(',').map(Number)];
    let cur = v0; left.delete(k0);
    for (let guard = 0; guard < 100000; guard++) { loop.push(cur); const kk = key(cur[0], cur[1]); const nx = left.get(kk); if (!nx) break; left.delete(kk); cur = nx; }
    if (loop.length > 8) loops.push(loop);
  }
  loops.sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)));
  if (!loops.length) { out.push({ id: w.id, verdict: 'refused', reason: 'the flat has no traceable boundary' }); continue; }
  const ring = simplifyDP(loops[0], 0.6).map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]);
  if (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  /* how far the old ring was out: mean distance from its vertices to the plate */
  const inNew = w.ring.filter(p => inRing(p[0], p[1], ring)).length;
  const rec = { id: w.id, verdict: 'traced', level: +lvl.toFixed(2), spread: +spread.toFixed(2), ring,
    area: Math.round(Math.abs(areaOf(ring))), seedArea: seed, plateArea: Math.round(area),
    seedVerticesInsidePlate: `${inNew}/${w.ring.length}`, speckleFilled: filled, islands };
  out.push(rec); ponds.push(rec);
  console.log(`${String(w.id).padEnd(14)} level ${rec.level} spread ${rec.spread}  ring ${seed} -> plate ${rec.area} m²  ${rec.ring.length} pts  seed vertices on the plate ${rec.seedVerticesInsidePlate}${rec.islands.length ? "  islands " + rec.islands.map(a => a + " m2").join("/") : ""}${rec.speckleFilled ? "  speckle " + rec.speckleFilled + " m2" : ""}`);
}
for (const r of out.filter(r => r.verdict === 'refused')) console.log(`${String(r.id).padEnd(14)} REFUSED: ${r.reason}`);
writeJSON(path.join(HERE, 'laser-ponds.json'), {
  source: "Every non-lake water ring of course-model.json re-traced off Lantmäteriet's 1 m Markhöjdmodell as published in apps/golf/public/grounds/angso, by angsobuild/laser-ponds.mjs. Laser does not penetrate water, so a pond is a flat plate: its level is the median of the DTM inside the model's own ring, and its shoreline is the boundary of the connected flat (+/- 0.12 m) grown from that interior at 1 m. A ring whose interior holds no such flat, or whose flat leaks into the ground beside it, is REFUSED with the reason and keeps the ring it had.",
  tracedOn: new Date().toISOString().slice(0, 10), ponds: out,
});
console.log(`\n${ponds.length} traced, ${out.length - ponds.length} refused -> angsobuild/laser-ponds.json`);
