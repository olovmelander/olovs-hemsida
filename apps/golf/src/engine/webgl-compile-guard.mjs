/* A PIPELINE DESTROYED WHILE IT COMPILES (three r187, WebGL2 fallback).

   With KHR_parallel_shader_compile, WebGLBackend.createRenderPipeline links a
   program and, inside compileAsync, polls its COMPLETION_STATUS_KHR once an
   animation frame until it reports done. If the pipeline is destroyed first
   (every render object using it released: a tile batch, a preflight mesh, a
   material swapped during boot), destroyPipeline deletes the program, the
   query on a deleted program returns null, and the poll goes round forever:
   the compileAsync promise never settles, the opening scene never finishes
   preparing, and the console fills with "getProgramParameter: attempt to use
   a deleted object". On an RTX 5080, every course at low quality on WebGL2
   (?q=lo&gl=1) hung at the opening compile until the page was killed
   (2 November; the same on main before tonight's work).

   This replaces the method on the one backend instance with three's own code
   and one more line: a program that is no longer a program resolves its
   promise and stops polling. Nothing else changes; WebGPU and a WebGL2
   without the extension are left alone. */

/** Install the guard on a WebGPURenderer's WebGL2 fallback backend. Returns true when installed. */
export function guardParallelCompile(backend) {
  if (!backend || backend.isWebGLBackend !== true || !backend.parallel || backend.__parallelCompileGuard) return false;
  const original = backend.createRenderPipeline;
  backend.createRenderPipeline = function createRenderPipeline(renderObject, promises) {
    if (promises === null || !this.parallel) return original.call(this, renderObject, promises);
    const gl = this.gl, parallel = this.parallel;
    const pipeline = renderObject.pipeline;
    const { fragmentProgram, vertexProgram } = pipeline;
    const programGPU = gl.createProgram();
    const fragmentShader = this.get(fragmentProgram).shaderGPU;
    const vertexShader = this.get(vertexProgram).shaderGPU;
    gl.attachShader(programGPU, fragmentShader);
    gl.attachShader(programGPU, vertexShader);
    gl.linkProgram(programGPU);
    this.set(pipeline, { programGPU, fragmentShader, vertexShader });
    promises.push(new Promise(resolve => {
      const checkStatus = () => {
        /* destroyed while compiling: nothing left to complete */
        if (!gl.isProgram(programGPU)) { resolve(); return; }
        if (gl.getProgramParameter(programGPU, parallel.COMPLETION_STATUS_KHR)) {
          this._completeCompile(renderObject, pipeline);
          resolve();
        } else requestAnimationFrame(checkStatus);
      };
      checkStatus();
    }));
  };
  backend.__parallelCompileGuard = true;
  return true;
}
