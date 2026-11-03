/* WATER THAT MIRRORS ITS SHORES (3 November; owner request: a calm pond should
   mirror the trees, banks, buildings and hills round it). Until now a lake
   reflected only the painted sky, the sun's road and a dark far-shore band
   (nordic-water.mjs waterTreeLine), so no pond ever showed the wood standing on
   its bank.

   This is a screen-space reflection traced by the water's own material, not a
   post pass: the water is the only surface that mirrors, it knows its own ripple
   normal, its Fresnel and the analytic reflection it falls back to, and the sun's
   road is added after the reflection as before (water-shading.mjs). When the
   first water sheet of the scene pass draws, three copies the opaque world's
   colour and depth (its ViewportTextureNode, here gated to the scene pass's own
   single-sample target: the temporal AA's, high quality only). Each water pixel
   then marches its reflected ray through that depth:

   - the march is in world metres along the ray, `steps` geometric steps from
     `first` growing by `growth` (about 2.4 km in all), interpolated in clip space
     (the projection is linear in homogeneous coordinates, so a step is one
     multiply-add, never a matrix);
   - the start is jittered per pixel and frame, so the coarse far steps average
     out under the temporal AA instead of banding;
   - the first step behind the depth buffer, within the step's own depth plus a
     `thickness`, is refined by bisection to the crossing and its colour read;
   - a ray that leaves the march still on screen reads the pixel its direction
     vanishes to, where that pixel is far away (distant hills, the sky and its
     clouds), since past two kilometres the reflection's parallax is nothing;
   - the result fades out toward the screen's edges (most of all the top, where
     reflected rays leave) and where nothing is found, giving way to the analytic
     reflection the water had before.

   It returns `vec4(colour, weight)`; the caller lays the colour over its sky
   reflection by the weight. ?waterreflect=0 is the before. */
import { DepthTexture, FloatType, FramebufferTexture, HalfFloatType, LinearFilter, ViewportTextureNode } from 'three/webgpu';
import { Break, Fn, If, Loop, abs, cameraFar, cameraNear, cameraProjectionMatrix, cameraViewMatrix, float, fract, frameId,
  perspectiveDepthToViewZ, pow, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl';

export const WATER_REFLECTION = Object.freeze({
  /* the march: t' = t x growth + first, metres along the reflected ray */
  steps: 32, refine: 5, first: 0.25, growth: 1.28,
  /* a hit lies within the step's depth plus this much behind the depth buffer: metres, and a share of the distance */
  thickness: Object.freeze([0.8, 0.015]),
  /* the hit fades out over its last stretch of the march, metres */
  reachFade: Object.freeze([1100, 1800]),
  /* the vanishing point's pixel is read where the world there lies at least this far, metres */
  background: Object.freeze([1200, 2200]),
  /* fade widths at the screen's sides, top and bottom, in uv */
  edge: Object.freeze([0.08, 0.16, 0.03]),
  /* the reflection's ripple: this share of the water's wave slope near and far, from near to far metres */
  tilt: Object.freeze([0.42, 0.12]), tiltMetres: Object.freeze([40, 700]),
  /* where it finds the world, the water mirrors this share of its Fresnel (the painted sky took 0.42) */
  strength: 0.92,
  /* the share of the sky's sun glow (nordic-water.mjs) the ripples still mirror over what is found */
  glowOver: 0.4,
});

/** A copy of the opaque scene's colour or depth that copies only when `gate(renderer)` allows it. */
class GatedSceneCopy extends ViewportTextureNode {
  static get type() { return 'GatedSceneCopy'; }
  constructor(uvNode, levelNode, framebufferTexture, gate) {
    super(uvNode, levelNode, framebufferTexture);
    this.gate = gate;
  }
  updateBefore(frame) {
    /* false: not copied in this render, so three asks again rather than marking it done */
    if (!this.gate(frame.renderer)) return false;
    return super.updateBefore(frame);
  }
  clone() {
    const node = new this.constructor(this.uvNode, this.levelNode, this.value, this.gate);
    node.generateMipmaps = this.generateMipmaps;
    return node;
  }
}

/* interleaved gradient noise (Jimenez 2014), turned each frame: the march's start */
const gradientNoise = Fn(([pixel]) => {
  const p = pixel.add(float(frameId).mod(64).mul(5.588238));
  return fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189));
});

/** `{ trace(P, R) -> vec4, setTarget(renderTarget), setActive(on), snapshot() }`. */
export function createWaterReflection({ reversedDepth = false, params = WATER_REFLECTION } = {}) {
  const active = uniform(0);
  let target = null, copies = 0;
  const gate = renderer => {
    const ok = active.value > 0 && target !== null && renderer.getRenderTarget() === target;
    if (ok) copies++;
    return ok;
  };
  /* the scene pass's own formats: half-float colour, and a float depth under the reversed buffer */
  const colourTexture = new FramebufferTexture();
  colourTexture.type = HalfFloatType;
  colourTexture.minFilter = LinearFilter;
  colourTexture.magFilter = LinearFilter;
  colourTexture.generateMipmaps = false;
  const depthTexture = new DepthTexture(1, 1);
  if (reversedDepth) depthTexture.type = FloatType;
  const colour = new GatedSceneCopy(screenUV, null, colourTexture, gate);
  const depth = new GatedSceneCopy(screenUV, null, depthTexture, gate);

  const [ex, eTop, eBottom] = params.edge;
  const edgeFade = uv => smoothstep(0, ex, uv.x).mul(smoothstep(0, ex, uv.x.oneMinus()))
    .mul(smoothstep(0, eTop, uv.y)).mul(smoothstep(0, eBottom, uv.y.oneMinus()));
  /* clip -> the copy's uv (v down, as three's screen uv) and the scene's distance there */
  const toUV = c => vec2(c.x.div(c.w).mul(0.5).add(0.5), c.y.div(c.w).mul(-0.5).add(0.5));
  const sceneDistance = uv => perspectiveDepthToViewZ(depth.sample(uv).r, cameraNear, cameraFar).negate();
  const onScreen = c => abs(c.x).lessThan(c.w).and(abs(c.y).lessThan(c.w));

  const trace = Fn(([P, R]) => {
    const result = vec4(0).toVar();
    If(active.greaterThan(0.5), () => {
      const viewProjection = cameraProjectionMatrix.mul(cameraViewMatrix);
      const c0 = viewProjection.mul(vec4(P, 1)).toVar();
      const dc = viewProjection.mul(vec4(R, 0)).toVar();
      /* the whole schedule scaled by growth^noise: each pixel's steps fall a different share of a step along */
      const first = float(params.first).mul(pow(float(params.growth), gradientNoise(screenCoordinate.xy))).toVar();
      const t = first.toVar();
      const front = float(0).toVar(), hitT = float(-1).toVar();
      Loop(params.steps, () => {
        const c = c0.add(dc.mul(t)).toVar();
        If(c.w.lessThan(cameraNear).or(onScreen(c).not()), () => { Break(); });
        const gap = c.w.sub(sceneDistance(toUV(c)));
        If(gap.greaterThan(0), () => {
          const allowed = t.sub(front).mul(abs(dc.w)).add(params.thickness[0]).add(c.w.mul(params.thickness[1]));
          If(gap.lessThan(allowed), () => { hitT.assign(t); Break(); });
        }).Else(() => { front.assign(t); });
        t.assign(t.mul(params.growth).add(first));
      });
      If(hitT.greaterThan(0), () => {
        /* bisect to the crossing: in front at `lo`, behind at `hi` */
        const lo = front.toVar(), hi = hitT.toVar();
        Loop(params.refine, () => {
          const mid = lo.add(hi).mul(0.5);
          const c = c0.add(dc.mul(mid));
          If(c.w.sub(sceneDistance(toUV(c))).greaterThan(0), () => { hi.assign(mid); }).Else(() => { lo.assign(mid); });
        });
        const uv = toUV(c0.add(dc.mul(hi))).toVar();
        const reach = smoothstep(params.reachFade[0], params.reachFade[1], hi).oneMinus();
        result.assign(vec4(colour.sample(uv).level(0).rgb, edgeFade(uv).mul(reach)));
      }).Else(() => {
        /* nothing in reach: the pixel the ray's direction vanishes to, if the world there is far */
        If(dc.w.greaterThan(0).and(onScreen(dc)), () => {
          const uv = toUV(dc).toVar();
          const far = smoothstep(params.background[0], params.background[1], sceneDistance(uv));
          result.assign(vec4(colour.sample(uv).level(0).rgb, edgeFade(uv).mul(far)));
        });
      });
    });
    return result;
  });

  return {
    trace: (P, R) => trace(P, R),
    params,
    /** The scene pass's render target: the only one copied. */
    setTarget(renderTarget) { target = renderTarget ?? null; },
    /** On for a frame drawn through the scene pass; off for the runtime drop's direct draw. */
    setActive(on) { active.value = on && target !== null ? 1 : 0; },
    snapshot: () => ({ on: true, active: active.value > 0, target: target !== null, copies }),
    nodes: { colour, depth },
  };
}
