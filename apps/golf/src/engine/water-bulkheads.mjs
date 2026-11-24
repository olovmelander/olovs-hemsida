/* Reusable timber & stone water retaining walls (bulkheads) for Detailed 3D,
 * Light 3D Map, and Spela ball-physics collision.
 *
 * Pure Three-free geometry & collision kernel so it works identically in Vitest
 * Node tests, main.js opaque BufferGeometry assembly, and play/ball-physics.mjs.
 *
 * Schema:
 *   infra.bulkheads = [{
 *     id: string,
 *     line: [[x, z], ...],         // polyline in local metres
 *     kind: 'timber' | 'stone',    // weathered vertical sleepers or stacked granite wall
 *     waterId?: string | null,     // optional water body id for exact RH 2000 water level
 *     heightAboveWater?: number | null,
 *     provenance?: string,
 *   }]
 */

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function hexLinear(hex) {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

function hash01(x, z, salt = 0) {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function nearestWaterLevel(pt, waterList, waterId) {
  if (waterId && Array.isArray(waterList)) {
    const exact = waterList.find(w => w.id === waterId && Number.isFinite(w.level));
    if (exact) return exact.level;
  }
  if (!Array.isArray(waterList) || !waterList.length) return null;
  let best = null, bestD2 = Infinity;
  for (const w of waterList) {
    if (!Number.isFinite(w?.level) || !Array.isArray(w.ring)) continue;
    for (const [rx, rz] of w.ring) {
      const d2 = (rx - pt[0]) ** 2 + (rz - pt[1]) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = w.level; }
    }
  }
  return bestD2 <= 60 * 60 ? best : null;
}

/**
 * Sample bulkhead polyline into small structural segments and build opaque
 * triangle vertex + vertex-colour arrays (all linear luminances < 0.45,
 * strictly bloom-safe across all 10 lighting presets).
 */
export function buildBulkheadGeometry(bulkheads, { waterList = [], heightAt, linear = hexLinear } = {}) {
  const positions = [];
  const colors = [];
  const rendered = [];

  if (!Array.isArray(bulkheads) || !bulkheads.length || typeof heightAt !== 'function') {
    return { positions, colors, rendered };
  }

  const tri = (a, b, c, col) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    colors.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const vary = (base, amt, seed) => {
    const k = 1 + (seed - 0.5) * amt;
    return [base[0] * k, base[1] * k, base[2] * k];
  };

  // Bloom-safe weathered palettes (all well below GLOW.threshold = 0.86)
  const timberPiling = linear(0x5b4c3d);
  const timberCap = linear(0x6f5e4c);
  const timberDark = linear(0x463a2e);
  const stoneWall = linear(0x7c7a74);
  const stoneCap = linear(0x8e8c85);
  const stoneShadow = linear(0x63615c);

  for (const bh of bulkheads) {
    const pts = bh?.line;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const kind = bh.kind === 'stone' ? 'stone' : 'timber';
    const waterLevel = nearestWaterLevel(pts[0], waterList, bh.waterId);
    const stepLen = kind === 'stone' ? 1.15 : 0.72;
    const halfThick = kind === 'stone' ? 0.24 : 0.13;
    const capOverhang = kind === 'stone' ? 0.04 : 0.05;
    const capH = kind === 'stone' ? 0.16 : 0.14;
    let segCount = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.05) continue;
      const nx = -dz / segLen, nz = dx / segLen;
      const steps = Math.max(1, Math.round(segLen / stepLen));

      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const x0 = ax + dx * t0, z0 = az + dz * t0;
        const x1 = ax + dx * t1, z1 = az + dz * t1;
        const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
        const h0 = heightAt(x0, z0), h1 = heightAt(x1, z1);
        if (!Number.isFinite(h0) || !Number.isFinite(h1)) continue;

        const baseW = Number.isFinite(waterLevel) ? waterLevel : Math.min(h0, h1) - 0.85;
        const yBot = baseW - 0.55;
        const top0 = Number.isFinite(bh.heightAboveWater)
          ? baseW + bh.heightAboveWater
          : Math.max(baseW + 0.36, h0 + 0.06);
        const top1 = Number.isFinite(bh.heightAboveWater)
          ? baseW + bh.heightAboveWater
          : Math.max(baseW + 0.36, h1 + 0.06);

        const seed = hash01(mx, mz, s);
        const wallCol = vary(kind === 'stone' ? stoneWall : timberPiling, 0.16, seed);
        const sideCol = vary(kind === 'stone' ? stoneShadow : timberDark, 0.14, hash01(mx, mz, s + 13));
        const capCol = vary(kind === 'stone' ? stoneCap : timberCap, 0.12, hash01(mx, mz, s + 29));

        // Slight batter on stone masonry (wider at base)
        const baseHalf = kind === 'stone' ? halfThick + 0.10 : halfThick;
        const p0L = [x0 + nx * baseHalf, yBot, z0 + nz * baseHalf];
        const p1L = [x1 + nx * baseHalf, yBot, z1 + nz * baseHalf];
        const p0R = [x0 - nx * baseHalf, yBot, z0 - nz * baseHalf];
        const p1R = [x1 - nx * baseHalf, yBot, z1 - nz * baseHalf];

        const t0L = [x0 + nx * halfThick, top0 - capH, z0 + nz * halfThick];
        const t1L = [x1 + nx * halfThick, top1 - capH, z1 + nz * halfThick];
        const t0R = [x0 - nx * halfThick, top0 - capH, z0 - nz * halfThick];
        const t1R = [x1 - nx * halfThick, top1 - capH, z1 - nz * halfThick];

        // Main vertical retaining faces (both sides so orientation never culls)
        quad(p0L, p1L, t1L, t0L, wallCol);
        quad(p1R, p0R, t0R, t1R, sideCol);

        // Dressed coping / horizontal timber cap beam along the crest
        const ch = halfThick + capOverhang;
        const c0L = [x0 + nx * ch, top0, z0 + nz * ch];
        const c1L = [x1 + nx * ch, top1, z1 + nz * ch];
        const c0R = [x0 - nx * ch, top0, z0 - nz * ch];
        const c1R = [x1 - nx * ch, top1, z1 - nz * ch];
        const cb0L = [x0 + nx * ch, top0 - capH, z0 + nz * ch];
        const cb1L = [x1 + nx * ch, top1 - capH, z1 + nz * ch];
        const cb0R = [x0 - nx * ch, top0 - capH, z0 - nz * ch];
        const cb1R = [x1 - nx * ch, top1 - capH, z1 - nz * ch];

        quad(c0L, c1L, c1R, c0R, capCol);       // Top cap surface
        quad(cb0L, cb1L, c1L, c0L, capCol);     // Left cap lip
        quad(cb1R, cb0R, c0R, c1R, sideCol);    // Right cap lip
        segCount++;
      }
    }
    if (segCount > 0) {
      rendered.push({ id: bh.id || null, kind, segments: segCount, waterLevel });
    }
  }

  return { positions, colors, rendered };
}

/**
 * Spatial wall segment index for Spela ball-physics collisions against
 * water-hazard timber sleepers & granite retaining walls.
 */
export function createBulkheadCollider(bulkheads, { waterList = [], heightAt } = {}) {
  const segments = [];
  if (Array.isArray(bulkheads)) {
    for (const bh of bulkheads) {
      const pts = bh?.line;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const kind = bh.kind === 'stone' ? 'stone' : 'timber';
      const waterLevel = nearestWaterLevel(pts[0], waterList, bh.waterId);
      const halfThick = kind === 'stone' ? 0.28 : 0.18;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const hA = typeof heightAt === 'function' ? heightAt(ax, az) : 0;
        const hB = typeof heightAt === 'function' ? heightAt(bx, bz) : 0;
        const baseW = Number.isFinite(waterLevel) ? waterLevel : Math.min(hA, hB) - 0.85;
        const yMax = Number.isFinite(bh.heightAboveWater)
          ? baseW + bh.heightAboveWater
          : Math.max(baseW + 0.36, Math.max(hA, hB) + 0.08);
        segments.push({
          id: bh.id || null,
          kind,
          ax, az, bx, bz, dx, dz, len,
          nx: -dz / len,
          nz: dx / len,
          minX: Math.min(ax, bx) - halfThick,
          maxX: Math.max(ax, bx) + halfThick,
          minZ: Math.min(az, bz) - halfThick,
          maxZ: Math.max(az, bz) + halfThick,
          yMin: baseW - 0.5,
          yMax,
          halfThick,
        });
      }
    }
  }

  return {
    count: segments.length,
    near(x, z, r = 1.5) {
      if (!segments.length) return [];
      const out = [];
      for (const s of segments) {
        if (x + r < s.minX || x - r > s.maxX || z + r < s.minZ || z - r > s.maxZ) continue;
        out.push(s);
      }
      return out;
    },
  };
}

/**
 * Helper to suppress reeds/beach strips immediately adjacent to retaining bulkheads.
 */
export function isNearBulkhead(x, z, bulkheads, radius = 2.0) {
  if (!Array.isArray(bulkheads) || !bulkheads.length) return false;
  const r2 = radius * radius;
  for (const bh of bulkheads) {
    const pts = bh?.line;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + dx * t - x, pz = az + dz * t - z;
      if (px * px + pz * pz <= r2) return true;
    }
  }
  return false;
}

/**
 * Derive a deck polygon from a line-only bridge definition when `bridge.ring`
 * is absent (used by Bro Hof's timber & stone bridges across water hazards).
 */
export function bridgeOutlineFromLine(line, width = 2.6) {
  if (!Array.isArray(line) || line.length < 2) return null;
  const half = Math.max(0.6, width * 0.5);
  const left = [], right = [];
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    left.push([line[i][0] + nx * half, line[i][1] + nz * half]);
    right.push([line[i][0] - nx * half, line[i][1] - nz * half]);
  }
  return [...left, ...right.reverse()];
}
