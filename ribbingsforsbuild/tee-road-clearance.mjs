/* Pure geometry used by both the Ribbingsfors compiler and its committed-model
   regression test. Distances are from a tee polygon to a road centreline; the
   caller subtracts the exact half-width used by the visible road ribbon. */

const EPSILON = 1e-9;

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length2 = dx * dx + dz * dz;
  const t = length2 > EPSILON
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2))
    : 0;
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(point, a, b) {
  return Math.abs(orientation(a, b, point)) <= EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  );
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function roadRenderHalfWidth(road) {
  const surface = road.surface || 'asphalt';
  if (road.kind === 'trunk') return road.oneway ? (road.lanes >= 2 ? 3.9 : 2.6) : 5;
  if (road.kind === 'secondary' || road.kind === 'tertiary') return 3.2;
  if (/gravel|ground|dirt|unpaved|compacted/.test(surface)) return 2.2;
  return 2.7;
}

export function ringToPolylineDistance(ring, line) {
  if (!Array.isArray(ring) || ring.length < 3 || !Array.isArray(line) || line.length < 2) return Infinity;
  let minimum = Infinity;
  for (let lineIndex = 0; lineIndex + 1 < line.length; lineIndex++) {
    const a = line[lineIndex], b = line[lineIndex + 1];
    if (pointInRing(a, ring) || pointInRing(b, ring)) return 0;
    for (let ringIndex = 0; ringIndex < ring.length; ringIndex++) {
      const c = ring[ringIndex], d = ring[(ringIndex + 1) % ring.length];
      minimum = Math.min(minimum, segmentDistance(a, b, c, d));
      if (minimum <= EPSILON) return 0;
    }
  }
  return minimum;
}

export function teeRoadClearance(ring, road) {
  return ringToPolylineDistance(ring, road.line) - roadRenderHalfWidth(road);
}

