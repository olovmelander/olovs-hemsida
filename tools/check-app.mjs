/* Does the app boot every course in the manifest, and is each one the right
   course? Exits non-zero on any failure.

   usage: node tools/check-app.mjs [baseUrl]     (default http://127.0.0.1:8620)

   Per course, through the app's whole path -- manifest, pack fetch, integrity
   hash, decode, boot -- this asserts what check3d asserts for the pages:
     - the card the engine holds matches the build's card.json value for value
       (par, index, every tee distance -- the 90-144 values per course);
     - the HUD tee row shows the manifest's tee names, all of them;
     - the header names the course;
     - the deep-link grammar wrote ?bana= for non-default courses;
     - no page errors, and the frame is a picture (luminance gates).           */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';
import { readCard } from '../packages/course-pack/lib.mjs';
import { browserArgs } from './browser-args.mjs';

/* SwiftShader boots the atlas build in minutes, not seconds; --boot-timeout
   raises it further when harnesses must share a CPU. */
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const BASE = process.argv.slice(2).find(a => !a.startsWith('--')) || 'http://127.0.0.1:8620';
/* `--only=slug[,slug]` checks a subset. Nine courses is half an hour under
   SwiftShader, which makes iterating on one course's failure prohibitively slow
   -- and a gate too slow to re-run is a gate that gets skipped. CI passes no
   flag and still checks everything. */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BUNDLED_CHROME = chromium.executablePath();
const CHROME = process.env.BANVY_CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME :
  fs.existsSync(BUNDLED_CHROME) ? BUNDLED_CHROME : undefined);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});

const courses = ONLY.length ? manifest.courses.filter(c => ONLY.includes(c.slug)) : manifest.courses;
if (ONLY.length && courses.length !== ONLY.length)
  throw new Error(`--only names a course the manifest does not have: ${ONLY.filter(s => !manifest.courses.some(c => c.slug === s)).join(', ')}`);

for (const c of courses) {
  console.log(`\n${c.slug}`);
  try {
    await checkCourse(c);
  } catch (e) {
    gate(false, `course check crashed: ${String(e).split('\n')[0].slice(0, 140)}`);
  }
}

async function checkCourse(c) {
  /* read out of the manifest, not restated here: a gate that keeps its own copy
     of the slug->build mapping agrees with itself and goes stale in silence */
  const build = c.build;
  if (!build) throw new Error(`${c.slug}: manifest carries no build directory`);
  const cardHoles = readCard(ROOT, build);

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  /* v2=0 pins the GPK1 pack path this gate was written for (cards, HUD, atlas
     probes, deep links); courses with a reviewed v2 ground serve v2 flagless
     now, and that default is gated by tools/check-course-v2.mjs instead. */
  await page.goto(`${BASE}/?bana=${c.slug}&det=1&v2=0`, { waitUntil: 'load', timeout: 120000 });
  try { await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT }); }
  catch { gate(false, 'boot did not complete'); await page.close(); return; }

  gate(errs.length === 0, `no page errors${errs.length ? ' -- ' + errs[0] : ''}`);

  const got = await page.evaluate(() => ({
    holes: window.V3D.HOLES.map(h => ({ n: h.n, par: h.par, idx: h.idx, t: h.t })),
    teeLabels: [...document.querySelectorAll('#tees .tee i')].map(e => e.textContent),
    teeOn: [...document.querySelectorAll('#tees .tee')].findIndex(e => e.classList.contains('on')),
    /* The element that names the course has moved once already: the shell
       rewrite replaced `.hd h1` with `#hdName`, and because this read the old
       selector directly it CRASHED the whole course check rather than failing
       the one assertion it belongs to -- so five other gates went unreported
       behind it. Both selectors are tried and a miss returns null, which
       fails the header gate below and leaves everything else measurable. */
    header: (document.getElementById('hdName') || document.querySelector('.hd h1'))?.textContent ?? null,
    title: document.title,
    url: location.search,
    ground: (() => {
      const V = window.V3D, info = V.groundInfo();
      const mappedObjectsOnly = V.M?.infra?.objectPlacement === 'mapped-only';
      const greenMisses = V.HOLES.filter(h => V.groundSample(h.green.c[0], h.green.c[1])?.surface !== 4).map(h => h.n);
      /* A crescent bunker's centroid can lie outside its own ring (Upsala's 3rd
         does), so probe a point that is inside by construction: the midpoint of
         the widest scanline span through the ring at the centroid's z. */
      const interiorPoint = (ring, c) => {
        const zs = ring.map(p => p[1]);
        const z = Math.min(Math.max(c[1], Math.min(...zs) + 0.01), Math.max(...zs) - 0.01);
        const xs = [];
        for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
          const a = ring[q], b = ring[p];
          if ((a[1] > z) === (b[1] > z)) continue;
          xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        xs.sort((a, b) => a - b);
        let best = null;
        for (let n = 0; n + 1 < xs.length; n += 2) {
          if (!best || xs[n + 1] - xs[n] > best[1] - best[0]) best = [xs[n], xs[n + 1]];
        }
        return best ? [(best[0] + best[1]) / 2, z] : c;
      };
      const bunkerMisses = [];
      for (const h of V.HOLES) for (const b of h.bunkers) {
        if (!b._r?.c) continue;
        const p = interiorPoint(b._r.ring, b._r.c);
        if (V.groundSample(p[0], p[1])?.surface !== 6) bunkerMisses.push(h.n);
      }
      /* A yardage plate is a CLAIM: "the middle of that green is this many
         metres away". Measured on the plate that was actually planted, against
         the green centre it names -- not against the formula that placed it. */
      const plates = (V.plates ? V.plates() : []).map(p => {
        const h = V.HOLES.find(x => x.n === p.hole);
        const err = Math.hypot(p.x - h.green.c[0], p.z - h.green.c[1]) - p.says;
        return { hole: p.hole, says: p.says, err: +err.toFixed(2) };
      });
      /* Every tee marker must stand on tee grass. Probed through the ATLAS, so
         it asks what the ground actually is at the marker, not what the model
         intended -- 5 is SURFACE.TEE, 3 the fringe collar a deck sits in. */
      const teeMisses = [];
      let teeMarks = 0, teePlatforms = 0;
      const holesMissingPlatforms = mappedObjectsOnly ? V.HOLES
        .filter(h => !Array.isArray(h.tees?.pads) || h.tees.pads.length === 0).map(h => h.n) : [];
      if (mappedObjectsOnly) {
        // The HUD's nominal tee references are not physical marker objects.
        // Probe the actual deck interiors, including concave polygons whose
        // vertex average can lie outside, so bad/wet turf still fails loudly.
        for (const h of V.HOLES) for (const [i, pad] of (h.tees.pads || []).entries()) {
          teePlatforms++;
          const ring = pad.ring;
          if (!ring || ring.length < 3) { teeMisses.push(`${h.n}/pad${i}:invalid`); continue; }
          const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
          const p = interiorPoint(ring, c), s = V.groundSample(p[0], p[1])?.surface;
          if (s !== 5 && s !== 3) teeMisses.push(`${h.n}/pad${i}:${s}`);
        }
      } else {
        for (const h of V.HOLES) for (const mk of (h.tees.marks || [])) {
          teeMarks++;
          const s = V.groundSample(mk.c[0], mk.c[1])?.surface;
          if (s !== 5 && s !== 3) teeMisses.push(`${h.n}/${mk.teeIdx}:${s}`);
        }
      }
      /* A tee's two markers straddle the line: the axis between them must be
         PERPENDICULAR to the direction of play. Measured against the hole line
         at each mark, and -- because that is the same geometry the engine
         derives the bearing from -- ALSO against the independent tee-to-green
         vector, which comes from the GPS survey and never enters the bearing.
         The first is the definition and is gated; the second cannot be exact on
         a dogleg, so it is reported and gated only loosely. */
      const axis = [];
      for (const h of V.HOLES) {
        const g = h.green && h.green.c;
        for (const mk of (h.tees.marks || [])) {
          const b = mk.b * Math.PI / 180;
          const R = [-Math.cos(b), Math.sin(b)];
          let best = Infinity, F = null;
          for (let i = 0; i < h.line.length - 1; i++) {
            const [x0, z0] = h.line[i], [x1, z1] = h.line[i + 1];
            const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
            if (!L2) continue;
            const t = Math.max(0, Math.min(1, ((mk.c[0] - x0) * dx + (mk.c[1] - z0) * dz) / L2));
            const d = Math.hypot(mk.c[0] - (x0 + dx * t), mk.c[1] - (z0 + dz * t));
            if (d < best) { best = d; F = [dx / Math.sqrt(L2), dz / Math.sqrt(L2)]; }
          }
          if (!F) continue;
          const off = a => Math.abs(90 - Math.acos(Math.min(1, Math.abs(a))) * 180 / Math.PI);
          const rec = { n: h.n, tee: mk.teeIdx, line: off(R[0] * F[0] + R[1] * F[1]) };
          if (g) {
            const gx = g[0] - mk.c[0], gz = g[1] - mk.c[1], gl = Math.hypot(gx, gz);
            if (gl > 1) rec.green = off((R[0] * gx + R[1] * gz) / gl);
          }
          axis.push(rec);
        }
      }
      return { ...info, greenMisses, bunkerMisses, plates, teeMarks, teePlatforms, teeMisses,
        holesMissingPlatforms, mappedObjectsOnly, axis, perf: V.perf() };
    })(),
  }));

  let mism = 0, vals = 0;
  for (const ch of cardHoles) {
    const h = got.holes.find(x => x.n === ch.n);
    vals += 2 + ch.t.length;
    if (!h || h.par !== ch.par) mism++;
    if (!h || h.idx !== ch.hcp) mism++;
    ch.t.forEach((v, i) => { if (!h || h.t[i] !== v) mism++; });
  }
  /* the card's own hole count, not eighteen: the second nines are nines */
  gate(mism === 0 && got.holes.length === cardHoles.length,
    `card through the app: ${vals} values over ${got.holes.length} holes, ${mism} mismatches`);
  gate(got.ground.mode === 'atlas', 'runtime ground atlas enabled');
  gate((got.ground.classCounts?.[2] || 0) > 0 && (got.ground.classCounts?.[4] || 0) > 0,
       'atlas contains fairway and green texels');
  gate(got.ground.greenMisses.length === 0, `green centre probes${got.ground.greenMisses.length ? ' miss holes ' + got.ground.greenMisses.join(',') : ''}`);
  gate(got.ground.bunkerMisses.length === 0, `bunker centre probes${got.ground.bunkerMisses.length ? ' miss holes ' + got.ground.bunkerMisses.join(',') : ''}`);
  {
    const ax = got.ground.axis;
    const offLine = ax.filter(a => a.line > 1);
    gate(offLine.length === 0,
      `all ${ax.length} tee-marker pairs stand square across the line` +
      (offLine.length ? ` -- ${offLine.length} do not (worst hole ${offLine.sort((p, q) => q.line - p.line)[0].n} at ${offLine[0].line.toFixed(1)}°)` : ''));
    /* the independent half: the survey's own green direction. A dogleg legitimately
       separates the two, so this is loose -- it is here to catch a bearing that is
       square to the line while the line itself points somewhere absurd. */
    const g = ax.filter(a => a.green != null).map(a => a.green).sort((p, q) => p - q);
    const med = g.length ? g[g.length >> 1] : 0;
    gate(med <= 25, `marker axes square to the surveyed green direction too (median ${med.toFixed(1)}°, worst ${(g[g.length - 1] || 0).toFixed(1)}°)`);
  }
  gate(got.ground.teeMisses.length === 0 && got.ground.holesMissingPlatforms.length === 0,
    (got.ground.mappedObjectsOnly
      ? `all ${got.ground.teePlatforms} physical tee-platform interiors are tee turf; no physical marker pairs are inferred`
      : `all ${got.ground.teeMarks} tee markers stand on tee grass`) +
    (got.ground.teeMisses.length ? ` -- ${got.ground.teeMisses.length} do not (hole/tee:surface ${got.ground.teeMisses.slice(0, 4).join(' ')})` : '') +
    (got.ground.holesMissingPlatforms.length ? ` -- missing physical tee platforms on holes ${got.ground.holesMissingPlatforms.join(', ')}` : ''));
  {
    /* 2 m, not zero: the post sits 15 m off the centre line, so at a polyline
       vertex the bearing -- and with it the post's own distance -- jumps, and no
       position along the line lands exactly on the label. Before this was
       solved the plates were out by 2.6 m on average and up to 32.6 m. */
    const p = got.ground.plates, bad = p.filter(q => Math.abs(q.err) > 2.0);
    const worst = p.reduce((a, q) => Math.max(a, Math.abs(q.err)), 0);
    /* Whether this course should carry ANY plate, derived from the card by the
       engine's own two rules: par 3s get none (the same reason they get no
       fairway), and the shortest plate is 100 m and needs `dist <= total - 60`.
       The count-above-zero half of this gate exists because a NaN once made
       every plate on every course vanish silently -- but Veckefjarden's
       korthalsbana is NINE PAR 3s, where zero is the only correct answer, and a
       gate that fails on a correct result is a gate people switch off. So the
       expectation is computed rather than assumed, and a course with no
       eligible hole is asserted to have exactly zero -- which still catches
       plates being invented where none belong. */
    const eligible = got.ground.mappedObjectsOnly ? 0 : cardHoles.filter(h => h.par >= 4 && h.t[0] > 160).length;
    const ok = eligible ? (p.length > 0 && bad.length === 0) : p.length === 0;
    gate(ok, eligible
      ? `${p.length} distance plates measure their own label (worst ${worst.toFixed(2)} m)` +
        (bad.length ? ` -- ${bad.length} off, e.g. hole ${bad[0].hole} says ${bad[0].says} at ${bad[0].err > 0 ? '+' : ''}${bad[0].err} m` : '')
      : (got.ground.mappedObjectsOnly
        ? 'no distance plates: mapped-only ground has no observed physical plate records'
        : `no distance plates, and none is due: ${cardHoles.length} holes, none par 4+ over 160 m`) +
        (p.length ? ` -- but ${p.length} were planted` : ''));
  }
  console.log(`  perf atlas ${got.ground.perf.atlasMs} ms, boot JS ${got.ground.perf.totalMs} ms`);

  /* The vegetation plan, held on every course on the PLAIN path: without a
     v2 flag the legacy planter is the only tree population, its export
     agrees with the draw statistics, and no v2 vegetation was loaded. The
     v2 path -- registry trees, stand fields, the lattice cut out of their
     coverage -- is gated by tools/vegetation-baseline.mjs on Puttom. */
  const veg = await page.evaluate(() => {
    const V = window.V3D;
    const trees = V.legacyTrees();
    return { total: trees.total, statsTrees: V.stats.trees, zones: trees.zones, reasons: trees.reasons, objects: V.v2Objects() };
  });
  gate(veg.total === veg.statsTrees, `tree export (${veg.total}) matches the planter count (${veg.statsTrees}); zones ${JSON.stringify(veg.zones)}`);
  gate(veg.objects.loaded === null && !(veg.reasons.v2Individual > 0) && !(veg.reasons.v2Stand > 0),
    `no v2 vegetation on the plain path (${veg.objects.graphObjectTiles ?? 'no graph'} object tiles referenced)`);

  /* Nothing may be under water. This is the gate the 14th exists for: an island
     green that once sat five metres under the fjärd, and a course whose water
     level is 21.59 m rather than zero -- so the probe is LOCAL, asking the
     engine's own terrainH at each green and tee against the level of whatever
     ring contains it, exactly as each build's check3d does for its page. */
  const wet = await page.evaluate(() => {
    const V = window.V3D, M = V.M, out = [];
    const inRing = (x, z, r) => { let i2 = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) i2 = !i2;
      } return i2; };
    const hasSea = M.water.some(w => w.isSea);
    const probe = (label, x, z) => {
      const h = V.probeH(x, z);
      if (hasSea && h < V.GEO.seaLevel + 0.4) { out.push(`${label} ${h.toFixed(2)} m (sea)`); return; }
      for (const w of M.water) {
        if (w.isSea || w.level == null) continue;
        if (inRing(x, z, w.ring) && h < w.level + 0.3) out.push(`${label} ${h.toFixed(2)} m in water at ${w.level} m`);
      }
    };
    /* Greens are probed at their centre and must be dry, full stop -- this is the
       gate the 14th exists for. A TEE is probed at its PAD, the prepared ground a
       player stands on, because line[0] is a geometric construction: the point the
       card slide lands on, which at Puttom's 16th falls 1.1 m over a traced
       shoreline (inside that shoreline's own uncertainty on a 2 m DEM) while the
       pad sits 14.7 m clear. That graze is still reported, never swallowed. */
    const notes = [];
    for (const h of V.HOLES) {
      probe(`green ${h.n}`, h.green.c[0], h.green.c[1]);
      const pad = h.tees.pads && h.tees.pads[0];
      const tp = pad && Number.isFinite(pad.cx) ? [pad.cx, pad.cz] : h.line[0];
      /* Say which hole and which value, rather than throwing a bare "worldX
         must be finite" out of the sampler three frames down. A gate that
         crashes stops being a gate, and this one did. */
      if (!Number.isFinite(tp?.[0]) || !Number.isFinite(tp?.[1])) {
        out.push(`tee ${h.n} has no probeable point (pad ${JSON.stringify(pad && [pad.cx, pad.cz])}, line0 ${JSON.stringify(h.line[0])})`);
        continue;
      }
      probe(`tee ${h.n}`, tp[0], tp[1]);
      if (pad) for (const w of M.water) {
        if (w.isSea || w.level == null) continue;
        if (inRing(h.line[0][0], h.line[0][1], w.ring))
          notes.push(`hole ${h.n}: the slid back-tee point lies in water; its pad is on dry ground`);
      }
    }
    return { out, notes };
  });
  for (const n of wet.notes) console.log(`  note ${n}`);
  gate(wet.out.length === 0, `nothing submerged${wet.out.length ? ' -- ' + wet.out.slice(0, 3).join('; ') : ' (36 probes)'}`);
  gate(JSON.stringify(got.teeLabels) === JSON.stringify(c.tees.names),
    `tee row shows [${got.teeLabels.join(', ')}]`);
  /* A bare visit opens on the yellow tee, on every course. Asserted against the
     manifest's own colour rather than its `def` index, so the gate and the
     generator cannot agree with each other while both being wrong -- and by
     COLOUR rather than name, since two cards name their tees by course rating. */
  gate(got.teeOn === c.tees.cols.indexOf(0xf0c93a),
    `opens on the yellow tee (${c.tees.names[got.teeOn]})`);
  gate(got.header === c.name, `header says "${got.header}"`);
  gate(got.title === c.title, 'document title set from the manifest');
  const isDefault = c.slug === manifest.courses[0].slug;
  gate(isDefault ? !/bana=/.test(got.url) : got.url.includes(`bana=${c.slug}`),
    `deep link ${isDefault ? 'stays clean for the default course' : 'carries bana=' + c.slug}`);

  /* SwiftShader needs minutes, not Playwright's default 30 s, to compose a frame */
  const shot = await page.screenshot({ timeout: 300000, animations: 'disabled' });
  const { decodePNG } = await import('../geobuild/png.mjs');
  const img = decodePNG(shot);
  let sum = 0, dark = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const o = i * img.channels;
    const l = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
    sum += l; if (l < 8) dark++;
  }
  gate(sum / n / 255 > 0.05 && dark / n < 0.85, `frame is a picture (lum ${(sum / n / 255).toFixed(3)})`);
  await page.close();
}

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nall courses boot correctly through the app');
process.exit(bad ? 1 : 0);
