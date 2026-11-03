/* THE CROWN'S PUFFS (2 November, after serenity-blocks' Odyssey "puff crowns",
   docs/ODYSSEY_ACT2_STUNNING_2026-10.md section 7).

   The approved crowns carry one broad normal field: 70% the whole crown's
   ellipsoid and 27% the clump a card sits on (tools/blender-tree-study/
   foliage_envelopes.py). So a crown lights as one soft ball, and from a tee a
   birch or an oak reads as a single green lump with a lit side. A painted
   canopy is a cluster of masses, each lit on its cap and dark on its belly,
   with a crease where two meet: the read Odyssey gets from a top puff and a
   ring of puffs, each with its own radial normals leaned up.

   This bakes that light into the crowns golf already has, at load, without
   moving a vertex: the crown's leaf cards are grouped into `puffs` masses
   (k-means from its highest point, deterministic), and every vertex's normal
   leans from the crown's toward its own mass's centre, and up. A card keeps
   one mass (its triangles' mass), so the seam between two masses falls
   between cards. The impostor bake draws these normals into its atlas, so the
   distant billboards carry the same masses. Silhouettes, sizes, UVs and the
   crown-depth colours are untouched. */

export const CROWN_PUFFS = Object.freeze({
  /* masses a crown is grouped into, by the tier drawn */
  puffs: Object.freeze({ hero: 9, full: 6 }),
  /* the spruce is grouped in tiers, its boughs (Odyssey's leafy conifers):
     height counts this many times over in the grouping, and it has more of them */
  spruce: Object.freeze({ hero: 8, full: 6, tierWeight: 3 }),
  /* the normal: this much of the crown's own, this much of the mass's, and this lean up */
  crown: 0.45, puff: 0.55, up: 0.22,
  iterations: 8,
});

/**
 * Lean a crown's normals toward the masses it is made of. Returns the mass of
 * every vertex (Uint8Array) and the masses' centres.
 * @param {import('three').BufferGeometry} geometry the crown, Y up
 */
export function bakePuffNormals(geometry, { puffs = CROWN_PUFFS.puffs.hero, crown = CROWN_PUFFS.crown, puff = CROWN_PUFFS.puff,
  up = CROWN_PUFFS.up, iterations = CROWN_PUFFS.iterations, tierWeight = 1 } = {}) {
  /* the grouping's metric: height weighs `tierWeight` times (tiers for a spruce) */
  const W = tierWeight * tierWeight;
  const pos = geometry.attributes.position.array, nrm = geometry.attributes.normal.array;
  const n = pos.length / 3, index = geometry.index ? geometry.index.array : null;
  const k = Math.max(1, Math.min(puffs, n));
  /* seeds: the highest point (the top mass), then each farthest from those chosen */
  const seeds = [];
  let top = 0;
  for (let i = 1; i < n; i++) if (pos[i * 3 + 1] > pos[top * 3 + 1]) top = i;
  seeds.push([pos[top * 3], pos[top * 3 + 1], pos[top * 3 + 2]]);
  const nearest = new Float64Array(n).fill(Infinity);
  while (seeds.length < k) {
    const s = seeds[seeds.length - 1];
    let far = 0, farD = -1;
    for (let i = 0; i < n; i++) {
      const d = (pos[i * 3] - s[0]) ** 2 + W * (pos[i * 3 + 1] - s[1]) ** 2 + (pos[i * 3 + 2] - s[2]) ** 2;
      if (d < nearest[i]) nearest[i] = d;
      if (nearest[i] > farD) { farD = nearest[i]; far = i; }
    }
    seeds.push([pos[far * 3], pos[far * 3 + 1], pos[far * 3 + 2]]);
  }
  /* k-means on the vertices */
  const label = new Uint8Array(n);
  const centres = seeds.map(s => [...s]);
  for (let it = 0; it < iterations; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (pos[i * 3] - centres[c][0]) ** 2 + W * (pos[i * 3 + 1] - centres[c][1]) ** 2 + (pos[i * 3 + 2] - centres[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      label[i] = best;
      const t = sum[best]; t[0] += pos[i * 3]; t[1] += pos[i * 3 + 1]; t[2] += pos[i * 3 + 2]; t[3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3] > 0) for (let a = 0; a < 3; a++) centres[c][a] = sum[c][a] / sum[c][3];
  }
  /* a card keeps one mass: each triangle's centroid decides its corners */
  if (index) {
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const p = [0, 1, 2].map(ax => (pos[a * 3 + ax] + pos[b * 3 + ax] + pos[c * 3 + ax]) / 3);
      let best = 0, bestD = Infinity;
      for (let m = 0; m < k; m++) {
        const d = (p[0] - centres[m][0]) ** 2 + W * (p[1] - centres[m][1]) ** 2 + (p[2] - centres[m][2]) ** 2;
        if (d < bestD) { bestD = d; best = m; }
      }
      label[a] = label[b] = label[c] = best;
    }
  }
  /* each mass's extent per axis, so a flat mass lights as a flat dome */
  const spread = centres.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const c = centres[label[i]], s = spread[label[i]];
    for (let a = 0; a < 3; a++) s[a] += (pos[i * 3 + a] - c[a]) ** 2;
    s[3]++;
  }
  const radius = spread.map(s => [0, 1, 2].map(a => Math.max(0.05, Math.sqrt(s[a] / Math.max(1, s[3])))));
  for (let i = 0; i < n; i++) {
    const c = centres[label[i]], r = radius[label[i]];
    let px = (pos[i * 3] - c[0]) / r[0], py = (pos[i * 3 + 1] - c[1]) / r[1], pz = (pos[i * 3 + 2] - c[2]) / r[2];
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    let x = nrm[i * 3] * crown + px * puff, y = nrm[i * 3 + 1] * crown + py * puff + up, z = nrm[i * 3 + 2] * crown + pz * puff;
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
  }
  geometry.attributes.normal.needsUpdate = true;
  return { label, centres, radius };
}
