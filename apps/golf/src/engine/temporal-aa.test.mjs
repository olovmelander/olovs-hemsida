import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector4 } from 'three/webgpu';
import { createWorldVelocity } from './temporal-aa.mjs';

const ndc = (m, p) => { const v = new Vector4(...p, 1).applyMatrix4(m); return [v.x / v.w, v.y / v.w]; };

describe('temporal AA', () => {
  it('reckons the world-static velocity from this frame\'s and the last frame\'s view-projection', () => {
    const camera = new PerspectiveCamera(48, 16 / 9, 0.5, 4000);
    camera.position.set(0, 2, 10); camera.lookAt(0, 0, 0);
    const v = createWorldVelocity();
    v.update(camera);
    /* the first frame: no motion */
    expect(v.matrices.previous.value.equals(v.matrices.current.value)).toBe(true);
    const before = v.matrices.current.value.clone();
    camera.position.x += 1; camera.updateMatrixWorld();
    v.update(camera);
    expect(v.matrices.previous.value.equals(before)).toBe(true);
    /* a world point's motion on screen is current minus previous, as three's VelocityNode has it */
    const p = [0, 0, 0];
    const [cx] = ndc(v.matrices.current.value, p), [px] = ndc(v.matrices.previous.value, p);
    expect(cx - px).toBeLessThan(0);
    v.reset(camera);
    expect(v.matrices.previous.value.equals(v.matrices.current.value)).toBe(true);
    expect(v.matrices.current.value).toBeInstanceOf(Matrix4);
  });
  it('is on by default at high quality in main.js, MSAA kept on low quality, det=1 and ?aa=msaa', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("const TEMPORAL_AA = !LOWQ && new URLSearchParams(location.search).get('post') !== '0'");
    expect(main).toContain("&& (AA_PARAM === 'traa' || (AA_PARAM === null && !DET));");
    expect(main).toContain('pass(scene, camera, { samples: 0 })');
    expect(main).toContain("scenePass.setMRT(mrt({ output, velocity: worldVelocity.velocity }));");
    expect(main).toContain('if (!lowfx) worldVelocity?.update(camera);');
  });
});
