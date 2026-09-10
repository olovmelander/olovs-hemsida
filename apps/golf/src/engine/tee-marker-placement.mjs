/* Decorative pairs fit the connected cross-section of an existing deck or
 * explicitly guide-associated fairway. A bounded inward display adjustment
 * can clear the sphere footprint; it never changes the source/camera reference
 * or establishes today's surveyed colour-marker positions. */
import { centroidOf, inRing, rightOf, ringSD } from './geom.js';

export function teeMarkerPlacement(hole, mark, { halfWidth = 2.6, edgeInset = 0.2, markerRadius = 0.15, maxDisplayShift = 1 } = {}) {
  const c = mark?.c;
  const omitted = (reason, detail = {}) => ({ positions: [], displayC: null, displayShiftM: null,
    maxDisplayShiftM: maxDisplayShift, reason, ...detail });
  if (mark?.orthophotoReference?.kind === 'unresolved-guide-tee-reference') return omitted('unresolved-guide-reference');
  if (!Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) ||
      !Number.isFinite(mark.b) || !Number.isFinite(halfWidth) || halfWidth <= 0 ||
      !Number.isFinite(edgeInset) || edgeInset <= 0 || !Number.isFinite(markerRadius) || markerRadius <= 0 ||
      !Number.isFinite(maxDisplayShift) || maxDisplayShift < 0) return omitted('invalid-reference-or-options');
  const direction = rightOf(mark.b * Math.PI / 180);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const crossSection = (anchor, axis, ring) => {
    let left = -Infinity, right = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const edge = [b[0] - a[0], b[1] - a[1]], relative = [a[0] - anchor[0], a[1] - anchor[1]];
      const denominator = cross(axis, edge);
      if (Math.abs(denominator) < 1e-10) continue;
      const t = cross(relative, edge) / denominator, u = cross(relative, axis) / denominator;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      if (t <= 0) left = Math.max(left, t);
      if (t >= 0) right = Math.min(right, t);
    }
    return [left, right];
  };
  const fitAt = (anchor, ring) => {
    if (ringSD(...anchor, ring) > -markerRadius) return null;
    const [left, right] = crossSection(anchor, direction, ring);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right - left <= 0.4) return null;
    const inset = Math.min(edgeInset, (right - left) / 4);
    const low = left + inset, high = right - inset;
    const clamp = value => Math.max(low, Math.min(high, value));
    const at = t => [anchor[0] + direction[0] * t, anchor[1] + direction[1] * t];
    const offsets = [clamp(-halfWidth), clamp(halfWidth)].map(offset => {
      if (ringSD(...at(offset), ring) <= -markerRadius) return offset;
      // Clear oblique edges by retreating along the same transverse axis.
      let safe = 0, outside = 1;
      for (let step = 0; step < 32; step++) {
        const fraction = (safe + outside) / 2;
        if (ringSD(...at(offset * fraction), ring) <= -markerRadius) safe = fraction;
        else outside = fraction;
      }
      return offset * safe;
    }), width = offsets[1] - offsets[0];
    if (offsets[0] >= -1e-6 || offsets[1] <= 1e-6 || width < 0.3) return null;
    const positions = offsets.map(at);
    if (!positions.every(p => inRing(...p, ring))) return null;
    return { positions, width };
  };
  const fairwayReference = mark.referenceSurfaceKind === 'fairway' &&
    mark.orthophotoReference?.kind === 'guide-orthophoto-reference';
  const surfaces = fairwayReference
    ? (hole.fairway?.rings || []).map(ring => ({ ring }))
    : hole.tees?.pads || [];
  let best = null, failure = omitted('reference-outside-nominated-surface');
  for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex++) {
    const pad = surfaces[surfaceIndex];
    if (!fairwayReference && mark.sourcePadId !== undefined && pad.id !== mark.sourcePadId && pad.reviewId !== mark.sourcePadId) continue;
    const ring = pad.ring;
    // Only already-contained references qualify for a display adjustment.
    if (!Array.isArray(ring) || ring.length < 3 || !inRing(...c, ring)) continue;
    const detail = { surfaceKind: fairwayReference ? 'fairway' : 'platform', surfaceIndex, padId: pad.id ?? pad.reviewId ?? null };
    let displayC = [...c], displayShiftM = 0, fit = fitAt(c, ring);
    if (!fit) {
      failure = omitted('insufficient-marker-clearance', detail);
      const centre = centroidOf(ring), distance = Math.hypot(centre[0] - c[0], centre[1] - c[1]);
      if (!centre.every(Number.isFinite) || !inRing(...centre, ring) || distance < 1e-9) continue;
      const inward = [(centre[0] - c[0]) / distance, (centre[1] - c[1]) / distance];
      // Stop at the first boundary: a concave deck cannot move an anchor across
      // rough to a disconnected cross-section on the way to its centroid.
      const [, exitDistance] = crossSection(c, inward, ring);
      const limit = Math.min(maxDisplayShift, distance, Math.max(0, exitDistance - 1e-7));
      const at = shift => [c[0] + inward[0] * shift, c[1] + inward[1] * shift];
      let previous = 0;
      for (let step = 1; step <= 32 && limit > 0; step++) {
        const shift = limit * step / 32, candidate = fitAt(at(shift), ring);
        if (!candidate) { previous = shift; continue; }
        // Refine the first fitting interval along this bounded inward path.
        let low = previous, high = shift;
        for (let iteration = 0; iteration < 20; iteration++) {
          const middle = (low + high) / 2;
          if (fitAt(at(middle), ring)) high = middle;
          else low = middle;
        }
        displayShiftM = high; displayC = at(high); fit = fitAt(displayC, ring);
        break;
      }
      if (!fit) {
        if (distance > maxDisplayShift && exitDistance > distance && fitAt(centre, ring)) {
          failure = omitted('display-inset-exceeds-limit', { ...detail, interiorAnchorWouldFit: true });
        }
        continue;
      }
    }
    if (!best || displayShiftM < best.displayShiftM - 1e-6 ||
        (Math.abs(displayShiftM - best.displayShiftM) <= 1e-6 && fit.width > best.width)) {
      best = { ...fit, displayC, displayShiftM, maxDisplayShiftM: maxDisplayShift,
        reason: displayShiftM ? 'inward-display-adjustment' : 'reference-cross-section', ...detail };
    }
  }
  if (!best) return failure;
  const { width, ...placement } = best;
  return placement;
}

export function teeMarkerPositions(hole, mark, options) {
  return teeMarkerPlacement(hole, mark, options).positions;
}
