/* The ground's picture, painted on the phone from the course's own outlines.

   Colours are the simulator's, read off its summer light, so the map and the 3D
   course are the same place. The mowing follows each hole's line as it does there.
   Forest is stamped from the same trees the map stands in 3D. Nothing here is
   shaded: the shader lays the sun and the relief over it. A second, smaller
   picture says what each surface is (water, mown turf, sand), so the shader can
   give each its own finish. */
import { LANDCOVER } from '../engine/landcover.mjs';
import { canopyAlpha } from './map-trees.mjs';

/* A third of a metre to the pixel on the 1 m tiles, where a green's edge and a
   bunker's shape are read at arm's length; half a metre's worth of a coarser
   tile is plenty further out. */
export const paintSize = node => (node.lod === 0 ? 768 : 512);
const MASK_SIZE = 256;
const STRIPE_METRES = 11;

export const MAP_COLOURS = Object.freeze({
  rough: '#5a7f3c',
  semiRough: '#6d9449',
  field: '#94a163',
  meadow: '#7a9756',
  town: '#8f927d',
  forestFloor: '#2f5428',
  forest: '#3a6a2e',
  scrub: '#587f3b',
  wetland: '#6f9160',
  water: '#1f6383',
  shallows: '#3d8f97',
  sand: '#efe6c6',
  sandEdge: '#9c8f62',
  rock: '#8f8c7f',
  road: '#5f615e',
  roadEdge: '#454744',
  path: '#8d9383',
  pathEdge: '#6a7361',
  building: '#4d4a45',
  fairway: '#8fb963',
  fairwayStripe: '#749f4d',
  tee: '#8bb860',
  green: '#b1dc95',
  collar: '#84b25c',
});

const LANDUSE_COLOURS = Object.freeze({
  farmland: MAP_COLOURS.field,
  farmyard: MAP_COLOURS.field,
  meadow: MAP_COLOURS.meadow,
  grass: MAP_COLOURS.meadow,
  residential: MAP_COLOURS.town,
  commercial: MAP_COLOURS.town,
  industrial: MAP_COLOURS.town,
  retail: MAP_COLOURS.town,
});

function ringPath(ring) {
  const path = new Path2D();
  ring.forEach(([x, z], i) => (i ? path.lineTo(x, z) : path.moveTo(x, z)));
  path.closePath();
  return path;
}

function linePath(line) {
  const path = new Path2D();
  line.forEach(([x, z], i) => (i ? path.lineTo(x, z) : path.moveTo(x, z)));
  return path;
}

function box(points, pad = 0) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

/* Some outlines came off a raster and step at its cells. Drawn, never measured:
   two rounds of corner-cutting ease the stairs without moving an edge a golfer
   reads, and no distance is ever taken from a painted fairway. */
export function softened(ring, rounds = 2) {
  let points = ring;
  for (let round = 0; round < rounds; round++) {
    const next = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    points = next;
  }
  return points;
}

const shape = (points, path, pad = 0) => ({ path, ...box(points, pad) });
const polygons = (rings, pad = 0) => rings.map(ring => shape(ring, ringPath(ring), pad));

/* A wood seen from above, from the trees themselves: each stamp is a real crown's
   view from overhead, over its own shadow, on a dark floor. It repeats, so a whole
   forest costs one pattern; where the camera comes close the 3D trees take over. */
const CANOPY_SIZE = 512, CANOPY_PIXELS_PER_METRE = 4;

function canopyPattern(ctx, atlases) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = CANOPY_SIZE;
  const c = tile.getContext('2d');
  c.fillStyle = MAP_COLOURS.forestFloor;
  c.fillRect(0, 0, CANOPY_SIZE, CANOPY_SIZE);
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wraps = [[0, 0], [CANOPY_SIZE, 0], [-CANOPY_SIZE, 0], [0, CANOPY_SIZE], [0, -CANOPY_SIZE],
    [CANOPY_SIZE, CANOPY_SIZE], [-CANOPY_SIZE, -CANOPY_SIZE], [CANOPY_SIZE, -CANOPY_SIZE], [-CANOPY_SIZE, CANOPY_SIZE]];
  const stamps = 92;
  for (let i = 0; i < stamps; i++) {
    const x = random() * CANOPY_SIZE, y = random() * CANOPY_SIZE;
    const pick = random(), species = pick < 0.5 ? 1 : pick < 0.86 ? 0 : 2;
    /* Half a frame spans the template's enclosing radius, about 13 m. */
    const half = (11 + random() * 7) * CANOPY_PIXELS_PER_METRE;
    const turn = random() * Math.PI * 2;
    const fx = 3 + Math.round(random()), fy = 3 + Math.round(random());
    for (const [ox, oy] of wraps) {
      if (x + ox < -half * 2 || x + ox > CANOPY_SIZE + half * 2 || y + oy < -half * 2 || y + oy > CANOPY_SIZE + half * 2) continue;
      c.save();
      c.translate(x + ox + half * 0.2, y + oy + half * 0.17);
      c.fillStyle = 'rgba(14,30,16,.3)';
      c.beginPath();
      c.ellipse(0, 0, half * 0.5, half * 0.46, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      if (atlases) {
        const size = atlases.frameSize;
        c.save();
        c.translate(x + ox, y + oy);
        c.rotate(turn);
        c.drawImage(atlases.colours[species], fx * size, fy * size, size, size, -half, -half, half * 2, half * 2);
        c.restore();
      } else {
        c.fillStyle = 'rgba(82,132,70,.9)';
        c.beginPath();
        c.arc(x + ox, y + oy, half * 0.42, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  return ctx.createPattern(tile, 'repeat');
}

/* The land cover as one alpha mask, in its own frame. A pack frame can sit a
   few degrees off the map's, so the mask is carried by the frame's own affine. */
function landcoverMask(course) {
  const record = course.landcover;
  if (!record) return null;
  const { nx, nz, cell, x0, z0, cells } = record;
  const mask = document.createElement('canvas');
  mask.width = nx;
  mask.height = nz;
  const c = mask.getContext('2d');
  const image = c.createImageData(nx, nz);
  for (let k = 0; k < nx * nz; k++) {
    const kind = cells[k];
    image.data[k * 4 + 3] = kind === LANDCOVER.TREES ? 255 : kind === LANDCOVER.LIGHT_TREES ? 150 : 0;
  }
  c.putImageData(image, 0, 0);
  const [ox, oz] = course.frame.toWorld(x0, z0);
  const [ax, az] = course.frame.toWorld(x0 + cell, z0);
  const [bx, bz] = course.frame.toWorld(x0, z0 + cell);
  return { canvas: mask, matrix: [ax - ox, az - oz, bx - ox, bz - oz, ox, oz] };
}

export function createMapPainter(course, atlases = null) {
  const surfaces = new Map();
  const surface = size => {
    if (!surfaces.has(size)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const trees = document.createElement('canvas');
      trees.width = trees.height = size;
      surfaces.set(size, { canvas, ctx: canvas.getContext('2d', { alpha: false }), trees, treeCtx: trees.getContext('2d') });
    }
    return surfaces.get(size);
  };
  const canopy = canopyPattern(surface(512).ctx, atlases);
  const land = landcoverMask(course);
  const small = document.createElement('canvas');
  const smallCtx = small.getContext('2d');
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskCanvas.height = MASK_SIZE;
  const maskCtx = maskCanvas.getContext('2d', { alpha: false });
  const f = course.features;

  /* Forest from what was measured there: the laser's canopy on a 1 m tile, the
     land cover on coarser ones. */
  function paintCanopy(node, scale, size) {
    const stand = node.stand;
    if (!stand && !land) return false;
    const { ctx, trees, treeCtx } = surface(size);
    treeCtx.setTransform(1, 0, 0, 1, 0, 0);
    treeCtx.globalCompositeOperation = 'source-over';
    treeCtx.clearRect(0, 0, size, size);
    treeCtx.imageSmoothingEnabled = true;
    treeCtx.imageSmoothingQuality = 'high';
    if (stand) {
      small.width = stand.section.width;
      small.height = stand.section.height;
      smallCtx.putImageData(new ImageData(canopyAlpha({ payload: stand.payload, ...stand.section }), stand.section.width, stand.section.height), 0, 0);
      treeCtx.drawImage(small, 0, 0, size, size);
    } else {
      treeCtx.setTransform(scale, 0, 0, scale, -node.x0 * scale, -node.z0 * scale);
      treeCtx.transform(...land.matrix);
      treeCtx.drawImage(land.canvas, 0, 0);
      treeCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    treeCtx.globalCompositeOperation = 'source-in';
    /* Anchored to the world, so neighbouring tiles' patterns meet. */
    const k = scale / CANOPY_PIXELS_PER_METRE;
    canopy.setTransform(new DOMMatrix([k, 0, 0, k, -node.x0 * scale, -node.z0 * scale]));
    treeCtx.fillStyle = canopy;
    treeCtx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(trees, 0, 0);
    ctx.restore();
    return true;
  }

  const landuse = f.landuse.filter(item => LANDUSE_COLOURS[item.kind])
    .map(item => ({ ...shape(item.ring, ringPath(item.ring)), colour: LANDUSE_COLOURS[item.kind] }));
  const holes = course.holes.map(hole => ({ ...shape(hole.line, linePath(hole.line), 120), rings: polygons(hole.fairways.map(ring => softened(ring)), 12), line: linePath(hole.line) }));
  const layers = {
    forest: polygons(f.forest),
    scrub: polygons(f.scrub),
    wetland: polygons(f.wetland),
    range: polygons(f.range),
    grass: polygons(f.grass),
    openSand: polygons(f.openSand),
    rock: polygons(f.rock),
    water: f.water.map(item => shape(item.ring, ringPath(item.ring), 10)),
    streams: f.streams.map(item => ({ ...shape(item.line, linePath(item.line), 4), width: item.width ?? 2 })),
    roads: f.roads.map(item => ({ ...shape(item.line, linePath(item.line), 8), width: item.width ?? 5 })),
    tracks: f.tracks.map(item => ({ ...shape(item.line, linePath(item.line), 4), width: item.width ?? 2.6 })),
    paths: f.paths.map(item => ({ ...shape(item.line, linePath(item.line), 3), width: item.width ?? 2 })),
    parking: polygons(f.parking),
    buildings: polygons(f.buildings),
    otherFairways: polygons(f.otherFairways.map(ring => softened(ring)), 12),
    otherTees: polygons(f.otherTees, 4),
    otherGreens: polygons(f.otherGreens, 8),
    otherBunkers: polygons(f.otherBunkers, 3),
    tees: polygons(course.holes.flatMap(hole => hole.teePads), 4),
    greens: polygons(course.holes.map(hole => hole.green.ring), 8),
    bunkers: polygons(course.holes.flatMap(hole => hole.bunkers), 3),
  };
  const mown = [...holes.flatMap(hole => hole.rings), ...layers.otherFairways, ...layers.otherTees, ...layers.otherGreens, ...layers.tees, ...layers.greens];

  function paintMask(node) {
    const scale = MASK_SIZE / node.size;
    const touches = item => item.x1 >= node.x0 && item.x0 <= node.x0 + node.size && item.z1 >= node.z0 && item.z0 <= node.z0 + node.size;
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskCtx.fillStyle = '#000';
    maskCtx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    maskCtx.setTransform(scale, 0, 0, scale, -node.x0 * scale, -node.z0 * scale);
    maskCtx.fillStyle = '#0f0';
    for (const item of mown) if (touches(item)) maskCtx.fill(item.path, 'evenodd');
    maskCtx.fillStyle = '#00f';
    for (const set of [layers.bunkers, layers.otherBunkers, layers.openSand]) for (const item of set) if (touches(item)) maskCtx.fill(item.path, 'evenodd');
    maskCtx.fillStyle = '#f00';
    for (const item of layers.water) if (touches(item)) maskCtx.fill(item.path, 'evenodd');
    maskCtx.strokeStyle = '#f00';
    maskCtx.lineCap = 'round';
    for (const item of layers.streams) {
      if (!touches(item)) continue;
      maskCtx.lineWidth = item.width;
      maskCtx.stroke(item.path);
    }
    return maskCanvas;
  }

  return {
    paint(node) {
      const size = paintSize(node);
      const { canvas, ctx } = surface(size);
      const scale = size / node.size;
      const x0 = node.x0, z0 = node.z0, x1 = x0 + node.size, z1 = z0 + node.size;
      const touches = item => item.x1 >= x0 && item.x0 <= x1 && item.z1 >= z0 && item.z0 <= z1;
      const pixels = n => n / scale;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = MAP_COLOURS.rough;
      ctx.fillRect(0, 0, size, size);
      ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -z0 * scale);
      ctx.lineCap = ctx.lineJoin = 'round';

      const fill = (items, colour) => {
        ctx.fillStyle = colour;
        for (const item of items) if (touches(item)) ctx.fill(item.path, 'evenodd');
      };
      const stroke = (items, colour, width) => {
        ctx.strokeStyle = colour;
        for (const item of items) {
          if (!touches(item)) continue;
          ctx.lineWidth = Math.max(width(item), pixels(0.8));
          ctx.stroke(item.path);
        }
      };

      for (const item of landuse) if (touches(item)) { ctx.fillStyle = item.colour; ctx.fill(item.path, 'evenodd'); }
      /* A mapped field or meadow can run under a hole; where the course is played
         it is rough, whatever the land was. */
      stroke(holes, MAP_COLOURS.rough, () => 96);
      fill(layers.wetland, MAP_COLOURS.wetland);
      fill(layers.scrub, MAP_COLOURS.scrub);
      if (node.lod > 3 || !paintCanopy(node, scale, size)) fill(layers.forest, MAP_COLOURS.forest);
      fill(layers.rock, MAP_COLOURS.rock);
      fill(layers.openSand, MAP_COLOURS.sand);

      stroke(layers.water, MAP_COLOURS.shallows, () => 7);
      fill(layers.water, MAP_COLOURS.water);
      stroke(layers.streams, MAP_COLOURS.water, item => item.width);

      stroke(layers.roads, MAP_COLOURS.roadEdge, item => item.width + 1.4);
      stroke(layers.roads, MAP_COLOURS.road, item => item.width);
      stroke(layers.tracks, MAP_COLOURS.pathEdge, item => item.width + 0.8);
      stroke(layers.tracks, MAP_COLOURS.path, item => item.width);
      fill(layers.parking, MAP_COLOURS.road);

      fill(layers.grass, MAP_COLOURS.semiRough);
      fill(layers.range, MAP_COLOURS.semiRough);
      stroke(layers.otherFairways, MAP_COLOURS.semiRough, () => 18);
      fill(layers.otherFairways, MAP_COLOURS.fairway);

      for (const hole of holes) {
        if (!touches(hole)) continue;
        stroke(hole.rings, MAP_COLOURS.semiRough, () => 18);
        fill(hole.rings, MAP_COLOURS.fairway);
        if (node.lod <= 2) {
          /* Stripes run along the hole, and bend with it: concentric strokes about
             its line, from the widest in, clipped to the fairway. */
          for (const ring of hole.rings) {
            if (!touches(ring)) continue;
            ctx.save();
            ctx.clip(ring.path, 'evenodd');
            for (let band = 9; band > 0; band--) {
              ctx.strokeStyle = band % 2 ? MAP_COLOURS.fairwayStripe : MAP_COLOURS.fairway;
              ctx.lineWidth = band * 2 * STRIPE_METRES - STRIPE_METRES;
              ctx.stroke(hole.line);
            }
            ctx.restore();
          }
        }
      }

      stroke(layers.paths, MAP_COLOURS.pathEdge, item => item.width + 0.7);
      stroke(layers.paths, MAP_COLOURS.path, item => item.width);

      for (const set of [layers.otherTees, layers.tees]) {
        stroke(set, MAP_COLOURS.semiRough, () => 3);
        fill(set, MAP_COLOURS.tee);
      }

      for (const set of [layers.otherGreens, layers.greens]) {
        stroke(set, MAP_COLOURS.semiRough, () => 12);
        stroke(set, MAP_COLOURS.collar, () => 5);
        fill(set, MAP_COLOURS.green);
      }

      for (const set of [layers.otherBunkers, layers.bunkers]) {
        stroke(set, MAP_COLOURS.sandEdge, () => 1.4);
        fill(set, MAP_COLOURS.sand);
      }

      fill(layers.buildings, MAP_COLOURS.building);
      return { colour: canvas, mask: paintMask(node) };
    },
  };
}
