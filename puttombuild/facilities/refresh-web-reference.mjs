/** Download the pinned public reference photos; no runtime use or scene mutation. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const manifestPath = new URL('./web-reference.json', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const photo of manifest.photos) {
  const target = path.resolve(root, photo.localPath);
  if (!target.startsWith(root + path.sep)) throw new Error(`Invalid destination: ${photo.localPath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (hash === photo.sha256) { console.log(`${photo.id}: cached and verified`); continue; }
    throw new Error(`Existing image differs from pinned reference: ${photo.id}`);
  }
  const response = await fetch(photo.originalImageUrl);
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`${photo.id}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== photo.sha256) throw new Error(`${photo.id}: provider image changed; review before replacing`);
  fs.writeFileSync(target, bytes);
  console.log(`${photo.id}: downloaded and verified`);
}
