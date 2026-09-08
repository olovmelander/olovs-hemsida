/* Pinned source/lattice contract for Lidingö's graph-independent canopy intake.
   Canopy raster origins address pixel edges; terrain origins address samples. */
export const LIDINGO_CANOPY_CONFIG = Object.freeze({
  groundId: 'lidingo',
  campaignId: '21c031-658_67',
  captureDate: '2021-03-23',
  sourceHref: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/21c031/m21c031-658_67.copc.laz',
  sourceSha256: '7a16aeb3b8d7aea2f8c38b0a247868a9c0c33b309bebc4fdaa8cc57d5ad43848',
  sourceEtag: '"7f2f60e485969d95b7fc79e5ba8ee9dd"',
  sourceBytes: 1349562664,
  sourcePoints: 217740127,
  sourceBounds: Object.freeze([670000, 6580000, 680000, 6590000]),
  width: 2048, height: 2048, sampleSpacingMetres: 1,
  originEasting: 676676.5, originNorthing: 6587423.5,
  tileMetres: 256, haloMetres: 64,
  groundFillRadiusCells: 60,
});

export function assertLidingoLaserSource(item) {
  const config = LIDINGO_CANOPY_CONFIG;
  if (item?.id !== config.campaignId || item.collection !== 'dsm-skoglig-copc' ||
      item.captureStart?.slice(0, 10) !== config.captureDate ||
      item.captureEnd?.slice(0, 10) !== config.captureDate || item.projCode !== 'EPSG:5845' ||
      JSON.stringify(item.projBbox) !== JSON.stringify(config.sourceBounds) ||
      item.assets?.data?.href !== config.sourceHref || item.assets.data.sha256 !== config.sourceSha256 ||
      item.assets.data.bytes !== config.sourceBytes || item.pointCount !== config.sourcePoints) {
    throw new Error('Lidingö laser source differs from pinned 2021 campaign 21c031-658_67');
  }
  return item;
}

export function lidingoCanopyTiles() {
  const config = LIDINGO_CANOPY_CONFIG;
  const tiles = [];
  for (let row = 0; row < config.height / config.tileMetres; row++) {
    for (let column = 0; column < config.width / config.tileMetres; column++) {
      const west = config.originEasting + column * config.tileMetres;
      const north = config.originNorthing - row * config.tileMetres;
      const bbox = [west, north - config.tileMetres, west + config.tileMetres, north];
      tiles.push({ id: `l0/${column}/${row}`, column, row, bbox,
        window: [bbox[0] - config.haloMetres, bbox[1] - config.haloMetres,
          bbox[2] + config.haloMetres, bbox[3] + config.haloMetres] });
    }
  }
  return tiles;
}

export function sampleLidingoDtm(heights, easting, northing) {
  const config = LIDINGO_CANOPY_CONFIG;
  const width = config.width + 1;
  if (!(heights instanceof Float32Array) || heights.length !== width * (config.height + 1)) {
    throw new Error('Lidingö DTM must contain the complete 2049-square sample lattice');
  }
  const fx = easting - config.originEasting;
  const fy = config.originNorthing - northing;
  if (fx < 0 || fy < 0 || fx > config.width || fy > config.height) return Number.NaN;
  const x = Math.min(config.width - 1, Math.floor(fx));
  const y = Math.min(config.height - 1, Math.floor(fy));
  const tx = fx - x, ty = fy - y;
  return (heights[y * width + x] * (1 - tx) + heights[y * width + x + 1] * tx) * (1 - ty) +
    (heights[(y + 1) * width + x] * (1 - tx) + heights[(y + 1) * width + x + 1] * tx) * ty;
}
