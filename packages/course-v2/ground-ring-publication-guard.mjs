import { readFile } from 'node:fs/promises';
import path from 'node:path';

/* A fixed pyramid cannot replace a live world graph: removing parent links
 * makes the runtime return to the small central frontier and its visible seam.
 */
export async function refusePublishedRingOverwrite(publicDirectory, slug) {
  let index;
  try { index = JSON.parse(await readFile(path.join(publicDirectory, 'courses/v2-index.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const entry = index.courses.find(course => course.slug === slug);
  if (!entry) return;
  const course = JSON.parse(await readFile(path.join(publicDirectory, entry.manifest.url), 'utf8'));
  const ground = JSON.parse(await readFile(path.join(publicDirectory, course.groundManifest.url), 'utf8'));
  if (ground.tiles.some(tile => tile.parentId)) {
    throw new Error(`${slug} already serves terrain rings; publish-ground-rings.mjs owns the live graph. Refusing to replace the surrounding terrain with a fixed pyramid.`);
  }
}
