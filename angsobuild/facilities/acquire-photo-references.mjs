// Downloads documented public reference pages and their image candidates.
// Run from repository root: node angsobuild/facilities/acquire-photo-references.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('angsobuild/cache/facilities-2026-09-10/photos');
await fs.mkdir(root, { recursive: true });
const sources = [
  ['club-home', 'https://angsogolfklubb.com/'],
  ['club-restaurant', 'https://angsogolfklubb.com/restaurang/'],
  ['club-lodging', 'https://angsogolfklubb.com/gast/bo-bekvamt-pa-banan/'],
  ['club-motorhomes', 'https://angsogolfklubb.com/gast/husvagn-husbil/'],
  ['club-charging', 'https://angsogolfklubb.com/laddstolpar/'],
  ['club-contact', 'https://angsogolfklubb.com/kontakt/'],
  ['club-business', 'https://angsogolfklubb.com/foretag/'],
  ['club-blog', 'https://angsogolfklubb.com/blogg/'],
  ['tourism-board', 'https://visitvastmanland.com/angso-golfklubb'],
  ['jmi-2020', 'https://www.jmi-sweden.se/web/calendar/20200704-angso-junior-open/'],
  ['visitor-2014', 'https://halsaochkarlek.wordpress.com/2014/05/03/angso-gk/'],
];
const results = [];
const imageCandidates = new Map();
await Promise.allSettled(sources.map(async ([id, url]) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    await fs.writeFile(path.join(root, `${id}.html`), html);
    const raw = [...html.matchAll(/(?:https?:\/\/|\/assets\/|\/wp-content\/)[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi)].map(m => m[0]);
    for (let candidate of raw) {
      candidate = candidate.replaceAll('&amp;', '&');
      const imageUrl = new URL(candidate, url).href;
      if (/logo|sponsor|icon|avatar|analytics|spinner/i.test(imageUrl)) continue;
      const image = imageCandidates.get(imageUrl) ?? { url: imageUrl, pages: [] };
      image.pages.push(id); imageCandidates.set(imageUrl, image);
    }
    results.push({id, url, status: res.status, local: path.relative(process.cwd(), path.join(root, `${id}.html`)).replaceAll('\\','/'), candidates: raw.length});
  } catch (error) { results.push({id, url, error: error.message}); }
}));
await fs.writeFile(path.join(root, 'discovery.json'), JSON.stringify({ retrievedAt: new Date().toISOString(), pages: results, imageCandidates: [...imageCandidates.values()] }, null, 2));
console.log(JSON.stringify({pages:results, imageCandidateCount:imageCandidates.size},null,2));
