#!/usr/bin/env node
// Public, club-linked evidence only. Raw website/image bytes stay in an ignored cache.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(root, process.argv[2] ?? `visbybuild/cache/club-sources-${new Date().toISOString().replaceAll(':', '-')}`);
if (!out.startsWith(path.join(root, 'visbybuild/cache') + path.sep)) throw new Error('Output must be below visbybuild/cache');
execFileSync('git', ['check-ignore', path.join(out, 'probe')], { cwd: root, stdio: 'ignore' });
await mkdir(out, { recursive: true });
try { await readFile(path.join(out, 'downloads.json')); throw new Error('Snapshot already exists; choose a new output directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const sources = [
  ['club-home', 'https://www.visbygk.com/'],
  ['club-golf', 'https://www.visbygk.com/golf/'],
  ['club-courses', 'https://www.visbygk.com/om-banorna/'],
  ['club-practice', 'https://www.visbygk.com/trackman-range/'],
  ['club-press', 'https://www.visbygk.com/press-media/'],
  ['club-directions', 'https://www.visbygk.com/besoka-kronholmen/'],
  ['club-location', 'https://www.visbygk.com/hitta-hit/'],
  ['club-about', 'https://www.visbygk.com/om-oss/'],
  ['caddee', 'https://www.caddee.se/klubb/visby-golfklubb'],
];
const manifest = { schemaVersion: 1, retrievedDate: new Date().toISOString().slice(0, 10), toolchain: `Node ${process.version}; global fetch; SHA-256`, rights: 'Publicly viewable research evidence. No redistribution grant established; raw bytes excluded from Git and runtime.', downloads: [] };
const bodies = new Map();
async function acquire(id, url, ext = '.html', context = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = id + ext;
  await writeFile(path.join(out, file), bytes);
  manifest.downloads.push({ id, url, resolvedUrl: response.url, localPath: path.relative(root, path.join(out, file)).replaceAll(path.sep, '/'), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString(), contentType: response.headers.get('content-type'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), captureDate: null, sourceCrs: null, accuracy: null, ...context });
  await writeFile(path.join(out, 'downloads.json'), JSON.stringify(manifest, null, 2) + '\n');
  bodies.set(id, bytes);
  console.log(`${id}: ${bytes.length} bytes`);
}
for (const [id, url] of sources) await acquire(id, url);
const caddee = JSON.parse(bodies.get('caddee').toString('utf8').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)[1]).props.pageProps;
await writeFile(path.join(out, 'caddee-next-data.json'), JSON.stringify(caddee, null, 2) + '\n');
for (const course of caddee.club.courses) {
  const label = course.number_of_holes === 18 ? '18' : '9';
  await acquire(`caddee-${label}-overview`, course.overview_image.normal, '.png', { role: 'ungeoreferenced-routing-diagram', providerCourseId: course.id, physicalHoleCount: course.number_of_holes });
  for (const hole of course.holes.slice(0, course.number_of_holes)) {
    await acquire(`caddee-${label}-hole-${String(hole.number).padStart(2, '0')}`, hole.detail_image.normal, '.png', { role: 'ungeoreferenced-hole-diagram', providerCourseId: course.id, holeNumber: hole.number });
  }
  for (const [index, img] of course.images.entries()) await acquire(`caddee-${label}-photo-${index + 1}`, img.normal, '.png', { role: 'course-reference-photo', providerCourseId: course.id });
}
const discoveredLinks = [];
for (const [id] of sources.filter(([id]) => id.startsWith('club-'))) {
  for (const match of bodies.get(id).toString('utf8').matchAll(/(?:src|href|data-src)=["']([^"']+)["']/g)) {
    const url = match[1].replaceAll('&amp;', '&');
    if (/uploads\/.*\.(?:jpe?g|png|mp4)|youtube|vimeo|webcam|goo.gl\/maps/.test(url) && !/favicon|sb-instagram|complianz/.test(url)) {
      if (!discoveredLinks.some(x => x.url === url)) discoveredLinks.push({ id: `club-linked-${discoveredLinks.length + 1}`, url, parentPageId: id, status: 'discovered', captureDate: null, rights: 'No redistribution grant established' });
    }
  }
}
for (const link of discoveredLinks.filter(link => /Visby.*(?:Sjoman|JSjoman)|visby-golfclub-ocean|traning-green|Putt3|ce6d6b35315b67b023956e74fbfb8e2c54dd5675|e8875eb051bcbbcdb8cf7467dd4d4be20d335f15|97ca1824952d321cda4f66c558f797220de3123e|0e4a0428d1af3be0531079da242479f1aeb52d12/i.test(link.url))) {
  await acquire(link.id, link.url, path.extname(new URL(link.url).pathname), { role: 'club-reference-photo', parentPageId: link.parentPageId, sourcePublicationYearHint: new URL(link.url).pathname.match(/uploads\/(\d{4})\/(\d{2})/)?.[0] ?? null });
  link.status = 'downloaded';
}
await acquire('club-historic-slope-men', 'https://www.visbygk.com/wp-content/uploads/2021/05/VISBY_GK_18_halsbanan_Men.pdf', '.pdf', { role: 'historical-rating-not-current-scorecard', ratingDate: '2014-02-22', publicationDate: null });
await acquire('club-hole-18-article', 'https://www.visbygk.com/wp-content/uploads/2024/06/SVG-Topp50-En-dag-pa_24_05.pdf', '.pdf', { role: 'published-hole-18-history-photo-reference', editionLabel: 'Svensk Golf 5-2024', publicationDate: null });

// The official site's public SGF widget verifies its registered embedding domain.
// Read its actual browser response in normal site context; no request-header impersonation.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VISBY_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const url = 'https://prd-sgf-widget-api.azurewebsites.net/api/widget/302e8ccf-fb86-4d6f-9d65-3348e0ecd29b/scorecard';
  const pending = page.waitForResponse(r => r.url() === url, { timeout: 60000 });
  await page.goto('https://www.visbygk.com/golf/', { waitUntil: 'domcontentloaded' });
  const response = await pending;
  if (!response.ok()) throw new Error(`Official SGF widget: HTTP ${response.status()}`);
  const bytes = await response.body();
  const file = path.join(out, 'sgf-scorecard.json');
  await writeFile(file, bytes);
  manifest.downloads.push({ id: 'sgf-scorecard', url, parentPage: 'https://www.visbygk.com/golf/', localPath: path.relative(root, file).replaceAll(path.sep, '/'), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString(), contentType: response.headers()['content-type'], etag: response.headers().etag ?? null, lastModified: response.headers()['last-modified'] ?? null, captureDate: null, publicationDate: null, sourceCrs: null, accuracy: null, method: 'Original HTTP response body from official SGF widget embedded on club golf page, read with headless Chromium' });
} finally { await browser.close(); }
manifest.discoveredLinks = discoveredLinks;
await writeFile(path.join(out, 'downloads.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Saved ${path.relative(root, out)}/downloads.json`);
