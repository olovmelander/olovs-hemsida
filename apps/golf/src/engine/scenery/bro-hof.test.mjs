import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadSceneryModule } from './index.js';
import * as scenery from './bro-hof.js';
import { inRing } from '../geom.js';
import { mownBankWaters } from '../ground-cover.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const pack = slug => {
  const bytes = fs.readFileSync(new URL(`../../../public/courses/${slug}/pack.bin`, import.meta.url));
  const headerBytes = bytes.readUInt32LE(4), header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString());
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  return JSON.parse(zlib.inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)).toString());
};

describe('the scenery both Bro Hof courses share', () => {
  it('is one module for both slugs', async () => {
    const [stadium, castle] = await Promise.all(['bro-hof-stadium', 'bro-hof-castle'].map(loadSceneryModule));
    expect(stadium).toBe(castle);
    expect(stadium.houseKit).toBe(true);
  });

  it('reads the ponds off the ground as published', () => {
    expect(scenery.deferWaterBedToWorld).toBe(true); // the early carve stood every pond inside its own walls
  });

  it('mixes the park trees, and never plants a conifer on the low shore', () => {
    const count = new Map();
    for (let i = 0; i < 1000; i++) {
      const id = scenery.species({ r: i / 1000, x: 0, z: 0, h: 8, extended: true });
      count.set(id, (count.get(id) ?? 0) + 1);
      expect([2, 3]).toContain(scenery.species({ r: i / 1000, x: 0, z: 0, h: 1.2, extended: true }));
      expect([0, 1, 2]).toContain(scenery.species({ r: i / 1000, x: 0, z: 0, h: 8 }));
    }
    expect([...count.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(count.get(4)).toBeGreaterThan(count.get(2));
    const conifers = x => Array.from({ length: 1000 }, (_, i) => scenery.species({ r: i / 1000, x, z: 0, h: 8, extended: true })).filter(s => s < 2).length;
    expect(conifers(1500)).toBeGreaterThan(conifers(0) * 2);
  });

  /* the owner, 27 November 2026: Bro Hof's mown pond banks bear no reeds */
  describe('the mown banks', () => {
    const record = read('../../../../../brohofbuild/mapping/reed-bank-decisions.json');
    const model = read('../../../../../brohofbuild/course-model.json');
    const [E0, N0] = [649094.5, 6598568.5];
    const local = ([e, n]) => [e - E0, N0 - n];
    const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.06);

    it("are the record's mown waters, at the same points and stretches", () => {
      const mown = record.waters.filter(w => w.bank === 'mown' || w.bank === 'mown in part');
      expect(scenery.mownBanks.map(b => b.id)).toEqual(mown.map(w => w.id));
      for (const [bank, entry] of scenery.mownBanks.map((b, i) => [b, mown[i]])) {
        expect(close(bank.at, local(entry.at)), bank.id).toBe(true);
        expect(!!bank.stretch, bank.id).toBe(entry.bank === 'mown in part');
        if (bank.stretch) expect(bank.stretch.every((p, i) => close(p, local(entry.stretch[i]))), bank.id).toBe(true);
      }
    });

    it('each name the water of its id in the model, and no other; a kept water is not named', () => {
      for (const entry of record.waters.filter(w => w.at)) {
        const [x, z] = local(entry.at);
        expect(model.water.filter(w => inRing(x, z, w.ring)).map(w => w.id), entry.id).toEqual([entry.id]);
      }
      const kept = record.waters.filter(w => !['mown', 'mown in part'].includes(w.bank)).map(w => w.id);
      expect(kept).toContain('lm-water-659_64-0-1');
      for (const bank of scenery.mownBanks) expect(kept).not.toContain(bank.id);
    });

    it('find their water in both published packs', () => {
      for (const slug of ['bro-hof-stadium', 'bro-hof-castle']) {
        const { water } = pack(slug);
        const { marked, missed } = mownBankWaters(water, scenery.mownBanks, inRing);
        expect(missed, slug).toEqual([]);
        expect(marked.size, slug).toBe(scenery.mownBanks.length);
        /* the same outline as the model's water of that id */
        for (const bank of scenery.mownBanks) {
          const q = water.find(w => marked.has(w) && inRing(bank.at[0], bank.at[1], w.ring));
          expect(q.ring, `${slug} ${bank.id}`).toEqual(model.water.find(w => w.id === bank.id).ring);
          if (bank.stretch) expect(marked.get(q)).toEqual([bank.stretch]);
        }
      }
    });
  });
});
