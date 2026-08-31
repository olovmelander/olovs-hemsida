const RGBA8_BYTES_PER_PIXEL = 4;
const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;
const MAX_CAPTURE_PIXELS = 4096 * 4096;

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > MAX_CAPTURE_PIXELS) {
    throw new RangeError('RGBA8 readback dimensions are invalid or exceed the capture budget');
  }
  return Object.freeze({
    rowBytes: width * RGBA8_BYTES_PER_PIXEL,
    pixelBytes: width * height * RGBA8_BYTES_PER_PIXEL,
  });
}

/** Three r185 exposes WebGPU's mapped copy buffer directly. Its rows are
    256-byte aligned except that the final row has no trailing padding. Convert
    only that exact layout to browser ImageData; any other byte count remains a
    fail-closed renderer error. */
export function contiguousRgba8Readback(readback, width, height) {
  if (!(readback instanceof Uint8Array)) throw new TypeError('RGBA8 readback must be a Uint8Array');
  const { rowBytes, pixelBytes } = dimensions(width, height);
  if (readback.byteLength === pixelBytes) return readback;
  const paddedRowBytes = Math.ceil(rowBytes / WEBGPU_BYTES_PER_ROW_ALIGNMENT) *
    WEBGPU_BYTES_PER_ROW_ALIGNMENT;
  const paddedBytes = (height - 1) * paddedRowBytes + rowBytes;
  if (readback.byteLength !== paddedBytes || paddedRowBytes === rowBytes) {
    throw new Error(`unexpected app WebGPU readback size ${readback.byteLength}`);
  }
  const pixels = new Uint8Array(pixelBytes);
  for (let row = 0; row < height; row++) {
    const source = row * paddedRowBytes;
    pixels.set(readback.subarray(source, source + rowBytes), row * rowBytes);
  }
  return pixels;
}

