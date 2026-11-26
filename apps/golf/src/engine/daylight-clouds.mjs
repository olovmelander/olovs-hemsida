import { Color, RepeatWrapping, TextureLoader, Vector2, Vector3 } from 'three/webgpu';
import { asin, atan, dFdx, dFdy, float, fwidth, mix, normalize, round, saturate, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';

// Blender extracts opacity, interior light and silver lining from a sky-only
// HDR photograph. The solar disc is removed in the bake. Each weather preset
// supplies its own sun, open shade and exposure in scene-linear light.
export async function loadCloudMap() {
  const map = await new TextureLoader().loadAsync(new URL('./assets/cloud-radiance.webp', import.meta.url).href);
  map.name = 'Cloud opacity, interior light and lining';
  map.wrapS = RepeatWrapping;
  return map;
}

export function createDaylightClouds(map, drift) {
  const sunBearing = uniform(new Vector2(1, 0));
  const sunDirection = uniform(new Vector3()), sunlight = uniform(new Color());
  const lit = uniform(new Color()), shade = uniform(new Color()), lining = uniform(new Color());
  const amount = uniform(0), overcast = uniform(0);
  return {
    setPreset(p) {
      const [x, y, z] = p.dir;
      sunDirection.value.set(x, y, z).normalize();
      const horizontal = Math.hypot(x, z);
      if (horizontal > 1e-5) sunBearing.value.set(x / horizontal, z / horizontal);
      const exposure = p.paintedSkyExposure ?? 1;
      lit.value.setHex(p.skyCloudLit ?? 0xf8f6ed).multiplyScalar(exposure);
      shade.value.setHex(p.skyCloudBase ?? p.skyCloudShade ?? 0x8f9fae).multiplyScalar(exposure * .72);
      const direct = y > 0 ? Math.min(1, p.int / 2.5) : 0;
      sunlight.value.setHex(p.sun).multiplyScalar(direct * exposure);
      lining.value.setHex(p.sun).multiplyScalar(exposure * direct * .56);
      amount.value = Math.min(1, p.cloudDensity * 1.65) * Math.min(1, p.cloud * 5);
      overcast.value = Math.max(0, Math.min(1, (p.cloud - .55) / .45)) * .88;
    },
    colour(clear, ray, showDisc = false) {
      // Translate the layer along the wind on its horizontal plane. At the
      // horizon the ray's intersection is far away and its angular drift dies.
      const d = drift ? normalize(vec3(ray.x.sub(drift.x.mul(ray.y).mul(.075)), ray.y,
        ray.z.sub(drift.y.mul(ray.y).mul(.075)))) : ray;
      const along = d.x.mul(sunBearing.x).add(d.z.mul(sunBearing.y));
      const across = d.z.mul(sunBearing.x).sub(d.x.mul(sunBearing.y));
      const u = atan(across, along).mul(1 / (2 * Math.PI)).add(.5);
      const v = asin(saturate(d.y)).mul(2 / Math.PI);
      // Longitude wraps once. A derivative spanning that seam must select
      // the same mip as the adjacent pixel, especially on rippled water.
      const dx = dFdx(u), dy = dFdy(u);
      const cloud = texture(map, vec2(u, v)).grad(vec2(dx.sub(round(dx)), dFdx(v)),
        vec2(dy.sub(round(dy)), dFdy(v)));
      const light = mix(shade, lit, cloud.g).add(lining.mul(cloud.b));
      const coverage = mix(cloud.r, float(1), overcast).mul(amount).mul(smoothstep(.008, .10, d.y));
      // A broad forward-scattering lobe is visible in both the sky and
      // reflections. The directional light already supplies the BRDF's sun.
      const chord = ray.sub(sunDirection).length();
      let solar = float(.11).div(chord.mul(chord).mul(70).add(1));
      if (showDisc) {
        // Solar angular diameter is about 0.53 degrees. Filter its edge in
        // screen space so it stays steady when seen through fine branches.
        const edge = fwidth(chord).clamp(.0003, .0035);
        const disc = smoothstep(float(.00465).sub(edge), edge.add(.00465), chord).oneMinus();
        solar = solar.add(disc.mul(4.5));
      }
      return mix(clear.add(sunlight.mul(solar)), light, coverage);
    },
  };
}
