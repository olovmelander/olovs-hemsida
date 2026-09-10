/* Independent source-kit receipt, transform and terrain checks. No Blender calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from '../laser-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const manifest = read('ribbingsforsbuild/facilities/reference/orthophoto-manifest.json');
const ground = read('ribbingsforsbuild/facilities/reference/facility-ground.json');
const legacy = read('ribbingsforsbuild/facilities/reference/legacy-facilities.json');
const checks = [];
const check = (label, ok, evidence) => checks.push({ label, pass: !!ok, ...(evidence === undefined ? {} : { evidence }) });
const near = (a, b, eps = 1e-7) => Math.abs(a - b) <= eps;
check('Ground export is absolute RH2000', ground.coordinateFrame.verticalDatumOffsetMetres === 0
  && ground.coordinateFrame.blenderAxes.includes('absolute RH2000'));
check('Orthophoto manifest does not subtract terrain tile origin from Blender height',
  !/heightRH2000\s*-\s*69\.14/.test(manifest.frame.blender), manifest.frame.blender);
check('Orthophoto manifest does not subtract terrain tile origin from scene height',
  !/heightRH2000\s*-\s*69\.14/.test(manifest.frame.engine), manifest.frame.engine);
for (const p of manifest.panels) {
  const bytes = fs.readFileSync(path.join(root, p.png));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const [minE, minN, maxE, maxN] = p.boundsEpsg3006;
  const expected = [minE - 448975.5, 6536024.5 - maxN, maxE - 448975.5, 6536024.5 - minN];
  const pgw = fs.readFileSync(path.join(root, p.worldfile), 'utf8').trim().split(/\s+/).map(Number);
  check(`${p.id}: PNG hash`, hash === p.pngSha256);
  check(`${p.id}: PNG dimensions`, bytes.readUInt32BE(16) === p.width && bytes.readUInt32BE(20) === p.height);
  check(`${p.id}: raster extent`, near(p.width * p.pixelSizeMetres, maxE - minE)
    && near(p.height * p.pixelSizeMetres, maxN - minN));
  check(`${p.id}: runtime bounds`, expected.every((n, i) => near(n, p.boundsEngineXZ[i])));
  check(`${p.id}: worldfile pixel centers`, near(pgw[0], p.pixelSizeMetres) && near(pgw[3], -p.pixelSizeMetres)
    && near(pgw[4], minE + p.pixelSizeMetres / 2) && near(pgw[5], maxN - p.pixelSizeMetres / 2));
}
const terrain = loadTerrain();
let compared = 0, largestError = 0;
for (const p of ground.panels) {
  check(`${p.id}: ground dimensions`, p.heightsRH2000M.length === p.width * p.height);
  check(`${p.id}: finite ground`, p.heightsRH2000M.every(Number.isFinite));
  for (let r = 0; r < p.height; r += 19) for (let c = 0; c < p.width; c += 17) {
    compared++;
    largestError = Math.max(largestError, Math.abs(p.heightsRH2000M[r * p.width + c] - terrain.hAt(p.x0 + c, p.z0 + r)));
  }
}
check('Extracted ground matches authoritative tile source within rounding', largestError <= .000501, { compared, largestError });
for (const b of legacy.buildings.filter(b => b.modelPriority === 'facilities')) {
  const [x, y] = b.anchorBlenderXY;
  check(`${b.id}: source-ground panel coverage`, ground.panels.some(p => x >= p.x0 && x <= p.x1 && -y >= p.z0 && -y <= p.z1));
  check(`${b.id}: anchor terrain`, Math.abs(terrain.hAt(x, -y) - b.anchorGroundRH2000M) <= .000501);
}
const report = { schemaVersion: 1, groundId: 'ribbingsfors', auditedUtc: new Date().toISOString(),
  scope: 'Independent filesystem/source audit; no Blender or runtime model mutation',
  status: checks.every(c => c.pass) ? 'passed' : 'discrepancies',
  checksPassed: checks.filter(c => c.pass).length, checksTotal: checks.length, checks };
fs.writeFileSync(path.join(here, 'reference/source-kit-independent-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks: `${report.checksPassed}/${report.checksTotal}`,
  failures: checks.filter(c => !c.pass), terrainComparisons: compared, largestTerrainDifferenceM: largestError }));
if (report.status !== 'passed') process.exitCode = 1;
