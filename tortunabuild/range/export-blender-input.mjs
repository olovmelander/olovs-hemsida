/* Hand the measured range to Blender for an independent look at its
 * proportions. Ground heights come from this build's own heightfield, so the
 * Blender scene stands on the same terrain the engine draws, and axes are
 * turned into Blender's convention here rather than in the .py: X east,
 * Y north, Z up, against the pack's x east / z south. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { heightAtLocal } from './terrain.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(resolve(HERE, '../../apps/golf/src/engine/scenery/tortuna-range-site.json'), 'utf8'));
const B = ([x, z]) => [x, -z];                       /* local -> Blender ground plane */
const ground = ([x, z]) => heightAtLocal(x, z);
const r2 = v => Math.round(v * 100) / 100;

/* One datum for the whole scene keeps Blender's numbers small and readable;
   every height below is relative to it and the offset is recorded. */
const all = [...site.mats.items.flatMap(m => m.ringLocal), ...site.net.lineLocal, ...site.earthworks.ringLocal];
const zs = all.map(ground).filter(Number.isFinite).sort((a, b) => a - b);
const datum = r2(zs[Math.floor(zs.length / 2)]);

writeFileSync(resolve(HERE, '../cache/range/blender-input.json'), JSON.stringify({
  source: site.source, state: site.state, datumRh2000: datum,
  axes: 'Blender X=east, Y=north, Z=up; heights are RH 2000 minus datum',
  mats: site.mats.items.map(m => ({ id: m.id,
    ring: m.ringLocal.map(p => [...B(p).map(r2), r2(ground(p) - datum)]) })),
  matThicknessMetres: 0.05,
  net: {
    heightMetres: site.net.heightMetres,
    posts: site.net.posts.map(p => {
      const localXZ = site.net.lineLocal[site.net.posts.indexOf(p)] ?? null;
      return null;
    }).filter(Boolean),
  },
  netPosts: site.net.lineLocal.map((p, i) => ({
    at: B(p).map(r2), base: r2(ground(p) - datum), height: site.net.posts[i]?.heightMetres ?? site.net.heightMetres })),
  netLine: site.net.lineLocal.map(p => [...B(p).map(r2), r2(ground(p) - datum)]),
  earthworks: site.earthworks.ringLocal.map(p => [...B(p).map(r2), r2(ground(p) - datum)]),
  matSideMetres: site.mats.drawnSideMetres,
}, null, 1) + '\n');
console.log('datum %s m RH2000; mats %s, net posts %s, earthworks ring %s points',
  datum, site.mats.items.length, site.net.lineLocal.length, site.earthworks.ringLocal.length);
