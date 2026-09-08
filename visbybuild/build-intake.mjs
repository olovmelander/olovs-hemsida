#!/usr/bin/env node
// Reproducible, source-only Kronholmen intake. No inferred pads, pins or GPK1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../packages/course-geo/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const hash = file => sha256File(path.join(ROOT, file));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
};

export function buildIntake(card, golf) {
  if (card.courseId !== 'visby' || card.holeCount !== 18 || card.par !== 72 || card.holes?.length !== 18 || card.tees?.length !== 6) {
    throw new Error('Expected Visby main course: 18 holes, par 72, six tees');
  }
  if (golf.type !== 'FeatureCollection' || golf.crs?.properties?.name !== 'EPSG:3006') throw new Error('Golf master vectors must declare EPSG:3006');
  const ids = new Set(), points = [];
  const visit = value => {
    if (!Array.isArray(value) || !value.length) throw new Error('Invalid source geometry');
    if (typeof value[0] === 'number') {
      if (value.length !== 2 || !value.every(Number.isFinite) || value[0] < 680000 || value[0] > 695000 || value[1] < 6360000 || value[1] > 6380000) throw new Error('Source coordinate outside Kronholmen');
      points.push(value);
    } else value.forEach(visit);
  };
  // OSM covers the shared 27-hole property. Unassigned outlines stay ground
  // observations; they must not be labelled as particular holes on the main 18.
  const groundFeatures = golf.features.filter(f => f.properties.tags.golf || f.properties.tags.leisure === 'golf_course');
  const features = groundFeatures.map(f => {
    if (!f.id || ids.has(f.id)) throw new Error('Missing or duplicate source feature ID');
    ids.add(f.id);
    if (!['LineString', 'Polygon', 'MultiPolygon', 'Point'].includes(f.geometry?.type)) throw new Error(`Unsupported geometry ${f.id}`);
    visit(f.geometry.coordinates);
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const rings of polygons) for (const ring of rings) {
      if (ring.length < 4 || ring[0].some((n, i) => n !== ring.at(-1)[i])) throw new Error(`Unclosed source polygon ${f.id}`);
    }
    return { id: f.id, kind: f.properties.tags.golf ?? 'golf_course', geometry: f.geometry, holeNumber: null, geometryStatus: 'supplementary-unreviewed' };
  });
  if (!points.length) throw new Error('No source geometry');
  const unassignedRoutes = groundFeatures.filter(f => f.properties.tags.golf === 'hole').map(f => ({
    sourceId: f.id, sourceRef: f.properties.tags.ref ?? null, sourcePar: f.properties.tags.par ?? null,
    decision: 'unresolved-course-and-hole-association',
  }));
  const indices = new Set(), teeIds = new Set(card.tees.map(t => t.id));
  if (teeIds.size !== 6 || card.tees.some(t => !t.id || !t.name)) throw new Error('Missing or duplicate tee identity');
  const holes = card.holes.map((h, i) => {
    const lengths = card.tees.map(t => h.lengths?.[t.id]);
    if (h.number !== i + 1 || ![3, 4, 5].includes(h.par) || !Number.isInteger(h.index) || h.index < 1 || h.index > 18 || indices.has(h.index) || lengths.some(n => !Number.isInteger(n) || n <= 0)) throw new Error(`Invalid official card row ${i + 1}`);
    indices.add(h.index);
    // The current extract's two ref=2 lines cannot establish main-course
    // ownership. Leave every routing association unresolved until reviewed.
    return { n: h.number, par: h.par, hcp: h.index, t: lengths, routeId: null, route: null,
      geometryStatus: 'routing-unavailable', teeMarkers: null, pin: null };
  });
  if (holes.reduce((sum, h) => sum + h.par, 0) !== 72) throw new Error('Card par does not reconcile');
  for (const [i, tee] of card.tees.entries()) {
    const front = holes.slice(0, 9).reduce((sum, h) => sum + h.t[i], 0);
    const back = holes.slice(9).reduce((sum, h) => sum + h.t[i], 0);
    if (front !== tee.front || back !== tee.back || front + back !== tee.total) throw new Error(`Source card totals disagree for tee ${tee.name}`);
  }
  return {
    schemaVersion: 1, groundId: 'visby', slug: 'visby', name: 'Visby Golfklubb · 18-hålsbanan',
    state: 'mapping-in-progress', playable: false, horizontalCrs: 'EPSG:3006',
    axisOrder: ['easting', 'northing'], frameStatus: 'pending-independent-control',
    card: { teeNames: card.tees.map(t => t.name), teeTotals: card.tees.map(t => t.total), par: 72, holes },
    features, unassignedRoutes, counts: Object.fromEntries(['hole', 'green', 'tee', 'fairway', 'bunker'].map(kind => [kind, features.filter(f => f.kind === kind).length])),
    bounds: { west: Math.min(...points.map(p => p[0])), east: Math.max(...points.map(p => p[0])), south: Math.min(...points.map(p => p[1])), north: Math.max(...points.map(p => p[1])) },
    releaseGates: { officialCard: true, routeParCrosscheck: false, independentControls: false,
      perHoleRoutingReview: false, completePlayingSurfaces: false, vegetationReview: false, hydrologyReview: false, runtime3dReview: false },
    progressNote: 'Scorekortet gäller 18-hålsbanan. Kartans ytor visar hela Kronholmens golfområde, som även rymmer 9-hålsbanan. Hålens geografiska rutter och ytornas håltillhörighet behöver fastställas med klubbens banguide och flygbilder.',
    limitations: [
      'OpenStreetMap-ytornas håltillhörighet är okänd. Ofullständiga och tvetydiga rutter har inte kopplats till scorekortet.',
      'Tee-namn är scorekortets längdbeteckningar. Färger, exakta markörer och flaggplaceringar har inte antagits.',
      'Flygbilder och klubbens bilder används som kartläggningsunderlag; 3D-banan är ännu inte färdig.',
    ],
  };
}

export function overviewSvg(intake) {
  const b = intake.bounds, margin = 45, width = b.east - b.west + 2 * margin, height = b.north - b.south + 2 * margin;
  const coords = ring => ring.map(([e, n]) => `${(e - b.west + margin).toFixed(2)},${(b.north - n + margin).toFixed(2)}`).join(' L');
  const colors = { green: '#79c797', tee: '#bcddaf', fairway: '#477953', bunker: '#dccb9d', driving_range: '#345943', golf_course: 'none' };
  const polygons = intake.features.filter(f => colors[f.kind]).flatMap(f => {
    const parts = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    return parts.map(rings => `<path d="${rings.map(r => `M${coords(r)} Z`).join(' ')}" fill="${colors[f.kind]}"${f.kind === 'golf_course' ? ' stroke="#769485" stroke-width="2" stroke-dasharray="8 6"' : ''} fill-rule="evenodd"/>`);
  }).join('');
  const routes = intake.card.holes.filter(h => h.route).map(h => {
    const [e, n] = h.route[0], x = e - b.west + margin, y = b.north - n + margin;
    return `<path d="M${coords(h.route)}" fill="none" stroke="#c6dace" stroke-width="2" stroke-dasharray="5 5"/><circle cx="${x}" cy="${y}" r="13" fill="#e7f1db"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#11271e">${h.n}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><title>Visby GK: preliminär bankarta · © OpenStreetMap contributors, ODbL</title><rect width="100%" height="100%" fill="#122b22"/>${polygons}${routes}<text x="20" y="30" fill="#c6dace" font-family="sans-serif" font-size="17">N ↑</text></svg>\n`;
}

function main() {
  const cardPath = 'visbybuild/reference/club-scorecard.json';
  const golfPath = 'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson';
  const card = read(cardPath), intake = buildIntake(card, read(golfPath));
  intake.sources = [
    { id: 'club-scorecard', path: cardPath, sha256: hash(cardPath), url: card.source.parentPage ?? card.source.url, label: 'Visby GK:s scorekort', acquiredOn: card.source.retrievedDate },
    { id: 'visby-osm-2026-09-07', path: golfPath, sha256: hash(golfPath), url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
  ];
  intake.resources = [
    { label: 'Klubbens banor', url: 'https://www.visbygk.com/om-banorna/' },
    { label: 'Banguide och scorekort hos Caddee', url: 'https://www.caddee.se/klubb/visby-golfklubb' },
    { label: 'Spela på Visby GK', url: 'https://www.visbygk.com/golf/' },
    { label: 'Hitta till Kronholmen', url: 'https://www.visbygk.com/hitta-hit/' },
    { label: 'Klubbens bilder och pressmaterial', url: 'https://www.visbygk.com/press-media/' },
  ];
  write('visbybuild/mapping/intake.json', intake);
  const digest = hash('visbybuild/mapping/intake.json'), previewUrl = `courses/visby/intake-${digest}.json`;
  write(`apps/golf/public/${previewUrl}`, intake);
  fs.writeFileSync(path.join(ROOT, 'apps/golf/public/courses/visby/overview.svg'), overviewSvg(intake));
  write('apps/golf/src/data/visby-preview.json', {
    slug: 'visby', name: 'Visby GK', club: 'Visby Golfklubb', tag: 'Kronholmen · Gotland', status: 'mapping',
    par: 72, holes: 18, tees: { names: intake.card.teeNames }, photos: 0,
    overviewUrl: 'courses/visby/overview.svg', previewUrl, previewSha256: digest,
    description: '18 hål vid havet på Kronholmen. Utforska scorekort och preliminär bankarta medan 3D-banan kartläggs.',
  });
  console.log(JSON.stringify({ state: intake.state, holes: 18, counts: intake.counts, teeTotals: intake.card.teeTotals, previewUrl }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
