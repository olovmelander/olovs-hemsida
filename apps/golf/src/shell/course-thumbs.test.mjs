import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/* A club row in the start menu shows its course at 56 px from thumb.webp, never the
   800 px poster (tools/make-posters.mjs, THE THUMBNAIL). */
const PUBLIC = new URL('../../public/', import.meta.url);
const courses = JSON.parse(fs.readFileSync(new URL('courses/index.json', PUBLIC), 'utf8')).courses;

/* the size a WebP says it is: lossy, lossless or extended */
export function webpSize(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  return null;
}

describe('the club rows\' thumbnails', () => {
  it('stand beside every course\'s posters, square, at three times 56 px and a few kilobytes', () => {
    const shown = courses.filter(course => course.photos);
    expect(shown.length).toBeGreaterThan(0);
    for (const course of shown) {
      const file = new URL(`courses/${course.slug}/thumb.webp`, PUBLIC);
      expect(fs.existsSync(file), `${course.slug}/thumb.webp`).toBe(true);
      const bytes = fs.readFileSync(file);
      expect(webpSize(bytes), course.slug).toEqual({ width: 168, height: 168 });
      expect(bytes.length, course.slug).toBeLessThan(12 * 1024);
    }
  });

  it('are what the start menu draws a row with, and what the service worker keeps', () => {
    expect(fs.readFileSync(new URL('home.js', import.meta.url), 'utf8')).toMatch(/courses\/\$\{slug\}\/thumb\.webp/);
    expect(fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8')).toMatch(/hero-1\|backdrop\|thumb/);
  });
});
