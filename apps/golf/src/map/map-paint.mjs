/* The ground's picture, painted on the phone from the course's own outlines.

   Colours are the simulator's, read off its summer light, so the map and the 3D
   course are the same place. The mowing follows each hole's line as it does there.
   Forest is stamped from the same trees the map stands in 3D. Nothing here is
   shaded: the shader lays the sun and the relief over it. A second, smaller
   picture says what each surface is (water, mown turf, sand), so the shader can
   give each its own finish. */
import { LANDCOVER, landcoverSampler } from '../engine/landcover.mjs';
import { canopyAlpha } from './map-trees.mjs';

/* A third of a metre to the pixel on the 1 m tiles, where a green's edge and a
   bunker's shape are read at arm's length; half a metre's worth of a coarser
   tile is plenty further out. */
export const paintSize = node => (node.lod === 0 ? 768 : 512);
const MASK_SIZE = 256;
const STRIPE_METRES = 6;
/* Enough to reach the far edge of the widest fairway from its line. */
const STRIPE_BANDS = Math.ceil(100 / STRIPE_METRES);

export const MAP_COLOURS = Object.freeze({
  rough: '#5a7f3c',
  semiRough: '#6d9449',
  field: '#94a163',
  meadow: '#7a9756',
  town: '#8f927d',
  forestFloor: '#2f5428',
  forest: '#3a6a2e',
  scrub: '#587f3b',
  wetland: '#638550',
  water: '#1f6383',
  shallows: '#3d8f97',
  sand: '#efe6c6',
  sandEdge: '#9c8f62',
  rock: '#8f8c7f',
  hay: '#a3a868',
  yard: '#8d8a78',
  clearfell: '#7c8a50',
  pitch: '#6fa050',
  court: '#9c6a4f',
  piste: '#a5b884',
  rail: '#7d7a70',
  sleeper: '#3f3d39',
  pier: '#9a8363',
  bridge: '#a39c8a',
  roof: '#6c655c',
  solar: '#2c3a4a',
  mat: '#4f7d52',
  hedge: '#35592b',
  fence: 'rgba(40,40,36,.55)',
  wire: 'rgba(30,32,34,.5)',
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
  garages: MAP_COLOURS.town,
  railway: MAP_COLOURS.rail,
  heath: '#77885a',
  allotments: '#86995c',
  cemetery: MAP_COLOURS.meadow,
  recreation: MAP_COLOURS.meadow,
  park: MAP_COLOURS.meadow,
});
const STAKE_COLOURS = Object.freeze({ r: '#d8443c', y: '#e8c33a', w: '#f2f0e8' });
const coverAlpha = kind => (kind === LANDCOVER.TREES ? 255 : kind === LANDCOVER.LIGHT_TREES ? 150 : 0);

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
const CANOPY_SIZE = 512, CANOPY_PIXELS_PER_METRE = 4, CANOPY_FINEST_LOD = 3;

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
    image.data[k * 4 + 3] = coverAlpha(cells[k]);
  }
  c.putImageData(image, 0, 0);
  const [ox, oz] = course.frame.toWorld(x0, z0);
  const [ax, az] = course.frame.toWorld(x0 + cell, z0);
  const [bx, bz] = course.frame.toWorld(x0, z0 + cell);
  return { canvas: mask, matrix: [ax - ox, az - oz, bx - ox, bz - oz, ox, oz] };
}

/* `land` is the ground's pictures of its water and forest (map-land.mjs), or null. */
export function createMapPainter(course, atlases = null, land = null) {
  const surfaces = new Map();
  const surface = size => {
    if (!surfaces.has(size)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const trees = document.createElement('canvas');
      trees.width = trees.height = size;
      const wet = document.createElement('canvas');
      wet.width = wet.height = size;
      surfaces.set(size, { canvas, ctx: canvas.getContext('2d', { alpha: false }), trees, treeCtx: trees.getContext('2d'), wet, wetCtx: wet.getContext('2d') });
    }
    return surfaces.get(size);
  };
  const canopy = canopyPattern(surface(512).ctx, atlases);
  const coverMask = land ? null : landcoverMask(course);
  const small = document.createElement('canvas');
  const smallCtx = small.getContext('2d');
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskCanvas.height = MASK_SIZE;
  const maskCtx = maskCanvas.getContext('2d', { alpha: false });
  const canopyMask = document.createElement('canvas');
  canopyMask.width = canopyMask.height = MASK_SIZE;
  const canopyMaskCtx = canopyMask.getContext('2d');
  const f = course.features;
  const landAt = course.landcover ? landcoverSampler(course.landcover) : null;

  /* A tile's share of a ground picture. Two cells over on every side, so the
     smoothing runs on across tile edges and neighbours meet. */
  function drawShare(target, image, node, size) {
    const { x0, z0, spacing } = land;
    const k = size / node.size, margin = spacing * 2, span = node.size + margin * 2;
    target.drawImage(image, (node.x0 - margin - x0) / spacing, (node.z0 - margin - z0) / spacing, span / spacing, span / spacing,
      -margin * k, -margin * k, span * k, span * k);
  }

  function waterPicture(node, size, colour) {
    const { wet, wetCtx } = surface(size);
    wetCtx.setTransform(1, 0, 0, 1, 0, 0);
    wetCtx.globalCompositeOperation = 'source-over';
    wetCtx.clearRect(0, 0, size, size);
    wetCtx.imageSmoothingEnabled = true;
    wetCtx.imageSmoothingQuality = 'low';
    drawShare(wetCtx, land.water, node, size);
    wetCtx.globalCompositeOperation = 'source-in';
    wetCtx.fillStyle = colour;
    wetCtx.fillRect(0, 0, size, size);
    return wet;
  }

  /* Forest from what was measured there: the laser's canopy on a 1 m tile, where
     it measured, and the ground's forest picture everywhere else. Past the tiles a
     stamp can read on, plain forest colour. */
  function paintCanopy(node, scale, size) {
    const stand = node.stand;
    if (!stand && !land && !coverMask) return false;
    const { ctx, trees, treeCtx } = surface(size);
    treeCtx.setTransform(1, 0, 0, 1, 0, 0);
    treeCtx.globalCompositeOperation = 'source-over';
    treeCtx.clearRect(0, 0, size, size);
    treeCtx.imageSmoothingEnabled = true;
    treeCtx.imageSmoothingQuality = 'low';
    if (stand) {
      small.width = stand.section.width;
      small.height = stand.section.height;
      const { width, height, cellMetres } = stand.section;
      const unmeasured = landAt && ((column, row) => {
        const [x, z] = course.frame.toPack(node.x0 + (column + 0.5) * cellMetres, node.z0 + (row + 0.5) * cellMetres);
        return coverAlpha(landAt(x, z));
      });
      smallCtx.putImageData(new ImageData(canopyAlpha({ payload: stand.payload, width, height, unmeasured }), width, height), 0, 0);
      treeCtx.drawImage(small, 0, 0, size, size);
    } else if (land) drawShare(treeCtx, land.forest, node, size);
    else {
      treeCtx.setTransform(scale, 0, 0, scale, -node.x0 * scale, -node.z0 * scale);
      treeCtx.transform(...coverMask.matrix);
      treeCtx.drawImage(coverMask.canvas, 0, 0);
      treeCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    treeCtx.globalCompositeOperation = 'source-in';
    /* Anchored to the world, so neighbouring tiles' patterns meet. */
    const k = scale / CANOPY_PIXELS_PER_METRE;
    canopy.setTransform(new DOMMatrix([k, 0, 0, k, -node.x0 * scale, -node.z0 * scale]));
    treeCtx.fillStyle = node.lod <= CANOPY_FINEST_LOD ? canopy : MAP_COLOURS.forest;
    treeCtx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(trees, 0, 0);
    ctx.restore();
    return true;
  }

  const landuse = f.landuse.filter(item => LANDUSE_COLOURS[item.kind])
    .map(item => ({ ...shape(item.ring, ringPath(item.ring)), colour: LANDUSE_COLOURS[item.kind] }));
  const plainLines = (items, pad = 4) => items.map(line => shape(line, linePath(line), pad));
  /* Thousands of far houses: bare corners and one path per tile, no Path2D each. */
  const farBuildings = f.farBuildings.map(corners => ({ corners, ...box(corners) }));
  const holes = course.holes.map(hole => ({ ...shape(hole.line, linePath(hole.line), 120), rings: polygons(hole.fairways.map(ring => softened(ring)), 12), line: linePath(hole.line) }));
  const layers = {
    forest: polygons(f.forest),
    scrub: polygons(f.scrub),
    wetland: polygons(f.wetland),
    range: polygons(f.range),
    grass: polygons(f.grass),
    openSand: polygons(f.openSand),
    rock: polygons(f.rock),
    /* Only the ground's own picture can tell the sea from the land inside such a ring. */
    water: f.water.filter(item => !(land && item.overLand)).map(item => shape(item.ring, ringPath(item.ring), 10)),
    hayfields: polygons(f.hayfields),
    yards: polygons(f.yards),
    clearfells: polygons(f.clearfells),
    shallows: polygons(f.shallows),
    basins: polygons(f.basins, 4),
    streams: f.streams.map(item => ({ ...shape(item.line, linePath(item.line), 4), width: item.width ?? 2 })),
    drains: f.drains.map(item => ({ ...shape(item.line, linePath(item.line), 3), width: item.width ?? 1.2 })),
    railways: f.railways.map(item => shape(item.line, linePath(item.line), 8)),
    piers: f.piers.map(item => shape(item.line, linePath(item.line), 4)),
    bridges: polygons(f.bridges, 2),
    barriers: f.barriers.map(item => ({ ...shape(item.line, linePath(item.line), 3), kind: item.kind })),
    powerLines: f.powerLines.map(item => shape(item.line, linePath(item.line), 3)),
    lifts: f.lifts.map(item => shape(item.line, linePath(item.line), 3)),
    nets: plainLines(f.nets),
    cartParks: plainLines(f.cartParks),
    outOfBounds: plainLines(f.outOfBounds),
    pitches: f.pitches.map(item => ({ ...shape(item.ring, ringPath(item.ring)), court: item.court })),
    pistes: polygons(f.pistes),
    mats: polygons(f.mats),
    paved: polygons(f.paved),
    bareGround: polygons(f.bareGround),
    courts: polygons(f.courts),
    roofs: polygons(f.roofs),
    solar: polygons(f.solar),
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
  let allWater = null;
  const waterPath = () => {
    if (!allWater) {
      allWater = new Path2D();
      for (const item of layers.water) allWater.addPath(item.path);
    }
    return allWater;
  };
  const mown = [...holes.flatMap(hole => hole.rings), ...layers.otherFairways, ...layers.otherTees, ...layers.otherGreens, ...layers.tees, ...layers.greens];

  function paintMask(node, canopySource) {
    const scale = MASK_SIZE / node.size;
    const touches = item => item.x1 >= node.x0 && item.x0 <= node.x0 + node.size && item.z1 >= node.z0 && item.z0 <= node.z0 + node.size;
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskCtx.fillStyle = '#000';
    maskCtx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    if (canopySource) {
      /* The canopy just painted, as white: all three channels at once. */
      canopyMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
      canopyMaskCtx.globalCompositeOperation = 'source-over';
      canopyMaskCtx.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
      canopyMaskCtx.drawImage(canopySource, 0, 0, MASK_SIZE, MASK_SIZE);
      canopyMaskCtx.globalCompositeOperation = 'source-in';
      canopyMaskCtx.fillStyle = '#fff';
      canopyMaskCtx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
      maskCtx.drawImage(canopyMask, 0, 0);
    }
    /* Under the surfaces, as it is in the picture: a played one is never water. */
    if (land) maskCtx.drawImage(waterPicture(node, MASK_SIZE, '#f00'), 0, 0);
    maskCtx.setTransform(scale, 0, 0, scale, -node.x0 * scale, -node.z0 * scale);
    maskCtx.fillStyle = '#0f0';
    for (const item of mown) if (touches(item)) maskCtx.fill(item.path, 'evenodd');
    maskCtx.fillStyle = '#00f';
    for (const set of [layers.bunkers, layers.otherBunkers, layers.openSand]) for (const item of set) if (touches(item)) maskCtx.fill(item.path, 'evenodd');
    maskCtx.fillStyle = '#f00';
    for (const set of [layers.water, layers.basins]) for (const item of set) if (touches(item)) maskCtx.fill(item.path, 'evenodd');
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
      fill(layers.hayfields, MAP_COLOURS.hay);
      fill(layers.clearfells, MAP_COLOURS.clearfell);
      fill(layers.yards, MAP_COLOURS.yard);
      /* A mapped field or meadow can run under a hole; where the course is played
         it is rough, whatever the land was. */
      stroke(holes, MAP_COLOURS.rough, () => 96);
      fill(layers.wetland, MAP_COLOURS.wetland);
      fill(layers.scrub, MAP_COLOURS.scrub);
      const canopied = paintCanopy(node, scale, size);
      if (!canopied || node.lod > CANOPY_FINEST_LOD) fill(layers.forest, MAP_COLOURS.forest);
      fill(layers.rock, MAP_COLOURS.rock);
      fill(layers.openSand, MAP_COLOURS.sand);

      stroke(layers.water, MAP_COLOURS.shallows, () => 7);
      fill(layers.water, MAP_COLOURS.water);
      fill(layers.basins, MAP_COLOURS.water);
      /* Lakes past the outlines, and the open sea, read off the laser's ground. */
      if (land) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(waterPicture(node, size, MAP_COLOURS.water), 0, 0);
        ctx.restore();
      }
      /* A lake's silt margin lies under its water: traced coarsely, it only counts
         inside the lake, as it does in the simulator. */
      if (layers.shallows.some(touches)) {
        ctx.save();
        ctx.clip(waterPath());
        ctx.globalAlpha = 0.55;
        fill(layers.shallows, MAP_COLOURS.shallows);
        ctx.restore();
      }
      stroke(layers.streams, MAP_COLOURS.water, item => item.width);
      stroke(layers.drains, MAP_COLOURS.water, item => item.width);

      stroke(layers.railways, MAP_COLOURS.rail, () => 5);
      ctx.setLineDash([1.2, 2.4]);
      stroke(layers.railways, MAP_COLOURS.sleeper, () => 2.6);
      ctx.setLineDash([]);

      stroke(layers.roads, MAP_COLOURS.roadEdge, item => item.width + 1.4);
      stroke(layers.roads, MAP_COLOURS.road, item => item.width);
      stroke(layers.tracks, MAP_COLOURS.pathEdge, item => item.width + 0.8);
      stroke(layers.tracks, MAP_COLOURS.path, item => item.width);
      fill(layers.parking, MAP_COLOURS.road);
      stroke(layers.piers, MAP_COLOURS.pier, () => 3);
      stroke(layers.cartParks, MAP_COLOURS.road, () => 3);
      stroke(layers.bridges, MAP_COLOURS.roadEdge, () => 0.7);
      fill(layers.bridges, MAP_COLOURS.bridge);

      fill(layers.pistes, MAP_COLOURS.piste);
      for (const item of layers.pitches) if (touches(item)) { ctx.fillStyle = item.court ? MAP_COLOURS.court : MAP_COLOURS.pitch; ctx.fill(item.path, 'evenodd'); }
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
            for (let band = STRIPE_BANDS; band > 0; band--) {
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
      fill(layers.paved, MAP_COLOURS.path);
      fill(layers.bareGround, MAP_COLOURS.rock);
      fill(layers.courts, MAP_COLOURS.court);
      fill(layers.mats, MAP_COLOURS.mat);

      for (const set of [layers.otherTees, layers.tees]) {
        stroke(set, MAP_COLOURS.semiRough, () => 3);
        fill(set, MAP_COLOURS.tee);
      }

      for (const set of [layers.otherGreens, layers.greens]) {
        stroke(set, MAP_COLOURS.semiRough, () => 12);
        stroke(set, MAP_COLOURS.collar, () => 5);
        fill(set, MAP_COLOURS.green);
      }
      /* A green is cut both ways: a fine check only the 1 m tiles can show. */
      if (node.lod === 0) {
        for (const set of [layers.otherGreens, layers.greens]) {
          for (const item of set) {
            if (!touches(item)) continue;
            ctx.save();
            ctx.clip(item.path, 'evenodd');
            ctx.fillStyle = 'rgba(255,255,255,.055)';
            for (let band = Math.floor(x0 / 6) * 6; band < x1; band += 6) ctx.fillRect(band, z0, 3, z1 - z0);
            for (let band = Math.floor(z0 / 6) * 6; band < z1; band += 6) ctx.fillRect(x0, band, x1 - x0, 3);
            ctx.restore();
          }
        }
      }

      for (const set of [layers.otherBunkers, layers.bunkers]) {
        stroke(set, MAP_COLOURS.sandEdge, () => 1.4);
        fill(set, MAP_COLOURS.sand);
      }

      fill(layers.buildings, MAP_COLOURS.building);
      ctx.fillStyle = MAP_COLOURS.building;
      ctx.beginPath();
      for (const item of farBuildings) {
        if (!touches(item)) continue;
        item.corners.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
        ctx.closePath();
      }
      ctx.fill();
      fill(layers.roofs, MAP_COLOURS.roof);
      fill(layers.solar, MAP_COLOURS.solar);

      /* What stands on the ground and has no width to speak of. */
      for (const item of layers.barriers) {
        if (!touches(item)) continue;
        ctx.strokeStyle = item.kind === 'hedge' ? MAP_COLOURS.hedge : MAP_COLOURS.fence;
        ctx.lineWidth = Math.max(item.kind === 'hedge' ? 1.6 : 0.5, pixels(0.7));
        ctx.stroke(item.path);
      }
      stroke(layers.nets, MAP_COLOURS.fence, () => 0.5);
      stroke(layers.lifts, MAP_COLOURS.wire, () => 0.6);
      stroke(layers.powerLines, MAP_COLOURS.wire, () => 0.6);
      ctx.fillStyle = MAP_COLOURS.sleeper;
      const dots = (points, half) => {
        for (const [x, z] of points) if (x >= x0 - half && x <= x1 + half && z >= z0 - half && z <= z1 + half) ctx.fillRect(x - half, z - half, half * 2, half * 2);
      };
      dots(f.masts, 2.6);
      if (node.lod <= 2) dots(f.poles, 0.8);

      /* Boundaries a golfer plays by. A stake is too small to see past the finest
         tiles, and the penalty line is told by the stakes it is marked with. */
      if (node.lod <= 1) {
        for (const { point: [x, z], colour } of f.stakes) {
          if (x < x0 - 2 || x > x1 + 2 || z < z0 - 2 || z > z1 + 2) continue;
          ctx.fillStyle = 'rgba(16,24,18,.7)';
          ctx.beginPath();
          ctx.arc(x, z, 1.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = STAKE_COLOURS[colour] ?? STAKE_COLOURS.w;
          ctx.beginPath();
          ctx.arc(x, z, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.setLineDash([6, 4]);
      stroke(layers.outOfBounds, STAKE_COLOURS.w, () => 0.9);
      ctx.setLineDash([]);
      return { colour: canvas, mask: paintMask(node, canopied ? surface(size).trees : null) };
    },
  };
}
