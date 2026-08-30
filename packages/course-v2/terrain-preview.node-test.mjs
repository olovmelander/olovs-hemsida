import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compileTerrainAssets } from './terrain-compiler-node.mjs';
import { createTerrainPreviewDescriptor, writeTerrainPreviewBundle } from './terrain-preview-node.mjs';
import { validateTerrainPreview } from './terrain-preview.mjs';

function compilation() {
  const width = 9, height = 9;
  const heights = new Float32Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    heights[row * width + column] = 31 + column * 0.3 + row * 0.2;
  }
  return compileTerrainAssets({
    groundId: 'preview-ground', courseSlugs: ['preview-course'],
    heights, width, height, originEasting: 650000, originNorthing: 6640008,
    tileSegments: 4,
  });
}

test('preview descriptor selects only the finest non-overlapping terrain frontier', () => {
  const compiled = compilation();
  const preview = createTerrainPreviewDescriptor(compiled, { label: 'Verifierad pilot' });
  assert.deepEqual(validateTerrainPreview(preview), []);
  assert.equal(preview.provisional, true);
  assert.equal(preview.provisionalReason, 'visual-only-origin-not-approved');
  assert.equal(preview.tiles.length, 4);
  assert.ok(preview.tiles.every(tile => tile.id.startsWith('l0/')));
  assert.equal(preview.frame.origin.easting, 650004);
  assert.equal(preview.frame.origin.northing, 6640004);
  assert.match(preview.frame.fingerprint, /^[a-f0-9]{64}$/);
});

test('preview bundle writes immutable BVCH assets without source terrain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'banvy-terrain-preview-'));
  try {
    const compiled = compilation();
    const result = await writeTerrainPreviewBundle(directory, compiled, { label: 'Preview' });
    const persisted = JSON.parse(await readFile(result.descriptorPath, 'utf8'));
    assert.deepEqual(validateTerrainPreview(persisted), []);
    assert.equal(result.writtenAssets.length, compiled.resources.size);
    for (const tile of persisted.tiles) assert.ok((await stat(join(directory, tile.reference.url))).isFile());
    await writeTerrainPreviewBundle(directory, compiled, { label: 'Preview' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preview contract rejects attempts to masquerade as approved production data', () => {
  const preview = structuredClone(createTerrainPreviewDescriptor(compilation()));
  preview.provisional = false;
  assert.match(validateTerrainPreview(preview).join('\n'), /must remain true/);
  preview.provisional = true;
  preview.tiles[0].reference.url = '../escaped.bvch';
  assert.match(validateTerrainPreview(preview).join('\n'), /invalid terrain preview|relative|content-addressed|url/i);
});
