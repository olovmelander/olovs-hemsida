/* The committed manifest's default tee, checked without a browser.

   Every course opens on its YELLOW tee, and `def` is the column that tee sits
   in -- which is 0 at Norrfallsviken, 1 on the five-tee cards and 2 on the two
   six-tee ones, so nothing about it is a constant the app could assume. The
   test reads the SHIPPED index.json rather than the generator, because that
   file is what the app fetches: regenerating is a step somebody can forget. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
const YELLOW = 0xf0c93a;

describe('manifest default tee', () => {
  it('every course has one', () => {
    for (const c of manifest.courses) expect(Number.isInteger(c.tees.def), c.slug).toBe(true);
  });

  it('uses the verified yellow swatch, on every course', () => {
    for (const c of manifest.courses) expect(c.tees.cols[c.tees.def], c.slug).toBe(YELLOW);
  });

  /* Visby was the exception to the rule above, and the word in its old name was
     UNVERIFIED: it shipped six identical grey swatches and an explicit def of 1
     because nobody had established which colour sat behind each of its
     course-rating names, and the file would not invent a yellow tee to satisfy
     a convention. They are established now, from Caddee's own `color` fields --
     63 Vit, 59 Svart, 55 GUL, 51 Blå, 46 Orange, 41 Röd -- so the exception is
     gone and the general rule above covers it. Two things are worth keeping
     here rather than in a comment on the generator. The club uses a DIFFERENT
     scheme on its nine (63/59 and 46/41 swap), so Caddee carries two blocks and
     the eighteen is the one whose sort_order puts 59 first, agreeing with the
     SGF widget; and this is the only six-tee card here that is white-first
     where the other two are black-first, which is why it could never be copied
     from them. */
  it('gives Visby the colours the club publishes, and the yellow it opens on', () => {
    const tees = manifest.courses.find(c => c.slug === 'visby').tees;
    expect(tees.names).toEqual(['63', '59', '55', '51', '46', '41']);
    expect(tees.cols).toEqual([0xf4f4ee, 0x1a1a1a, YELLOW, 0x4a8fe0, 0xe08b3a, 0xe0574a]);
    expect(tees.names[tees.def]).toBe('55');
  });

  it('is a real column on the card', () => {
    for (const c of manifest.courses) {
      expect(c.tees.def, c.slug).toBeGreaterThanOrEqual(0);
      expect(c.tees.def, c.slug).toBeLessThan(c.tees.names.length);
    }
  });

  /* the two courses that name their tees by course rating: a name match would
     have left exactly these on the back tee, so they are named here */
  it('finds the yellow column on the rating-named cards', () => {
    const by = s => manifest.courses.find(c => c.slug === s);
    expect(by('upsala').tees.names[by('upsala').tees.def]).toBe('56');
    expect(by('veckefjarden').tees.names[by('veckefjarden').tees.def]).toBe('58');
    expect(by('visby').tees.names[by('visby').tees.def]).toBe('55');
  });
});
