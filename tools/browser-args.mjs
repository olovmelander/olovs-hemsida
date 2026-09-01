/* The Chromium flags every harness here launches with, in one place.

   The default is SwiftShader: software rasterisation on the CPU, which is what
   a machine with no GPU (CI, a container, a remote box) has, and it is why a
   boot in these harnesses takes minutes rather than seconds.

   `BANVY_GPU=1` asks for the real adapter through ANGLE/D3D11 instead. On this
   repo's development machine that is an RTX 3070 Laptop and one course boots in
   34 s against several minutes -- the difference between running the whole
   nine-course gate while you wait and running it overnight.

   It is OPT-IN, not the default, for two reasons: a box without a usable GPU
   would fail to launch rather than fall back, and a picture rendered by a real
   driver is not bit-identical to one rendered by SwiftShader -- so any pixel
   comparison (parity, goldens) must keep both sides on the SAME mode. Measure
   like with like: that rule has already cost this repo a day once.          */
export const GPU = process.env.BANVY_GPU === '1';

export const browserArgs = () => GPU
  ? ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--force_high_performance_gpu',
     '--ignore-gpu-blocklist', '--force-device-scale-factor=1']
  : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
     '--force-device-scale-factor=1'];
