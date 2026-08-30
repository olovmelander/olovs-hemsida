function dimension(value, label) {
  if (!Number.isSafeInteger(value) || value < 2 || value > 1025) {
    throw new RangeError(`${label} must be an integer from 2 to 1025`);
  }
  return value;
}

function boundaryVertices(width, height) {
  const result = [];
  for (let column = 0; column < width; column++) result.push([column, 0]);
  for (let row = 1; row < height; row++) result.push([width - 1, row]);
  for (let column = width - 2; column >= 0; column--) result.push([column, height - 1]);
  for (let row = height - 2; row > 0; row--) result.push([0, row]);
  return result;
}

/**
 * One immutable grid/index topology can render every tile with equal dimensions.
 * Surface vertices store integer texel coordinates in X/Z. Duplicate boundary
 * vertices carry Y=-1; the shader turns that marker into the last-resort skirt.
 */
export function createTerrainGridTopology({ width: requestedWidth, height: requestedHeight, skirts = true } = {}) {
  const width = dimension(requestedWidth, 'width');
  const height = dimension(requestedHeight, 'height');
  if (typeof skirts !== 'boolean') throw new TypeError('skirts must be boolean');
  const surfaceVertexCount = width * height;
  const boundary = skirts ? boundaryVertices(width, height) : [];
  const boundaryVertexCount = boundary.length;
  const vertexCount = surfaceVertexCount + boundaryVertexCount;
  const surfaceTriangles = (width - 1) * (height - 1) * 2;
  const skirtTriangles = boundaryVertexCount * 2;
  const triangleCount = surfaceTriangles + skirtTriangles;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Int8Array(vertexCount * 3);
  const IndexArray = vertexCount > 65_535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(triangleCount * 3);

  let vertex = 0;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++, vertex++) {
      positions[vertex * 3] = column;
      positions[vertex * 3 + 2] = row;
      normals[vertex * 3 + 1] = 127;
    }
  }
  for (const [column, row] of boundary) {
    positions[vertex * 3] = column;
    positions[vertex * 3 + 1] = -1;
    positions[vertex * 3 + 2] = row;
    normals[vertex * 3 + 1] = 127;
    vertex++;
  }

  let offset = 0;
  for (let row = 0; row < height - 1; row++) {
    for (let column = 0; column < width - 1; column++) {
      const northWest = row * width + column;
      const northEast = northWest + 1;
      const southWest = northWest + width;
      const southEast = southWest + 1;
      indices.set([
        northWest, southWest, northEast,
        northEast, southWest, southEast,
      ], offset);
      offset += 6;
    }
  }
  for (let index = 0; index < boundaryVertexCount; index++) {
    const next = (index + 1) % boundaryVertexCount;
    const top = boundary[index][1] * width + boundary[index][0];
    const topNext = boundary[next][1] * width + boundary[next][0];
    const bottom = surfaceVertexCount + index;
    const bottomNext = surfaceVertexCount + next;
    indices.set([top, topNext, bottom, topNext, bottomNext, bottom], offset);
    offset += 6;
  }

  return Object.freeze({
    width,
    height,
    skirts,
    surfaceVertexCount,
    boundaryVertexCount,
    vertexCount,
    surfaceTriangleCount: surfaceTriangles,
    skirtTriangleCount: skirtTriangles,
    triangleCount,
    positions,
    normals,
    indices,
    cpuBytes: positions.byteLength + normals.byteLength + indices.byteLength,
  });
}
