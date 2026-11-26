/* Environment reflection of the local surveyed bank when the screen does not
   contain its image. This ray visits a compact top-down field; it never
   changes a position, a shadow caster, a water level, or a terrain sample. */
import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { Break, Fn, If, Loop, cameraPosition, color, float, mix, normalize, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl';
import { inflateBounded } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { retainPlayingHeightArt } from './playing-height-art-cache.mjs';

const assets = {
  'bro-hof-stadium': new URL('./assets/bank-bro-hof-stadium.bin', import.meta.url),
  norrfallsviken: new URL('./assets/bank-norrfallsviken.bin', import.meta.url),
};

export async function loadMeasuredBankReflection(slug) {
  if (!Object.hasOwn(assets, slug)) return null;
  const url = assets[slug];
  const controlledAtRequest = Boolean(globalThis.navigator?.serviceWorker?.controller);
  const response = await fetch(url, { signal: globalThis.AbortSignal?.timeout?.(8000) });
  if (!response.ok) throw Error('Bank reflection field HTTP ' + response.status);
  const bytes = await response.arrayBuffer();
  const field = await decodeBankReflection(bytes);
  if (!controlledAtRequest)
    await retainPlayingHeightArt(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }), controlledAtRequest);
  return field;
}

export async function decodeBankReflection(buffer) {
  if (buffer.byteLength < 24 || buffer.byteLength > 4_194_304) throw Error('Invalid bank reflection size');
  const bytes = new Uint8Array(buffer), header = new DataView(buffer);
  if (header.getUint32(0) !== 0x424e4b31) throw Error('Invalid bank reflection field');
  const width = header.getUint16(4, true), height = header.getUint16(6, true);
  const x0 = header.getFloat32(8, true), z0 = header.getFloat32(12, true), cell = header.getFloat32(16, true);
  if (!width || !height || width * height > 1048576 || !Number.isFinite(x0) || !Number.isFinite(z0) || !Number.isFinite(cell) || !(cell > 0))
    throw Error('Invalid bank reflection bounds');
  const data = await inflateBounded(bytes.subarray(24), width * height * 4, { preallocate: true });
  const map = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  map.name = 'Surveyed bank and canopy heights';
  map.minFilter = map.magFilter = LinearFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return { map, x0, z0, cell, width, height };
}

const groundY = sample => sample.r.mul(652.8).add(sample.g.mul(2.55)).sub(32);

/** Linear reflected radiance and confidence in A. A real SSR hit wins first. */
export function reflectedBank(field, { point, direction, screenWeight, shore, sun, lighting, cloud }) {
  const { map, x0, z0, cell, width, height } = field;
  const origin = vec2(x0,z0), span = vec2(width*cell,height*cell);
  const inside = uv => uv.x.greaterThan(0).and(uv.y.greaterThan(0)).and(uv.x.lessThan(1)).and(uv.y.lessThan(1));
  const sample = uv => texture(map, uv).level(0);
  return Fn(() => {
    const hit = vec4(0).toVar();
    const range = cameraPosition.sub(point).length();
    // Above steep rays most radiance comes from the water body. Distant
    // surfaces retain the atmospheric sky and the existing screen trace.
    const weight = smoothstep(390,650,range).oneMinus().mul(smoothstep(.48,.80,direction.y).oneMinus());
    const available = inside(point.xz.sub(origin).div(span)).and(weight.greaterThan(.005))
      .and(screenWeight.lessThan(.98)).and(shore.lessThan(125));
    If(available, () => {
      // A ray crossing a smooth lake cannot reach land before the measured
      // shortest path to its shore; allow overhanging crowns in this lead-in.
      const start = shore.sub(6).max(1.35);
      const t = start.toVar();
      const opacity = float(0).toVar(), best = float(0).toVar();
      const struck = vec4(0).toVar(), position = vec3(0).toVar(), treeShare = float(0).toVar();
      // Resolve the measured crowns at their native spacing. Geometric
      // strides skipped whole trees at 40 m, striping their reflections.
      Loop(34, () => {
        const p = point.add(direction.mul(t)).toVar();
        const uv = p.xz.sub(origin).div(span).toVar();
        If(inside(uv).not().or(t.greaterThan(155)), () => { Break(); });
        const s = sample(uv).toVar(), h = groundY(s).toVar();
        const crown = s.b.mul(51).toVar(), aboveGround = p.y.sub(h);
        // Below the crown, a ray sees air. This approximates a measured
        // crown's outline, leaving the bank visible under lifted foliage.
        const crownMask = smoothstep(-.65, 1.7, crown.sub(aboveGround))
          .mul(smoothstep(crown.mul(.25), crown.mul(.42).add(.30), aboveGround))
          .mul(smoothstep(1.4, 3.0, crown));
        const land = smoothstep(.14,.31,s.a).mul(smoothstep(-.14,.18,h.sub(p.y)));
        const visibility = smoothstep(cell*23,cell*33,t.sub(start)).oneMinus().mul(smoothstep(120,155,t).oneMinus());
        const contribution = land.max(crownMask).mul(visibility).mul(opacity.oneMinus()).toVar();
        If(contribution.greaterThan(best), () => {
          struck.assign(s); position.assign(p); treeShare.assign(crownMask); best.assign(contribution);
        });
        opacity.addAssign(contribution);
        If(opacity.greaterThan(.98), () => { Break(); });
        t.addAssign(cell);
      });
      If(opacity.greaterThan(.005), () => {
        const uv = position.xz.sub(origin).div(span), h = groundY(struck);
        const sx = groundY(sample(uv.add(vec2(1/width,0))));
        const sz = groundY(sample(uv.add(vec2(0,1/height))));
        const n = normalize(vec3(h.sub(sx),float(cell),h.sub(sz)));
        const sandy = smoothstep(.82,.94,struck.a);
        const rock = smoothstep(.68,.78,struck.a).mul(sandy.oneMinus());
        let pigment = mix(color(0x526e3e),color(0x709051),smoothstep(.41,.58,struck.a));
        pigment = mix(mix(pigment,color(0x737873),rock),color(0xcbbc95),sandy);
        pigment = mix(pigment,color(0x385336),treeShare);
        const facing = mix(n.dot(sun).max(0),sun.y.mul(.45).add(.12).max(0),treeShare);
        const radiance = lighting.bankRadiance(pigment, facing, cloud ? cloud.sunlightAt(position) : float(1));
        const borders = uv.min(vec2(1).sub(uv)).mul(span);
        const edge = borders.x.min(borders.y);
        hit.assign(vec4(radiance, opacity.mul(weight).mul(smoothstep(0,7,edge))));
      });
    });
    return hit;
  })();
}
