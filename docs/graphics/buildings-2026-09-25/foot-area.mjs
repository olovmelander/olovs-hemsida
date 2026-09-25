/* How much wall the foot reaches: under `root`, every mesh stamped with the ground under its vertices
   (aGround, building-paint.mjs), in square metres of wall -- faces steeper than |normal.y| 0.5 -- and the
   part of it from the ground line up to `metres` (`batch` for vertex-coloured meshes), which is where the
   foot darkens. The height over the ground is linear across a face, so each face is cut exactly at the
   band's edges. Summed per building: each mesh's ancestor directly under `root` (root itself for a mesh
   hung on it). Self-contained, so a harness can hand it to a page as it is. */
export function footArea(root, { metres, batch = metres }) {
  const buildings = new Map();
  root.updateMatrixWorld(true);
  const clip = (poly, g) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ga = g(a), gb = g(b);
      if (ga >= 0) out.push(a);
      if ((ga >= 0) !== (gb >= 0)) {
        const t = ga / (ga - gb);
        out.push({ p: [0, 1, 2].map(k => a.p[k] + (b.p[k] - a.p[k]) * t), f: a.f + (b.f - a.f) * t });
      }
    }
    return out;
  };
  const area = poly => {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i].p, b = poly[(i + 1) % poly.length].p;
      x += a[1] * b[2] - a[2] * b[1]; y += a[2] * b[0] - a[0] * b[2]; z += a[0] * b[1] - a[1] * b[0];
    }
    return 0.5 * Math.hypot(x, y, z);
  };
  root.traverse(mesh => {
    const ground = mesh.isMesh && mesh.geometry?.getAttribute('aGround');
    if (!ground) return;
    let building = mesh;
    while (building !== root && building.parent !== root) building = building.parent;
    const name = building === root ? root.name || 'root' : building.name || building.uuid;
    const band = [mesh.material].flat().some(m => m.vertexColors) ? batch : metres;
    const row = buildings.get(name) || { name, meshes: 0, wall: 0, foot: 0 };
    buildings.set(name, row);
    row.meshes++;
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index, e = mesh.matrixWorld.elements;
    const corner = i => {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const p = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
      return { p, f: p[1] - ground.getX(i) };
    };
    const count = index ? index.count : position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const tri = [0, 1, 2].map(k => corner(index ? index.getX(t + k) : t + k));
      const [a, b, c] = tri.map(v => v.p);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...n);
      if (!(length > 0) || Math.abs(n[1]) / length >= 0.5) continue;
      row.wall += length / 2;
      row.foot += area(clip(clip(tri, q => q.f), q => band - q.f));
    }
  });
  return [...buildings.values()].map(r => ({ ...r, wall: Math.round(r.wall * 10) / 10, foot: Math.round(r.foot * 10) / 10 }));
}
