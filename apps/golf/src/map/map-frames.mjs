/* Where a course's drawn geometry lands on its 1 m height tiles.

   A GPK1 pack and the v2 terrain are not in the same frame. Six grounds are
   authored in a true-north flat-earth frame about their own origin, and up to
   a 3.28 degree rotation separates that from the EPSG:3006 grid the tiles are
   cut on (82.6 m at Veckefjärden's far corner). The four grid-authored grounds
   only differ by a translation.

   These numbers are copied here rather than imported for the reason
   gps-projected-frames.mjs gives: the reviewed configs are behind a dynamic
   import of the whole registry, and the map must not download the registry to
   place a green. map-frames.test.mjs asserts every field against the reviewed
   configs, so a drifted or newly published ground fails loudly. */
import { legacyGridBridge } from '../engine/geodetic-frame.mjs';

const legacy = (frameFingerprint, easting, northing, latitude, longitude, metresPerLongitude, verticalDatumOffsetMetres) => Object.freeze({
  bridgeMode: 'wgs84-legacy-frame',
  frameFingerprint,
  legacyOriginEpsg3006: Object.freeze({ easting, northing }),
  legacyFrame: Object.freeze({ latitude, longitude, metresPerLatitude: 111320, metresPerLongitude }),
  verticalDatumOffsetMetres,
});
const grid = (frameFingerprint, easting, northing) => Object.freeze({
  bridgeMode: 'epsg3006-local-rh2000',
  frameFingerprint,
  legacyOriginEpsg3006: Object.freeze({ easting, northing }),
  legacyFrame: null,
  verticalDatumOffsetMetres: 0,
});

export const MAP_GROUND_FRAMES = Object.freeze({
  angso: legacy('bfc6a0f04badb8e31cd874bc28e58ed679dd591164d8cb9a96ca9a96209b9318', 605689.962, 6605447.157, 59.5739, 16.871, 56375.41058837328, 0),
  johannesberg: legacy('3b6db48a9134351129c33ee0e167aa1f5a295f9724f1e3a42ab797a2153209d4', 679460.879, 6625364.187, 59.72733, 18.19202, 56118.162848134096, 5.6676),
  lidingo: grid('8b9f61aba7ef3d78a14219d10ba79ce09322ac947c52a4f1551acc9c4447a7d6', 677700.5, 6586399.5),
  norrfallsviken: legacy('f3c5d5b875eb5d4b75726bdaf1a0ba30583a7227dcd2ab854bb469040d3f758a', 678970.625, 6988556.634, 62.9825, 18.5325, 50568.5149714403, 20.3432),
  puttom: legacy('07385de7aae61f2e4399e3e18e1df931c86f2bdff4ec233319bfd2d3f03377c8', 697498.021708, 7024997.739459, 63.2992, 18.9413, 50019.57950643624, 23.6263),
  ribbingsfors: grid('5d616311e246c109899b52223af5ed4a68f372f9b923787d6c0354b33b2c968f', 448975.5, 6536024.5),
  tortuna: grid('37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f', 597400.5, 6614899.5),
  upsala: legacy('628d86e3e5bf35bd79500173488c31a31fe101c06d1acad56033d089d2846d86', 639830.271, 6636114.391, 59.839, 17.4952, 55930.68, 0),
  veckefjarden: legacy('2e56c2fd7f8cbb04b684fb0222d2a0890201ccb23f635d068302be0569760fa6', 684183.801986, 7022564.696685, 63.2845, 18.6735, 50045.09293725691, 20.9924),
  visby: grid('d7631b5ee1a936044fc4f03d7ee13971438b65653cc23a4dd9676b563123f511', 687748.5, 6370951.5),
});

/* The map's world is the ground's own: metres from the ground's origin, east
   +x and south +z, the frame the tiles' bounds are written in. Everything
   drawn is carried into it once at load, so the renderer never meets a pack
   frame and a tile is always axis-aligned. */
export function createMapFrame(groundId, groundFrame) {
  const config = MAP_GROUND_FRAMES[groundId];
  if (!config) throw new Error(`banan ${groundId} saknar kartans koordinatram`);
  if (groundFrame?.fingerprint !== config.frameFingerprint) {
    throw new Error(`${groundId}: höjddatan har en annan koordinatram än kartan granskades mot`);
  }
  const { easting: originEasting, northing: originNorthing } = groundFrame.origin;
  const translateX = originEasting - config.legacyOriginEpsg3006.easting;
  const translateZ = config.legacyOriginEpsg3006.northing - originNorthing;
  const bridge = config.legacyFrame ? legacyGridBridge(config.legacyFrame) : null;
  const toWorld = bridge
    ? (x, z) => {
      const [gridX, gridZ] = bridge.toGrid(x, z);
      return [gridX - translateX, gridZ - translateZ];
    }
    : (x, z) => [x - translateX, z - translateZ];
  const toPack = bridge
    ? (x, z) => bridge.toLegacy(x + translateX, z + translateZ)
    : (x, z) => [x + translateX, z + translateZ];
  return Object.freeze({ groundId, toWorld, toPack, rotationRadians: bridge?.rotationRadians ?? 0, verticalDatumOffsetMetres: config.verticalDatumOffsetMetres });
}
