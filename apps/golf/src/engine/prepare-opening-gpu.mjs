import { ColorManagement, FloatType, NoToneMapping, Vector2 } from 'three/webgpu';

/** Compile against the real scene's lights, camera and output target. r186's
 * compileAsync processes one object's pipeline at a time, so a few independent
 * scene branches keep the driver busy without an unbounded compile burst.
 * No objects are cloned/reparented and no renderer internals are replaced.
 * Call only while the animation loop is stopped and scene construction is done.
 */
export async function prepareOpeningGpu(renderer, scene, camera, { scenePass = null, concurrency = 4 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid GPU preparation concurrency');
  const started = performance.now();
  const previous = { target: renderer.getRenderTarget(), mrt: renderer.getMRT(),
    toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace,
    shaderError: renderer.debug.onShaderError, consoleError: console.error };
  const device = renderer.backend?.device;
  const errors = [];
  let scope = false, next = 0, completed = 0;
  const branches = scene.children.filter(object => object.visible && !object.isLight);
  try {
    // Three can report a failed pipeline/TSL build and resolve compileAsync.
    // That must not allow an incomplete opening view through the loading gate.
    console.error = (...details) => {
      if (errors.length < 8) errors.push(new Error(details.map(String).join(' ').slice(0, 500)));
      previous.consoleError.apply(console, details);
    };
    renderer.debug.onShaderError = (...details) => {
      errors.push(new Error('Opening scene WebGL shader compilation failed'));
      previous.shaderError?.(...details);
    };
    if (device?.pushErrorScope) { device.pushErrorScope('validation'); scope = true; }
    if (scenePass) {
      // These are the same public target settings that PassNode.setup applies
      // on the first render. Match them before compilation, including r186's
      // reversed float depth and the scene pass's multisampling/HDR format.
      const target = scenePass.renderTarget;
      target.samples = scenePass.options.samples ?? renderer.samples;
      target.texture.type = renderer.getOutputBufferType();
      if (renderer.reversedDepthBuffer && target.depthTexture) target.depthTexture.type = FloatType;
      const size = renderer.getDrawingBufferSize(new Vector2());
      scenePass.setSize(size.x, size.y);
      renderer.setRenderTarget(target);
      renderer.setMRT(scenePass.getMRT());
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = ColorManagement.workingColorSpace;
    }
    scene.updateMatrixWorld(true);
    // Every worker catches its own failure. Drain all in-flight calls before
    // restoring global render state; Promise.all's early rejection is unsafe.
    await Promise.all(Array.from({ length: Math.min(concurrency, branches.length) }, async () => {
      while (next < branches.length && !errors.length) {
        const object = branches[next++];
        try { await renderer.compileAsync(object, camera, scene); completed++; }
        catch (error) { errors.push(error); }
      }
    }));
  } finally {
    renderer.setRenderTarget(previous.target);
    renderer.setMRT(previous.mrt);
    renderer.toneMapping = previous.toneMapping;
    renderer.outputColorSpace = previous.outputColorSpace;
    renderer.debug.onShaderError = previous.shaderError;
    console.error = previous.consoleError;
    if (scope) {
      const error = await device.popErrorScope();
      if (error) errors.push(new Error(`Opening scene GPU validation failed: ${error.message}`));
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Could not prepare the opening scene');
  return { milliseconds: +(performance.now() - started).toFixed(1), branches: branches.length, completed,
    concurrency, target: scenePass ? 'scene-pass' : 'canvas', samples: scenePass?.renderTarget.samples ?? renderer.samples };
}
