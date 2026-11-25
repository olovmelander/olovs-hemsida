/* On the Sverigekarta (map.js) pins that would stand on each other are drawn as one
   group with a count, once the map holds more clubs than the start menu lists whole
   (lobby-model.mjs). Pure: points in screen pixels in, groups out. */

/* A pin's head is 32 px across: closer than this, two heads touch. */
export const PIN_GROUP_PX = 44;

const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = group => ({
  x: group.reduce((sum, point) => sum + point.x, 0) / group.length,
  y: group.reduce((sum, point) => sum + point.y, 0) / group.length,
});

/* Pins closer than the radius share a group through any chain of them, so no pin is
   left standing on a group's member; and a group is drawn at its middle, so groups
   whose middles would touch become one. Every point lands in exactly one group, each
   group in the order given (the most important pin first: the running course, the
   last opened, then the rest), and the groups by their first pin. */
export function groupPins(points, radius = PIN_GROUP_PX) {
  const parent = points.map((_, i) => i);
  const root = i => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (apart(points[i], points[j]) <= radius) parent[root(j)] = root(i);
    }
  }
  const byRoot = new Map();
  points.forEach((point, i) => {
    const key = root(i);
    if (!byRoot.has(key)) byRoot.set(key, []);
    byRoot.get(key).push(i);
  });
  let groups = [...byRoot.values()].sort((a, b) => a[0] - b[0]);
  for (let merged = true; merged;) {
    merged = false;
    const middles = groups.map(group => middle(group.map(i => points[i])));
    search: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (apart(middles[i], middles[j]) > radius) continue;
        groups[i] = [...groups[i], ...groups[j]].sort((a, b) => a - b);
        groups.splice(j, 1);
        merged = true;
        break search;
      }
    }
  }
  groups = groups.sort((a, b) => a[0] - b[0]);
  return groups.map(group => group.map(i => points[i]));
}

/* Where a group is drawn: the middle of its pins. */
export const groupMiddle = middle;

/* The first zoom, from `from` to `to`, at which `target` stands clear of every other
   point: where a club in a group gets its own pin. `project(point, zoom)` gives the
   point's pixels at that zoom. */
export function separatingZoom(target, others, project, { from, to, radius = PIN_GROUP_PX }) {
  for (let zoom = from; zoom <= to; zoom++) {
    const at = project(target, zoom);
    if (others.every(other => apart(project(other, zoom), at) > radius)) return zoom;
  }
  return to;
}
