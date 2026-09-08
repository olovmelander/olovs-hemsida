#!/usr/bin/env node
// Rebuild factual references from retained, checksummed website evidence. No geometry adoption.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reference = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(reference, '../..');
const snapshot = path.resolve(root, process.argv[2] ?? 'visbybuild/cache/club-sources-2026-09-07-full');
const downloads = JSON.parse(await readFile(path.join(snapshot, 'downloads.json'), 'utf8'));
const retained = new Map();
for (const source of downloads.downloads) {
  const local = path.resolve(root, source.localPath);
  if (!local.startsWith(snapshot + path.sep)) throw new Error(`Source outside snapshot: ${source.id}`);
  const bytes = await readFile(local);
  if (bytes.length !== source.byteLength || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Source checksum mismatch: ${source.id}`);
  retained.set(source.id, bytes);
}
const caddee = JSON.parse(retained.get('caddee').toString('utf8').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)[1]).props.pageProps;
const main = caddee.courseArray.find(c => c.id === 'c33d3bba-77d2-4ba6-8f88-9723bd3a23ec');
const official = JSON.parse(retained.get('sgf-scorecard'));
const teeNames = ['63', '59', '55', '51', '46', '41'];
const normalize = h => ({ number: h.holeNumber ?? h.number, par: h.par, index: h.index, lengths: Object.fromEntries(teeNames.map(t => [`tee-${t}`, (h.teeLengths ?? h.tees).find(x => x.name === t)?.length])) });
const holes = official.holeTeeInformation.map(normalize).sort((a, b) => a.number - b.number);
if (JSON.stringify(holes) !== JSON.stringify(main.holes.map(normalize))) throw new Error('Official SGF and club-linked Caddee cards differ; review before adoption');
if (holes.length !== 18 || holes.some((h, i) => h.number !== i + 1) || holes.reduce((sum, h) => sum + h.par, 0) !== 72 || new Set(holes.map(h => h.index)).size !== 18 || holes.some(h => h.index < 1 || h.index > 18)) throw new Error('Card identity / par / stroke-index validation failed');
const tees = teeNames.map(name => {
  const id = `tee-${name}`;
  const front = holes.slice(0, 9).reduce((sum, h) => sum + h.lengths[id], 0);
  const back = holes.slice(9).reduce((sum, h) => sum + h.lengths[id], 0);
  const total = front + back;
  if (total !== main.tee_lengths.find(t => t.name === name)?.length) throw new Error(`Total mismatch tee ${name}`);
  return { id, name, front, back, total };
});
const source = downloads.downloads.find(d => d.id === 'sgf-scorecard');
const corroboration = downloads.downloads.find(d => d.id === 'caddee');
const card = {
  schemaVersion: 1, courseId: 'visby', courseName: 'Visby Golfklubb – 18-hålsbanan', holeCount: 18, par: 72, unit: 'metres',
  source: {
    url: source.url, parentPage: source.parentPage, assetId: source.id, sha256: source.sha256, retrievedDate: source.retrievedAt.slice(0, 10),
    editionLabel: 'Current public SGF scorecard embedded on the club golf page at retrieval; no edition date supplied', publicationDate: null, captureDate: null,
    method: 'Extracted from original SGF widget HTTP response in normal club browser context; all 18 pars, 18 indexes and 108 lengths agree exactly with club-linked Caddee; all six totals agree with Caddee published tee totals. Front/back sums derived.',
    reviewer: 'Codex machine comparison; no independent human review',
    decision: 'Factual routing/card evidence only. Numeric tee identities retained; no tee-pad position, height or spatial authority established.',
    rights: 'No redistribution grant for source pages, diagrams or photos found. Raw source evidence remains in ignored cache. This file records factual numeric card values.',
  },
  corroboration: { url: corroboration.url, sha256: corroboration.sha256, providerCourseId: main.id },
  tees, holes,
  notes: [
    'Club prose states approximately 6,300 m from back tee; current exact SGF/Caddee tee 63 total is 6,230 m.',
    'Use numeric tee names. Caddee color mappings and sort orders differ between the main course and nine-hole course; no global color-to-number conversion is adopted.',
    'Separate Hål 19–27 (9 hålsb) is not this routing. Caddee repeats its nine holes as an 18-hole scorecard; repetitions are not additional physical holes.',
  ],
  links: { club: 'https://www.visbygk.com/', overview: 'https://www.visbygk.com/om-banorna/', banguide: corroboration.url, interactiveGuide: corroboration.url, scorecard: source.parentPage, gallery: 'https://www.visbygk.com/om-banorna/', localRules: source.parentPage, practice: 'https://www.visbygk.com/trackman-range/', videos: 'https://www.youtube.com/@visbygolfklubb1958', press: 'https://www.visbygk.com/press-media/' },
};
await writeFile(path.join(reference, 'club-scorecard.json'), JSON.stringify(card, null, 2) + '\n');

function dimensions(bytes) {
  if (bytes.subarray(1, 4).toString() === 'PNG') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let p = 2; p + 8 < bytes.length;) {
      if (bytes[p] !== 0xff) break;
      const marker = bytes[p + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: bytes.readUInt16BE(p + 7), height: bytes.readUInt16BE(p + 5) };
      if (marker === 0xd9 || marker === 0xda) break;
      p += 2 + bytes.readUInt16BE(p + 2);
    }
  }
  return null;
}
const inventory = {
  schemaVersion: 1, groundId: 'visby', retrievedDate: downloads.retrievedDate,
  status: 'source-intake; no spatial registration, survey accuracy or redistribution grant established for club imagery',
  toolchain: downloads.toolchain,
  spatialPolicy: { diagrams: 'Ungeoreferenced illustrative drawings, for identity and routing corroboration only', photos: 'Unknown camera calibration/viewpoint accuracy; no survey claim', sourceCrs: null, captureDate: null, approvedOrigin: null },
  rights: downloads.rights,
  courses: caddee.club.courses.map(c => ({ providerCourseId: c.id, name: c.name, physicalHoleCount: c.number_of_holes, par: c.total_par, serializedCardHoles: c.holes.length, displayOnlyCoordinate: { crs: 'OGC:CRS84', axisOrder: ['longitude', 'latitude'], coordinates: [Number(c.longitude), Number(c.latitude)], sourceDeclaredAccuracy: null, approval: 'unapproved course-level location; never a hole or origin control' }, overviewSourceId: `caddee-${c.number_of_holes}-overview`, holes: c.holes.slice(0, c.number_of_holes).map(h => ({ number: h.number, par: h.par, index: h.index, sourceHoleId: h.id, diagramSourceId: `caddee-${c.number_of_holes}-hole-${String(h.number).padStart(2, '0')}` })) })),
  downloads: downloads.downloads.map(d => ({ ...d, rasterDimensions: dimensions(retained.get(d.id)), attribution: d.id.startsWith('caddee') ? 'Caddee; source diagrams carry © Caddee' : 'Visby Golfklubb / Kronholmen Golf AB and indicated photographer/provider; source-specific permission unresolved', redistribution: 'not-approved; local research only' })),
  discoveredLinks: downloads.discoveredLinks,
  validation: { checkedHashes: retained.size, checkedMainHoles: 18, checkedTeeLengths: 108, checkedTeeTotals: 6, parSum: 72, strokeIndexPermutation: true, perHoleCoordinatesFound: false, overviewImageSharedByBothRoutings: downloads.downloads.find(d => d.id === 'caddee-18-overview').sha256 === downloads.downloads.find(d => d.id === 'caddee-9-overview').sha256 },
};
await writeFile(path.join(reference, 'club-resources.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ card: 'visbybuild/reference/club-scorecard.json', inventory: 'visbybuild/reference/club-resources.json', ...inventory.validation, tees }, null, 2));
