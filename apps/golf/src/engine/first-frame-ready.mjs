/** Wait for the submitted scene, without blocking the UI with gl.finish().
 * Used once at boot, never in the regular animation loop. Rendering commands
 * returning does not mean the GPU has finished the first visible frame.
 */
export async function waitForGpuFrame(renderer, { timeoutMilliseconds = 60_000 } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The first scene frame did not finish.')), timeoutMilliseconds);
  });
  const queue = renderer.backend?.device?.queue;
  const gl = renderer.backend?.gl;
  let sync;
  let pollTimer;
  try {
    let completion;
    if (queue?.onSubmittedWorkDone) completion = queue.onSubmittedWorkDone();
    else if (gl?.fenceSync) {
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) throw new Error('Could not wait for the first scene frame.');
      gl.flush();
      completion = new Promise((resolve, reject) => {
        const poll = () => {
          if (gl.isContextLost()) return reject(new Error('Graphics context lost while preparing the first view.'));
          const state = gl.clientWaitSync(sync, 0, 0);
          if (state === gl.WAIT_FAILED) return reject(new Error('The first scene frame failed.'));
          if (state === gl.TIMEOUT_EXPIRED) pollTimer = setTimeout(poll, 8);
          else resolve();
        };
        poll();
      });
    } else throw new Error('The renderer cannot confirm the first scene frame.');
    await Promise.race([completion, timeout]);
  } finally {
    clearTimeout(timer);
    clearTimeout(pollTimer);
    if (sync) gl.deleteSync(sync);
  }
}
