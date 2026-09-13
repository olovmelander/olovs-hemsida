// Passed directly to page.addInitScript; keep this function self-contained.
// Hardware launch flags are not proof of which WebGPU adapter made the device.
export function recordRequestedAdapters() {
  window.__startupAdapters = [];
  if (!globalThis.GPUAdapter) return;
  const original = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = function(...args) {
    const info = this.info;
    window.__startupAdapters.push({ atMs: performance.now(),
      vendor: info?.vendor ?? null, architecture: info?.architecture ?? null,
      device: info?.device ?? null, description: info?.description ?? null,
      isFallbackAdapter: info?.isFallbackAdapter ?? this.isFallbackAdapter ?? null });
    return original.apply(this, args);
  };
}
