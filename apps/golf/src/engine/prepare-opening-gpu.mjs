import { ColorManagement, FloatType, NoToneMapping, Vector2 } from 'three/webgpu';

/** Compile against the real scene's lights, camera and output target, one
 * compileAsync call at a time. r187 (#34816) keeps a call's progress in the
 * renderer's single `_precompilationState` across its awaits, so two calls in
 * flight clobber each other: the first to finish nulls the state and the next
 * `_finishPreCompile` throws "Cannot destructure 'useFrameBufferTarget'". Four
 * concurrent branches failed every WebGPU boot on an RTX 5080 (2 November).
 * Within one call r187 already builds up to 16 pipelines in parallel, so
 * `mode: 'scene'` compiles the whole scene in one call and `'branches'` walks
 * its top-level branches serially (the r186 shape, one call each).
 * No objects are cloned/reparented and no renderer internals are replaced.
 * Call only while the animation loop is stopped and scene construction is done.
 */
export async function prepareOpeningGpu(renderer, scene, camera, { scenePass = null, mode = 'scene' } = {}) {
  if (mode !== 'scene' && mode !== 'branches') throw new Error('Invalid GPU preparation mode');
  const started = performance.now();
  const previous = { target: renderer.getRenderTarget(), mrt: renderer.getMRT(),
    toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace,
    shaderError: renderer.debug.onShaderError, consoleError: console.error };
  const device = renderer.backend?.device;
  const errors = [];
  let scope = false, completed = 0;
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
    // Strictly one compileAsync in flight (see above). A failure stops the walk.
    const units = mode === 'scene' ? (branches.length ? [scene] : []) : branches;
    for (const object of units) {
      if (errors.length) break;
      try { await renderer.compileAsync(object, camera, scene); completed += object === scene ? branches.length : 1; }
      catch (error) { errors.push(error); }
    }
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
    mode, target: scenePass ? 'scene-pass' : 'canvas', samples: scenePass?.renderTarget.samples ?? renderer.samples };
}
