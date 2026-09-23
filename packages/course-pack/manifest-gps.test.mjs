/* The manifest's `gps` record is derived from each pack (courseGpsRecord), so
   it is only as true as the pack it came from. This reads the SHIPPED
   index.json and every committed pack and demands they agree, because a pack
   rebuilt without re-running emit-manifest would leave GPS mode sending players
   to where a course's holes used to be -- and nothing else would notice. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { courseGpsRecord, inflateStream, readPack } from './lib.mjs';
import { gpsToLocal } from '../../apps/golf/src/engine/caddie.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));

describe('manifest gps records', () => {
  it.each(manifest.courses.map(c => [c.slug, c]))('%s matches its pack', (slug, course) => {
    const { header, sv } = readPack(fs.readFileSync(path.join(ROOT, 'apps/golf/public', course.packUrl)));
    const holes = JSON.parse(inflateStream(sv).toString('utf8')).holes;
    expect(course.gps).toEqual(courseGpsRecord(header.GEO, holes));
    expect(course.gps.lines).toHaveLength(course.holes);
  });

  it.each(manifest.courses.map(c => [c.slug, c]))('%s places its own origin at the frame origin', (slug, course) => {
    /* the app's gpsToLocal accepts the record as a frame -- a projected pack's
       frame string, origin and scale must match the registry exactly -- and
       puts the pack origin at (0, 0) */
    const [x, z] = gpsToLocal({ latitude: course.gps.origin.lat, longitude: course.gps.origin.lon }, course.gps);
    expect(Math.hypot(x, z)).toBeLessThan(0.05);
  });

  it('refuses a pack whose holes are not stored in playing order', () => {
    const geo = { frame: 'f', origin: { lat: 60, lon: 17 }, mPerLon: 55000 };
    expect(() => courseGpsRecord(geo, [{ n: 2, line: [[0, 0], [1, 1]] }])).toThrow(/numbered/);
    expect(courseGpsRecord(geo, [{ n: 1, line: [[0.4, -0.6], [100.5, -200.49]] }]).lines).toEqual([[[0, -1], [101, -200]]]);
  });
});
