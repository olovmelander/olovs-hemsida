import assert from 'node:assert/strict';
import test from 'node:test';
import { croppedFromSquare, publishedItemExtent } from './ring-item-extent.mjs';

/* Visby's two items: 10 km squares whose rasters are clipped 5,000 m off the
   WEST edge, which is the case that used to throw. */
const visbyNorth = { id: '637_68', minEasting: 680000, maxEasting: 690000, minNorthing: 6370000, maxNorthing: 6380000 };
const visbyNorthCog = { originX: 685000, originY: 6380000, width: 5000, height: 10000, pixelScaleX: 1, pixelScaleY: 1 };

test('a west-cropped coastal item publishes a sub-rectangle of its square', () => {
  const published = publishedItemExtent(visbyNorthCog, visbyNorth);
  assert.deepEqual({ ...published }, { minEasting: 685000, maxNorthing: 6380000, maxEasting: 690000, minNorthing: 6370000 });
  assert.deepEqual({ ...croppedFromSquare(published, visbyNorth) }, { west: 5000, east: 0, north: 0, south: 0 });
});

test('an inland item filling its whole square is unchanged', () => {
  const item = { id: '658_67', minEasting: 670000, maxEasting: 680000, minNorthing: 6580000, maxNorthing: 6590000 };
  const published = publishedItemExtent({ originX: 670000, originY: 6590000, width: 10000, height: 10000, pixelScaleX: 1, pixelScaleY: 1 }, item);
  assert.deepEqual({ ...croppedFromSquare(published, item) }, { west: 0, east: 0, north: 0, south: 0 });
});

/* Norrfällsviken's shape: clipped on the south and east, so its north-west
   corner survives. This is the case the old equality assertion accepted, and
   it must keep working. */
test('a south-and-east-cropped coastal item keeps its north-west corner', () => {
  const item = { id: '698_68', minEasting: 680000, maxEasting: 690000, minNorthing: 6980000, maxNorthing: 6990000 };
  const published = publishedItemExtent({ originX: 680000, originY: 6990000, width: 7500, height: 7500, pixelScaleX: 1, pixelScaleY: 1 }, item);
  assert.deepEqual({ ...croppedFromSquare(published, item) }, { west: 0, east: 2500, north: 0, south: 2500 });
});

test('a raster escaping its square is refused, naming what it published', () => {
  assert.throws(() => publishedItemExtent({ ...visbyNorthCog, originX: 679000 }, visbyNorth),
    /637_68 publishes 679000,.* which is not inside its item square/);
  assert.throws(() => publishedItemExtent({ ...visbyNorthCog, width: 12000 }, visbyNorth),
    /not inside its item square/);
});

/* The offset test has to stay INSIDE the square, or containment fires first
   and proves nothing about the lattice. Half a metre east with the width
   shortened to match is the real shape of a half-sample slip. */
test('a raster offset by a fraction of a sample is refused rather than rounded', () => {
  assert.throws(() => publishedItemExtent({ ...visbyNorthCog, originX: 685000.5, width: 4999 }, visbyNorth),
    /minEasting is offset 5000.5 m from its square, which is not a whole number of samples/);
  assert.throws(() => publishedItemExtent({ ...visbyNorthCog, originY: 6379999.5, height: 9999.5 }, visbyNorth),
    /maxNorthing is offset 0.5 m from its square/);
});
