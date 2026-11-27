#!/usr/bin/env node
/* Upsala's first decision files for pipeline v2, written from the September 2026 reviewed models.

   node upsalabuild/mapping/make-decisions.mjs

   Upsala was built with its own builder. Its September reviews already put every tee platform, green and the
   routing on Lantmäteriet's June 2025 photo (upsalabuild/mapping/NEXT-SESSION.md and the reviews it links): 56 Stora
   and 24 Mellan decks drawn on that photo, five Stora and all nine Mellan greens traced on it, the other Stora
   greens OSM's outlines checked against it. Those are evidence, so the decisions start from them and the tracer
   measures each again on the photo:

   - a deck drawn on the photo is a `ring` deck (refined 0.9 m on the photo, then held to the terrain by
     deck-ground.mjs); the two Stora decks the reviews left as provisional originals say so in their reason;
   - a tee the reviews placed on a visible site and not on a deck (most 42 and Orange tees, which are marks on the
     fairway, and Stora 13's 51/47 and 15's 62 under the canopy edge) gets a small `ellipse` deck at that site,
     kept as drawn (`reach` 0), and its reason says which;
   - every green starts from its reviewed ring and is refined on the photo;
   - each hole's bends are its reviewed line's inner points.

   It also writes each routing's card in the pipeline's form (reference/club-scorecard.json) from the verified cards
   (upsalabuild/card.json, upsalabuild/card-mellanbanan.json). Run it once; after that the decision files are edited
   by hand, each change with its reason. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 1)}\n`);
  console.log('wrote', file);
};
const round1 = v => Math.round(v * 10) / 10;
const pt = p => [round1(p[0]), round1(p[1])];
const REVIEWED_ON = '2026-11-27';
const REVIEWER = 'Claude Opus 5.5 (agent), from the September 2026 reviews on the 2025-06-14 0.16 m RGBI orthophoto, re-measured on the same flight and the 1 m laser terrain';

const ROUTINGS = [
  {
    slug: 'upsala',
    build: 'upsalabuild',
    courseName: 'Upsala GK Stora banan',
    migration: 'geo_data/course-v2/upsala/migration/course-model.epsg3006.json',
    card: 'upsalabuild/card.json',
    tees: [
      { id: '62', name: '62', color: '#1a1a1a' },
      { id: '59', name: '59', color: '#f4f4ee' },
      { id: '56', name: '56', color: '#f0c93a' },
      { id: '51', name: '51', color: '#4a8fe0' },
      { id: '47', name: '47', color: '#e0574a' },
      { id: '42', name: '42', color: '#e08b3a' },
    ],
    totals: [6192, 5888, 5565, 5118, 4722, 4222],
    ratings: {
      '62': { ratingMen: { cr: 74.5, slope: 140 } },
      '59': { ratingMen: { cr: 72.5, slope: 139 }, ratingWomen: { cr: 78.2, slope: 145 } },
      '56': { ratingMen: { cr: 71.3, slope: 135 }, ratingWomen: { cr: 76.4, slope: 142 } },
      '51': { ratingMen: { cr: 69.5, slope: 130 }, ratingWomen: { cr: 74.4, slope: 135 } },
      '47': { ratingMen: { cr: 67.2, slope: 125 }, ratingWomen: { cr: 71.3, slope: 130 } },
      '42': { ratingWomen: { cr: 68.6, slope: 124 } },
    },
    source: {
      primary: 'https://upsalagk.se/',
      primaryEdition: "The club's Stora banan card (upsalabuild/card.json), re-checked hole by hole on 2026-09-04 against golfisverige.com: all 144 values agree and every tee column reproduces its printed total.",
      secondary: 'https://www.golfisverige.com/klubb/upsala-golfklubb/',
      slope: 'https://slope.no/sv/baner/upsala-golfklubb/ (read 2026-09-04; the club publishes the same table as images)',
      retrievedOn: '2026-09-04',
      notes: 'Six tees named by nominal length in metres: 62 Svart (men only), 59 Vit, 56 Gul, 51 Blå, 47 Röd, 42 Orange (women only). Stora banan rebuilt by Bob Kains 2007-2010. See docs/courses/upsala-source-dossier.md.',
    },
  },
  {
    slug: 'upsala-mellanbanan',
    build: 'upsalamellanbuild',
    courseName: 'Upsala GK Mellanbanan',
    migration: 'geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json',
    card: 'upsalabuild/card-mellanbanan.json',
    tees: [
      { id: 'vit', name: 'Vit', color: '#f4f4ee' },
      { id: 'gul', name: 'Gul', color: '#f0c93a' },
      { id: 'bla', name: 'Blå', color: '#4a8fe0' },
      { id: 'rod', name: 'Röd', color: '#e0574a' },
      { id: 'orange', name: 'Orange', color: '#e08b3a' },
    ],
    totals: null,
    ratings: {},
    source: {
      primary: 'https://www.golfisverige.com/klubb/upsala-golfklubb/',
      primaryEdition: "golfisverige.com's Mellanbanan card, confirmed against the club's per-hole banguide on holes 1, 7 and 8 (upsalabuild/card-mellanbanan.json); the Out totals 2601/2499/2307/2115/1814 are printed.",
      secondary: 'https://banguider.se/ (the club-linked per-hole guide sheets)',
      retrievedOn: '2026-09-04',
      notes: "Par 35 over nine. The stroke index is the club's banguide column; golfisverige publishes another (13, 9, 3, 15, 11, 1, 17, 5, 7), so it stays unverified. Mellanbanan is Nils O. Nyberg and Einar Jansson's, 1978 (the club's history), not Nordwall's.",
    },
  },
];

function card(routing) {
  const old = read(routing.card);
  const ids = routing.tees.map(t => t.id);
  const holes = old.holes.map(h => ({ number: h.n, par: h.par, index: h.hcp, lengths: Object.fromEntries(ids.map((id, i) => [id, h.t[i]])) }));
  const tees = routing.tees.map((t, i) => {
    const front = holes.filter(h => h.number <= 9).reduce((s, h) => s + h.lengths[t.id], 0);
    const back = holes.filter(h => h.number > 9).reduce((s, h) => s + h.lengths[t.id], 0);
    if (routing.totals && front + back !== routing.totals[i]) throw new Error(`${routing.slug} ${t.id}: holes sum to ${front + back}, card prints ${routing.totals[i]}`);
    return { ...t, front, back, total: front + back, ...(routing.ratings[t.id] || {}) };
  });
  return {
    schemaVersion: 1, groundId: 'upsala', slug: routing.slug, courseName: routing.courseName,
    source: routing.source, par: holes.reduce((s, h) => s + h.par, 0), tees, holes,
  };
}

const ellipseFor = ring => {
  // A drawn deck's own extent, for the record only; the deck itself is passed as its ring.
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

function decisions(routing, scorecard) {
  const model = read(routing.migration).geometry;
  const ids = routing.tees.map(t => t.id);
  const holes = {};
  for (const h of model.holes) {
    const pads = h.tees.pads.map(p => ({
      src: 'ring',
      ring: p.ring.map(pt),
      tees: [],
      sourceId: p.sourceId ?? null,
      why: p.prov ? `deck ${p.sourceId} drawn on the ${p.observedYear ?? 2025} photo in the September review (${p.prov}, ${p.boundaryInterpretationUncertaintyMetres ?? '?'} m)` : 'a provisional original deck the September reviews could not settle under the canopy',
    }));
    const sites = [];
    h.tees.marks.forEach((mark, i) => {
      const tee = ids[i];
      const padId = mark.referencePlacement?.padSourceId;
      const pad = padId ? pads.find(p => p.sourceId === padId) : null;
      if (pad) { pad.tees.push(tee); return; }
      // A reviewed site with no deck: one ellipse per distinct site, shared by the tees placed on it.
      const at = pt(mark.c);
      let site = sites.find(s => Math.hypot(s.c[0] - at[0], s.c[1] - at[1]) < 1);
      if (!site) {
        const forward = i === ids.length - 1;
        site = {
          src: 'ellipse', c: at, size: forward ? [6, 4] : [8, 5], rot: Math.round(((mark.b ?? 0) + 360) % 180), reach: 0, tees: [],
          why: forward
            ? `the ${routing.tees[i].name} tee is a mark on the fairway (the September site review, ${mark.referencePlacement?.reviewId ?? 'reviewed site'}), not a deck: drawn as a small deck at that site, kept as drawn`
            : `visible tee turf at the canopy edge (the September site review, ${mark.referencePlacement?.reviewId ?? 'reviewed site'}); the deck's whole outline was never settled, so a small deck at that site, kept as drawn`,
        };
        sites.push(site);
      }
      site.tees.push(tee);
    });
    const allPads = [...pads, ...sites].map(({ sourceId, ...rest }) => rest);
    const line = h.line;
    const green = h.green;
    holes[h.n] = {
      why: `${h.name ? `"${h.name}". ` : ''}Routing from the September reviewed model (line from ${h.lineSrc ?? 'the reviewed routing'}; the tees' navigation references reviewed 2026-09-09).`,
      bends: line.slice(1, -1).map(pt),
      pads: allPads,
      green: {
        ring: green.ring.map(pt),
        why: green.prov === 'osm'
          ? `OSM's green ${green.sourceId}, checked against the 2025 photo in the September review`
          : `drawn on the 2025 photo in the September review (${green.sourceId ?? green.prov})`,
      },
    };
    void ellipseFor;
  }
  return {
    schemaVersion: 1, groundId: 'upsala', slug: routing.slug, horizontalCrs: 'EPSG:3006', coordinateOrder: ['easting', 'northing'],
    reviewedOn: REVIEWED_ON, reviewer: REVIEWER,
    note: 'Written once by make-decisions.mjs from the September 2026 reviewed model; edited by hand since, each change with its reason. The card is reference/club-scorecard.json.',
    holes,
  };
}

for (const routing of ROUTINGS) {
  const sc = card(routing);
  write(`${routing.build}/reference/club-scorecard.json`, sc);
  write(`${routing.build}/mapping/decisions.json`, decisions(routing, sc));
}

/* The water the tracer keeps sand and greens clear of: the reviewed model's rings (OSM's, each measured flat in the
   laser on 2026-09-04), shared by both routings. */
const stora = read(ROUTINGS[0].migration).geometry;
write('geo_data/course-v2/upsala/mapping/water-epsg3006.geojson', {
  type: 'FeatureCollection',
  properties: { source: ROUTINGS[0].migration, note: "The reviewed model's water rings (OSM ways, levels measured from the laser on 2026-09-04)." },
  features: stora.water.map(w => ({ type: 'Feature', id: w.id, properties: { kind: 'water', level: w.level ?? null }, geometry: { type: 'Polygon', coordinates: [[...w.ring.map(pt), pt(w.ring[0])]] } })),
});
