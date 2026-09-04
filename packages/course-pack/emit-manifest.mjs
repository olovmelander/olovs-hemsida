/* Write the course manifest -- apps/golf/public/courses/index.json, the single
   contract between the pipelines and the app.

   usage: node packages/course-pack/emit-manifest.mjs

   Everything computable is computed (par and tee count from the build's
   card.json, bytes and sha256 from the committed pack -- so the manifest IS the
   currency gate's other half), and the few display strings that used to be
   page literals live in the table below, absorbed verbatim from the six pages'
   headers when the app took over. `hideFrom` is each page's own nth-child
   number: from which tee column the medium-width layout starts hiding.
   Veckefjarden joins this table at the merge phase, not before.               */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack, sha256, readCard } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'apps/golf/public/courses/index.json');

/* The yellow tee's colour. Every course's table below carries it, and `def` --
   which tee the app opens on -- is derived from it rather than written per
   course, so it cannot drift from the swatch the HUD actually draws. */
const TEE_YELLOW = 0xf0c93a;

/* order is presentation order: the first entry is the default course until the
   phase-5 rail replaces defaults with a choice */
const COURSES = [
  { slug: 'angso', build: 'angsobuild', name: 'Ängsö GK', club: 'Ängsö Golfklubb',
    title: 'Ängsö Golfklubb — Banan i 3D', tag: 'Ängsö', boot: 'Stora Bodarna · Mälaren',
    tees: { names: ['Vit', 'Gul', 'Blå', 'Röd', 'Ora'], cols: [0xf4f4ee, 0xf0c93a, 0x4a8fe0, 0xe0574a, 0xe08b3a], hideFrom: 5 } },
  { slug: 'norrfallsviken', build: 'nvgkbuild', name: 'Norrfällsvikens GK', club: 'Norrfällsvikens Golfklubb',
    title: 'Norrfällsvikens GK — Seaside i Höga Kusten, i 3D', tag: 'Seaside', boot: 'Mjällom · Höga Kusten',
    tees: { names: ['Gul', 'Röd', 'Orange'], cols: [0xf0c93a, 0xe0574a, 0xe08b3a], hideFrom: 4 } },
  { slug: 'puttom', build: 'puttombuild', name: 'Puttom', club: 'Örnsköldsviks Golfklubb',
    title: 'Örnsköldsviks GK Puttom — Skogsbana i 3D', tag: 'Örnsköldsviks GK', boot: 'Arnäsvall · Örnsköldsvik',
    tees: { names: ['Vit', 'Gul', 'Röd', 'Orange'], cols: [0xf4f4ee, 0xf0c93a, 0xe0574a, 0xe08b3a], hideFrom: 5 } },
  { slug: 'upsala', build: 'upsalabuild', name: 'Upsala GK', club: 'Upsala Golfklubb',
    title: 'Upsala Golfklubb — Banan i 3D', tag: 'Stora banan', boot: 'Håmö gård · Läby',
    tees: { names: ['62', '59', '56', '51', '47', '42'], cols: [0x1a1a1a, 0xf4f4ee, 0xf0c93a, 0x4a8fe0, 0xe0574a, 0xe08b3a], hideFrom: 5 } },
  /* The first NINE, and the first course to share another's ground: the same
     terrain, woods and clubhouse as `upsala`, a different set of holes played
     over them, and the Stora banan carried in its scenery so the championship
     course still reads as mown from here. */
  { slug: 'upsala-mellanbanan', build: 'upsalamellanbuild', name: 'Mellanbanan', club: 'Upsala Golfklubb',
    title: 'Upsala GK Mellanbanan — Nio hål i 3D', tag: 'Mellanbanan', boot: 'Håmö gård · Läby',
    tees: { names: ['Vit', 'Gul', 'Blå', 'Röd', 'Orange'], cols: [0xf4f4ee, 0xf0c93a, 0x4a8fe0, 0xe0574a, 0xe08b3a], hideFrom: 5 } },
  { slug: 'johannesberg', build: 'johannesbergbuild', name: 'Johannesberg', club: 'Johannesberg Golf & Country Club',
    title: 'Johannesberg Golf & CC — Banan i 3D', tag: 'Gottröra', boot: 'Gottröra · Uppland',
    tees: { names: ['Vit', 'Gul', 'Blå', 'Röd', 'Orange'], cols: [0xf4f4ee, 0xf0c93a, 0x4a8fe0, 0xe0574a, 0xe08b3a], hideFrom: 5 } },
  /* Johannesberg is 27 holes: this is the other Donald Steel nine, west and
     north-west of the manor, on the eighteen's ground. Only two tees exist. */
  { slug: 'johannesberg-9', build: 'johannesberg9build', name: 'Johannesberg 9', club: 'Johannesberg Golf & Country Club',
    title: 'Johannesberg Golf & CC — Niohålsbanan i 3D', tag: 'Niohålsbanan', boot: 'Gottröra · Uppland',
    tees: { names: ['Gul', 'Röd'], cols: [0xf0c93a, 0xe0574a], hideFrom: 3 } },
  /* the six-tee course, and the only one whose card lives in banguide/ */
  { slug: 'veckefjarden', build: 'geobuild', name: 'Veckefjärdens GC', club: 'Veckefjärdens Golfklubb',
    title: 'Veckefjärdens GC — Mästerskapsbanan i 3D', tag: 'Mästerskapsbanan', boot: 'Örnsköldsvik · Ångermanland',
    tees: { names: ['65', '61', '58', '55', '48', '40'], cols: [0x1a1a1a, 0xf4f4ee, 0xf0c93a, 0x4a8fe0, 0xe0574a, 0xe08b3a], hideFrom: 5 } },
  /* nine par 3s on the Mästerskapsbanan's ground, and the only course here whose
     card does not reconcile with its own printed totals -- see
     geobuild/card-korthalsbanan.json, which says so in its own note. It is also
     the only unrated one, so every hcp is null and the card prints par alone. */
  { slug: 'veckefjarden-korthalsbanan', build: 'veckefjardenkortbuild', name: 'Korthålsbanan', club: 'Veckefjärdens Golfklubb',
    title: 'Veckefjärdens GC — Korthålsbanan i 3D', tag: 'Korthålsbanan', boot: 'Örnsköldsvik · Ångermanland',
    tees: { names: ['Gul', 'Röd'], cols: [0xf0c93a, 0xe0574a], hideFrom: 3 } },
  { slug: 'ribbingsfors', build: 'ribbingsforsbuild', name: 'Ribbingsfors Golf & Kultur', club: 'Ribbingsfors Golf & Kultur',
    title: 'Ribbingsfors Golf & Kultur — Nio hål i 3D', tag: 'Park & hagmark', boot: 'Gullspång · Skagern',
    cardStatus: 'Hålavstånd och index är preliminära',
    tees: { names: ['Vit', 'Gul', 'Röd'], cols: [0xf4f4ee, 0xf0c93a, 0xe0574a], hideFrom: 4 } },
];

const entries = COURSES.map(c => {
  const cardHoles = readCard(ROOT, c.build);
  const packFile = path.join(ROOT, 'apps/golf/public/courses', c.slug, 'pack.bin');
  const buf = fs.readFileSync(packFile);
  const { header } = readPack(buf);                       /* validates magic + fmt + framing */
  if (header.slug !== c.slug) throw new Error(`${c.slug}: pack header says ${header.slug}`);
  const nTee = cardHoles[0].t.length;
  if (nTee !== c.tees.names.length || nTee !== c.tees.cols.length)
    throw new Error(`${c.slug}: card has ${nTee} tees, display table has ${c.tees.names.length}/${c.tees.cols.length}`);
  /* Which tee a course OPENS on: the yellow one, the tee most members play.
     Found by COLOUR, never by name -- two courses name their tees by course
     rating (Upsala's yellow is '56', Veckefjardens '58') and a name match would
     quietly open those two on the back tee. A course with no yellow is an error
     rather than a fallback, because the default would then be a guess and this
     table is where that decision belongs. */
  const def = c.tees.cols.indexOf(TEE_YELLOW);
  if (def < 0) throw new Error(`${c.slug}: no yellow tee in the display table, so no default tee`);
  const par = cardHoles.reduce((a, h) => a + h.par, 0);
  /* How many posters the chooser card may cycle through. Counted from what is
     actually committed rather than declared, so a course that loses a poster
     stops advertising it and the card simply cycles fewer -- the same reason
     bytes and sha256 are measured here instead of written down. */
  const dir = path.join(ROOT, 'apps/golf/public/courses', c.slug);
  let photos = 0;
  while (fs.existsSync(path.join(dir, `hero-${photos + 1}.webp`))) photos++;
  return {
    slug: c.slug, name: c.name, club: c.club, title: c.title, tag: c.tag, boot: c.boot,
    /* Which build directory produced this course. The app ignores it; the gates
       need it, and they used to keep a SECOND copy of this mapping -- which no
       rule can derive (norrfallsviken comes from nvgkbuild, veckefjarden from
       geobuild) and which therefore silently went stale every time a course was
       added. The manifest is the pipelines' contract with the app, and which
       pipeline built a course is part of that contract. */
    build: c.build,
    par, holes: cardHoles.length, tees: { ...c.tees, def }, photos,
    ...(c.cardStatus ? { cardStatus: c.cardStatus } : {}),
    /* RELATIVE, with no leading slash: the manifest is data, and data does not
       get to know where the site is mounted. The app prefixes its own base
       (import.meta.env.BASE_URL), so the same manifest serves a domain root and
       a GitHub Pages subpath without being regenerated per host. */
    packUrl: `courses/${c.slug}/pack.bin`, bytes: buf.length, sha256: sha256(buf),
  };
});

fs.writeFileSync(OUT, JSON.stringify({ fmt: 1, courses: entries }, null, 1) + '\n');
for (const e of entries)
  console.log(`${e.slug.padEnd(16)} par ${e.par}  ${String(e.tees.names.length)} tees  ${(e.bytes / 1024).toFixed(0).padStart(4)} KB  ${e.sha256.slice(0, 12)}…`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
