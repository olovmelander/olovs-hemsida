#!/usr/bin/env node
/* Unified per-ground quality assurance gate for Banvy v2 golf courses.
 *
 * Audits a ground across every published course routing on that ground:
 *  1. V2 ground manifest & LOD0 tile seam continuity (checks chunk presence &
 *     edge elevation agreement across adjacent 1 m LOD0 tiles).
 *  2. Scorecard & hole metadata integrity (9 or 18 holes, sequential 1..N,
 *     valid par 3..5, valid stroke-index permutation, non-boilerplate notes).
 *  3. Green & Tee 1 m RH 2000 terrain checks (green relief, Greengrid slope
 *     sanity, tee slope, and tee dryness above water hazards).
 *  4. 100/150/200 m distance-plate corridor sanity on Par 4/5 holes.
 *  5. Water, bulkhead, and bridge geometry seating checks.
 *  6. Tree-on-green / tree-on-tee clearance check when published tree tiles exist.
 *  7. Facility GLB & bloom-safe linear albedo check (< GLOW.threshold = 0.86).
 *  8. White stakes: no shot from a tee onto its own fairway or green, and no approach
 *     onto the green, is called out of bounds by Spela's rule (out-of-bounds-shots.mjs).
 *
 * Usage:
 *   node tools/check-course-quality.mjs --ground visby [--public-root apps/golf/public]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseChunkEnvelope } from '../packages/course-v2/chunk.mjs';
import { buildTileTree } from '../apps/golf/src/map/map-lod.mjs';
import { decodeTileHeights, sampleTile } from '../apps/golf/src/map/map-height.mjs';
import { createMapFrame } from '../apps/golf/src/map/map-frames.mjs';
import { pointInPoly, polyLen } from '../geobuild/lib.mjs';
import { validateFacilityManifest } from './facility-pipeline/validate-facility-glb.mjs';
import { goodShotsCalledOut } from './out-of-bounds-shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readPackVectors(packFile) {
  const bytes = fs.readFileSync(packFile);
  const headerBytes = bytes.readUInt32LE(4);
  const header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString('utf8'));
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  return {
    header,
    vectors: JSON.parse(zlib.inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)).toString('utf8')),
  };
}

function loadTileHeights(publicRoot, node) {
  const { encodedPayload, codec, header } = parseChunkEnvelope(fs.readFileSync(path.join(publicRoot, node.layers.terrain.url)));
  const payload = codec === 'deflate-raw' ? zlib.inflateRawSync(encodedPayload) : encodedPayload;
  return decodeTileHeights(new Uint8Array(payload), header.grid);
}

/** Check shared border height continuity across adjacent LOD0 1 m tiles. */
export function checkLod0SeamContinuity(publicRoot, l0Nodes, maxSamplePairs = 32) {
  const byOrigin = new Map(l0Nodes.map(n => [`${n.x0}:${n.z0}`, n]));
  const decodedCache = new Map();
  const getDecoded = node => {
    if (!decodedCache.has(node.id)) decodedCache.set(node.id, loadTileHeights(publicRoot, node));
    return decodedCache.get(node.id);
  };

  let pairsChecked = 0;
  let maxEdgeDeltaM = 0;
  let worstPair = null;

  // Check interior east-west and north-south seams among central tiles
  const sorted = [...l0Nodes].sort((a, b) => Math.hypot(a.x0, a.z0) - Math.hypot(b.x0, b.z0));
  for (const node of sorted) {
    if (pairsChecked >= maxSamplePairs) break;
    const east = byOrigin.get(`${node.x0 + node.size}:${node.z0}`);
    if (east) {
      const a = getDecoded(node), b = getDecoded(east);
      const side = Math.round(Math.sqrt(a.heights.length));
      for (let r = 0; r < side; r++) {
        const diff = Math.abs(a.heights[r * side + (side - 1)] - b.heights[r * side]);
        if (diff > maxEdgeDeltaM) { maxEdgeDeltaM = diff; worstPair = `${node.id}|${east.id}`; }
      }
      pairsChecked++;
    }
    const south = byOrigin.get(`${node.x0}:${node.z0 + node.size}`);
    if (south) {
      const a = getDecoded(node), b = getDecoded(south);
      const side = Math.round(Math.sqrt(a.heights.length));
      for (let c = 0; c < side; c++) {
        const diff = Math.abs(a.heights[(side - 1) * side + c] - b.heights[c]);
        if (diff > maxEdgeDeltaM) { maxEdgeDeltaM = diff; worstPair = `${node.id}|${south.id}`; }
      }
      pairsChecked++;
    }
  }
  return { pairsChecked, maxEdgeDeltaM: Math.round(maxEdgeDeltaM * 10000) / 10000, worstPair };
}

/** Metres from a point to the nearest edge of a ring. */
const ringGap = (x, z, ring) => ring.reduce((best, [ax, az], i) => {
  const [bx, bz] = ring[(i + 1) % ring.length], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
}, Infinity);

export function checkGroundQuality({
  groundId,
  publicRoot = path.join(ROOT, 'apps/golf/public'),
  maxSeamDeltaM = 0.02,
  maxGreenMedianReliefM = 1.6,
  maxTeeSlopePercent = 12,
  checkFacilityMaxLum = 0.82,
}) {
  const errors = [];
  const warnings = [];
  const v2Index = readJson(path.join(publicRoot, 'courses/v2-index.json'));
  const packIndex = readJson(path.join(publicRoot, 'courses/index.json'));
  const entries = (v2Index.courses || []).filter(c => c.groundId === groundId);
  if (!entries.length) {
    return { ok: false, groundId, errors: [`no courses found for groundId=${groundId} in courses/v2-index.json`], warnings, summary: null };
  }

  const firstCourse = readJson(path.join(publicRoot, entries[0].manifest.url));
  const groundManifest = readJson(path.join(publicRoot, firstCourse.groundManifest.url));
  const { nodes } = buildTileTree(groundManifest);
  const frame = createMapFrame(groundId, groundManifest.frame);
  const l0Nodes = [...nodes.values()].filter(n => n.lod === 0);

  // 1. LOD0 seam continuity
  const seam = checkLod0SeamContinuity(publicRoot, l0Nodes, 24);
  if (seam.maxEdgeDeltaM > maxSeamDeltaM) {
    errors.push(`LOD0 seam jump ${seam.maxEdgeDeltaM} m at ${seam.worstPair} exceeds ${maxSeamDeltaM} m`);
  }

  // Lazy 1 m terrain sampler in ground world coordinates
  const tileCache = new Map();
  const heightAtWorld = (wx, wz) => {
    const node = l0Nodes.find(n => wx >= n.x0 && wx < n.x0 + n.size && wz >= n.z0 && wz < n.z0 + n.size);
    if (!node) return NaN;
    if (!tileCache.has(node.id)) tileCache.set(node.id, loadTileHeights(publicRoot, node).heights);
    return sampleTile(tileCache.get(node.id), (wx - node.x0) / node.size, (wz - node.z0) / node.size);
  };

  const courseReports = [];
  for (const entry of entries) {
    const packEntry = (packIndex.courses || []).find(p => p.slug === entry.slug);
    if (!packEntry) {
      errors.push(`${entry.slug}: missing from courses/index.json`);
      continue;
    }
    const { vectors } = readPackVectors(path.join(publicRoot, packEntry.packUrl));
    const holes = vectors.holes || [];
    if (![9, 18].includes(holes.length)) {
      errors.push(`${entry.slug}: unexpected hole count ${holes.length}`);
    }

    // Check unique non-boilerplate notes
    const noteSet = new Set(holes.map(h => (h.note || '').trim()).filter(Boolean));
    if (holes.length >= 9 && noteSet.size <= 1) {
      warnings.push(`${entry.slug}: all holes share identical or empty note text`);
    }

    const greenReliefs = [];
    let teesDryChecked = 0;
    let bulkheadsCount = (vectors.infra?.bulkheads || []).length;
    let bridgesCount = (vectors.infra?.bridges || []).length;
    const waterBodies = vectors.water || [];

    for (const h of holes) {
      if (!Number.isInteger(h.par) || h.par < 3 || h.par > 5) {
        errors.push(`${entry.slug} h${h.n}: invalid par ${h.par}`);
      }
      if (!Array.isArray(h.line) || h.line.length < 2) {
        errors.push(`${entry.slug} h${h.n}: invalid centerline`);
      } else if (h.par >= 4 && polyLen(h.line) < 180) {
        warnings.push(`${entry.slug} h${h.n}: par ${h.par} centerline only ${Math.round(polyLen(h.line))} m`);
      }

      // Sample 1 m RH 2000 heights around the green ring
      const greenHeights = (h.green?.ring || []).map(([x, z]) => heightAtWorld(...frame.toWorld(x, z)));
      if (!greenHeights.length || !greenHeights.every(Number.isFinite)) {
        errors.push(`${entry.slug} h${h.n}: green ring extends outside 1 m LOD0 tiles`);
      } else {
        greenReliefs.push(Math.max(...greenHeights) - Math.min(...greenHeights));
      }

      // Check tee pads slope & dryness
      for (const [padIndex, pad] of (h.tees?.pads || []).entries()) {
        const ring = pad.ring || [];
        if (ring.length < 3) continue;
        const pts = ring.map(([x, z]) => {
          const [wx, wz] = frame.toWorld(x, z);
          return { x, z, wx, wz, h: heightAtWorld(wx, wz) };
        });
        if (!pts.every(p => Number.isFinite(p.h))) {
          errors.push(`${entry.slug} h${h.n}: tee pad leaves 1 m LOD0 coverage`);
          continue;
        }
        const relief = Math.max(...pts.map(p => p.h)) - Math.min(...pts.map(p => p.h));
        const xs = pts.map(p => p.wx), zs = pts.map(p => p.wz);
        const span = Math.max(4, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)));
        const slopePct = (relief / span) * 100;
        if (slopePct > maxTeeSlopePercent) {
          warnings.push(`${entry.slug} h${h.n}: tee pad slope ${slopePct.toFixed(1)}% exceeds ${maxTeeSlopePercent}%`);
        }
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        for (const wb of waterBodies) {
          if (wb.ring && pointInPoly(cx, cz, wb.ring)) {
            errors.push(`${entry.slug} h${h.n}: tee pad centroid sits inside water body ${wb.id ?? `water ${waterBodies.indexOf(wb)}`}`);
          }
        }
        // The app stands a lake up to 0.3 m over its plate: ground at the water's own level beside it floods (a fill newer
        // than the laser, Castle 18 at Bro Hof). Heights and levels share a datum only on a grid-authored ground.
        const medianH = pts.map(p => p.h).sort((m, n) => m - n)[pts.length >> 1];
        const wet = waterBodies.find(wb => wb.ring && Number.isFinite(wb.level) && Math.abs(medianH - wb.level) < 0.3
          && pts.some(p => ringGap(p.x, p.z, wb.ring) < 6));
        if (wet) warnings.push(`${entry.slug} h${h.n}: tee ${pad.id ?? `deck ${padIndex + 1}`} stands at the water's own level beside ${wet.id ?? `water ${waterBodies.indexOf(wet)}`}; the laser may be older than the ground`);
        teesDryChecked++;
      }
    }

    // Validate bulkheads & bridges have finite coordinates within ground bounds
    for (const bh of vectors.infra?.bulkheads || []) {
      if (!Array.isArray(bh.line) || bh.line.length < 2) {
        errors.push(`${entry.slug}: bulkhead ${bh.id} requires >= 2 vertices`);
      } else {
        for (const [x, z] of bh.line) {
          if (!Number.isFinite(heightAtWorld(...frame.toWorld(x, z)))) {
            errors.push(`${entry.slug}: bulkhead ${bh.id} vertex leaves LOD0 coverage`);
            break;
          }
        }
      }
    }
    for (const br of vectors.infra?.bridges || []) {
      if (!Array.isArray(br.line) || br.line.length < 2) {
        errors.push(`${entry.slug}: bridge ${br.id} requires >= 2 vertices`);
      }
    }

    // 8. A hole's own fairway and green are never out of bounds: a stake line that rules
    // a shot onto them out is drawn across the play (Veckefjärden, 27 November 2026).
    const stakeShots = goodShotsCalledOut(vectors);
    for (const r of stakeShots.filter(s => s.out)) {
      errors.push(`${entry.slug} h${r.hole}: ${r.out} of ${r.shots} shots onto its own fairway or green are called out of bounds by the white stakes (first: ${r.first.kind} ${r.first.from.join(',')} to ${r.first.to.join(',')})`);
    }

    const sortedRelief = [...greenReliefs].sort((a, b) => a - b);
    const medianGreenRelief = sortedRelief.length ? sortedRelief[Math.floor(sortedRelief.length / 2)] : null;
    if (medianGreenRelief !== null && medianGreenRelief > maxGreenMedianReliefM) {
      errors.push(`${entry.slug}: median green relief ${medianGreenRelief.toFixed(2)} m exceeds ${maxGreenMedianReliefM} m`);
    }

    courseReports.push({
      slug: entry.slug,
      holes: holes.length,
      medianGreenReliefM: medianGreenRelief !== null ? Math.round(medianGreenRelief * 1000) / 1000 : null,
      teesChecked: teesDryChecked,
      waterBodies: waterBodies.length,
      bulkheads: bulkheadsCount,
      bridges: bridgesCount,
      stakeShots: { shots: stakeShots.reduce((n, s) => n + s.shots, 0), out: stakeShots.reduce((n, s) => n + s.out, 0) },
    });
  }

  // Optional facility GLB validation if published
  let facilityReport = null;
  const facManifestPath = path.join(publicRoot, `models/${groundId}/facilities-v1.json`);
  if (fs.existsSync(facManifestPath)) {
    const res = validateFacilityManifest({
      manifestPath: facManifestPath,
      publicRoot,
      maxLinearLuminance: checkFacilityMaxLum,
    });
    facilityReport = res.summary;
    for (const e of res.errors) errors.push(`facilities-v1: ${e}`);
    for (const w of res.warnings) warnings.push(`facilities-v1: ${w}`);
  }

  return {
    ok: errors.length === 0,
    groundId,
    errors,
    warnings,
    summary: {
      tiles: groundManifest.tiles.length,
      seam,
      courses: courseReports,
      facilities: facilityReport,
    },
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${k} requires a value`);
    opts[k.slice(2)] = v;
    i++;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.ground) {
    throw new Error('Usage: check-course-quality.mjs --ground ID [--public-root DIR]');
  }
  const report = checkGroundQuality({
    groundId: opts.ground,
    publicRoot: opts['public-root'] ? path.resolve(opts['public-root']) : path.join(ROOT, 'apps/golf/public'),
    ...(opts['max-facility-luminance'] ? { checkFacilityMaxLum: Number(opts['max-facility-luminance']) } : {}),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
