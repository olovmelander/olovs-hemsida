/* THE GROUND'S OWN LIGHT, BAKED. The v2 terrain lost what the ring meshes
   carried per vertex: how much of the sky a point sees (horizonAO in main.js,
   six directions at 14 and 46 m against the elevation model). A hollow and the
   foot of a slope stood as bright as an open shoulder, and open ground beside a
   wall of forest as bright as a fairway's middle. A painter sets the land's
   form down in exactly those tones: sheltered ground darker and lusher, exposed
   crests drier and paler.

   One signed number per tint cell carries it, in the raster's alpha, which
   always stood at 255: 128 + 127 s, s from -1 fully sheltered through 0 open
   to +1 a fully exposed crest.
   Shelter is the ring meshes' own horizon occlusion, or -- on open ground --
   the share of forest round the cell, whichever is more; exposure is how far the
   cell stands above the mean of the ground round it. How open a cell is, is the
   share of forest in the 3 x 3 cells round it, never its one canopy sample: the
   canopy raster is 3 m and a 6 m cell point-sampling it would darken every
   gap in a wood on its own, the salt and pepper canopyOpenFraction (main.js)
   was written against. The RGB beside it is not touched, so the tint's colours
   are exactly the ones they were, and the ground material decides what the
   number does (ground-material-core.mjs).

   All of it is reckoned on the raster's own grid of heights, one height per
   cell -- the colour pass already reads it -- with sums over boxes and
   bilinear taps, so a 513 x 513 layer costs tens of milliseconds, not a second
   of elevation lookups. */
export const GROUND_RELIEF = Object.freeze({
  /* the ring meshes' horizon occlusion: six directions, a near and a far radius, and its slope gain */
  directions: 6, radiiMetres: [14, 46], slopeGain: 2.4,
  /* a crest this many metres above the mean ground round it is fully exposed; below the first, not at all */
  crestMetres: [0.4, 3.0], crestWindowMetres: 30,
  /* forest within this distance shelters open ground; at most this share of it counts */
  forestMetres: 18, forestShelter: 0.8,
});

/** The signed relief (-1 sheltered .. +1 exposed) of every cell as a byte: 128 + 127 s. */
export function groundReliefBytes({ heights, forest = null, n, dx, skip = null }) {
  const R = GROUND_RELIEF;
  /* the radii grow with a coarse raster, so a 24 m layer still sees its hills */
  const radii = R.radiiMetres.map((r, i) => Math.max(r, dx * (i ? 6 : 2)));
  const window = Math.max(1, Math.round(Math.max(R.crestWindowMetres, dx * 5) / dx));
  const reach = Math.max(1, Math.round(Math.max(R.forestMetres, dx) / dx));
  const at = (i, j) => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  const bilinear = (fx, fz) => {
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
  const boxSums = values => {
    const w = n + 1, sums = new Float64Array(w * w);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
      sums[(j + 1) * w + i + 1] = values[j * n + i] + sums[j * w + i + 1] + sums[(j + 1) * w + i] - sums[j * w + i];
    return (i, j, r) => {
      const i0 = Math.max(0, i - r), j0 = Math.max(0, j - r), i1 = Math.min(n, i + r + 1), j1 = Math.min(n, j + r + 1);
      return (sums[j1 * w + i1] - sums[j0 * w + i1] - sums[j1 * w + i0] + sums[j0 * w + i0]) / ((i1 - i0) * (j1 - j0));
    };
  };
  const meanHeight = boxSums(heights);
  const meanForest = forest ? boxSums(forest) : null;
  const dirs = Array.from({ length: R.directions }, (_, k) => [Math.cos(k / R.directions * 2 * Math.PI), Math.sin(k / R.directions * 2 * Math.PI)]);
  const out = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (skip && skip[k]) { out[k] = 128; continue; }
    const h = heights[k];
    let occ = 0;
    for (const [cx, cz] of dirs) {
      let m = 0;
      for (const r of radii) {
        const s = (bilinear(i + cx * r / dx, j + cz * r / dx) - h) / r;
        if (s > m) m = s;
      }
      occ += Math.min(1, m * R.slopeGain);
    }
    const occlusion = occ / R.directions;
    const woods = forest ? meanForest(i, j, reach) * (1 - meanForest(i, j, 1)) * R.forestShelter : 0;
    const rise = h - meanHeight(i, j, window);
    const t = Math.min(1, Math.max(0, (rise - R.crestMetres[0]) / (R.crestMetres[1] - R.crestMetres[0])));
    const exposure = t * t * (3 - 2 * t);
    const s = Math.max(-1, Math.min(1, exposure - Math.max(occlusion, woods)));
    out[k] = Math.round(128 + 127 * s);
  }
  return out;
}

/** The signed relief a byte carries (the ground material's own reading of the alpha). */
export const reliefOfByte = byte => Math.max(-1, (byte - 128) / 127);
