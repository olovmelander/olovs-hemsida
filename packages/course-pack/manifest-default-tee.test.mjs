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

  it('points at the yellow swatch, whatever the tee is named', () => {
    for (const c of manifest.courses) expect(c.tees.cols[c.tees.def], c.slug).toBe(YELLOW);
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
  });
});
