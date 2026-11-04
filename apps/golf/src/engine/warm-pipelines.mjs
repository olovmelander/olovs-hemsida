/* THE WARM FRAME (owner request: load times, 4 November). The opening compile
   (prepare-opening-gpu.mjs) covers the scene's own materials, in parallel. What
   only a real frame reaches is not covered: the shadow pass's override material
   on every caster, and every post pass (GTAO, temporal AA, sharpen, god rays,
   bloom, output). Those came to 42 of Veckefjärden's 109 pipelines. r187 created
   them with the blocking createRenderPipeline during the first frame, one after
   another, so that frame took the GPU 1.84 s against the compile's 5.4 times
   parallel 1.4 s for the other 67.

   A frame behind the loading cover goes down the parallel path instead. r187's
   Pipelines.getForRender takes a promises array, as compileAsync passes it, and
   a draw whose pipeline is not built yet is skipped (Pipelines.isReady). So one
   frame with the array in place requests every pipeline a frame needs and draws
   nothing that is not ready; once they are built the first real frame finds them
   all. There is no list to keep: whatever a frame reaches is warmed. It is the
   one touch of a renderer internal here, and it is put back in the same turn.
   A frame can change what the next needs (god rays join the output once the
   shadow map exists), so it repeats until a frame asks for nothing new.

   The frame's draws are skipped, so anything it was meant to leave behind must
   be asked for again: the caller re-requests the sun's on-demand shadow map. */
const WARM_TIMEOUT_MS = 30000, WARM_FRAMES = 4;

export async function warmFramePipelines(renderer, renderFrame, { timeoutMs = WARM_TIMEOUT_MS } = {}) {
  const pipelines = renderer?._pipelines;
  if (typeof pipelines?.getForRender !== 'function' || typeof pipelines.updateForRender !== 'function')
    return { warmed: false, pipelines: 0, frames: 0, milliseconds: 0 };
  const started = performance.now();
  /* A stuck driver must not hold the cover forever: past the bound, the frames
     find what they can and three builds the rest as it always did. */
  let timer = null;
  const expired = new Promise(resolve => { timer = setTimeout(() => resolve('expired'), timeoutMs); });
  let frames = 0, total = 0, warmed = true;
  try {
    while (frames < WARM_FRAMES) {
      const pending = [];
      pipelines.updateForRender = renderObject => pipelines.getForRender(renderObject, pending);
      try { renderFrame(); }
      finally { delete pipelines.updateForRender; }
      frames++; total += pending.length;
      if (!pending.length) break;
      if (await Promise.race([Promise.all(pending), expired]) === 'expired') { warmed = false; break; }
    }
  } finally { clearTimeout(timer); }
  return { warmed, pipelines: total, frames, milliseconds: +(performance.now() - started).toFixed(1) };
}
