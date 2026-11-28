/* The still green view is shown from the green cache's copy of the frame (map-green-cache.mjs).
   On 28 November it was drawn red on Bro Hof Stadium 1: the ground's shore field had been
   given the scene layer's texture unit, so the frame was copied into that one-channel field
   and shown from it, in its red channel alone. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHORE_UNIT } from './map-gl.mjs';
import { createGreenCache, FOREGROUND_UNIT, GREEN_CACHE_UNITS, SCENE_UNIT, VISIBILITY_UNIT } from './map-green-cache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Just enough of WebGL2 to see which texture each unit holds when the cache copies the
   frame and when it shows it. */
function recordingGl() {
  const bound = new Map(), copies = [], draws = [];
  let active = 0, made = 0;
  const gl = {
    TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, RGB8: 0x8051, R8: 0x8229, NEAREST: 0x2600,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, NO_ERROR: 0, TRIANGLES: 4,
    COLOR_BUFFER_BIT: 0x4000, STENCIL_BUFFER_BIT: 0x400, DEPTH_TEST: 0x0b71, STENCIL_TEST: 0x0b90,
    ALWAYS: 0x0207, EQUAL: 0x0202, KEEP: 0x1e00, REPLACE: 0x1e01,
    drawingBufferWidth: 8, drawingBufferHeight: 6,
    getError: () => 0,
    isContextLost: () => false,
    getContextAttributes: () => ({ stencil: true }),
    createTexture: () => ({ layer: ++made }),
    activeTexture(unit) { active = unit - gl.TEXTURE0; },
    bindTexture(target, handle) { if (target === gl.TEXTURE_2D) bound.set(active, handle); },
    copyTexSubImage2D() { copies.push(bound.get(active)); },
    drawArrays() { draws.push(new Map(bound)); },
  };
  for (const name of ['deleteTexture', 'texStorage2D', 'texParameteri', 'useProgram', 'uniform1i', 'bindVertexArray',
    'clear', 'clearColor', 'enable', 'disable', 'stencilFunc', 'stencilOp']) gl[name] = () => {};
  return { gl, copies, draws };
}

describe('the green cache', () => {
  it('copies the frame into its own layers and shows them, whatever the other passes bound', () => {
    const { gl, copies, draws } = recordingGl();
    const cache = createGreenCache(gl, () => ({ program: {}, u: {} }));
    const shore = { layer: 'the ground\'s shore field' };
    /* The renderer's passes bind their own textures between the cache's calls, every frame. */
    const otherPasses = () => {
      for (let unit = 0; unit < 16; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, shore);
      }
    };
    expect(cache.prepare()).toBe(true);
    otherPasses();
    cache.markForeground();
    expect(cache.finish()).toBe(true);
    expect(copies).toHaveLength(3);
    expect(copies, 'a copy went into another pass\'s texture').not.toContain(shore);
    expect(new Set(copies).size).toBe(3);

    otherPasses();
    expect(cache.present()).toBe(true);
    const [scene, foreground, visibility] = copies;
    const shown = draws.at(-1);
    expect(shown.get(SCENE_UNIT), 'the frame shown is the scene layer').toBe(scene);
    expect(shown.get(FOREGROUND_UNIT)).toBe(foreground);
    expect(shown.get(VISIBILITY_UNIT)).toBe(visibility);
  });

  it('has units no other texture of the map takes', () => {
    const source = fs.readFileSync(path.join(HERE, 'map-gl.mjs'), 'utf8');
    const named = name => {
      expect({ SHORE_UNIT }, `map-gl.mjs binds ${name}: name it here`).toHaveProperty(name);
      return { SHORE_UNIT }[name];
    };
    const taken = new Set([
      ...[...source.matchAll(/gl\.TEXTURE(\d+)\b(?!\s*\+)/g)].map(match => Number(match[1])),
      ...[...source.matchAll(/gl\.TEXTURE0 \+ ([A-Z_]+)/g)].map(match => named(match[1])),
      ...[...source.matchAll(/\b(?:texture|arrayTexture)\((\d+),/g)].map(match => Number(match[1])),
      ...[...source.matchAll(/gl\.uniform1i\(\w+\.u\.u\w+, (\d+|SHORE_UNIT)\)/g)]
        .map(match => /^\d+$/.test(match[1]) ? Number(match[1]) : named(match[1])),
    ]);
    expect(taken).toContain(SHORE_UNIT);
    expect(taken).toContain(7);
    expect(new Set(GREEN_CACHE_UNITS).size).toBe(GREEN_CACHE_UNITS.length);
    for (const unit of GREEN_CACHE_UNITS) expect(taken.has(unit), `unit ${unit} is the green cache's`).toBe(false);
  });
});
