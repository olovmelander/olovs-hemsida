import fs from 'node:fs';
import assert from 'node:assert/strict';
import { collectCoordinatePairs, localToLatLon, localToProjected, roundedCoordinate } from '../course-geo/migration.mjs';
import { latLonToSweref99Tm, horizontalProjectionBackend } from '../course-geo/proj.mjs';
import { compilePack } from '../course-pack/compile-pack.mjs';
import { readPack, inflateStream } from '../course-pack/lib.mjs';
import { validateOrthoRing } from '../../geobuild/mapping/apply-ortho-review.mjs';
import { readPinned, pinned, writeBytes } from './production-inputs.mjs';
import { readJson, writeJson, digest, hashObject } from './io.mjs';
import { CATEGORIES } from './standard.mjs';

export function migrateModel(model, manifest) {
  const frame = manifest.legacyFrame;
  assert(frame, 'a measured-source authoring adapter is required when there is no retained compatibility model');
  for (const [actual, expected] of [[model.origin.lat, frame.originWgs84.latitude],
    [model.origin.lon, frame.originWgs84.longitude], [model.mPerLat, frame.metresPerLatitude],
    [model.mPerLon, frame.metresPerLongitude]]) assert(Math.abs(actual - expected) < 1e-9, 'model/source frame mismatch');
  const geometry = structuredClone(model);
  const pairs = collectCoordinatePairs(geometry);
  const projected = frame.projectedOriginEpsg3006
    ? pairs.coordinates.map(({ pair }) => localToProjected(pair, frame))
    : latLonToSweref99Tm(pairs.coordinates.map(({ pair }) => localToLatLon(pair, frame)), { decimals: 6 });
  pairs.coordinates.forEach(({ pair }, i) => {
    pair[0] = roundedCoordinate(projected[i].easting);
    pair[1] = roundedCoordinate(projected[i].northing);
  });
  delete geometry.origin; delete geometry.mPerLon; delete geometry.mPerLat;
  geometry.frame = 'absolute EPSG:3006 coordinate pairs; retained scalar heights are unchanged and unapproved';
  return { geometry, coordinatePairCount: pairs.coordinates.length, ignoredMetadataPairCount: pairs.ignored.length,
    projection: frame.projectedOriginEpsg3006 ? { implementation: 'exact recorded projected offsets', scope: 'horizontal-only' } : horizontalProjectionBackend(),
    approvalStatus: 'migration-only-pending-independent-control' };
}

export function geometryFeatures(model, slug) {
  const features = [];
  const add = (category, hole, value, id, closed = true) => {
    const rings = value?.ring ? [value.ring, ...(value.innerRings || [])] : value?.rings;
    const points = rings || (value?.line ? [value.line] : null);
    if (!points?.length) return;
    features.push({ id: `${slug}/${id}`, category, hole, rings: points, closed,
      lineage: value.reviewId || value.sourceId || value.provenance || null,
      interpretationStatus: value.status || value.boundaryStatus || 'inherited-unassessed' });
  };
  for (const h of model.holes) {
    add('greens', h.n, h.green, `h${h.n}/green`);
    add('fairways', h.n, h.fairway, `h${h.n}/fairway`);
    (h.tees?.pads || []).forEach((v, i) => add('tees', h.n, v, `h${h.n}/tee/${v.reviewId || v.id || i}`));
    (h.bunkers || []).forEach((v, i) => add('bunkers', h.n, v, `h${h.n}/bunker/${v.reviewId || v.id || i}`));
  }
  (model.water || []).forEach((v, i) => add('water', null, v, `water/${v.id || i}`));
  (model.streams || []).forEach((v, i) => add('water', null, v, `stream/${v.id || i}`, false));
  for (const [kind, values] of Object.entries(model.infra || {})) {
    if (Array.isArray(values)) values.forEach((v, i) => add('infrastructure', null, v, `${kind}/${v.id || i}`, !v.line));
  }
  for (const [kind, values] of Object.entries(model.scenery || {})) {
    if (!Array.isArray(values)) continue;
    // Shared surfaces are context, never silently attributed to the active hole.
    const category = { greens: 'greens', tees: 'tees', fairways: 'fairways', bunkers: 'bunkers' }[kind];
    if (!category) continue;
    values.forEach((v, i) => add(category, null, Array.isArray(v) ? { ring: v } : v, `scenery/${kind}/${i}`));
  }
  return features;
}

export function boundsOf(points, padding = 0) {
  assert(points.length && points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)), 'finite coordinate pairs required');
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return [Math.min(...xs) - padding, Math.min(...ys) - padding, Math.max(...xs) + padding, Math.max(...ys) + padding];
}
const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const COLORS = { tees: '#b269d4', greens: '#087e6d', fairways: '#8fc260', bunkers: '#c39535', water: '#448fd0', infrastructure: '#9a6550' };

export function mappingReview(config, models, source) {
  const discrepancies = source.blockers.map(b => ({ kind: 'source-blocker', severity: b.severity, id: b.id, detail: b.description }));
  const coverage = [], panels = [], allFeatures = [];
  for (const c of config.courses) {
    const model = models[c.slug].geometry;
    const features = geometryFeatures(model, c.slug);
    const featureBounds = new Map();
    for (const f of features) {
      featureBounds.set(f.id, boundsOf(f.rings.flat()));
      if (f.closed) for (const ring of f.rings) {
        try { validateOrthoRing(ring, f.id); }
        catch (e) { discrepancies.push({ kind: 'invalid-ring', severity: 'release-blocking', id: f.id, detail: e.message }); }
      }
    }
    allFeatures.push(...features);
    for (const h of model.holes) {
      const own = features.filter(f => f.hole === h.n);
      const extent = boundsOf([...h.line, ...own.flatMap(f => f.rings.flat())], 50);
      const nearby = features.filter(f => f.hole === null && overlap(extent, featureBounds.get(f.id)));
      const categories = Object.fromEntries(CATEGORIES.map(category => {
        const selected = own.filter(f => f.category === category), context = nearby.filter(f => f.category === category);
        return [category, { ownedFeatures: selected.length, nearbySharedFeatures: context.length,
          status: 'unknown', evidence: [],
          notes: category === 'vegetation' ? 'Requires measured canopy, identity/exclusion evaluation and visual review.'
            : !selected.length && !context.length ? 'No mapped feature in this inspection window; absence is not established.'
              : 'Mapped input exists. Source agreement, completeness and current condition have not been approved.' }];
      }));
      for (const category of ['tees', 'greens', 'fairways', 'bunkers']) if (!categories[category].ownedFeatures) {
        discrepancies.push({ kind: 'category-gap', severity: 'review-required', id: `${c.slug}/h${h.n}/${category}`,
          detail: 'No owned polygon; inspect sources and document actual absence or missing mapping.' });
      }
      coverage.push({ slug: c.slug, hole: h.n, categories });
      panels.push({ id: `${c.slug}-h${String(h.n).padStart(2, '0')}`, slug: c.slug, hole: h.n,
        extentEPSG3006: extent, sourceStatus: 'not-rendered', featureIds: [...own, ...nearby].map(f => f.id), routing: h.line });
    }
  }
  return { schemaVersion: 1, groundId: config.groundId, geographicApproval: false,
    scope: 'Deterministic inventory of retained geometry and open source questions. No new real-world review.',
    crs: 'EPSG:3006', coordinateOrder: ['easting', 'northing'],
    mappingInputs: config.courses.map(c => ({ slug: c.slug, model: c.model, card: c.card })),
    sourceEvidence: config.mappingEvidence, coverage, discrepancies, panels, features: allFeatures };
}

export function writeReview(ctx, out, report) {
  writeJson(ctx.root, `${out}/review.json`, report);
  writeJson(ctx.root, `${out}/per-hole-coverage.json`, { groundId: ctx.groundId, geographicApproval: false, holes: report.coverage });
  writeJson(ctx.root, `${out}/discrepancies.json`, { geographicApproval: false, discrepancies: report.discrepancies });
  const source = ctx.config.review.acquisition;
  const publishedOut = out.replace(/\.tmp-\d+(?=\/|$)/, '');
  writeJson(ctx.root, `${out}/source-overlay-plan.json`, { status: 'not-run', geographicApproval: false,
    requiredInput: source, sourceDirectory: ctx.config.review.sourceDirectory,
    command: ['python', 'packages/course-workflow/render-source-overlays.py', '--review', `${publishedOut}/review.json`,
      '--acquisition', source.path, '--acquisition-sha256', source.sha256,
      '--source-dir', ctx.config.review.sourceDirectory,
      '--out', `${ctx.config.review.sourceDirectory}/cache/overlays`] });
  const features = new Map(report.features.map(f => [f.id, f]));
  for (const panel of report.panels) {
    const [west, south, east, north] = panel.extentEPSG3006, width = east - west, height = north - south;
    const geometries = panel.featureIds.map(id => features.get(id)).map(f => {
      const d = f.rings.map(r => r.map(([x, y], i) => `${i ? 'L' : 'M'}${(x-west).toFixed(3)},${(north-y).toFixed(3)}`).join(' ') + (f.closed ? 'Z' : '')).join(' ');
      return `<path d="${d}" fill="${f.closed ? COLORS[f.category] : 'none'}" fill-opacity="0.3" fill-rule="evenodd" stroke="${COLORS[f.category]}" stroke-width="0.8"><title>${escape(f.id)}</title></path>`;
    }).join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><title>${escape(panel.id)} — vector inspection, no geographic approval</title><rect width="100%" height="100%" fill="#f3f3ec"/>${geometries}</svg>\n`;
    writeBytes(ctx.root, `${out}/${panel.id}.svg`, svg);
  }
  const rows = report.coverage.map(h => `<tr><td>${escape(h.slug)} / ${h.hole}</td>${CATEGORIES.map(k => `<td>${h.categories[k].ownedFeatures} + ${h.categories[k].nearbySharedFeatures} shared<br>Unknown</td>`).join('')}</tr>`).join('');
  const gallery = report.panels.map(p => `<figure><a href="${p.id}.svg"><img loading="lazy" src="${p.id}.svg" alt="${p.id}"></a><figcaption>${p.id}</figcaption></figure>`).join('');
  writeBytes(ctx.root, `${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>${ctx.groundId} mapping inspection</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;color:#16352c}table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #ccc;padding:6px}main{display:grid;grid-template-columns:repeat(3,1fr)}img{width:100%;height:300px}figure{margin:12px}p{max-width:850px}</style><h1>${ctx.groundId}: mapping inspection</h1><p>Vector-only preparation from pinned retained inputs. Every category remains unapproved. Counts show owned plus nearby shared features and do not measure completeness. Source overlays, terrain, vegetation and player acceptance are separate.</p><p><a href="discrepancies.json">Discrepancies (${report.discrepancies.length})</a> · <a href="review.json">Inputs, source hashes and panel bounds</a></p><table><tr><th>Layout / hole</th>${CATEGORIES.map(k => `<th>${k}</th>`).join('')}</tr>${rows}</table><main>${gallery}</main>`);
}

export function compileMapping(ctx, out) {
  const source = readJson(ctx.root, ctx.workflow.sourceManifest), models = {}, players = [], products = [];
  for (const c of ctx.config.courses) {
    const model = readPinned(ctx.root, c.model), card = readPinned(ctx.root, c.card);
    assert.equal(model.holes.length, c.holes);
    assert.equal(card.holes.length, c.holes);
    model.holes.forEach((h, i) => {
      assert.equal(h.n, i + 1); const row = card.holes[i]; assert.equal(row.n, h.n);
      assert.equal(h.par, row.par, `${c.slug}/${h.n}: card par mismatch`);
      assert.equal(h.idx, row.hcp, `${c.slug}/${h.n}: card index mismatch`);
      assert.deepEqual(h.t, row.t, `${c.slug}/${h.n}: card lengths mismatch`);
      assert(h.line.length >= 2); assert(h.green?.ring?.length >= 3);
    });
    const migrated = migrateModel(model, source);
    models[c.slug] = migrated;
    writeJson(ctx.root, `${out}/models/${c.slug}.epsg3006.json`, { schemaVersion: 1, groundId: ctx.groundId,
      source: c.model, ...migrated });
    const pack = compilePack({ model, heightfields: readPinned(ctx.root, c.heightfields),
      cover: c.cover ? readPinned(ctx.root, c.cover) : null, slug: c.slug });
    const decoded = readPack(pack);
    assert.equal(decoded.header.slug, c.slug);
    for (const [key, stream] of [['HF0', decoded.s0], ['HF1', decoded.s1]]) {
      assert.equal(inflateStream(stream).length, decoded.header[key].nx * decoded.header[key].nz * 2, 'heightfield stream size mismatch');
    }
    assert.equal(JSON.parse(inflateStream(decoded.sv)).holes.length, c.holes);
    const packUrl = `courses/${c.slug}/pack.bin`;
    writeBytes(ctx.root, `${out}/public/${packUrl}`, pack);
    const entry = { ...c.player, par: card.holes.reduce((n, h) => n + h.par, 0), holes: c.holes,
      photos: 0, packUrl, bytes: pack.length, sha256: digest(pack) };
    assert.equal(c.player.tees.names.length, card.holes[0].t.length);
    for (const [key, ref] of Object.entries(c.sidecars)) {
      const bytes = fs.readFileSync(pinned(ctx.root, ref)), url = `courses/${c.slug}/${key}.json`;
      // These are explicitly declared retained source sidecars, not regenerated measurements.
      writeBytes(ctx.root, `${out}/public/${url}`, bytes);
      entry[{ 'mown-surface': 'mownSurface' }[key] || key] = { url, bytes: bytes.length, sha256: digest(bytes) };
    }
    players.push(entry); products.push({ slug: c.slug, packSha256: digest(pack),
      projectedGeometrySha256: hashObject(migrated.geometry), coordinatePairs: migrated.coordinatePairCount });
  }
  writeJson(ctx.root, `${out}/public/courses/index.json`, { fmt: 1, courses: players });
  const report = mappingReview(ctx.config, models, source);
  writeReview(ctx, `${out}/review`, report);
  const summary = { schemaVersion: 1, groundId: ctx.groundId, geographicApproval: false,
    products, holes: report.coverage.length, discrepancies: report.discrepancies.length };
  writeJson(ctx.root, `${out}/mapping-report.json`, summary);
  return summary;
}
