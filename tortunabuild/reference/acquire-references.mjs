/** Public-reference intake. Original media remains in ignored private cache. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = 'tortunabuild/cache/reference';
const out = 'tortunabuild/reference';
await fs.mkdir(root, { recursive: true });
const assets = [];
async function acquire(id, url, kind, parentUrl = null) {
  const extension = kind === 'html' ? '.html' : path.extname(new URL(url).pathname);
  const localPath = `${root}/${id}${extension}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (kind === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error(`${id}: not PDF`);
  await fs.writeFile(localPath, bytes);
  const record = {
    id, sourceUrl: url, resolvedUrl: response.url, parentUrl, kind, localPath,
    retrievedAt: new Date().toISOString(), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: response.headers.get('content-type'),
    lastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
    use: 'reference-only', redistribution: 'not-approved; original bytes private',
    captureDate: null,
  };
  assets.push(record);
  console.log(`${id}: ${bytes.length} bytes`);
  return { record, text: bytes.toString('utf8') };
}
const clubUrl = 'https://tortunagk.se/spela-golf/banan/';
const caddeeUrl = 'https://www.caddee.se/klubb/tortuna-golfklubb';
const club = await acquire('club-course', clubUrl, 'html');
await acquire('club-home', 'https://tortunagk.se/', 'html');
await acquire('club-slope', 'https://tortunagk.se/spela-golf/slope-och-lokala-regler/', 'html');
await acquire('club-facilities', 'https://tortunagk.se/anlaggningen/', 'html');
await acquire('club-maintenance-2025', 'https://tortunagk.se/hosterbjudande-2025/', 'html');
const caddee = await acquire('caddee', caddeeUrl, 'html', clubUrl);
const next = JSON.parse(caddee.text.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)[1]);
const course = next.props.pageProps.club.courses[0];
const teeNames = ['Gul', 'Blå', 'Röd', 'Orange'];
const holes = course.holes.map(h => ({
  number: h.number, par: h.par, strokeIndex: h.index,
  teeLengths: teeNames.map(name => h.tees.find(t => t.name === name)?.length ?? null),
  sourceHoleId: h.id, sourceUrl: caddeeUrl,
}));
if (holes.length !== 18 || holes.some(h => h.teeLengths.includes(null))) throw new Error('Incomplete scorecard');
const sum = list => list.reduce((a, b) => a + b, 0);
const card = {
  schemaVersion: 1, groundId: 'tortuna', observedOn: new Date().toISOString().slice(0, 10),
  source: caddeeUrl, sourceId: 'caddee', sourceHtmlSha256: caddee.record.sha256,
  linkedByOfficialClub: club.text.includes('https://www.caddee.se/assets/embed/course.js'),
  status: 'current-club-embedded-third-party-card; numeric facts only',
  editionDate: null, teeNames, teeNamesEnglish: ['Yellow', 'Blue', 'Red', 'Orange'],
  par: sum(holes.map(h => h.par)),
  parOut: sum(holes.slice(0, 9).map(h => h.par)),
  parIn: sum(holes.slice(9).map(h => h.par)),
  teeTotals: teeNames.map((_, i) => sum(holes.map(h => h.teeLengths[i]))),
  teeOut: teeNames.map((_, i) => sum(holes.slice(0, 9).map(h => h.teeLengths[i]))),
  teeIn: teeNames.map((_, i) => sum(holes.slice(9).map(h => h.teeLengths[i]))),
  holes,
  notes: [
    'The official club course page embeds Caddee. Caddee warns this club is not affiliated and graphic currency is not guaranteed.',
    'Official August 2026 slope PDFs independently confirm par 71, rated 2019-08-15.',
    'GolfTraxx retains older par 72 with hole 9 par 4. Current hole 9 is par 3: Gul/Blå 105m, Röd/Orange 95m.',
    'GolfiSverige currently swaps hole 5 yellow/red distances. Caddee live data says Gul 140m, Röd 125m, as its test site and GolfTraxx legacy card also corroborate.',
    'Tee distances do not identify current physical tee positions, tee pad dimensions, or a survey.',
  ],
};
await fs.writeFile(`${out}/scorecard.json`, JSON.stringify(card, null, 2) + '\n');
const routing = [];
for (let h = 1; h <= 18; h++) {
  const url = `https://golftraxx.com/hole-layout?coursename=Tortuna+Golfklubb&hole=${h}&static=true&zipcode=72596SW`;
  const { text, record } = await acquire(`golftraxx-${h}`, url, 'html');
  function coord(prefix) {
    return ['longitude', 'latitude'].map(axis => Number(text.match(new RegExp(`var ${prefix}${axis} = "([^"]+)"`))?.[1]));
  }
  const extras = [...text.matchAll(/<div class="extraslisting"([^>]+)>/g)].map(m => {
    const attributes = Object.fromEntries([...m[1].matchAll(/data-([a-z]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    return { name: attributes.landmarkname, position: attributes.landmarkposition,
      coordinate: [Number(attributes.reachlong), Number(attributes.reachlat)] };
  });
  const tee = extras.find(e => e.name === 'TheTipsTee');
  if (!tee || ![...tee.coordinate, ...coord('gc')].every(Number.isFinite)) throw new Error(`Missing tee/green ${h}`);
  const par = Number(text.match(new RegExp(`Hole# ${h} Par (\\d+)`))?.[1]);
  routing.push({
    number: h, sourceId: `golftraxx-${h}`, sourceUrl: url, sourceHtmlSha256: record.sha256,
    sourcePar: Number.isFinite(par) ? par : null,
    teeBack: tee.coordinate, teeTarget: coord('tt'), greenFront: coord('gf'),
    greenCenter: coord('gc'), greenBack: coord('gb'),
    teeBackStatus: h === 9 ? 'historical-par4-tee; not-current-par3-start' : 'source-back-tee-reference; current-colour-unverified',
    coordinateStatus: 'provisional-legacy-reference; capture-date-and-accuracy-unknown',
  });
}
await fs.writeFile(`${out}/routing-golftraxx.json`, JSON.stringify({
  schemaVersion: 1, groundId: 'tortuna', observedOn: new Date().toISOString().slice(0, 10),
  horizontalCrs: 'EPSG:4326', axisOrder: ['longitude', 'latitude'], use: 'reference-only',
  holes: routing,
  notes: [
    'TheTipsTee Back is the source tee reference; ttlatitude/ttlongitude is a target within the hole, not its tee.',
    'Green front, centre and back are point observations. They do not define a green boundary.',
    'Hole 9 source tee and target belong to an older par 4. Find the present par 3 tee in current licensed imagery before routing.',
    'Do not slide source coordinates to force card lengths. Resolve positions against licensed orthophoto and record any digitized replacement separately.',
    'Public accessibility establishes no production geometry or database redistribution grant.',
  ],
}, null, 2) + '\n');
await acquire('caddee-overview', course.overview_image.normal, 'image', caddeeUrl);
for (const h of course.holes) await acquire(`caddee-hole-${h.number}`, h.detail_image.normal, 'image', caddeeUrl);
for (const [id, url] of [
  ['club-slope-men-2026', 'https://tortunagk.se/wp-content/uploads/2026/08/TORTUNA_GK_Course_Men-2.pdf'],
  ['club-slope-women-2026', 'https://tortunagk.se/wp-content/uploads/2026/08/TORTUNA_GK_Course_Women-orange.pdf'],
  ['club-local-rules-2026', 'https://tortunagk.se/wp-content/uploads/2026/04/Lokala-Regler-2026-1.pdf'],
]) {
  try { await acquire(id, url, 'pdf', 'https://tortunagk.se/spela-golf/slope-och-lokala-regler/'); }
  catch (error) { assets.push({ id, sourceUrl: url, status: 'unavailable', reason: error.message }); }
}
const photoUrls = new Map();
for (const asset of assets.filter(a => a.kind === 'html' && a.id.startsWith('club-'))) {
  const html = await fs.readFile(asset.localPath, 'utf8');
  for (const m of html.matchAll(/https:\/\/tortunagk\.se\/wp-content\/uploads\/[^"'<>\s]+\.(?:jpg|jpeg|webp)/g)) {
    photoUrls.set(m[0], asset.sourceUrl);
  }
}
let imageNumber = 0;
for (const [url, parentUrl] of photoUrls) {
  try { await acquire(`club-photo-${++imageNumber}`, url, 'image', parentUrl); }
  catch (error) { assets.push({ sourceUrl: url, status: 'unavailable', reason: error.message }); }
}
await fs.writeFile(`${out}/source-assets.json`, JSON.stringify({
  schemaVersion: 1, groundId: 'tortuna', retrievedAt: new Date().toISOString(),
  originalMediaPolicy: 'private ignored cache; no original photograph, guide graphic, HTML or PDF redistribution',
  sourceFactsPolicy: 'Retained factual scorecard and explicitly provisional reference points; no survey or production geometry approval.',
  assets,
}, null, 2) + '\n');
console.log(`Retained ${assets.length} asset records; card par ${card.par}; tee totals ${card.teeTotals}`);
