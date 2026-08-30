/* The chooser's course posters: capture, choose, encode.

   usage: node tools/make-posters.mjs [--base http://127.0.0.1:8643]
                                      [--course slug] [--candidates] [--write]

   Two passes, because picking a poster is a judgement and the judgement has to
   be made at the size the poster is shown:

     --candidates  boots each course ONCE, shoots the eight framings in RECIPES,
                   encodes them, and writes a contact sheet showing all eight at
                   the card's own 400x225 on the chooser's dark ground. This is
                   the exploring pass; look at the sheet, then edit POSTERS.
     --write       shoots exactly what POSTERS lists and writes hero-1..N.webp.
                   It does not read the candidate cache, so the shipped posters
                   are reproducible from this file alone.

   WHICH HOLE, AND WHY. The signature holes are not guesses: they are the clubs'
   own words, read out of each build's guide-notes.json. Norrfällsviken calls its
   12th "Banans signaturhål" and its 7th "John Bauer-hålet"; Johannesberg's 18th
   is the only plan carrying the "Signaturhål" laurel; Upsala's 3rd is marked
   SIGNATURE HOLE with the lake down its entire left side; Puttom's 12th plays
   over a bay of Stor-Rössjön; Ängsö's 15th is the water hole and the only one
   with a drop zone; Veckefjärden's 14th is the island green in the fjord.

   WHAT THE ENCODE COSTS, measured (carried from make-posters.py, which did the
   measuring; this tool replaces it because the repo's other tooling is Node and
   this machine has no Python). Each poster compared against a lossless downscale
   of the same still, both sampled at 400x225:

       resize alone            0.43-0.48 mean/255, worst 2-5
       jpeg q82   38-52 KB     2.41-3.15 mean,     worst 36-56
       jpeg q90   54-73 KB     2.00-2.62 mean,     worst 39-42
       webp q90   40-58 KB     1.93-2.28 mean,     worst 28-45
       webp q95   59-87 KB     1.65-1.90 mean,     worst 30-42

   The resize is nearly free, so the loss is the codec; WebP beats JPEG on both
   axes at the same quality number, and q90 is the knee. Not claimed: that the
   difference is invisible. A poster that must be exact should come from the
   harness still, not from here.

   Posters are shot with ?ren=1&skylt=0 so no HUD or marker sprite is baked into
   a picture, and ?det=1 so a re-shoot of the same recipe is the same picture. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/golf/public/courses');
const CACHE = path.join(ROOT, 'geobuild/cache/posters');

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = flag('base', 'http://127.0.0.1:8643');
const ONLY = flag('course', null);
const DO_CANDIDATES = args.includes('--candidates');
const DO_WRITE = args.includes('--write');
/* --extra "6:orbit:golden,17:green:golden" shoots named framings alongside the
   standard eight, numbered from 9 up, and keeps the ones already captured. A
   course whose identity is not on its signature hole needs this: Norrfällsviken
   is a seaside club and its signature 12th never shows the sea. */
const EXTRA = (flag('extra', '') || '').split(',').filter(Boolean).map((spec, i) => {
  const [hole, cam, preset] = spec.split(':');
  return { id: 9 + i, hole: +hole, cam, preset, literal: true,
           what: `extra · hål ${hole} · ${cam} · ${preset}` };
});
const WIDTH = 800;      /* 2x the ~400 px card; the card is never shown larger */
const QUALITY = 0.90;   /* the knee of the curve above */

/* signature hole, then two more the club's notes single out as scenic */
const PLAN = {
  veckefjarden:   { sig: 14, s2: 2,  s3: 18 },
  norrfallsviken: { sig: 12, s2: 7,  s3: 5  },
  puttom:         { sig: 12, s2: 9,  s3: 18 },
  upsala:         { sig: 3,  s2: 9,  s3: 12 },
  johannesberg:   { sig: 18, s2: 11, s3: 4  },
  angso:          { sig: 15, s2: 2,  s3: 17 },
  /* The second courses. Mellanbanan's 8th is the club's OWN signature, played
     from a tee looking out over the Stora banan, and its 4th green stands 20 m
     from the big pond. Johannesberg's nine names no signature, so it was
     measured instead: a 19 300 m2 pond runs through the middle of it and the
     2nd drops 12.5 m to a green 5 m off the water -- the only real identity the
     nine has. The korthalsbana has no water within 186 m of any green, so it
     leads with its longest hole and its compact loop from above. */
  'upsala-mellanbanan':          { sig: 8, s2: 4, s3: 6 },
  'johannesberg-9':              { sig: 2, s2: 7, s3: 8 },
  'veckefjarden-korthalsbanan':  { sig: 1, s2: 3, s3: 9 },
};

/* Eight framings per course: the signature hole from all four cameras, then the
   two scenic holes in different light. One boot covers all eight. */
const RECIPES = [
  { id: 1, hole: 'sig', cam: 'orbit', preset: 'golden', what: 'signatur · 3/4 · kvällsljus' },
  { id: 2, hole: 'sig', cam: 'green', preset: 'golden', what: 'signatur · green · kvällsljus' },
  { id: 3, hole: 'sig', cam: 'tee', preset: 'golden', what: 'signatur · tee · kvällsljus' },
  { id: 4, hole: 'sig', cam: 'top', preset: 'noon', what: 'signatur · ovan · dag' },
  { id: 5, hole: 's2', cam: 'orbit', preset: 'golden', what: 'scenisk 2 · 3/4 · kvällsljus' },
  { id: 6, hole: 's2', cam: 'tee', preset: 'dawn', what: 'scenisk 2 · tee · gryning' },
  { id: 7, hole: 's3', cam: 'orbit', preset: 'host', what: 'scenisk 3 · 3/4 · höst' },
  { id: 8, hole: 's3', cam: 'green', preset: 'mist', what: 'scenisk 3 · green · dis' },
];

/* Filled in after looking at the contact sheets: candidate ids in card order.
   hero-1 is what the card shows at rest, so it carries the course's identity. */
/* What each card actually ships, in card order, as literal framings rather than
   indices into a cache that may not exist: this table IS the record of what
   every poster is a picture of, and re-shooting it a year from now gives the
   same four pictures. hero-1 is the resting card, so it carries the identity. */
const POSTERS = {
  /* the island green in the fjord; the 18th in autumn; the island from above;
     the home green through mist */
  veckefjarden: [
    { hole: 14, cam: 'green', preset: 'golden' },
    { hole: 18, cam: 'orbit', preset: 'host' },
    { hole: 14, cam: 'top', preset: 'noon' },
    { hole: 18, cam: 'green', preset: 'mist' },
  ],
  /* hål 6 leads, NOT the signature 12th: this club is seaside and its 12th
     shows no sea at all, so the resting card said "another forest course".
     6's green is 133 m from the sea ring, the closest on the course, and is
     the hole the club's own text singles out for havsvinden. */
  norrfallsviken: [
    { hole: 6, cam: 'orbit', preset: 'golden' },
    { hole: 12, cam: 'green', preset: 'golden' },
    { hole: 12, cam: 'top', preset: 'noon' },
    { hole: 5, cam: 'orbit', preset: 'host' },
  ],
  /* Stor-Rössjön curving past the 12th, then the carry over the bay itself */
  puttom: [
    { hole: 12, cam: 'orbit', preset: 'golden' },
    { hole: 12, cam: 'tee', preset: 'golden' },
    { hole: 18, cam: 'orbit', preset: 'host' },
    { hole: 12, cam: 'top', preset: 'noon' },
  ],
  /* the 3rd's lake, autumn parkland, the lake from above, Håmö gård's clubhouse */
  upsala: [
    { hole: 3, cam: 'green', preset: 'golden' },
    { hole: 12, cam: 'orbit', preset: 'host' },
    { hole: 3, cam: 'top', preset: 'noon' },
    { hole: 9, cam: 'orbit', preset: 'golden' },
  ],
  /* the manor standing behind the 18th -- the herrgård is the course's character */
  johannesberg: [
    { hole: 18, cam: 'green', preset: 'golden' },
    { hole: 4, cam: 'orbit', preset: 'host' },
    { hole: 18, cam: 'top', preset: 'noon' },
    { hole: 11, cam: 'orbit', preset: 'golden' },
  ],
  /* THE THREE SECOND COURSES. All golden: these are nines in forest, and the
     top+noon recipe that works on the eighteens blows their ponds to flat white
     -- at card size it reads as a rendering fault rather than a photograph, so
     none of them uses it. Orbit does the work here; at ground level under an
     evening sun these corridors go too dark to read at 400x225. */

  /* the 8th's pond and corridors, then the 4th -- the only green on the nine
     within 20 m of water, which is the closest anything gets */
  'upsala-mellanbanan': [
    { hole: 8, cam: 'orbit', preset: 'golden' },
    { hole: 4, cam: 'orbit', preset: 'golden' },
  ],
  /* the 8th leads, not the signature 2nd: it is the frame that carries the
     estate -- corridors, a bunker, the pond curving through and the buildings
     on the horizon. Then the 2nd's green across the water it drops to. */
  'johannesberg-9': [
    { hole: 8, cam: 'orbit', preset: 'golden' },
    { hole: 2, cam: 'green', preset: 'golden' },
    { hole: 2, cam: 'orbit', preset: 'golden' },
  ],
  /* the 3rd leads because it is the ONLY framing on this nine that shows the
     fjärd, and a Veckefjärden course whose card does not show the fjärd is
     selling itself as a forest course. Then the 9th with the red clubhouse on
     the ridge, and the 1st's green under raking evening light. */
  'veckefjarden-korthalsbanan': [
    { hole: 3, cam: 'orbit', preset: 'golden' },
    { hole: 9, cam: 'orbit', preset: 'golden' },
    { hole: 1, cam: 'green', preset: 'golden' },
  ],

  /* the water hole and its drop zone, then the 17th, the wettest on the card */
  angso: [
    { hole: 15, cam: 'green', preset: 'golden' },
    { hole: 17, cam: 'green', preset: 'mist' },
    { hole: 17, cam: 'orbit', preset: 'host' },
    { hole: 15, cam: 'top', preset: 'noon' },
  ],
};

const slugs = ONLY ? [ONLY] : Object.keys(PLAN);

/* Prefer a system Chrome for its real GPU -- a poster wants the good renderer --
   but fall back to the bundled Chromium on swiftshader where there is none, the
   same way tools/check-app.mjs does. Without this the tool cannot run at all in
   a container, which is where the second courses' posters had to be shot. */
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAVE_BUNDLED = fs.existsSync(LINUX_CHROME);
const browser = await chromium.launch({
  ...(HAVE_BUNDLED ? { executablePath: LINUX_CHROME } : { channel: 'chrome' }),
  headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=1',
         ...(HAVE_BUNDLED ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : [])],
});

/* Downscale + encode inside the browser that already has the pixels: no image
   dependency enters the repo, and the codec is the one the posters ship to. */
async function encodeWebp(page, pngBuffer, width = WIDTH, quality = QUALITY) {
  const b64 = await page.evaluate(async ([src, w, q]) => {
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = src; });
    const scale = Math.min(1, w / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', q).split(',')[1];
  }, ['data:image/png;base64,' + pngBuffer.toString('base64'), width, quality]);
  return Buffer.from(b64, 'base64');
}

async function shootCourse(slug) {
  const plan = PLAN[slug];
  const dir = path.join(CACHE, slug);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const url = `${BASE}/?bana=${slug}&det=1&ren=1&skylt=0`;
  process.stdout.write(`\n${slug}  booting…`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  /* Clean mode hides the HUD but ADDS one control: the button that leaves it.
     Correct for a visitor, wrong for a photograph -- it was sitting in the
     top-right corner of every poster in the first batch. */
  await page.addStyleTag({ content: '#cleanExit{display:none!important}' });
  await page.waitForTimeout(1200);
  process.stdout.write(' up\n');

  const labelFile = path.join(dir, 'labels.json');
  const labels = fs.existsSync(labelFile) ? JSON.parse(fs.readFileSync(labelFile, 'utf8')) : {};
  for (const r of (EXTRA.length ? EXTRA : RECIPES)) {
    const hole = r.literal ? r.hole : plan[r.hole];
    labels[r.id] = `hål ${hole} · ${r.what.replace(/^extra · hål \d+ · /, '')}`;
    await page.evaluate(([h, c, p]) => {
      if (p) window.V3D?.setPreset?.(p);
      if (h) window.V3D?.goHole?.(+h, false, true);
      if (c) window.V3D?.setCam?.(c, true);
    }, [hole, r.cam, r.preset]);
    await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1100);
    const png = await page.screenshot({ timeout: 300000, animations: 'disabled' });
    const webp = await encodeWebp(page, png);
    fs.writeFileSync(path.join(dir, `cand-${r.id}.webp`), webp);
    console.log(`  cand-${r.id}  hål ${hole} · ${r.cam} · ${r.preset}  ${(webp.length / 1024).toFixed(0)} kB`);
  }
  fs.writeFileSync(labelFile, JSON.stringify(labels, null, 1));
  await page.close();
}

/* The contact sheet is the point of the candidates pass: eight framings at the
   card's real size, on the chooser's own ground, so the pick is made where the
   viewer makes it and not on a 1600 px still that flatters everything. */
async function contactSheet(slug) {
  const dir = path.join(CACHE, slug);
  const labelFile = path.join(dir, 'labels.json');
  const labels = fs.existsSync(labelFile) ? JSON.parse(fs.readFileSync(labelFile, 'utf8')) : {};
  const ids = fs.readdirSync(dir).map(f => (f.match(/^cand-(\d+)\.webp$/) || [])[1])
    .filter(Boolean).map(Number).sort((a, b) => a - b);
  const cards = ids.map(id => {
    const b64 = fs.readFileSync(path.join(dir, `cand-${id}.webp`)).toString('base64');
    return `<figure><img src="data:image/webp;base64,${b64}">
      <figcaption><b>${id}</b> ${labels[id] || ''}</figcaption></figure>`;
  }).join('');
  const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
  await page.setContent(`<style>
    body{margin:0;background:#0b120e;color:#eaf3ec;font:13px system-ui,sans-serif;padding:18px}
    h1{font-size:15px;margin:0 0 14px;letter-spacing:.4px}
    .g{display:grid;grid-template-columns:repeat(4,400px);gap:16px}
    figure{margin:0}
    img{width:400px;height:225px;object-fit:cover;border-radius:10px;display:block}
    figcaption{padding-top:6px;color:#9db3a5}
    b{color:#5fd07a}
  </style><h1>${slug} — kandidater vid kortets egen storlek (400×225)</h1>
  <div class="g">${cards}</div>`);
  await page.waitForTimeout(400);
  const out = path.join(CACHE, `contact-${slug}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  console.log(`  contact sheet -> ${path.relative(ROOT, out)}`);
}

/* Shoot exactly what POSTERS lists and write it. One boot per course. */
async function writeChosen(slug) {
  const picks = POSTERS[slug] || [];
  if (!picks.length) { console.log(`  ${slug}: nothing listed, skipped`); return; }
  const dest = path.join(OUT, slug);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  process.stdout.write(`\n  ${slug}  booting…`);
  await page.goto(`${BASE}/?bana=${slug}&det=1&ren=1&skylt=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  await page.addStyleTag({ content: '#cleanExit{display:none!important}' });
  await page.waitForTimeout(1200);
  process.stdout.write(' up\n');
  let total = 0;
  for (let i = 0; i < picks.length; i++) {
    const r = picks[i];
    await page.evaluate(([h, c, p]) => {
      if (p) window.V3D?.setPreset?.(p);
      if (h) window.V3D?.goHole?.(+h, false, true);
      if (c) window.V3D?.setCam?.(c, true);
    }, [r.hole, r.cam, r.preset]);
    await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1100);
    const png = await page.screenshot({ timeout: 300000, animations: 'disabled' });
    const webp = await encodeWebp(page, png);
    const to = path.join(dest, `hero-${i + 1}.webp`);
    fs.writeFileSync(to, webp);
    total += webp.length;
    console.log(`    hero-${i + 1}  hål ${r.hole} · ${r.cam} · ${r.preset}  ${(webp.length / 1024).toFixed(0)} kB`);
  }
  await page.close();
  /* stale posters from a shorter set would keep being fetched by a card that no
     longer lists them, so they go */
  for (let i = picks.length + 1; i <= 8; i++) {
    const f = path.join(dest, `hero-${i}.webp`);
    if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`  ${slug}: removed stale hero-${i}.webp`); }
  }
  console.log(`  ${slug}: ${picks.length} posters, ${(total / 1024).toFixed(0)} kB`);
}

if (DO_CANDIDATES) {
  for (const s of slugs) { await shootCourse(s); await contactSheet(s); }
}
if (DO_WRITE) {
  console.log('\nwriting chosen posters');
  let grand = 0;
  for (const s of slugs) {
    await writeChosen(s);
    for (const f of fs.readdirSync(path.join(OUT, s))) {
      if (/^hero-\d+\.webp$/.test(f)) grand += fs.statSync(path.join(OUT, s, f)).size;
    }
  }
  console.log(`\n  all posters on the front door: ${(grand / 1024).toFixed(0)} kB`);
}
if (!DO_CANDIDATES && !DO_WRITE) console.log('nothing to do: pass --candidates and/or --write');
await browser.close();
