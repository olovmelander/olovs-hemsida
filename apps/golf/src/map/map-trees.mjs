/* The simulator's trees, on the map.

   Where a tree stands, how tall it is and which species it is are all decided by
   the same code the 3D course runs (engine/v2-vegetation.mjs) on the same published
   LiDAR tiles, under the same local rules as main.js. So a tree on the map is the
   tree in the simulator, not a similar one. It is drawn as that tree's own impostor,
   baked from the player by tools/bake-map-trees.mjs: two triangles for each. */
import { hash2, ringSD } from '../engine/geom.js';
import { LANDCOVER, landcoverSampler } from '../engine/landcover.mjs';
import { planV2Vegetation, SPECIES_INDEX } from '../engine/v2-vegetation.mjs';
import { createWoodlandContextSampler, woodlandSpeciesPrior } from '../engine/woodland-context.mjs';
import { decodeStandField, STAND_FLAG_EXCLUDED, STAND_FLAG_MEASURED } from '../../../../packages/course-v2/stand-field.mjs';
import { sampleTile } from './map-height.mjs';
import catalogues from '../../public/models/map-trees.json';

export const TREE_FLOATS = 8;
const SHORE_REACH = [12, 26];

/* main.js's default, and the courses' own species rules. Copied rather than
   imported for the reason map-frames.mjs gives: a scenery module is part of the
   engine, and importing Veckefjärden's brought all of three.js with it. The same
   hands kept the numbers: map.test.mjs compares each with its original. */
const defaultTreeSpecies = r => (r < 0.58 ? SPECIES_INDEX.pine : r < 0.94 ? SPECIES_INDEX.spruce : SPECIES_INDEX.birch);
export const SPECIES_RULES = Object.freeze({
  angso: ({ r, h, extended = false }) => {
    if (h < 3) return r < 0.72 ? (extended && r < 0.4 ? 3 : 2) : 0;
    return r < 0.36 ? 0 : r < 0.68 ? 1 : (extended && r > 0.86 ? 4 : 2);
  },
  veckefjarden: ({ r, x, z, h, ringSD: signedDistance, RES, extended = false }) => {
    for (const rr of RES) {
      if (x < rr.bb.x0 || x > rr.bb.x1 || z < rr.bb.z0 || z > rr.bb.z1) continue;
      if (signedDistance(x, z, rr.ring) < 0) return extended ? (r < 0.5 ? 3 : r < 0.78 ? 2 : 0) : (r < 0.78 ? 2 : 0);
    }
    return h > 46 ? (r < 0.66 ? 0 : 1) : r < 0.44 ? 0 : r < 0.80 ? 1 : 2;
  },
  visby: ({ r, h }) => {
    if (h < 2.5) return r < 0.52 ? 1 : r < 0.94 ? 2 : 0;
    return r < 0.74 ? 1 : r < 0.94 ? 2 : 0;
  },
});

/* Only these two courses plant the extended species, so only they load them. */
export const speciesCount = slug => (/^(?:angso|veckefjarden)/.test(slug) ? 5 : 3);

export const catalogueFor = groundId => {
  const named = Object.values(catalogues.catalogues).find(entry => entry.grounds?.includes(groundId));
  return named ?? catalogues.catalogues.realistic;
};

export function createTreeRules(course) {
  const catalogue = catalogueFor(course.ground.groundId);
  const extended = catalogue.species.length > 3;
  const { easting, northing, heightRH2000 } = course.ground.frame.origin;
  const datum = heightRH2000 + course.frame.verticalDatumOffsetMetres;
  const hook = SPECIES_RULES[course.ground.groundId] ?? null;
  const woodlandAt = createWoodlandContextSampler(course.woodland, { toEpsg: (x, z) => [x + easting, northing - z] });
  const RES = course.reserves;
  const landAt = landcoverSampler(course.landcover);
  const mownAt = course.mown ? landcoverSampler(course.mown) : null;

  /* The same test main.js makes before a measured tree may stand: nothing on a
     played surface, by the course's own outlines, or on ground measured as mown. */
  const played = [...course.holes.flatMap(hole => [...hole.fairways, hole.green.ring, ...hole.teePads, ...hole.bunkers]),
    ...course.features.otherFairways, ...course.features.otherGreens, ...course.features.otherTees, ...course.features.otherBunkers]
    .map(ring => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return { ring, x0, z0, x1, z1 };
    });

  const species = ({ r, x, z, h }) => {
    const [px, pz] = course.frame.toPack(x, z);
    const prior = woodlandSpeciesPrior({ r, context: woodlandAt(x, z) });
    const own = hook?.({ r, x: px, z: pz, h: h + datum, ringSD, RES, extended });
    if (prior === 2 && extended && own >= 2) return own;
    const chosen = prior ?? own;
    return Number.isInteger(chosen) ? (chosen < catalogue.species.length ? chosen : 2) : chosen;
  };

  return {
    catalogue,
    species: hook || course.woodland ? species : null,
    defaultSpecies: defaultTreeSpecies,
    shoreDistanceAt(x, z) {
      for (const reach of SHORE_REACH) {
        for (let k = 0; k < 8; k++) {
          const [px, pz] = course.frame.toPack(x + Math.cos(k * 0.785) * reach, z + Math.sin(k * 0.785) * reach);
          if (landAt(px, pz) === LANDCOVER.WATER) return reach;
        }
      }
      return null;
    },
    excludeFor(node) {
      const near = played.filter(item => item.x1 >= node.x0 - 2 && item.x0 <= node.x0 + node.size + 2
        && item.z1 >= node.z0 - 2 && item.z0 <= node.z0 + node.size + 2);
      return (x, z) => {
        for (const item of near) if (ringSD(x, z, item.ring) < 1.2) return true;
        if (mownAt) {
          const [px, pz] = course.frame.toPack(x, z);
          return mownAt(px, pz) === 1;
        }
        return false;
      };
    },
  };
}

/* One tile's trees, in the map's world, packed for the GPU: x, ground, z, yaw, then
   crown scale, height scale, species and tone. */
export function plantTile({ node, heights, stand, objects, ground, rules }) {
  const { easting, northing } = ground.frame.origin;
  const loaded = {
    tiles: [{
      id: node.id,
      objects: objects ?? null,
      stands: stand ? decodeStandField(stand.payload, stand.section) : null,
      bounds: { minEasting: node.x0 + easting, maxNorthing: northing - node.z0 },
    }],
  };
  const { instances } = planV2Vegetation(loaded, {
    mapper: { toWorld: (e, n) => [e - easting, northing - n] },
    groundHeightAt: (x, z) => sampleTile(heights, (x - node.x0) / node.size, (z - node.z0) / node.size),
    shoreDistanceAt: rules.shoreDistanceAt,
    species: rules.species,
    defaultSpecies: rules.defaultSpecies,
    excludeAt: rules.excludeFor(node),
  });
  const templates = rules.catalogue.species;
  /* Shuffled, so a far tile can draw the first few and still be the same wood. */
  const order = instances.map((_, k) => k);
  for (let k = order.length - 1; k > 0; k--) {
    const swap = Math.floor(hash2(k, node.x0 + node.z0 * 3) * (k + 1));
    [order[k], order[swap]] = [order[swap], order[k]];
  }
  const out = new Float32Array(instances.length * TREE_FLOATS);
  order.forEach((index, k) => {
    const tree = instances[index], shape = templates[tree.species] ?? templates[0];
    out.set([tree.x, tree.y, tree.z, tree.rotation, tree.radius / shape.templateRadius, tree.height / shape.templateHeight,
      Math.min(tree.species, templates.length - 1), hash2(tree.x * 7, tree.z * 3)], k * TREE_FLOATS);
  });
  return out;
}

/* Where a tile's canopy lies, as alpha, from the same raster. */
export function canopyAlpha({ payload, width, height }) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let k = 0; k < width * height; k++) {
    const flags = payload[k * 4 + 3];
    if (!(flags & STAND_FLAG_MEASURED) || flags & STAND_FLAG_EXCLUDED) continue;
    /* Thin canopy is ground with a few trees on it, not forest. */
    out[k * 4 + 3] = Math.min(255, Math.max(0, payload[k * 4] - 26) * 1.5);
  }
  return out;
}

/* The baked pictures: colour and normals per species, as bitmaps a texture array
   takes. A tree that fails to load leaves the map its painted canopy. */
export async function loadTreeAtlases(catalogue, count, fetchFile) {
  const decode = async (file, premultiplyAlpha) => {
    const bytes = await fetchFile(file);
    return createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { premultiplyAlpha, colorSpaceConversion: 'none' });
  };
  const wanted = catalogue.species.slice(0, count);
  const [colours, normals] = await Promise.all([
    Promise.all(wanted.map(entry => decode(entry.colour, 'none'))),
    Promise.all(wanted.map(entry => decode(entry.normal, 'none'))),
  ]);
  const shapes = Array.from({ length: 6 }, (_, k) => {
    const entry = wanted[Math.min(k, wanted.length - 1)];
    return [entry.radius, entry.centreY, entry.height];
  });
  return { colours, normals, shapes, frameSize: catalogue.species[0].frameSize };
}
