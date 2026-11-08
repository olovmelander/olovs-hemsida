/* WATER IN THE DITCHES AND STREAMS (8 November, owner request: "fix the water in all
   ponds, ditches, trenches, waterholes, lakes").

   Every course's pack carries its ditches and streams as lines with a width (12 of 13
   layouts, up to 35 km at Veckefjarden), and the detailed course drew no water in any
   of them: the laser's 1 m ground shows each as a dry trench. The map strokes them.

   This reads each channel off the same ground the sheet stands on. Every `step` metres
   along the line it looks across it for the channel's floor (the lowest ground within
   the line's half-width plus `searchMetres`: a traced line is often a metre off the
   cut) and its banks. Water stands `depth` above the floor -- a share of how deep the
   cut is, between `minimumDepthMetres` and `maximumDepthMetres` -- and spreads across
   to where the ground rises above it, then runs `tuckMetres` under the banks so the
   terrain draws its edges. No water is drawn:
   - where the laser shows no cut channel (banks under `minimumCutMetres` above the
     floor: a ditch piped, filled or too narrow for the ground to hold);
   - where the floor jumps up out of its neighbours by more than `crossingMetres` (a
     culvert under a road or a path: the road stays dry);
   - on runs shorter than `minimumRunSamples`;
   - where `inLake(x, z)` says a lake's own water and carved bed are there: a ditch
     that runs into a pond becomes the pond, and the ground under it is the lake's bed.

   The ribbons are one geometry for the whole course, drawn by the lakes' own water
   (water-shading.mjs). Their shore distance is scaled by `fadeScale`, so a metre-wide
   ditch fades in across its own edges as a lake does across its 2.5 m. ?ditches=0 is the
   before. */
export const STREAM_WATER = Object.freeze({
  stepMetres: 2,
  searchMetres: 1.5,
  bankMetres: 3,
  acrossStepMetres: 0.5,
  minimumCutMetres: 0.25,
  depthShare: 0.3,
  minimumDepthMetres: 0.06,
  maximumDepthMetres: 0.18,
  crossingMetres: 0.3,
  tuckMetres: 0.4,
  minimumRunSamples: 3,
  fadeScale: 10,
});

const median5 = (a, i) => {
  const w = [];
  for (let k = Math.max(0, i - 2); k <= Math.min(a.length - 1, i + 2); k++) if (Number.isFinite(a[k])) w.push(a[k]);
  w.sort((m, n) => m - n);
  return w.length ? w[w.length >> 1] : NaN;
};

/** The channel along one line: [{ x, z, nx, nz, floor, surface, left, right, wet }]. */
export function readChannel(line, width, heightAt, options = {}, inLake = null) {
  const o = { ...STREAM_WATER, ...options };
  const half = Math.max(0.3, (Number.isFinite(width) ? width : 1.5) / 2);
  const samples = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(L > 0)) continue;
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = -tz, nz = tx;
    const last = i + 2 === line.length;
    for (let s = 0; s < L || (last && s <= L + 1e-9); s += o.stepMetres) {
      const t = Math.min(s, L);
      const x = a[0] + tx * t, z = a[1] + tz * t;
      let floor = Infinity, bank = -Infinity;
      const across = [];
      for (let d = -(half + o.bankMetres); d <= half + o.bankMetres + 1e-9; d += o.acrossStepMetres) {
        const h = heightAt(x + nx * d, z + nz * d);
        if (!Number.isFinite(h)) continue;
        if (Math.abs(d) <= half + o.searchMetres) { across.push([d, h]); if (h < floor) floor = h; }
        if (Math.abs(d) >= half + o.searchMetres) bank = Math.max(bank, h);
      }
      /* the middle of the floor, not its first low sample: a flat-bottomed cut */
      let lo = Infinity, hi = -Infinity;
      for (const [d, h] of across) if (h <= floor + 0.03) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
      const at = Number.isFinite(lo) ? (lo + hi) / 2 : 0;
      samples.push({ x: x + nx * at, z: z + nz * at, nx, nz, floor: Number.isFinite(floor) ? floor : NaN, cut: bank - floor });
      if (s >= L) break;
    }
  }
  const floors = samples.map(s => s.floor);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const base = median5(floors, i);
    const crossing = s.floor - base > o.crossingMetres;
    const depth = Math.min(o.maximumDepthMetres, Math.max(o.minimumDepthMetres, o.depthShare * s.cut));
    s.surface = base + depth;
    s.wet = Number.isFinite(s.floor) && Number.isFinite(s.cut) && s.cut >= o.minimumCutMetres && !crossing
      && !(inLake && inLake(s.x, s.z));
    if (!s.wet) continue;
    /* across: to where the ground rises over the water, each side */
    const reach = side => {
      let d = 0, previous = s.floor;
      for (let k = o.acrossStepMetres; k <= half + o.searchMetres + o.bankMetres; k += o.acrossStepMetres) {
        const h = heightAt(s.x + s.nx * side * k, s.z + s.nz * side * k);
        if (!Number.isFinite(h)) break;
        if (h > s.surface) {
          /* where the bank crosses the water, between this step and the last */
          d += o.acrossStepMetres * Math.max(0, Math.min(1, (s.surface - previous) / Math.max(1e-6, h - previous)));
          break;
        }
        d = k; previous = h;
      }
      return Math.max(o.acrossStepMetres / 2, d);
    };
    s.left = reach(-1); s.right = reach(1);
  }
  /* runs too short to read as water are dropped */
  let start = 0;
  for (let i = 0; i <= samples.length; i++) {
    if (i < samples.length && samples[i].wet) continue;
    if (i - start < o.minimumRunSamples) for (let k = start; k < i; k++) samples[k].wet = false;
    start = i + 1;
  }
  return samples;
}

/**
 * One geometry for every stream: positions, aShore, aDepth and indices, strips of three
 * vertices across (bank, centre, bank) joined between wet neighbours. `heightAt` is the
 * ground the terrain draws. Returns { positions, shore, depth, indices, metres, runs }.
 */
export function buildStreamWater(streams, heightAt, options = {}, inLake = null) {
  const o = { ...STREAM_WATER, ...options };
  const positions = [], shore = [], depth = [], indices = [];
  let metres = 0, runs = 0;
  for (const stream of streams ?? []) {
    if (!(stream?.line?.length >= 2)) continue;
    const samples = readChannel(stream.line, stream.w ?? stream.widthMetres, heightAt, o, inLake);
    let previous = -1;
    for (let k = 0; k < samples.length; k++) {
      const s = samples[k];
      if (!s.wet) { previous = -1; continue; }
      const base = positions.length / 3;
      /* a run's two ends taper to nothing, so a ditch's water begins and ends, not cuts off */
      const end = previous < 0 || !samples[k + 1]?.wet;
      const taper = end ? 0.35 : 1;
      const left = s.left * taper + o.tuckMetres, right = s.right * taper + o.tuckMetres;
      positions.push(s.x - s.nx * left, s.surface, s.z - s.nz * left, s.x, s.surface, s.z, s.x + s.nx * right, s.surface, s.z + s.nz * right);
      shore.push(0, end ? 0 : Math.min(s.left, s.right) * o.fadeScale, 0);
      for (const [px, pz] of [[s.x - s.nx * left, s.z - s.nz * left], [s.x, s.z], [s.x + s.nx * right, s.z + s.nz * right]]) {
        const h = heightAt(px, pz);
        depth.push(Number.isFinite(h) ? Math.min(3, Math.max(0, s.surface - h)) : 0);
      }
      if (previous >= 0) {
        indices.push(previous, base, previous + 1, previous + 1, base, base + 1);
        indices.push(previous + 1, base + 1, previous + 2, previous + 2, base + 1, base + 2);
        metres += o.stepMetres;
      } else runs++;
      previous = base;
    }
  }
  return { positions: Float32Array.from(positions), shore: Float32Array.from(shore), depth: Float32Array.from(depth),
    indices: indices.length > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices), metres, runs };
}
