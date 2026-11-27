/* Each house's roof in the colour Lantmäteriet's orthophoto shows, as the detailed
   course gives it (engine/house-kit.mjs measuredRoofs; owner, 27 November: the two modes
   one in what they show, each drawn for its device).

   The records are the detailed course's own (engine/scenery/<ground>-roof-colours.json,
   from geobuild/facilities/roof-colours.py): a roof by building index, kept only while
   the footprint is the one it was read from. The check and the easing are the house
   kit's, restated here because that module brings three.js: map-roof-colours.test.mjs
   holds them equal. The map draws in display colour, so the eased roof goes back there. */

/* FNV-1a over the ring's JSON: house-kit.mjs ringCheck. */
export function ringCheck(ring) {
  const text = JSON.stringify(ring);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* house-kit.mjs ROOF_EASE and roofAlbedo: a photographed roof is its paint under a June
   sun through haze, eased above a knee toward a ceiling, its chroma given back. */
export const ROOF_EASE = Object.freeze({ knee: 0.22, ceiling: 0.34, chroma: 1.3 });
const lumOf = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export function roofAlbedo(rgb) {
  const lum = lumOf(rgb), { knee, ceiling, chroma } = ROOF_EASE;
  const eased = lum <= knee ? lum : knee + (ceiling - knee) * (1 - Math.exp(-(lum - knee) / (ceiling - knee)));
  const k = lum > 0 ? eased / lum : 1;
  return rgb.map(v => Math.max(0, eased + (v * k - eased) * chroma));
}

const toLinear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toDisplay = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export const linear = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(c => toLinear(c / 255));

/* The roofs by building index, each with the footprint check it holds for and its eased
   colour in display terms, as the map's houses take their colours. */
export function roofTable(record) {
  const out = new Map();
  if (record?.schemaVersion !== 2 || !Array.isArray(record.roofs)) return out;
  for (const [index, check, roof] of record.roofs) {
    if (!Number.isInteger(index) || !/^#[0-9a-f]{6}$/.test(roof)) continue;
    out.set(index, { check, roof: roofAlbedo(linear(parseInt(roof.slice(1), 16))).map(v => Math.min(1, toDisplay(v))) });
  }
  return out;
}

/* A house's measured roof, or null: by its index in the layout's buildings, while its
   footprint is the one the colour was read from. */
export function roofFor(table, structure) {
  const entry = Number.isInteger(structure.index) ? table?.get(structure.index) : null;
  return entry && entry.check === structure.check ? entry.roof : null;
}

/* One small file a ground, fetched with the map's code when its course opens. */
const RECORDS = import.meta.glob('../engine/scenery/*-roof-colours.json', { import: 'default' });
export async function loadRoofColours(groundId) {
  const load = RECORDS[`../engine/scenery/${groundId}-roof-colours.json`];
  return load ? roofTable(await load()) : new Map();
}
