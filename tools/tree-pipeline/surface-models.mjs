#!/usr/bin/env node
/* The surface model matched from each aerial photo flight over a ground's tree window (Lantmäteriet's Ythöjdmodell,
   collection dsm-cog), on the laser canopy model's own 0.5 m grid.

   node --env-file=.env tools/tree-pipeline/surface-models.mjs --ground <id> [--years 2025,2021] [--pin-only]

   1. Finds every dsm-cog item over the window in Lantmäteriet's public height catalogue, and pins each one's address,
      size, SHA-256 and flight date in geo_data/course-v2/<ground>/acquisition/surface-models.json (public metadata,
      kept in git). The source policy is checked on the pins before anything is read.
   2. For each year asked, reads only the window from the pinned items (an authenticated range read of each
      cloud-optimised GeoTIFF; the credentials are passed to the reader in its environment, never printed) and writes
      dsm-photo-<year>-050 and chm-photo-<year>-050 beside the laser rasters in the tree cache (private, ignored).

   Why: the laser over many grounds was flown leafless and years ago. The flight of the tracing photo shows trees
   planted since, broadleaf crowns in leaf (a leafless crown is split into several by the laser), and, set against a
   leafless flight, which crowns are broadleaf. It adds to the laser and never replaces it: see source-policy.mjs.
   The owner allowed this source on 25 November 2026. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STAC_ENDPOINTS, stacSearch, sha256FromStacChecksum } from '../../packages/course-geo/acquisition/stac.mjs';
import { PIXI } from '../../packages/course-geo/toolchain/mapping-environment.mjs';
import { LANTMATERIET_HEIGHT_STAC, SURFACE_COLLECTION, surfacePolicyProblems } from './source-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

/** The pins for a window, from the catalogue's items: one entry an item, newest flight first. */
export function surfacePins(groundId, items, bboxWgs84, observedOn = new Date().toISOString().slice(0, 10)) {
  const pinned = items.map(item => {
    const asset = item.assets?.data, p = item.properties ?? {};
    return { id: item.id, year: Number(p.flygar ?? String(p.datetime).slice(0, 4)), datetime: p.datetime, campaign: p.insamlingsomrade ?? null,
      resolutionMetres: p.upplosning ?? null, href: asset?.href, bytes: asset?.['file:size'] ?? null, sha256: sha256FromStacChecksum(asset?.['file:checksum']) };
  }).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
  return { schemaVersion: 1, kind: 'surface-model-pins', groundId, discovery: LANTMATERIET_HEIGHT_STAC, collection: SURFACE_COLLECTION,
    product: 'Ythöjdmodell (surface model matched from aerial photos), Lantmäteriet', terms: 'https://www.lantmateriet.se/sv/geodata/vara-produkter/Villkor-och-avgifter/',
    allowedBy: 'the owner, 25 November 2026', searchBboxWgs84: bboxWgs84, observedOn, years: [...new Set(pinned.map(i => i.year))], items: pinned };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: node --env-file=.env tools/tree-pipeline/surface-models.mjs --ground <id> [--years 2025,2021] [--pin-only]');
  const config = json(`course-workflows/${groundId}/trees.json`), bbox = config.orthophotos?.stacSearchBboxWgs84;
  if (!bbox) throw new Error(`${groundId}: trees.json gives no orthophotos.stacSearchBboxWgs84 to search`);
  const pins = surfacePins(groundId, await stacSearch(STAC_ENDPOINTS.height, { bbox, collections: [SURFACE_COLLECTION] }), bbox);
  const problems = surfacePolicyProblems(pins);
  if (problems.length) throw new Error(`the source policy refuses these pins:\n${problems.join('\n')}`);
  const pinFile = `geo_data/course-v2/${groundId}/acquisition/surface-models.json`;
  fs.writeFileSync(path.join(ROOT, pinFile), `${JSON.stringify(pins, null, 1)}\n`);
  console.log(`${pinFile}: ${pins.items.length} items, flown ${pins.items.map(i => i.datetime?.slice(0, 10)).filter((d, i, all) => all.indexOf(d) === i).join(', ')}`);
  if (argv.includes('--pin-only')) process.exit(0);
  const rasters = path.join(config.cacheDir, 'rasters'), grid = path.join(rasters, 'chm-pitfree-050.json');
  if (!fs.existsSync(path.join(ROOT, grid))) throw new Error(`${grid} is missing: run the canopy stage first, so the surface shares its grid`);
  const traceConfig = ['brohofbuild', ...config.courseSlugs].map(b => `${b}/mapping/trace-config.json`).find(f => fs.existsSync(path.join(ROOT, f)))
    ?? json('apps/golf/public/courses/index.json').courses.filter(c => config.courseSlugs.includes(c.slug)).map(c => `${c.build}/mapping/trace-config.json`).find(f => fs.existsSync(path.join(ROOT, f)));
  if (!traceConfig) throw new Error(`${groundId}: no trace-config.json names the 1 m terrain to stand the surface on`);
  const years = (flag('years') ?? String(pins.years[0])).split(',').map(Number);
  for (const year of years) {
    const run = spawnSync(PIXI, ['run', '--manifest-path', 'packages/course-geo/toolchain/pixi.toml', '-e', 'mapping', '--frozen', 'python', 'tools/tree-pipeline/surface-window.py',
      '--pins', pinFile, '--year', String(year), '--grid', grid, '--terrain', traceConfig, '--out', rasters], { cwd: ROOT, stdio: 'inherit', env: process.env });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
