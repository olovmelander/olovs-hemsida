#!/usr/bin/env node
/* Source-only course authoring. This deliberately cannot emit a GPK1 pack:
 * an OSM route endpoint is not a green outline or a surveyed tee marker. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
};

export function buildIntake(card, golf) {
  const sourceCard = card;
  card = { teeNames: sourceCard.tees?.map(t => t.name), holes: sourceCard.holes?.map(h => ({
    n: h.number, par: h.par, hcp: h.index, t: sourceCard.tees.map(t => h.lengths?.[t.id]),
  })) };
  if (golf.crs?.properties?.name !== 'EPSG:3006') throw new Error('Golf master vectors must declare EPSG:3006');
  if (card.holes?.length !== 18 || card.teeNames?.length !== 5) throw new Error('Expected the official 18-hole, five-tee card');
  const indices = new Set();
  const routes = golf.features.filter(f => f.properties.tags.golf === 'hole');
  if (routes.length !== 18) throw new Error('Expected exactly 18 source routes');
  const holes = card.holes.map((hole, index) => {
    if (hole.n !== index + 1 || !Number.isInteger(hole.par) || hole.par < 3 || hole.par > 5 ||
        !Number.isInteger(hole.hcp) || hole.hcp < 1 || hole.hcp > 18 || indices.has(hole.hcp) ||
        hole.t?.length !== 5 || hole.t.some(n => !Number.isInteger(n) || n <= 0)) throw new Error(`Invalid official card row ${index + 1}`);
    indices.add(hole.hcp);
    const candidates = routes.filter(f => Number(f.properties.tags.ref) === hole.n);
    if (candidates.length !== 1) throw new Error(`Missing or duplicate route for hole ${hole.n}`);
    const route = candidates[0];
    if (Number(route.properties.tags.par) !== hole.par) throw new Error(`Club/OSM par disagreement on hole ${hole.n}`);
    if (route.geometry.type !== 'LineString' || route.geometry.coordinates.length < 2) throw new Error(`Invalid route ${hole.n}`);
    return { ...hole, routeId: route.id, route: route.geometry.coordinates,
      geometryStatus: 'supplementary-unreviewed', teeMarkers: null, pin: null };
  });
  if (holes.reduce((sum, h) => sum + h.par, 0) !== 70) throw new Error('Official par must total 70');
  const teeTotals = card.teeNames.map((_, i) => holes.reduce((sum, h) => sum + h.t[i], 0));
  // Independent values transcribed from the printed totals, not derived from rows.
  const printedTotals = [5786, 5373, 5058, 4518, 3965];
  if (teeTotals.some((n, i) => n !== printedTotals[i])) throw new Error('Card rows do not reconcile with the printed totals');
  const points = [];
  const visit = value => {
    if (Array.isArray(value) && typeof value[0] === 'number') {
      if (value.length !== 2 || !value.every(Number.isFinite) || value[0] < 676000 || value[0] > 680000 || value[1] < 6584000 || value[1] > 6589000) throw new Error('Source coordinate outside the Lidingö ground');
      points.push(value);
    } else if (Array.isArray(value)) value.forEach(visit);
    else throw new Error('Invalid source geometry');
  };
  const features = golf.features.map(f => {
    visit(f.geometry.coordinates);
    return { id: f.id, kind: f.properties.tags.golf, geometry: f.geometry };
  });
  const counts = Object.fromEntries(['hole', 'green', 'tee', 'fairway', 'bunker'].map(kind => [kind, features.filter(f => f.kind === kind).length]));
  return {
    schemaVersion: 1, groundId: 'lidingo', slug: 'lidingo', name: 'Lidingö Golfklubb',
    state: 'mapping-in-progress', playable: false, horizontalCrs: 'EPSG:3006',
    axisOrder: ['easting', 'northing'], frameStatus: 'pending-independent-control',
    card: { teeNames: card.teeNames, teeTotals, par: 70, holes }, features, counts,
    bounds: { west: Math.min(...points.map(p => p[0])), east: Math.max(...points.map(p => p[0])), south: Math.min(...points.map(p => p[1])), north: Math.max(...points.map(p => p[1])) },
    releaseGates: {
      officialCard: true, routeParCrosscheck: true, independentControls: false,
      perHoleRoutingReview: false, completePlayingSurfaces: false,
      vegetationReview: false, hydrologyReview: false, runtime3dReview: false,
    },
    limitations: [
      'Rutterna kommer från OpenStreetMap och behöver granskas mot klubbens banguide.',
      'Kartlagda ytor är ofullständiga. Tee-färger, flaggplaceringar och saknade ytor har inte gissats.',
      '3D-banan öppnas när geometri, terräng och vegetation har granskats tillsammans.',
    ],
  };
}

export function overviewSvg(intake) {
  const b = intake.bounds, margin = 60, width = b.east - b.west + margin * 2, height = b.north - b.south + margin * 2;
  const coords = ring => ring.map(([e, n]) => `${(e - b.west + margin).toFixed(2)},${(b.north - n + margin).toFixed(2)}`).join(' ');
  const colors = { green: '#70c59b', tee: '#a4d7b5', fairway: '#376b50', bunker: '#d5c396', driving_range: '#284d3a' };
  const polygons = intake.features.filter(f => f.geometry.type === 'Polygon' && colors[f.kind]).map(f => `<polygon points="${coords(f.geometry.coordinates[0])}" fill="${colors[f.kind]}"/>`).join('');
  const lines = intake.card.holes.map(h => `<polyline points="${coords(h.route)}" fill="none" stroke="#c6dace" stroke-width="2" stroke-dasharray="5 5"/><circle cx="${h.route[0][0] - b.west + margin}" cy="${b.north - h.route[0][1] + margin}" r="13" fill="#e7f1db"/><text x="${h.route[0][0] - b.west + margin}" y="${b.north - h.route[0][1] + margin + 4}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#11271e">${h.n}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><title>Lidingö: preliminär bankarta</title><rect width="100%" height="100%" fill="#122b22"/>${polygons}${lines}<text x="25" y="35" fill="#c6dace" font-family="sans-serif" font-size="17">N ↑</text></svg>\n`;
}

function main() {
  const cardPath = 'lidingobuild/reference/club-scorecard.json';
  const golfPath = 'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson';
  const card = read(cardPath);
  const intake = buildIntake(card, read(golfPath));
  intake.sources = [
    { id: 'club-scorecard', path: cardPath, sha256: hash(cardPath), url: 'https://www.lidingogk.se/banan/slope-lokala-regler-aeven-scorekort/' },
    { id: 'lidingo-osm-2026-09-07', path: golfPath, sha256: hash(golfPath), url: 'https://www.openstreetmap.org/relation/3942404', licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
  ];
  intake.resources = [
    { label: 'Klubbens banguide', url: 'https://www.lidingogk.se/banan/nya-banguiden/' },
    { label: 'Scorekort och lokala regler', url: 'https://www.lidingogk.se/banan/slope-lokala-regler-aeven-scorekort/' },
    { label: 'Banan hos Lidingö GK', url: 'https://www.lidingogk.se/banan/' },
    { label: 'Flyover – alla 18 hål', url: card.links.flyovers },
    { label: 'Klubbens bildgalleri 2026', url: card.links.gallery2026 },
    { label: 'Lokala regler 2026', url: card.links.localRules },
  ];
  write('lidingobuild/mapping/intake.json', intake);
  const intakeSha256 = hash('lidingobuild/mapping/intake.json');
  const previewUrl = `courses/lidingo/intake-${intakeSha256}.json`;
  write(`apps/golf/public/${previewUrl}`, intake);
  fs.writeFileSync(path.join(ROOT, 'apps/golf/public/courses/lidingo/overview.svg'), overviewSvg(intake));
  write('apps/golf/src/data/lidingo-preview.json', {
    slug: 'lidingo', name: 'Lidingö GK', club: 'Lidingö Golfklubb', tag: 'Lidingö · Stockholm',
    status: 'mapping', par: intake.card.par, holes: intake.card.holes.length,
    tees: { names: intake.card.teeNames }, photos: 0,
    overviewUrl: 'courses/lidingo/overview.svg', previewUrl,
    previewSha256: intakeSha256,
    description: '18 hål på Lidingö. Utforska scorekort och preliminär bankarta medan 3D-banan kartläggs.',
  });
  console.log(JSON.stringify({ state: intake.state, holes: intake.card.holes.length, counts: intake.counts, releaseGates: intake.releaseGates }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
