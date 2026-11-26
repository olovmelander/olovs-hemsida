import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import pine from '../data/scots-pine-assets.mjs';
import { fetchGlb, fitFoliageTier } from './ghibli-tree-assets.mjs';

const root = new URL('../../public/models/trees/', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root));

async function fittedMesh(rec, variant) {
  const mesh = await fetchGlb(rec.file, rec, async file => new Response(read(file)));
  fitFoliageTier(mesh, variant.templateHeight, variant.templateRadius);
  mesh.crown.computeBoundingBox();
  return mesh;
}

function outwardFraction(wood) {
  const indices = wood.index.array, p = wood.attributes.position, n = wood.attributes.normal;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), radial = new Vector3(), tmp = new Vector3();
  let outward = 0;
  for (let i = 0; i < indices.length; i += 3) {
    a.fromBufferAttribute(p, indices[i]);
    b.fromBufferAttribute(p, indices[i + 1]).sub(a);
    c.fromBufferAttribute(p, indices[i + 2]).sub(a);
    radial.fromBufferAttribute(n, indices[i]);
    radial.add(tmp.fromBufferAttribute(n, indices[i + 1])).add(tmp.fromBufferAttribute(n, indices[i + 2]));
    if (b.cross(c).dot(radial) > 0) outward++;
  }
  return outward / (indices.length / 3);
}

it.each([['inland', 'realistic-v2.json'], ['coastal', 'realistic-visby.json']])(
  'keeps the %s pine crown envelopes, triangle budgets and outward-facing bark', async (family, catalogue) => {
    const original = JSON.parse(read(catalogue)).species.find(s => s.key === 'tall');
    const { variants, foliage } = pine[family];
    expect(variants).toHaveLength(original.variants.length);
    for (const [map, size] of [[foliage.atlas, 1024], [foliage.normals, 512]]) {
      const bytes = read(map.file);
      expect(bytes.length).toBe(map.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(map.sha256);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([size, size]);
    }
    for (const [i, variant] of original.variants.entries()) {
      const reference = await fittedMesh(variant.tiers.hero, variant);
      for (const tier of ['hero', 'full']) {
        const mesh = await fittedMesh(variants[i][tier], variant);
        for (const face of ['min', 'max']) for (const axis of ['x', 'y', 'z']) {
          const delta = mesh.crown.boundingBox[face][axis] - reference.crown.boundingBox[face][axis];
          expect(Math.abs(delta)).toBeLessThan(.0003);
        }
        expect((mesh.crown.index.count + mesh.trunk.index.count) / 3).toBe(variant.tiers[tier].tris);
        expect(outwardFraction(mesh.trunk)).toBeGreaterThan(.997);
      }
    }
  });
