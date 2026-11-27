/* The ground cover's corridor is every tee's line of play (tee-corridors.mjs): Bro Hof's blind
   review of 27 November 2026 found a bush on Stadium 18's aim line from the forward tees. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { teeCorridors, teePlayLines, TEE_CORRIDOR_METRES } from './tee-corridors.mjs';
import { teeView } from './tee-view.mjs';
import { distToLine } from './geom.js';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const pack = slug => {
  const bytes = fs.readFileSync(new URL(`../../public/courses/${slug}/pack.bin`, import.meta.url));
  const headerBytes = bytes.readUInt32LE(4), header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString());
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  return JSON.parse(zlib.inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)).toString());
};

describe('every tee\'s line of play', () => {
  /* a straight hole north, its back tee on the line and a forward deck 40 m to the west */
  const hole = { n: 1, line: [[0, 0], [0, -400]], pin: [0, -400],
    tees: { marks: [{ c: [0, 0] }, { c: [-40, -60] }] } };

  it('runs from each mark to the landing area its tee view frames', () => {
    const lines = teePlayLines([hole]);
    expect(lines).toHaveLength(2);
    const { aim } = teeView(hole, hole.tees.marks[1]);
    expect(lines[1].line).toEqual([[-40, -60], [aim.x, aim.z]]);
    expect(Math.abs(aim.x)).toBeLessThan(1e-9);   /* on the route */
  });

  it('keeps the cover off the forward deck\'s shot, which the hole\'s line leaves open', () => {
    const corridors = teeCorridors([hole]);
    /* 30 m west of the line, 30 m ahead of the forward deck: the drive crosses it */
    const p = [-30, -90];
    expect(distToLine(p[0], p[1], hole.line)).toBeGreaterThan(24);
    expect(corridors.within(...p)).toBe(true);
    /* far west of every line of play the rough is the cover's */
    expect(corridors.within(-90, -200)).toBe(false);
    expect(corridors.within(-40 - TEE_CORRIDOR_METRES - 1, -60)).toBe(false);
  });

  it('covers the rough Stadium 18\'s yellow and blue deck drives over, which the back tee\'s line does not', () => {
    const holes = pack('bro-hof-stadium').holes;
    const h18 = holes.find(h => h.n === 18);
    const corridors = teeCorridors([h18]);
    /* the forward deck that stands farthest from the hole's line */
    const far = h18.tees.marks.map(m => ({ m, d: distToLine(m.c[0], m.c[1], h18.line) })).sort((a, b) => b.d - a.d)[0];
    expect(far.d).toBeGreaterThan(30);
    const { aim } = teeView(h18, far.m);
    /* the first 45 m of its shot lie more than the hole line's 24 m from that line, and
       inside the deck's own corridor (the bush stood 30.5 m from the line at E 648595 N 6597701) */
    const length = Math.hypot(aim.x - far.m.c[0], aim.z - far.m.c[1]);
    for (let s = 5; s <= 45; s += 5) {
      const p = [far.m.c[0] + (aim.x - far.m.c[0]) * s / length, far.m.c[1] + (aim.z - far.m.c[1]) * s / length];
      expect(distToLine(p[0], p[1], h18.line)).toBeGreaterThan(24);
      expect(corridors.within(...p)).toBe(true);
    }
    expect(corridors.within(-499.3, 867.6)).toBe(true);
  });

  it('is wired in the cover lattice and the reed scan behind ?teecorridor=0', () => {
    expect(main).toMatch(/const TEE_CORRIDOR_ON = new URLSearchParams\(location\.search\)\.get\('teecorridor'\) !== '0';/);
    expect(main).toMatch(/const TEE_PLAY = TEE_CORRIDOR_ON \? teeCorridors\(HOLES\) : null;/);
    const cell = main.slice(main.indexOf('const coverCell = '), main.indexOf("await scatterGrid('cover'"));
    expect(cell).toMatch(/if \(c\.dLine < 24 \|\| c\.dLine > 300\) return;\n\s+if \(TEE_PLAY\?\.within\(px, pz\)\) return;/);
    /* and the reed scan, which the hole line's rule only thins */
    const reeds = main.slice(main.indexOf('const reedCell = '), main.indexOf("await scatterGrid('reeds'"));
    expect(reeds).toMatch(/if \(TEE_PLAY\?\.within\(px, pz\)\) return;\n\s+if \(c\.dLine < 34\) dens \*= 0\.12;/);
    expect(main.indexOf('const TEE_PLAY = ')).toBeLessThan(main.indexOf('const reedCell = '));
  });
});
