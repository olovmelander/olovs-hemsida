import { ringSD } from '../geom.js';

// Rows interpreted from campus-native.png (Lantmateriet, 2024-06-27).
// Occupancy is illustrative; these are not a live inventory of parked cars.
const ROWS = [
  { lot: 'S04', a: [226.145, -506.313], b: [242.568, -497.206], forward: [.484454, -.874817], count: 6 },
  { lot: 'S05', a: [267.108, -506.999], b: [266.948, -473.557], forward: [-.998351, -.057409], count: 6 },
  { lot: 'S05', a: [279.509, -505.805], b: [278.569, -467.127], forward: [.998351, .057413], count: 6 },
  { lot: 'S06', a: [297.840, -471.461], b: [298.117, -453.999], forward: [-.998350, -.057419], count: 3 },
  { lot: 'S06', a: [308.825, -470.669], b: [308.318, -450.692], forward: [.998350, .057423], count: 3 },
];
const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function parkingCarPlan(facilities) {
  const plan = [];
  for (const row of ROWS) {
    const ring = facilities.find(f => f.id === row.lot)?.planRingLocal;
    assert(ring?.length >= 3, 'Parking outline unavailable: ' + row.lot);
    const yaw = Math.atan2(...row.forward), s = Math.sin(yaw), c = Math.cos(yaw);
    const offsets = row.count === 6 ? [0, .17, .36, .58, .78, 1] : [.04, .5, .94];
    for (const t of offsets) {
      const x = row.a[0] + (row.b[0] - row.a[0]) * t, z = row.a[1] + (row.b[1] - row.a[1]) * t;
      const corners = [[-1, -2.25], [1, -2.25], [1, 2.25], [-1, 2.25]]
        .map(([dx, dz]) => [x + dx * c + dz * s, z - dx * s + dz * c]);
      assert(corners.every(p => ringSD(...p, ring) < 0), 'Car leaves parking outline: ' + row.lot);
      plan.push({ id: `parking-car-${plan.length + 1}`, lot: row.lot, x, z, yaw, corners });
    }
  }
  return plan;
}

export function buildParkingCars({ THREE, facilitiesRoot, facilities }) {
  const plan = parkingCarPlan(facilities);
  const root = new THREE.Group(); root.name = 'Veckefjarden parked cars';
  const report = { count: 0, draws: 0, triangles: 0, lots: {}, placements: [],
    placement: 'Illustrative occupancy in orthophoto-guided rows; supported by the rendered paving' };
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 2000);
  facilitiesRoot.updateMatrixWorld(true);
  const ground = new Map();
  facilitiesRoot.traverse(m => {
    if (m.isMesh && m.userData.groundContact && ['S04', 'S05', 'S06'].includes(m.userData.facilityId)) ground.set(m.userData.facilityId, m);
  });
  const wheels = [[-.85, -1.35], [.85, -1.35], [-.85, 1.35], [.85, 1.35]];
  const matrices = plan.map(car => {
    const paving = ground.get(car.lot);
    assert(paving, 'Rendered parking surface unavailable: ' + car.lot);
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
    const heights = wheels.map(([x, z]) => {
      ray.ray.origin.set(car.x + x * c + z * s, 1000, car.z - x * s + z * c);
      const hit = ray.intersectObject(paving, false)[0];
      assert(hit && Number.isFinite(hit.point.y), 'Car wheel has no parking support');
      return hit.point.y;
    });
    const forward = new THREE.Vector3(s, ((heights[2] + heights[3]) - (heights[0] + heights[1])) / 5.4, c).normalize();
    let right = new THREE.Vector3(c, ((heights[1] + heights[3]) - (heights[0] + heights[2])) / 3.4, -s).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    right = new THREE.Vector3().crossVectors(up, forward).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, forward);
    const y = Math.max(...wheels.map(([x, z], i) => heights[i] - new THREE.Vector3(x, 0, z).applyMatrix4(basis).y)) + .025;
    basis.setPosition(car.x, y, car.z);
    const wheelClearances = wheels.map(([x, z], i) => new THREE.Vector3(x, 0, z).applyMatrix4(basis).y - heights[i]);
    report.placements.push({ ...car, position: [car.x, y, car.z], matrix: basis.toArray(), wheelHeights: heights, wheelClearances });
    report.lots[car.lot] = (report.lots[car.lot] || 0) + 1;
    return basis;
  });

  function mesh(vertices, faces) {
    const positions = [];
    for (const face of faces) for (let i = 1; i < face.length - 1; i++) {
      for (const j of [face[0], face[i + 1], face[i]]) positions.push(...vertices[j]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
    return g;
  }
  function box(x, y, z, w, h, d) {
    const source = new THREE.BoxGeometry(w, h, d); source.translate(x, y, z);
    const g = source.toNonIndexed(); source.dispose(); g.deleteAttribute('uv'); return g;
  }
  function join(parts) {
    const p = [], n = [];
    for (const g of parts) {
      p.push(...g.attributes.position.array); n.push(...g.attributes.normal.array); g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); return g;
  }
  const ring = [[-.72, -2.15], [.72, -2.15], [.90, -1.95], [.90, 1.95], [.72, 2.15], [-.72, 2.15], [-.90, 1.95], [-.90, -1.95]];
  const bodyVertices = [.36, .93].flatMap(y => ring.map(([x, z]) => [x, y, z]));
  const sides = ring.map((_, i) => [i, (i + 1) % 8, (i + 1) % 8 + 8, i + 8]);
  const body = join([
    mesh(bodyVertices, [[7, 6, 5, 4, 3, 2, 1, 0], [8, 9, 10, 11, 12, 13, 14, 15], ...sides]),
    box(0, 1.50, -.12, 1.38, .065, 1.54),
    box(-.763, 1.18, -.10, .075, .53, .09), box(.763, 1.18, -.10, .075, .53, .09),
    box(0, .95, 1.63, 1.66, .035, .84), box(0, .95, -1.72, 1.66, .035, .60),
  ]);
  const glass = mesh([
    [-.81, .94, -1.38], [.81, .94, -1.38], [.81, .94, 1.16], [-.81, .94, 1.16],
    [-.68, 1.48, -.89], [.68, 1.48, -.89], [.68, 1.48, .65], [-.68, 1.48, .65],
  ], [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
  const tire = new THREE.CylinderGeometry(.31, .31, .24, 12); tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(.15, .15, .255, 10); hub.rotateZ(Math.PI / 2);
  const front = join([-.62, .62].map(x => box(x, .77, 2.155, .35, .16, .035)));
  const rear = join([-.66, .66].map(x => box(x, .77, -2.155, .27, .16, .035)));
  const colours = [0xd9dddc, 0xa5aaad, 0x252d31, 0xd9dddc, 0x42546b, 0x7c3637, 0x666b68, 0xd9dddc];
  function instances(name, geometry, colour, roughness, metallic, wheelPart = false, paint = false) {
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness: metallic });
    const im = new THREE.InstancedMesh(geometry, material, plan.length * (wheelPart ? 4 : 1));
    im.name = name; im.castShadow = true; im.receiveShadow = true;
    const offset = new THREE.Matrix4(), matrix = new THREE.Matrix4();
    matrices.forEach((pose, i) => {
      if (wheelPart) wheels.forEach(([x, z], j) => {
        offset.makeTranslation(x, .31, z); matrix.multiplyMatrices(pose, offset); im.setMatrixAt(i * 4 + j, matrix);
      });
      else im.setMatrixAt(i, pose);
      if (paint) im.setColorAt(i, new THREE.Color(colours[(i * 5 + Math.floor(i / 7)) % colours.length]));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    root.add(im); report.draws++;
    report.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3 * im.count;
  }
  instances('Car paint', body, 0xffffff, .40, .30, false, true);
  instances('Car windows', glass, 0x293b49, .23, .10);
  instances('Car tires', tire, 0x171b1b, .90, 0, true);
  instances('Car wheel hubs', hub, 0x81878a, .45, .45, true);
  instances('Car headlamp lenses', front, 0xc8d3ce, .32, .1);
  instances('Car tail lamp lenses', rear, 0x8b2629, .38, 0);
  report.count = plan.length;
  root.userData.parkingCars = report;
  return { root, report };
}
