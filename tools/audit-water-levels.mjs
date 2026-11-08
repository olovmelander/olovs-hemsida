#!/usr/bin/env node
/* Where every course's water stands against its ground: an audit on the CPU, no browser.
 *
 *   node tools/audit-water-levels.mjs [--course slug[,slug]] [--json out.json] [--near]
 *
 * For each layout's water polygon (lake, pond, waterhole) it reads the 1 m laser ground
 * the map and the simulator read, in the pack's own frame and datum, and reports:
 *   - the level the boot gives it today (map-shores-bake.mjs simulatorLevel);
 *   - the laser's own surface inside it (water-plate-level.mjs) and how flat that is;
 *   - the inside's lower quartile, the ring's own ground, and the bank 2-8 m outside;
 *   - drop    = boot level - surface  (how far above the measured water it is drawn)
 *   - freeboard = bank - boot level   (how far below the bank the water sits)
 * and for each stream or ditch: its channel floor and banks along the line.
 * Nothing is written to the app. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseChunkEnvelope } from '../packages/course-v2/chunk.mjs';
import { createMapFrame } from '../apps/golf/src/map/map-frames.mjs';
import { decodeTileHeights, sampleTile } from '../apps/golf/src/map/map-height.mjs';
import { buildTileTree } from '../apps/golf/src/map/map-lod.mjs';
import { laserPlateLevel, LASER_PLATE_COURSES } from '../apps/golf/src/engine/water-plate-level.mjs';
import { simulatorLevel, nearPlay } from './map-shores-bake.mjs';
import { shoreLevel } from '../apps/golf/src/engine/water-level.mjs';
import { buildStreamWater } from '../apps/golf/src/engine/stream-water.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const ONLY = flag('course', null)?.split(',');
const PUBLIC = path.resolve('apps/golf/public');
const json = file => JSON.parse(fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
const chunkOf = reference => {
  const envelope = parseChunkEnvelope(fs.readFileSync(path.join(PUBLIC, reference.url)));
  return { header: envelope.header, payload: envelope.codec === 'deflate-raw' ? zlib.inflateRawSync(envelope.encodedPayload) : envelope.encodedPayload };
};
const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

function groundProbe(ground, frame) {
  const { root } = buildTileTree(ground);
  const decoded = new Map();
  const heightsOf = node => {
    if (!decoded.has(node.id)) {
      const { header, payload } = chunkOf(node.layers.terrain);
      decoded.set(node.id, decodeTileHeights(payload, header.grid, 0).heights);
    }
    return decoded.get(node.id);
  };
  return (packX, packZ) => {
    const [x, z] = frame.toWorld(packX, packZ);
    let node = root, finest = null;
    while (node) {
      const u = (x - node.x0) / node.size, v = (z - node.z0) / node.size;
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) break;
      finest = node;
      node = node.children[(v >= 0.5 ? 2 : 0) + (u >= 0.5 ? 1 : 0)];
    }
    if (!finest) return NaN;
    return sampleTile(heightsOf(finest), (x - finest.x0) / finest.size, (z - finest.z0) / finest.size) + frame.verticalDatumOffsetMetres;
  };
}

const inRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const area = ring => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], s = ring[(i + 1) % ring.length]; a += p[0] * s[1] - s[0] * p[1]; } return Math.abs(a / 2); };

/* the ring's own ground, and the bank 2-8 m outside it along each edge's outward normal */
function ringAndBank(ring, probe) {
  const sign = (() => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], s = ring[(i + 1) % ring.length]; a += p[0] * s[1] - s[0] * p[1]; } return a > 0 ? 1 : -1; })();
  const onRing = [], bank = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(L > 0)) continue;
    const nx = sign * (b[1] - a[1]) / L, nz = -sign * (b[0] - a[0]) / L;
    for (let s = 0; s < L; s += 2) {
      const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L;
      const h0 = probe(x, z); if (Number.isFinite(h0)) onRing.push(h0);
      let best = -Infinity;
      for (const d of [2, 4, 6, 8]) {
        /* outward is whichever side is outside the ring */
        const px = x + nx * d, pz = z + nz * d, ox = x - nx * d, oz = z - nz * d;
        const [ux, uz] = inRing(px, pz, ring) ? [ox, oz] : [px, pz];
        const h = probe(ux, uz);
        if (Number.isFinite(h)) best = Math.max(best, h);
      }
      if (Number.isFinite(best)) bank.push(best);
    }
  }
  onRing.sort((m, n) => m - n); bank.sort((m, n) => m - n);
  return { onRing, bank };
}

function insideStats(ring, probe) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  let step = 1.5;
  while ((x1 - x0) * (z1 - z0) / (step * step) > 40000) step *= 1.5;
  const h = [];
  for (let z = z0 + step / 2; z < z1; z += step) for (let x = x0 + step / 2; x < x1; x += step) {
    if (!inRing(x, z, ring)) continue;
    const v = probe(x, z); if (Number.isFinite(v)) h.push(v);
  }
  h.sort((m, n) => m - n);
  return h;
}

/* a stream's channel: every 5 m along it, the floor (lowest ground within w/2 + 1.5 m of
   the line) and the banks (highest within w/2 + 4 m) */
function channel(line, w, probe) {
  const floors = [], banks = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(L > 0)) continue;
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
    for (let s = 0; s < L; s += 5) {
      const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L;
      let lo = Infinity, hi = -Infinity;
      for (let d = -(w / 2 + 4); d <= w / 2 + 4; d += 0.5) {
        const v = probe(x + nx * d, z + nz * d);
        if (!Number.isFinite(v)) continue;
        if (Math.abs(d) <= w / 2 + 1.5) lo = Math.min(lo, v);
        if (Math.abs(d) >= w / 2 + 2) hi = Math.max(hi, v);
      }
      if (Number.isFinite(lo) && Number.isFinite(hi)) { floors.push(lo); banks.push(hi - lo); }
    }
  }
  banks.sort((m, n) => m - n);
  return { samples: floors.length, depth: banks };
}

const layouts = json('courses/index.json').courses;
const v2 = json('courses/v2-index.json').courses;
const report = [];
for (const meta of layouts) {
  if (ONLY && !ONLY.includes(meta.slug)) continue;
  const entry = v2.find(e => e.slug === meta.slug);
  if (!entry) continue;
  const groundManifest = json(entry.manifest.url).groundManifest;
  const ground = json(groundManifest.url);
  const frame = createMapFrame(entry.groundId, ground.frame);
  const probe = groundProbe(ground, frame);
  const pack = fs.readFileSync(path.join(PUBLIC, meta.packUrl));
  const headerBytes = pack.readUInt32LE(4);
  const header = JSON.parse(pack.subarray(8, 8 + headerBytes).toString());
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  const vectors = JSON.parse(zlib.inflateRawSync(pack.subarray(start, start + header.VEC.bytes)).toString());
  const measuredOnly = vectors.infra?.terrainPlacement === 'measured-only';
  const holes = vectors.holes ?? [];
  const nearestHole = (x, z) => {
    let best = Infinity, hole = null;
    for (const h of holes) for (const p of h.line) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < best) { best = d; hole = h.n; } }
    return { d: best, hole };
  };
  const bodies = [];
  (vectors.water ?? []).forEach((w, index) => {
    if (w.stream || !(w.ring?.length >= 3)) return;
    const a = area(w.ring);
    const c = w.ring.reduce((s, p) => [s[0] + p[0] / w.ring.length, s[1] + p[1] / w.ring.length], [0, 0]);
    const near = nearestHole(c[0], c[1]);
    const boot = measuredOnly ? { level: w.level } : simulatorLevel({ ring: w.ring, level: w.level, probe, plate: LASER_PLATE_COURSES.has(meta.slug) });
    const plate = laserPlateLevel(w.ring, probe);
    const inside = insideStats(w.ring, probe);
    const { onRing, bank } = ringAndBank(w.ring, probe);
    const surface = plate?.surfaceMetres ?? q(inside, 0.25);
    const shore = measuredOnly ? null : shoreLevel({ ring: w.ring, heightAt: probe, near: nearPlay(holes) });
    const fitted = shore ? { shore: shore.shoreMetres, level: shore.level, overlap: shore.overlap, method: shore.method } : null;
    const insideSpread = q(inside, 0.9) - q(inside, 0.1);
    bodies.push({
      index, sea: !!w.isSea, lake: !!w.isLake, areaM2: Math.round(a), nearHole: near.hole, holeM: Math.round(near.d),
      pack: r2(w.level), boot: r2(boot.level), plate: r2(plate?.surfaceMetres), plateFrac: plate?.plateFraction ?? null,
      insideP10: r2(q(inside, 0.1)), insideP25: r2(q(inside, 0.25)), insideP50: r2(q(inside, 0.5)), insideSpread: r2(insideSpread),
      ringP30: r2(q(onRing, 0.3)), ringP50: r2(q(onRing, 0.5)), bankP50: r2(q(bank, 0.5)), bankP20: r2(q(bank, 0.2)),
      drop: r2(boot.level - surface), freeboard: r2(q(bank, 0.5) - boot.level),
      fitShore: r2(fitted?.shore), fitLevel: r2(fitted?.level), overlap: fitted?.overlap ?? null, method: fitted?.method ?? null, fitFreeboard: r2(q(bank, 0.5) - (fitted?.level ?? NaN)),
    });
  });
  const streams = (vectors.streams ?? []).map((s, index) => {
    const ch = channel(s.line, s.w ?? 1.5, probe);
    let len = 0; for (let i = 1; i < s.line.length; i++) len += Math.hypot(s.line[i][0] - s.line[i - 1][0], s.line[i][1] - s.line[i - 1][1]);
    return { index, kind: s.kind ?? null, w: s.w, lengthM: Math.round(len), samples: ch.samples,
      channelDepthP20: r2(q(ch.depth, 0.2)), channelDepthP50: r2(q(ch.depth, 0.5)), flatShare: +(ch.depth.filter(d => d < 0.25).length / Math.max(1, ch.depth.length)).toFixed(2) };
  });
  report.push({ slug: meta.slug, ground: entry.groundId, measuredOnly, bodies, streams });
  const flagged = bodies.filter(b => !b.sea);
  console.log(`\n== ${meta.slug} (${entry.groundId}${measuredOnly ? ', measured-only' : ''}): ${flagged.length} water bodies, ${streams.length} streams`);
  console.log('  #  area m2  hole(m)   pack   boot  plate  frac  in25  in50  spread  ring30  bank50  drop  freebd |  fit  ovlap  fit-boot');
  for (const b of flagged.sort((x, y) => x.holeM - y.holeM)) {
    console.log(`${String(b.index).padStart(3)} ${String(b.areaM2).padStart(8)} ${String(b.nearHole).padStart(4)}(${String(b.holeM).padStart(4)}) ${String(b.pack).padStart(6)} ${String(b.boot).padStart(6)} ${String(b.plate ?? '-').padStart(6)} ${String(b.plateFrac ?? '-').padStart(5)} ${String(b.insideP25).padStart(6)} ${String(b.insideP50).padStart(6)} ${String(b.insideSpread).padStart(6)} ${String(b.ringP30).padStart(7)} ${String(b.bankP50).padStart(7)} ${String(b.drop).padStart(5)} ${String(b.freeboard).padStart(6)} | ${String(b.fitLevel).padStart(6)} ${String(b.overlap).padStart(5)} ${String(r2(b.fitLevel - b.boot)).padStart(6)}`);
  }
  if (streams.length) {
    const deep = streams.filter(s => s.channelDepthP50 >= 0.4).length;
    const drawn = (vectors.streams ?? []).filter(x => !x.contextOnly && !/no new water plane/i.test(x.waterSurfaceStatus ?? ''));
    const ribbons = buildStreamWater(drawn, probe);
    console.log(`  streams: ${streams.length}, ${Math.round(streams.reduce((s, x) => s + x.lengthM, 0))} m; a cut channel (median bank 0.4 m+ above the floor) on ${deep}; water drawn on ${Math.round(ribbons.metres)} m in ${ribbons.runs} runs (${drawn.length} streams eligible)`);
  }
}
const out = flag('json', null);
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
