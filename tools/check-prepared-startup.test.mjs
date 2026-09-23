import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPreparedStartup } from './check-prepared-startup.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';

async function alteredCatalog(mutate, run) {
  const source = path.resolve('apps/golf/public'), root = await fs.mkdtemp(path.join(os.tmpdir(), 'banvy-prepared-gate-'));
  const linkReadOnlyInput = async (from, to) => {
    if (process.platform !== 'win32') return fs.symlink(from, to);
    // Junctions need no symlink privilege; copy the few root metadata files.
    // Only the separate index.json below is mutated by these fixtures.
    if ((await fs.stat(from)).isDirectory()) return fs.symlink(from, to, 'junction');
    return fs.copyFile(from, to);
  };
  try {
    for (const name of await fs.readdir(source)) if (name !== 'courses') await linkReadOnlyInput(path.join(source, name), path.join(root, name));
    await fs.mkdir(path.join(root, 'courses'));
    for (const name of await fs.readdir(path.join(source, 'courses'))) if (name !== 'index.json') await linkReadOnlyInput(path.join(source, 'courses', name), path.join(root, 'courses', name));
    const catalog = JSON.parse(await fs.readFile(path.join(source, 'courses/index.json'))); mutate(catalog);
    await fs.writeFile(path.join(root, 'courses/index.json'), JSON.stringify(catalog));
    await run(root);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

describe('prepared startup release gate', () => {
  const revision = courseSourceRevision(process.cwd());
  it('rejects a stale source identity rather than silently falling back', async () => {
    await alteredCatalog(c => { c.courses[0].preparedTint['painted-hi'].identity = '0'.repeat(64); },
      async root => { await expect(checkPreparedStartup(root, revision)).rejects.toThrow(/stale\/missing hi tint/); });
  });
  it('rejects an altered compressed asset receipt', async () => {
    await alteredCatalog(c => { c.courses[0].startup.sha256 = '0'.repeat(64); },
      async root => { await expect(checkPreparedStartup(root, revision)).rejects.toThrow(/hash/); });
  });
  it('rejects a changed decoded tint receipt despite intact compressed bytes', async () => {
    await alteredCatalog(c => { c.courses[0].preparedTint['painted-hi'].decodedSha256 = '0'.repeat(64); },
      async root => { await expect(checkPreparedStartup(root, revision)).rejects.toThrow(); });
  });
  it('rejects a stale far-vista record rather than silently planting from it', async () => {
    await alteredCatalog(c => { c.courses[0].preparedVista['vista-hi'].identity = '0'.repeat(64); },
      async root => { await expect(checkPreparedStartup(root, revision)).rejects.toThrow(/stale\/missing vista-hi/); });
  });
  it('rejects a stale scatter record rather than silently planting from it', async () => {
    await alteredCatalog(c => { c.courses[0].preparedScatter['scatter-lo'].identity = '0'.repeat(64); },
      async root => { await expect(checkPreparedStartup(root, revision)).rejects.toThrow(/stale\/missing scatter-lo/); });
  });
  it('requires a current unsupported-water receipt rather than accepting any missing water', async () => {
    await alteredCatalog(c => { delete c.courses[0].preparedWater; delete c.courses[0].preparedWaterUnsupported; },
      async root => { await expect(checkPreparedStartup(root, revision)).rejects.toThrow(/unsupported-water bake receipt/); });
  });
});
