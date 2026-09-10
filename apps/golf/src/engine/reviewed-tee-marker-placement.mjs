/* Reviewed tee colours can share a reference point without sharing the same
 * decorative balls. Their bounded display layout never changes source or
 * camera coordinates, and only uses the surface nominated by each reference. */
import { inRing } from './geom.js';
import { teeMarkerPositions } from './tee-marker-placement.mjs';

export function reviewedTeeMarkerPositions(hole, mark) {
  if (hole?.tees?.markerLayout !== 'separate-reviewed-colours') return teeMarkerPositions(hole, mark);
  const marks = hole.tees.marks || [], target = marks.indexOf(mark);
  // Array membership establishes colour order even for otherwise equal marks.
  if (target < 0) return [];
  const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  const validRing = ring => Array.isArray(ring) && ring.length >= 3 && ring.every(point);
  const offsets = [0, .6, -.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3, -3];
  const previous = [];
  for (let index = 0; index <= target; index++) {
    const reference = marks[index];
    let accepted = [];
    if (point(reference?.c) && Number.isFinite(reference.b) &&
        reference.orthophotoReference?.kind !== 'unresolved-guide-tee-reference') {
      const guide = reference.orthophotoReference?.kind === 'guide-orthophoto-reference';
      const fairway = reference.referenceSurfaceKind === 'fairway' && guide;
      const mown = reference.referenceSurfaceKind === 'mown-ground';
      const eligible = mown
        ? (guide && validRing(reference.referenceSurfaceRing)
          ? [{ id: reference.sourcePadId ?? 'reviewed-mown-ground', ring: reference.referenceSurfaceRing }] : [])
        : fairway
          ? (hole.fairway?.rings || []).map(ring => ({ ring }))
          : (hole.tees.pads || []).filter(pad => reference.sourcePadId === undefined ||
              pad.id === reference.sourcePadId || pad.reviewId === reference.sourcePadId);
      const surfaces = eligible.filter(surface => validRing(surface.ring) && inRing(...reference.c, surface.ring));
      const bearing = reference.b * Math.PI / 180, forward = [Math.sin(bearing), Math.cos(bearing)];
      const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
      // Bound each trial to the connected cross-section through the original
      // reference: moving a colour cannot jump a gap into another turf island.
      const intervals = surfaces.map(surface => {
        let low = -Infinity, high = Infinity;
        for (let i = 0; i < surface.ring.length; i++) {
          const a = surface.ring[i], b = surface.ring[(i + 1) % surface.ring.length];
          const edge = [b[0] - a[0], b[1] - a[1]], relative = [a[0] - reference.c[0], a[1] - reference.c[1]];
          const denominator = cross(forward, edge);
          if (Math.abs(denominator) < 1e-10) continue;
          const t = cross(relative, edge) / denominator, u = cross(relative, forward) / denominator;
          if (u < -1e-9 || u > 1 + 1e-9) continue;
          if (t <= 0) low = Math.max(low, t);
          if (t >= 0) high = Math.min(high, t);
        }
        return { surface, low, high };
      });
      for (const offset of offsets) {
        const available = intervals.filter(({ low, high }) => offset >= low && offset <= high).map(({ surface }) => surface);
        if (!available.length) continue;
        const candidate = { ...reference, c: [reference.c[0] + forward[0] * offset, reference.c[1] + forward[1] * offset] };
        const proxy = fairway
          ? { ...hole, fairway: { ...hole.fairway, rings: available.map(surface => surface.ring) } }
          : { ...hole, tees: { ...hole.tees, pads: available } };
        if (mown) delete candidate.referenceSurfaceKind;
        // The shared helper may inset a pair by up to one metre. Reserve that
        // distance within the same three-metre total display-adjustment bound.
        const pair = teeMarkerPositions(proxy, candidate, { maxDisplayShift: Math.min(1, 3 - Math.abs(offset)) });
        if (pair.length === 2 && pair.every(p => previous.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= .35))) {
          accepted = pair;
          break;
        }
      }
    }
    if (index === target) return accepted;
    previous.push(...accepted);
  }
  return [];
}
