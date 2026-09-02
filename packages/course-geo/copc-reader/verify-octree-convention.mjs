/* Which subdivision do a Laserdata Skog item's hierarchy keys follow?

   The COPC specification subdivides the cube in the info VLR. Lantmäteriet's
   Untwine-built half-tile items subdivide each axis over the HEADER's data
   extent instead (Y over the 5 km half, Z over the point heights), and only X
   coincides with the cube because the data happens to be 10 km wide. A reader
   that prunes nodes by the cube reads the wrong ground -- which is what the
   52-point PDAL window in the D2 evidence was. This decodes a sample of nodes
   per item and counts, for both conventions, how many nodes' points fall
   inside the footprint the key implies. Aggregate counts only.

   usage: node verify-octree-convention.mjs [--per-depth 6] [item-url ...]  */
import { Copc } from 'copc';
import { authorizationHeaders, lantmaterietCredentials } from '../acquisition/credentials.mjs';

const args = process.argv.slice(2);
const perDepth = +(args[args.indexOf('--per-depth') + 1] || 6);
const urls = args.filter(arg => /^https:\/\/dl1\.lantmateriet\.se\/hojd\/data\/pointcloud\/sls\/.*\.copc\.laz$/.test(arg));
if (!urls.length) urls.push(
  'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/26f015/m26f015-702_69.copc.laz',
  'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/23f028/m23f028-702_69.copc.laz',
  'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/20f015/m20f015-702_69.copc.laz',
);
const headers = authorizationHeaders(lantmaterietCredentials());

function footprint(origin, extent, index, depth) {
  const size = extent / 2 ** depth;
  return [origin + index * size, origin + (index + 1) * size];
}

for (const url of urls) {
  const getter = async (begin, end) => {
    const response = await fetch(url, { headers: { ...headers, Range: `bytes=${begin}-${end - 1}` } });
    if (response.status !== 206) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const copc = await Copc.create(getter);
  const cube = copc.info.cube;
  const side = cube[3] - cube[0];
  const { min, max } = copc.header;
  const { nodes } = await Copc.loadHierarchyPage(getter, copc.info.rootHierarchyPage);
  const byDepth = {};
  for (const key of Object.keys(nodes)) { const d = +key.split('-')[0]; (byDepth[d] ||= []).push(key); }
  const sample = Object.values(byDepth).flatMap(list => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / perDepth)) === 0).slice(0, perDepth));
  let tested = 0;
  const fits = { cube: { x: 0, y: 0, z: 0 }, extent: { x: 0, y: 0, z: 0 } };
  const worst = { x: 0, y: 0, z: 0 };
  const mismatches = [];
  for (const key of sample) {
    const [d, x, y, z] = key.split('-').map(Number);
    const view = await Copc.loadPointDataView(getter, copc, nodes[key]);
    if (!view.pointCount) continue;
    tested++;
    const gx = view.getter('X'), gy = view.getter('Y'), gz = view.getter('Z');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < view.pointCount; i++) {
      const px = gx(i), py = gy(i), pz = gz(i);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
    }
    const overshoot = (range, lo, hi) => Math.max(0, range[0] - lo, hi - range[1]);
    const axes = {
      x: [footprint(cube[0], side, x, d), footprint(min[0], max[0] - min[0], x, d), minX, maxX],
      y: [footprint(cube[1], side, y, d), footprint(min[1], max[1] - min[1], y, d), minY, maxY],
      z: [footprint(cube[2], side, z, d), footprint(min[2], max[2] - min[2], z, d), minZ, maxZ],
    };
    let extentFit = true;
    const detail = [];
    for (const [axis, [cubeRange, extentRange, lo, hi]] of Object.entries(axes)) {
      if (overshoot(cubeRange, lo, hi) <= 1e-3) fits.cube[axis]++;
      const over = overshoot(extentRange, lo, hi);
      if (over <= 1e-3) fits.extent[axis]++;
      else { extentFit = false; worst[axis] = Math.max(worst[axis], over); detail.push(`${axis} over by ${over.toFixed(2)} m (node ${extentRange.map(v => v.toFixed(1)).join('..')}, points ${lo.toFixed(1)}..${hi.toFixed(1)})`); }
    }
    if (!extentFit) mismatches.push(`${key}: ${detail.join('; ')}`);
  }
  const item = url.split('/').pop();
  console.log(`${item}: ${tested} non-empty nodes sampled over depths ${Object.keys(byDepth).join(',')}`);
  console.log(`   per-axis fits of ${tested}: cube x ${fits.cube.x} y ${fits.cube.y} z ${fits.cube.z} | header-extent x ${fits.extent.x} y ${fits.extent.y} z ${fits.extent.z} | worst extent overshoot x ${worst.x.toFixed(2)} y ${worst.y.toFixed(2)} z ${worst.z.toFixed(2)} m`);
  for (const line of mismatches.slice(0, 6)) console.log('   ' + line);
  console.log(`   cube ${cube.map(v => +v.toFixed(2)).join(',')} | header min ${min.map(v => +v.toFixed(2)).join(',')} max ${max.map(v => +v.toFixed(2)).join(',')}`);
}
