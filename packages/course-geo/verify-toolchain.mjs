import { existsSync, statSync } from 'node:fs';
import { gridPath, loadGridSpec, runGeoCommand, sha256File } from './proj.mjs';

const EXPECTED = Object.freeze({
  gdal: '3.13.3',
  proj: '9.8.1',
  pdal: '2.10.2',
});

function combined(command, args) {
  const result = runGeoCommand(command, args);
  return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

function requireVersion(label, output, version) {
  if (!new RegExp(`(^|[^0-9])${version.replaceAll('.', '\\.')}(?=$|[^0-9])`).test(output)) {
    throw new Error(`${label} must be ${version}; received ${JSON.stringify(output)}`);
  }
}

const gdal = combined('gdalinfo', ['--version']);
const proj = combined('proj', []);
const pdal = combined('pdal', ['--version']);
requireVersion('GDAL', gdal, EXPECTED.gdal);
requireVersion('PROJ', proj, EXPECTED.proj);
requireVersion('PDAL', pdal, EXPECTED.pdal);

const compound = combined('projinfo', ['EPSG:5845', '-o', 'PROJJSON']);
if (!compound.includes('CompoundCRS') || !compound.includes('SWEREF99 TM') || !compound.includes('RH2000')) {
  throw new Error('EPSG:5845 is not the expected SWEREF99 TM + RH2000 compound CRS');
}
const horizontal = combined('projinfo', ['EPSG:3006', '-o', 'PROJJSON']);
if (!horizontal.includes('SWEREF99 TM')) {
  throw new Error('EPSG:3006 is not available as SWEREF99 TM');
}
const vertical = combined('projinfo', ['EPSG:5613', '-o', 'PROJJSON']);
if (!vertical.includes('RH2000')) {
  throw new Error('EPSG:5613 is not available as RH2000 height');
}

const spec = loadGridSpec();
const path = gridPath();
if (!existsSync(path) || statSync(path).size !== spec.sizeBytes || sha256File(path) !== spec.sha256) {
  throw new Error(`Missing or invalid verified grid ${path}`);
}

console.log(JSON.stringify({
  status: 'ok',
  versions: EXPECTED,
  crs: {
    compound: 'EPSG:5845',
    horizontal: 'EPSG:3006',
    vertical: 'EPSG:5613',
  },
  projNetwork: process.env.PROJ_NETWORK || 'OFF (enforced per process)',
  verticalGrid: {
    id: spec.id,
    sha256: spec.sha256,
    sizeBytes: spec.sizeBytes,
    licence: spec.licence,
  },
}, null, 2));
