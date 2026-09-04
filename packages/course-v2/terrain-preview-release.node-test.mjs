import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { compileTerrainAssets } from './terrain-compiler-node.mjs';
import { writeTerrainPreviewBundle } from './terrain-preview-node.mjs';
import { stageTerrainPreviewRelease } from './terrain-preview-release-node.mjs';

function compilation() {
  const size = 9;
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = 48 + row * 0.2 + Math.sin(column * 0.4);
  }
  return compileTerrainAssets({
    groundId: 'release-test', courseSlugs: ['release-test'], heights,
    width: size, height: size, originEasting: 650000, originNorthing: 6640008,
    tileSegments: 4, codec: 'raw',
  });
}

async function filesBelow(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, rel));
    else result.push(rel.split(sep).join('/'));
  }
  return result.sort();
}

test('release staging retains only the descriptor and its verified finest tiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'banvy-preview-release-'));
  try {
    const source = join(root, 'source'), release = join(root, 'release');
    const compiled = compilation();
    const bundle = await writeTerrainPreviewBundle(source, compiled, { label: 'Release test' });
    await writeFile(join(source, 'source-terrain.tif'), 'must never be retained');
    const result = await stageTerrainPreviewRelease(source, release, {
      expectedLabel: 'Release test', expectedTileCount: 4,
    });
    assert.equal(result.tileCount, 4);
    const expected = ['preview.json', ...bundle.descriptor.tiles.map(tile => tile.reference.url)].sort();
    assert.deepEqual(await filesBelow(release), expected);
    assert.equal((await readFile(join(release, 'preview.json'), 'utf8')).includes('Release test'), true);
    assert.equal(bundle.writtenAssets.length > result.tileCount, true);
    assert.equal((await filesBelow(release)).some(path => path.endsWith('.tif')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release staging rejects a corrupt referenced tile before creating output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'banvy-preview-corrupt-'));
  try {
    const source = join(root, 'source'), release = join(root, 'release');
    const compiled = compilation();
    const { descriptor } = await writeTerrainPreviewBundle(source, compiled, { label: 'Corrupt test' });
    const target = join(source, descriptor.tiles[0].reference.url);
    const bytes = await readFile(target);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(target, bytes);
    await assert.rejects(stageTerrainPreviewRelease(source, release), /integrity mismatch/);
    await assert.rejects(readdir(release), error => error.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
