/* Compare the cached and original draw order, including real multisample
   coverage at silhouettes. No terrain/assets are required for this fixture. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const source = await readFile(new URL('../apps/golf/src/map/map-green-cache.mjs', import.meta.url));
const url = 'data:application/javascript;base64,' + source.toString('base64');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  const page = await browser.newPage();
  for (const antialias of [false, true]) {
    const result = await page.evaluate(async ({ url, antialias }) => {
      const { createGreenCache, CACHED_PULSE_INK, FOREGROUND_UNIT, VISIBILITY_UNIT } = await import(url);
      const canvas = document.createElement('canvas');
      canvas.width = 96; canvas.height = 64;
      const gl = canvas.getContext('webgl2', { alpha: false, antialias, stencil: true });
      function compile(gl, vert, frag) {
        const program = gl.createProgram();
        for (const [type, text] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]]) {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, text); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        const u = {};
        for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
          const { name } = gl.getActiveUniform(program, i);
          u[name] = gl.getUniformLocation(program, name);
        }
        return { program, u };
      }
      const vertex = `#version 300 es
        uniform vec3 uPlacement;
        void main() {
          vec2 corners[3] = vec2[3](vec2(-1,-1), vec2(1,-1), vec2(-1,1));
          gl_Position = vec4(corners[gl_VertexID] * uPlacement.z + uPlacement.xy, 0.5, 1.0);
        }`;
      const program = cached => compile(gl, vertex, `#version 300 es
        precision highp float;
        ${cached ? CACHED_PULSE_INK : ''}
        uniform vec4 uInk;
        out vec4 colour;
        void main() {colour = vec4(${cached ? 'cachedPulseInk(uInk.rgb)' : 'uInk.rgb'}, uInk.a);}`);
      const plain = program(false), tinted = program(true);
      gl.useProgram(tinted.program);
      gl.uniform1i(tinted.u.uForeground, FOREGROUND_UNIT);
      gl.uniform1i(tinted.u.uVisibility, VISIBILITY_UNIT);
      const triangle = (p, at, ink) => {
        gl.useProgram(p.program);
        gl.uniform3fv(p.u.uPlacement, at); gl.uniform4fv(p.u.uInk, ink);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const clear = () => {
        gl.clearColor(.1,.3,.17,1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      };
      const foreground = () => {
        gl.enable(gl.DEPTH_TEST);
        triangle(plain, [.42,-.11,.8], [.68,.22,.04,1]);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        triangle(plain, [-.13,.35,.61], [.12,.81,.24,.58]);
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.disable(gl.DEPTH_TEST);
      };
      const pulse = (p, offset) => {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        triangle(p, [offset,-.24,1.05], [1,.89,.64,.85]);
        triangle(p, [offset + .26,.4,.74], [.87,.93,1,.48]);
        gl.disable(gl.BLEND);
      };
      const pixels = () => {
        const data = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
        return data;
      };
      const reference = offset => { clear(); pulse(plain,offset); foreground(); return pixels(); };
      const cache = createGreenCache(gl,compile);
      const offsets = [-.35, .13];
      const refs = offsets.map(reference);
      clear();
      if (!cache.prepare()) throw Error('Unable to prepare cache');
      cache.markForeground(); foreground();
      if (!cache.finish()) throw Error('Unable to capture cache');
      const diffs = offsets.map((offset, index) => {
        if (!cache.present()) throw Error('Unable to present cache');
        pulse(tinted,offset);
        const frame = pixels(), reference = refs[index];
        let changed = 0, error = 0;
        for (let i = 0; i < frame.length; i++) {
          const diff = Math.abs(frame[i] - reference[i]);
          error += diff;
          if (diff > 3) changed++;
        }
        return { mean: error / frame.length, changed: changed / frame.length };
      });
      cache.release();
      return { diffs, samples: gl.getParameter(gl.SAMPLES), error: gl.getError(), ready: cache.present() };
    }, { url, antialias });
    console.log('Static scene and foreground occlusion', JSON.stringify(result));
    assert.equal(result.error, 0);
    assert.equal(result.ready, false);
    for (const diff of result.diffs) {
      // The cached frame resolves antialiasing before composing. Subpixel
      // intersections between a moving edge and a fixed edge can round differently.
      assert.ok(diff.mean < .55 && diff.changed < .014);
    }
  }
} finally { await browser.close(); }
