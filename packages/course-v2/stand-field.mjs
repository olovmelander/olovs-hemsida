/* The measured stand field: what dense forest is published as.

   Where crowns cannot be told apart the vegetation plan forbids inventing
   individual trees, so a tile carries a small raster instead -- per 4 m cell,
   how much of it is canopy, how tall that canopy is on average and at its
   95th percentile, which campaign measured it, and whether it is excluded or
   unmeasured. The renderer draws representative trees from it, labelled as
   such; nothing in it is a stem. Four bytes per cell, so a 256 m tile is
   16 KiB decoded and a few KiB encoded.

   Byte 0  canopy fraction, unorm8 (0..255 -> 0..1)
   Byte 1  mean canopy height, 0.25 m steps (0..63.75 m)
   Byte 2  95th-percentile canopy height, 0.25 m steps
   Byte 3  flags: bit 0 measured, bit 1 campaign (1 = north/east of the seam),
                  bit 2 excluded (never plant), bits 3-7 reserved zero         */

export const STAND_FIELD_FORMAT = 'stand-field-u8-v1';
export const STAND_FIELD_FEATURE = 'stand-field-u8-v1';
export const STAND_FIELD_BYTES_PER_SAMPLE = 4;
export const STAND_FIELD_HEIGHT_SCALE_METRES = 0.25;
export const STAND_FIELD_CHANNELS = Object.freeze(['canopyFraction', 'meanHeight', 'p95Height', 'flags']);
export const STAND_FLAG_MEASURED = 1;
export const STAND_FLAG_NORTH_CAMPAIGN = 2;
export const STAND_FLAG_EXCLUDED = 4;

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || width < 1 || width > 4096 || !Number.isSafeInteger(height) || height < 1 || height > 4096) {
    throw new RangeError('stand field width and height must be integers from 1 to 4096');
  }
  return width * height;
}

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('payload must be an ArrayBuffer or Uint8Array');
}

export function standFieldHeaderSection({ width, height, cellMetres }) {
  dimensions(width, height);
  if (!Number.isFinite(cellMetres) || cellMetres <= 0) throw new RangeError('cellMetres must be positive');
  return Object.freeze({
    width,
    height,
    cellMetres,
    bytesPerSample: STAND_FIELD_BYTES_PER_SAMPLE,
    channels: [...STAND_FIELD_CHANNELS],
    fractionEncoding: 'unorm8',
    heightScaleMetres: STAND_FIELD_HEIGHT_SCALE_METRES,
    rowOrder: 'north-to-south',
    columnOrder: 'west-to-east',
    standRegistryVersion: 1,
  });
}

/**
 * Encode a field. Inputs are per-cell arrays of `width * height`: fraction
 * (0..1, NaN where unmeasured), meanHeight and p95Height in metres (NaN where
 * no canopy), measured (0/1), north (0/1), excluded (0/1).
 */
export function encodeStandField({ width, height, cellMetres, fraction, meanHeight, p95Height, measured, north, excluded }) {
  const count = dimensions(width, height);
  for (const [name, array] of Object.entries({ fraction, meanHeight, p95Height, measured, north, excluded })) {
    if (!array || array.length !== count) throw new RangeError(`${name} must hold ${count} samples`);
  }
  const payload = new Uint8Array(count * STAND_FIELD_BYTES_PER_SAMPLE);
  const quantize = value => (Number.isNaN(value) ? 0 : Math.max(0, Math.min(255, Math.round(value / STAND_FIELD_HEIGHT_SCALE_METRES))));
  for (let i = 0; i < count; i++) {
    const o = i * STAND_FIELD_BYTES_PER_SAMPLE;
    const isMeasured = measured[i] ? 1 : 0;
    payload[o] = isMeasured && !Number.isNaN(fraction[i]) ? Math.max(0, Math.min(255, Math.round(fraction[i] * 255))) : 0;
    payload[o + 1] = isMeasured ? quantize(meanHeight[i]) : 0;
    payload[o + 2] = isMeasured ? quantize(p95Height[i]) : 0;
    payload[o + 3] = (isMeasured ? STAND_FLAG_MEASURED : 0) | (north[i] ? STAND_FLAG_NORTH_CAMPAIGN : 0) | (excluded[i] ? STAND_FLAG_EXCLUDED : 0);
  }
  return { payload, standField: standFieldHeaderSection({ width, height, cellMetres }) };
}

export function decodeStandField(payload, standField) {
  const bytes = byteView(payload);
  const count = dimensions(standField.width, standField.height);
  if (bytes.byteLength !== count * STAND_FIELD_BYTES_PER_SAMPLE) {
    throw new RangeError(`stand field payload has ${bytes.byteLength} bytes; expected ${count * STAND_FIELD_BYTES_PER_SAMPLE}`);
  }
  if (standField.rowOrder !== 'north-to-south' || standField.columnOrder !== 'west-to-east') {
    throw new Error('unsupported stand field axis order');
  }
  const scale = standField.heightScaleMetres ?? STAND_FIELD_HEIGHT_SCALE_METRES;
  const fraction = new Float32Array(count);
  const meanHeight = new Float32Array(count);
  const p95Height = new Float32Array(count);
  const flags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * STAND_FIELD_BYTES_PER_SAMPLE;
    fraction[i] = bytes[o] / 255;
    meanHeight[i] = bytes[o + 1] * scale;
    p95Height[i] = bytes[o + 2] * scale;
    flags[i] = bytes[o + 3];
  }
  return { width: standField.width, height: standField.height, cellMetres: standField.cellMetres, fraction, meanHeight, p95Height, flags };
}

/** Validation and the counts a loader reports; throws on a malformed payload. */
export function inspectStandFieldPayload(payload, header) {
  const section = header?.standField;
  if (!section) throw new Error('stand field header section is required');
  const decoded = decodeStandField(payload, section);
  let measured = 0;
  let closed = 0;
  let excluded = 0;
  let north = 0;
  let heightSum = 0;
  let heightCount = 0;
  for (let i = 0; i < decoded.flags.length; i++) {
    const flag = decoded.flags[i];
    if (flag & ~(STAND_FLAG_MEASURED | STAND_FLAG_NORTH_CAMPAIGN | STAND_FLAG_EXCLUDED)) {
      throw new Error(`stand field cell ${i} carries reserved flag bits`);
    }
    if (flag & STAND_FLAG_MEASURED) measured++;
    else if (decoded.fraction[i] !== 0 || decoded.meanHeight[i] !== 0) throw new Error(`stand field cell ${i} is unmeasured but carries values`);
    if (flag & STAND_FLAG_EXCLUDED) excluded++;
    if (flag & STAND_FLAG_NORTH_CAMPAIGN) north++;
    if ((flag & STAND_FLAG_MEASURED) && decoded.fraction[i] >= 0.5) { closed++; heightSum += decoded.meanHeight[i]; heightCount++; }
  }
  return Object.freeze({
    cells: decoded.flags.length,
    measuredCells: measured,
    closedCanopyCells: closed,
    excludedCells: excluded,
    northCampaignCells: north,
    meanClosedCanopyHeightMetres: heightCount ? Math.round((heightSum / heightCount) * 1000) / 1000 : null,
  });
}
