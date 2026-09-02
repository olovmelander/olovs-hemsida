import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAND_FLAG_EXCLUDED,
  STAND_FLAG_MEASURED,
  STAND_FLAG_NORTH_CAMPAIGN,
  decodeStandField,
  encodeStandField,
  inspectStandFieldPayload,
  standFieldHeaderSection,
} from './stand-field.mjs';

function field() {
  const width = 3;
  const height = 2;
  return {
    width, height, cellMetres: 4,
    fraction: Float32Array.from([1, 0.5, 0, Number.NaN, 0.25, 0.75]),
    meanHeight: Float32Array.from([12.3, 8, 0, Number.NaN, 4, 20.126]),
    p95Height: Float32Array.from([15, 9, 0, Number.NaN, 5, 30]),
    measured: Uint8Array.from([1, 1, 1, 0, 1, 1]),
    north: Uint8Array.from([1, 1, 1, 0, 0, 0]),
    excluded: Uint8Array.from([0, 0, 0, 0, 1, 0]),
  };
}

test('a field round-trips through four bytes per cell at 0.25 m and 1/255 resolution', () => {
  const { payload, standField } = encodeStandField(field());
  assert.equal(payload.length, 24);
  assert.deepEqual(standField, standFieldHeaderSection({ width: 3, height: 2, cellMetres: 4 }));
  const decoded = decodeStandField(payload, standField);
  assert.ok(Math.abs(decoded.fraction[0] - 1) < 1e-6);
  assert.ok(Math.abs(decoded.fraction[1] - 0.5) < 0.003);
  assert.equal(decoded.meanHeight[0], 12.25);
  assert.equal(decoded.meanHeight[5], 20.25);
  assert.equal(decoded.p95Height[5], 30);
  assert.equal(decoded.flags[0], STAND_FLAG_MEASURED | STAND_FLAG_NORTH_CAMPAIGN);
  assert.equal(decoded.flags[3], 0, 'an unmeasured cell carries nothing');
  assert.equal(decoded.fraction[3], 0);
  assert.equal(decoded.flags[4], STAND_FLAG_MEASURED | STAND_FLAG_EXCLUDED);
  const inspection = inspectStandFieldPayload(payload, { standField });
  assert.deepEqual(inspection, {
    cells: 6, measuredCells: 5, closedCanopyCells: 3, excludedCells: 1, northCampaignCells: 3,
    meanClosedCanopyHeightMetres: Math.round(((12.25 + 8 + 20.25) / 3) * 1000) / 1000,
  });
});

test('malformed payloads are refused', () => {
  const { payload, standField } = encodeStandField(field());
  assert.throws(() => decodeStandField(payload.subarray(0, 20), standField), /expected 24/);
  assert.throws(() => inspectStandFieldPayload(payload, {}), /header section/);
  const reserved = Uint8Array.from(payload);
  reserved[3] |= 0x80;
  assert.throws(() => inspectStandFieldPayload(reserved, { standField }), /reserved flag/);
  const ghost = Uint8Array.from(payload);
  ghost[12] = 40;
  assert.throws(() => inspectStandFieldPayload(ghost, { standField }), /unmeasured but carries values/);
  assert.throws(() => encodeStandField({ ...field(), fraction: new Float32Array(2) }), /must hold 6/);
  assert.throws(() => standFieldHeaderSection({ width: 0, height: 1, cellMetres: 4 }), /integers/);
});
