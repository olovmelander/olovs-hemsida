/* WIRES (3 November, owner request: "fix the power grids and lines"). Power lines,
   railway catenaries and lift cables were drawn as LineSegments: every wire exactly
   one pixel wide at every distance, hard-edged and stepping as it crossed the pixel
   grid. A 25 mm conductor 400 m away is a twentieth of a pixel; drawn as one it was
   a hard black stroke across the sky, and up close it was still one pixel.

   Each wire is now a ribbon turned to face the eye about its own length, its real
   width (`diameter`) wherever that is at least `minPixels` on screen; narrower than
   that it is drawn `minPixels` wide and its colour is spread thin by the share of
   that it truly covers, so a far span fades as a real one does instead of turning
   into a line of the same weight. One draw for every wire on the course; the
   temporal AA resolves the sub-pixel ribbons. Depth tested, not written; drawn with
   the overlays (render order 1). ?wires=lines is the before. */
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cross, float, max, normalize, positionGeometry,
  screenSize, uniform, varying, vec3, vec4,
} from 'three/tsl';

export const WIRES = Object.freeze({
  /* a conductor's width, metres, and the least it is drawn on screen, pixels */
  diameter: 0.03, minPixels: 1,
  /* its colour, and how dark it is against the sky at full cover */
  colour: 0x2b2e31, opacity: 0.9,
});

/**
 * One mesh of camera-facing ribbons for `segments` ([x0, y0, z0, x1, y1, z1, ...], as the
 * LineSegments took them). Returns the mesh, or null when there are none.
 */
export function createWireMesh(segments, { diameter = WIRES.diameter, colour = WIRES.colour, opacity = WIRES.opacity, name = 'wires' } = {}) {
  const count = Math.floor(segments.length / 6);
  if (!count) return null;
  /* four corners a segment: (end, side) = (0, -1), (0, 1), (1, -1), (1, 1) */
  const position = new Float32Array(count * 4 * 3), other = new Float32Array(count * 4 * 3), corner = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  for (let s = 0; s < count; s++) {
    const a = segments.slice(s * 6, s * 6 + 3), b = segments.slice(s * 6 + 3, s * 6 + 6);
    for (let k = 0; k < 4; k++) {
      const end = k >> 1, side = (k & 1) ? 1 : -1, v = s * 4 + k;
      position.set(end ? b : a, v * 3);
      other.set(end ? a : b, v * 3);
      corner.set([end, side], v * 2);
    }
    index.set([s * 4, s * 4 + 2, s * 4 + 1, s * 4 + 1, s * 4 + 2, s * 4 + 3], s * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aOther', new THREE.BufferAttribute(other, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  const uColour = uniform(new THREE.Color(colour));
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.name = 'Wires';
  material.fog = true;
  const cover = varying(float(1), 'wireCover');
  material.positionNode = Fn(() => {
    const p = positionGeometry, q = attribute('aOther', 'vec3'), c = attribute('aCorner', 'vec2');
    /* across the wire, square to the eye */
    const along = normalize(q.sub(p).mul(c.x.mul(-2).add(1)));
    const toEye = cameraPosition.sub(p);
    const side = normalize(cross(along, toEye).add(vec3(0, 1e-6, 0)));
    /* the width a pixel spans at this distance */
    const depth = max(cameraViewMatrix.mul(vec4(p, 1)).z.negate(), 0.01);
    const pixel = depth.mul(2).div(cameraProjectionMatrix.element(1).y.mul(max(screenSize.y, 1)));
    const drawn = max(float(diameter), pixel.mul(WIRES.minPixels));
    cover.assign(float(diameter).div(drawn));
    return p.add(side.mul(drawn.mul(0.5)).mul(c.y));
  })();
  material.colorNode = vec4(uColour, 1).rgb;
  material.opacityNode = cover.mul(opacity);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = 1;
  mesh.frustumCulled = true;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}
