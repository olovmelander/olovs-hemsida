// Reversible integer prediction. No quantization: 65535 (no data), wraparound,
// tile borders and every original little-endian height sample survive exactly.
export function predictTerrain(payload, width) {
  const n = payload.byteLength / 2;
  if (!Number.isInteger(n) || !Number.isSafeInteger(width) || width < 1 || n % width) {
    throw new Error('invalid terrain predictor dimensions');
  }
  const source = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const result = new Uint8Array(payload.byteLength);
  for (let i = 0; i < n; i++) {
    const left = i % width ? source.getUint16((i - 1) * 2, true) : 0;
    const up = i >= width ? source.getUint16((i - width) * 2, true) : 0;
    const corner = i >= width && i % width ? source.getUint16((i - width - 1) * 2, true) : 0;
    const residual = ((source.getUint16(i * 2, true) - left - up + corner) << 16) >> 16;
    const zigzag = ((residual << 1) ^ (residual >> 15)) & 65535;
    result[i] = zigzag & 255;
    result[n + i] = zigzag >>> 8;
  }
  return result;
}

export function restoreTerrain(planes, width) {
  const n = planes.byteLength / 2;
  if (!Number.isInteger(n) || !Number.isSafeInteger(width) || width < 1 || n % width) {
    throw new Error('invalid terrain predictor dimensions');
  }
  const result = new Uint8Array(planes.byteLength);
  const view = new DataView(result.buffer);
  for (let i = 0; i < n; i++) {
    const zigzag = planes[i] | planes[n + i] << 8;
    const residual = (zigzag >>> 1) ^ -(zigzag & 1);
    const left = i % width ? view.getUint16((i - 1) * 2, true) : 0;
    const up = i >= width ? view.getUint16((i - width) * 2, true) : 0;
    const corner = i >= width && i % width ? view.getUint16((i - width - 1) * 2, true) : 0;
    view.setUint16(i * 2, residual + left + up - corner, true);
  }
  return result;
}
