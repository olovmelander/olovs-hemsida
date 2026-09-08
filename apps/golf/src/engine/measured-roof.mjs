/* Dated roof surfaces already contain absolute RH 2000 elevations. They are
 * neither eave heights nor offsets above the ground. Partial meshes preserve
 * their gaps and only explicitly supported perimeter segments produce walls. */
export function measuredRoofGeometry(surface, terrainH) {
  if (surface?.verticalCrs !== 'EPSG:5613' || !Array.isArray(surface.vertices) ||
      !Array.isArray(surface.triangleIndices) || surface.triangleIndices.length % 3 ||
      !Array.isArray(surface.boundaryWallSegments)) throw new Error('Invalid measured roof geometry');
  const point = v => {
    if (!Array.isArray(v?.c) || v.c.length !== 2 || !v.c.every(Number.isFinite) || !Number.isFinite(v.heightRH2000)) {
      throw new Error('Measured roof requires local horizontal pairs and absolute RH 2000 heights');
    }
    return [v.c[0], v.heightRH2000, v.c[1]];
  };
  const vertices = surface.vertices.map(point), triangles = [];
  for (let i = 0; i < surface.triangleIndices.length; i += 3) {
    const ids = surface.triangleIndices.slice(i, i + 3);
    if (ids.some(id => !Number.isInteger(id) || id < 0 || id >= vertices.length) || new Set(ids).size !== 3) {
      throw new Error('Invalid measured roof triangle indices');
    }
    const [a, b, c] = ids.map(id => vertices[id]);
    const up = (b[2]-a[2])*(c[0]-a[0]) - (b[0]-a[0])*(c[2]-a[2]);
    if (Math.abs(up) < 1e-9) throw new Error('Degenerate measured roof triangle');
    triangles.push(up > 0 ? [a, b, c] : [a, c, b]);
  }
  const walls = surface.boundaryWallSegments.map(segment => {
    if (!Array.isArray(segment) || segment.length !== 2) throw new Error('Invalid measured roof wall segment');
    const [a, b] = segment.map(point);
    const ay = terrainH(a[0], a[2]), by = terrainH(b[0], b[2]);
    if (![ay, by].every(Number.isFinite) || ay >= a[1] || by >= b[1]) throw new Error('Measured roof wall has no finite clearance above terrain');
    return [[a[0], ay, a[2]], [b[0], by, b[2]], b, a];
  });
  return { triangles, walls };
}
