/* The retone is applied by MATERIAL NAME, and the asset it reads is re-exported
   from Blender by hand. So the failure that matters is silent: rename
   `campus_gravel`, or add a seventh paved surface, and the pass simply stops
   matching -- no error, no warning, and the car park is a white slab again.
   These tests read the published GLB and fail when that happens. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANGSO_GROUND_SURFACES } from './angso-ground-materials.mjs';

const root = new URL('../../../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('apps/golf/public/models/angso/facilities-v1.json', root), 'utf8'));
const glb = readFileSync(fileURLToPath(new URL(`apps/golf/public/models/angso/${manifest.asset.url.split('/').pop()}`, root)));

function readGlbJson(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let offset = 12; offset < buffer.byteLength;) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    offset += 8;
    if (type === 0x4e4f534a) return JSON.parse(buffer.slice(offset, offset + length).toString('utf8'));
    offset += length;
  }
  throw new Error('no JSON chunk');
}

const document = readGlbJson(glb);
const profileName = name => (name || '').replace(/^ANG MODEL\s*\d*\s*\|\s*/, '');
const toLinear = c => (c /= 255, c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgbLuminance = hex => 0.2126 * toLinear(hex >> 16 & 255) + 0.7152 * toLinear(hex >> 8 & 255) + 0.0722 * toLinear(hex & 255);
const factorLuminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* Triangles per material on every `site` group -- the paved ground, as opposed
   to a bollard or a charging post standing on it. */
function siteMaterialTriangles() {
  const totals = new Map();
  const accessor = document.accessors;
  const walk = index => {
    const node = document.nodes[index];
    if (node.mesh != null) for (const primitive of document.meshes[node.mesh].primitives) {
      const name = profileName(document.materials[primitive.material]?.name);
      const count = (primitive.indices != null ? accessor[primitive.indices].count : accessor[primitive.attributes.POSITION].count) / 3;
      totals.set(name, (totals.get(name) || 0) + count);
    }
    for (const child of node.children || []) walk(child);
  };
  for (const index of document.scenes[document.scene ?? 0].nodes) {
    if (document.nodes[index].extras?.kind === 'site') walk(index);
  }
  return totals;
}

/* Props that legitimately stand ON the hardstanding and must keep their own
   colours. Anything paved and NOT here has to be in the retone table. */
const PROPS = new Set(['metal', 'white', 'wood', 'wood_light', 'foundation', 'grass', 'range_turf',
  'mat_rubber', 'notice_cream', 'charging_green', 'charging_orange']);
const PAVED_TRIANGLE_FLOOR = 300;

describe('Ängsö authored ground materials', () => {
  it('covers every paved surface the published asset carries on a site group', () => {
    const totals = siteMaterialTriangles();
    const uncovered = [...totals]
      .filter(([name, triangles]) => triangles >= PAVED_TRIANGLE_FLOOR
        && !PROPS.has(name) && !(name in ANGSO_GROUND_SURFACES))
      .map(([name, triangles]) => `${name} (${Math.round(triangles)} triangles)`);
    expect(uncovered, 'a re-export added or renamed a paved surface the retone does not match').toEqual([]);
  });

  it('every retoned name is actually present, so the table cannot rot', () => {
    const totals = siteMaterialTriangles();
    for (const name of Object.keys(ANGSO_GROUND_SURFACES)) {
      expect(totals.has(name), `${name} is retoned but no longer exists in the asset`).toBe(true);
    }
  });

  it('darkens each surface into the reviewed band instead of Blender pale', () => {
    for (const [name, spec] of Object.entries(ANGSO_GROUND_SURFACES)) {
      const authored = document.materials.find(material => profileName(material.name) === name);
      const factor = authored.pbrMetallicRoughness.baseColorFactor.slice(0, 3);
      const before = factorLuminance(factor), after = srgbLuminance(spec.colorSrgb);
      // The bug: Blender's sheet sits in the .30-.60 linear band and renders pale.
      expect(before, `${name} is no longer the pale export this retone exists for`).toBeGreaterThan(0.2);
      expect(after, `${name} is not darker than the authored value`).toBeLessThan(before);
      // Veckefjärden's reviewed paving spans .107-.151 linear; stay in that band.
      expect(after).toBeGreaterThan(0.09);
      expect(after).toBeLessThan(0.17);
    }
  });
});
