/* The detailed course as the ball physics sees it: the drawn ground, its lies,
   the trees as trunks and crowns, the white stakes and the cups. Built once from
   the handle main.js gives the play mode (see the end of main.js). */
import { LIE_SURFACE } from './shot-model.mjs';
import { outTest } from './play-rules.mjs';

const CELL = 16;

/** A spatial index of the course's trees: [{ x, y, z, height, radius, trunk }]. */
export function treeIndex({ lists, species }) {
  const cells = new Map();
  let count = 0;
  lists.forEach((list, s) => {
    const kind = species[s];
    if (!kind || !list) return;
    for (let i = 0; i + 5 < list.length; i += 6) {
      const height = kind.height * list[i + 3], radius = kind.radius * list[i + 5];
      if (!(height > 1.5) || !(radius > .2)) continue;
      const tree = { x: list[i], y: list[i + 1] + .25, z: list[i + 2], height, radius, trunk: .1 + .012 * height };
      const key = `${Math.floor(tree.x / CELL)},${Math.floor(tree.z / CELL)}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, cell = []);
      cell.push(tree); count++;
    }
  });
  return {
    count,
    /** Every tree whose trunk stands inside a box. */
    within(minX, maxX, minZ, maxZ) {
      const out = [];
      for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) for (let k = Math.floor(minZ / CELL); k <= Math.floor(maxZ / CELL); k++) {
        const cell = cells.get(`${i},${k}`);
        if (cell) for (const tree of cell) if (tree.x >= minX && tree.x <= maxX && tree.z >= minZ && tree.z <= maxZ) out.push(tree);
      }
      return out;
    },
    near(x, z, r) {
      const out = [];
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
      const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
      for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) {
        const cell = cells.get(`${i},${k}`);
        if (cell) for (const tree of cell) if (Math.abs(tree.x - x) < r + tree.radius && Math.abs(tree.z - z) < r + tree.radius) out.push(tree);
      }
      return out;
    },
  };
}

/** The physics world for one stroke from `from` ([x, z]) toward the hole's cup. */
export function createPlayWorld(handle) {
  const trees = treeIndex(handle.trees());
  const boundaries = handle.boundaries();
  const heightAt = (x, z) => {
    const h = handle.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  /* The lie: the detailed course's own (kikLie), with the fringe told apart. */
  const surfaceAt = (x, z) => {
    const lie = handle.lieAt(x, z, heightAt(x, z));
    if (lie !== 'green' && lie !== 'vatten') {
      const c = handle.classify(x, z);
      if (c.fringe > .5 && c.green < .5) return 'fringe';
    }
    return LIE_SURFACE[lie] || 'rough';
  };
  const inCourse = (x, z) => handle.classify(x, z).inBounds !== false;
  const cupOf = n => {
    const cup = handle.cups().find(c => c.hole === n);
    if (cup) return [cup.x, cup.z, cup.y];
    const hole = handle.holes[n - 1];
    return [hole.pin[0], hole.pin[1], heightAt(hole.pin[0], hole.pin[1])];
  };
  /* The day's ground (conditions.mjs groundWith), set when the light or the weather changes. */
  let ground = null, plug = 0;
  return {
    trees, heightAt, surfaceAt, inCourse, cupOf, boundaries,
    setGround(next, plugChance = 0) { ground = next; plug = plugChance; },
    /** The world a stroke from `from` plays in (its out-of-bounds test looks from there). */
    forStroke(from, cup) {
      return { heightAt, surfaceAt, trees, cup: cup ? [cup[0], cup[1]] : null, isOut: outTest({ lines: boundaries, from, inCourse }),
        ...(ground ? { ground, plug } : {}) };
    },
  };
}
