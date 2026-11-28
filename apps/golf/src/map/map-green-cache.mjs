/* The drawing buffer is multisampled and need not survive presentation. While a
   green is still, keep its resolved scene and the foreground that covers the
   grid. Trees retain their alpha-to-coverage silhouettes. No depth readback. */
const SCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const SCREEN_FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D uScene;
uniform int uMode;
out vec4 colour;
void main() {
  if (uMode == 0) colour = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0);
  else colour = vec4(vec3(uMode == 2 ? 1.0 : 0.0), 1.0);
}`;

/* The units of the cache's three layers. No other texture in the map may take one
   (map-gl.mjs): the ground's shore field was given the scene's unit 8, the frame was
   copied into that one-channel field, and every still green view was drawn in its red
   channel alone (Bro Hof Stadium 1, 28 November). */
export const SCENE_UNIT = 11, FOREGROUND_UNIT = 9, VISIBILITY_UNIT = 10;
export const GREEN_CACHE_UNITS = Object.freeze([SCENE_UNIT, FOREGROUND_UNIT, VISIBILITY_UNIT]);

/* Source-over with this ink leaves the cached, depth-tested foreground exactly
   where it was, including the fractional coverage of branches and roof edges. */
export const CACHED_PULSE_INK = `
uniform highp sampler2D uForeground, uVisibility;
vec3 cachedPulseInk(vec3 ink) {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  return texelFetch(uForeground, pixel, 0).rgb + texelFetch(uVisibility, pixel, 0).r * ink;
}`;


export function createGreenCache(gl, compile) {
  let screen = null, layers = null, failed = false, ready = false;
  function texture(unit, format) {
    const handle = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return handle;
  }
  function release() {
    if (layers) for (const handle of layers.values()) gl.deleteTexture(handle);
    layers = null;
    ready = false;
    failed = false;
  }
  function prepare() {
    if (failed || gl.isContextLost()) return false;
    if (layers) return true;
    if (!gl.getContextAttributes()?.stencil) { failed = true; return false; }
    screen ??= compile(gl, SCREEN_VERTEX, SCREEN_FRAGMENT);
    layers = new Map(GREEN_CACHE_UNITS.map(unit => [unit, texture(unit, unit === VISIBILITY_UNIT ? gl.R8 : gl.RGB8)]));
    if ([...layers.values()].some(handle => !handle) || gl.getError() !== gl.NO_ERROR) {
      release();
      failed = true;
      return false;
    }
    return true;
  }
  function writeScreen(mode) {
    gl.useProgram(screen.program);
    gl.uniform1i(screen.u.uMode, mode);
    gl.uniform1i(screen.u.uScene, SCENE_UNIT);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /* A copy or a read reaches whatever texture its unit holds at that moment, and the
     renderer binds its own between prepare() and finish() and between frames. So each
     layer is bound to its unit again whenever it is written or shown. */
  function bindLayers() {
    for (const [unit, handle] of layers) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
    }
  }
  function capture(unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }
  return {
    prepare, release,
    invalidate() { ready = false; },
    markForeground() {
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    },
    finish() {
      bindLayers();
      capture(SCENE_UNIT);
      gl.disable(gl.DEPTH_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      /* Keep visible foreground samples on black, then measure the complementary
         coverage in a single channel. Both copies use the actual MSAA resolve. */
      writeScreen(1);
      capture(FOREGROUND_UNIT);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      writeScreen(2);
      capture(VISIBILITY_UNIT);
      gl.clearColor(0.7, 0.84, 0.9, 1);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.DEPTH_TEST);
      ready = !gl.isContextLost() && gl.getError() === gl.NO_ERROR;
      if (!ready) { release(); failed = true; }
      return ready;
    },
    present() {
      if (!ready || gl.isContextLost()) return false;
      bindLayers();
      gl.disable(gl.DEPTH_TEST);
      writeScreen(0);
      return true;
    },
  };
}
