// Retain public club evidence locally; raw media is excluded from Git/runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const reference = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(reference, 'cache', 'club-2026-09-07');
await fs.mkdir(cache, { recursive: true });
const pages = [
  ['course', 'https://www.lidingogk.se/banan/'],
  ['scorecard-rules', 'https://www.lidingogk.se/banan/slope-lokala-regler-aeven-scorekort/'],
  ['banguide-embed', 'https://www.lidingogk.se/banan/nya-banguiden/'],
  ['banguide', 'https://banguider.se/lidingo-golfklubb/18-halsbanan'],
  ['flyovers', 'https://www.lidingogk.se/banan/flyover/'],
  ['gallery', 'https://www.lidingogk.se/banan/bildgalleri/'],
  ['gallery-2026', 'https://www.lidingogk.se/banan/bildgalleri/bildgalleri-2026/'],
  ['maintenance-2026', 'https://www.lidingogk.se/banan/banchefen-informerar-2026/'],
  ['historical-routing', 'https://www.lidingogk.se/banan/banstraeckning-historiskt/'],
  ['course-council', 'https://www.lidingogk.se/klubben/kommitteer-sektioner/banraadet/'],
  ['course-council-2024', 'https://www.lidingogk.se/klubben/kommitteer-sektioner/banraadet/information-2024-09-17/'],
  ['practice-areas', 'https://www.lidingogk.se/trana/rangen-ovningsomraden/'],
  ['webcam', 'https://www.lidingogk.se/banan/webbkamera/'],
];
const inventoryPath = path.join(reference, 'club-source-assets.json');
const previous = await fs.readFile(inventoryPath, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return { assets: [] };
});
const inventory = [];
const discovery = [];
async function retain(id, url, context) {
  const prior = previous.assets.find(asset => asset.id === id && asset.url === url);
  if (prior) {
    const bytes = await fs.readFile(path.join(reference, prior.cachePath));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== prior.sha256) throw new Error(`Evidence checksum mismatch: ${id}`);
    inventory.push(prior);
    return bytes.toString('utf8');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = path.extname(new URL(url).pathname) || '.html';
  const filename = `${id}${extension}`;
  await fs.writeFile(path.join(cache, filename), bytes);
  inventory.push({ id, url, finalUrl: response.url, context, retrievedAt: new Date().toISOString(), byteLength: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), contentType: response.headers.get('content-type'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), cachePath: `cache/club-2026-09-07/${filename}`, captureDate: null, nativeCrs: null, coordinateOrder: null, sourceAccuracy: 'not stated', rights: 'Public viewing; no derivative or redistribution grant found. Local reference only; raw bytes must not ship.' });
  return bytes.toString('utf8');
}
for (const [id, url] of pages) {
  const html = await retain(id, url, 'public source page');
  const tags = [...html.matchAll(/<(?:img|iframe|a|script)\b[^>]*(?:src|href)=[^>]*>/gi)].map(match => match[0]);
  const media = tags.filter(tag => /media|iframe|youtube|banguider|vimeo|\.js/i.test(tag));
  discovery.push({id, url, tags: media});
  console.log(`${id}: ${media.length} reference tags`);
}
const decode = value => value.replaceAll('&amp;', '&').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
const attribute = (tag, name) => decode(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '');
const seen = new Set();
for (const page of discovery) {
  if (!['scorecard-rules', 'banguide', 'gallery', 'gallery-2026', 'historical-routing', 'course-council', 'course-council-2024', 'practice-areas'].includes(page.id)) continue;
  for (const tag of page.tags) {
    const href = attribute(tag, 'href');
    const src = attribute(tag, 'src');
    const chosen = href || src;
    if (!chosen || /lgklogo/i.test(chosen)) continue;
    if (!/\.(?:jpe?g|png|webp|pdf)(?:\?|$)/i.test(chosen)) continue;
    if (page.id !== 'banguide' && !chosen.includes('/media/')) continue;
    if (page.id === 'banguide' && !chosen.includes('/uploads/product/')) continue;
    const assetUrl = new URL(chosen, page.url);
    assetUrl.search = '';
    if (seen.has(assetUrl.href)) continue;
    seen.add(assetUrl.href);
    const base = path.basename(assetUrl.pathname, path.extname(assetUrl.pathname));
    const id = `${page.id}-${base}`;
    await retain(id, assetUrl.href, {parentPage: page.url, sourcePageId: page.id, label: attribute(tag, 'alt') || base, type: /\.pdf$/i.test(assetUrl.pathname) ? 'club-document' : page.id === 'banguide' || page.id === 'historical-routing' ? 'ungeoreferenced-course-diagram' : page.id === 'scorecard-rules' ? 'scorecard' : 'photograph'});
  }
}
const flyovers = discovery.find(page => page.id === 'flyovers').tags.filter(tag => tag.startsWith('<iframe') && tag.includes('youtube.com')).map(tag => {
  const title = attribute(tag, 'title');
  const embedUrl = attribute(tag, 'src');
  const videoId = new URL(embedUrl).pathname.split('/').pop();
  return { hole: Number(title.match(/Hål (\d+)/)?.[1]), title, statedYear: 2023, sourcePage: 'https://www.lidingogk.se/banan/flyover/', url: `https://www.youtube.com/watch?v=${videoId}`, embedUrl, captureDate: null, status: 'Club-linked playback reference; video bytes not downloaded; title year is not an independently verified capture date.' };
}).sort((a, b) => a.hole - b.hole);
await fs.writeFile(inventoryPath, JSON.stringify({schemaVersion: 1, retrievedAt: new Date().toISOString(), sourceScope: 'Club and club-linked public reference materials. No geometry authority or redistribution permission inferred. Re-run verifies retained snapshots; create a new dated snapshot for source updates.', assets: inventory, flyovers}, null, 2) + '\n');
await fs.writeFile(path.join(cache, 'discovery.json'), JSON.stringify(discovery, null, 2) + '\n');
console.log(`Retained ${inventory.length} source assets and ${flyovers.length} video references.`);
