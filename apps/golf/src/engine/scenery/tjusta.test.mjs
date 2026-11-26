import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { loadCampusFacilities } from './campus-facilities.mjs';
import { GLOW } from '../glow.mjs';
import * as tjusta from './tjusta.js';

const PUBLIC = new URL('../../../public/', import.meta.url);
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const luminance = hex => [16, 8, 0].map(shift => ((hex >> shift) & 255) / 255)
  .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

describe('Tjusta\'s scenery', () => {
  it('draws tan sand, well under the glow', () => {
    expect(tjusta.groundAppearance.palette.sand).toBe(0xaa9d94);
    expect(luminance(tjusta.groundAppearance.palette.sand)).toBeLessThan(GLOW.threshold * 0.6);
  });

  it('carves its ponds with the world: the terrain was flown with them full', () => {
    expect(tjusta.deferWaterBedToWorld).toBe(true);
  });

  it('plants conifers in the woods and broadleaves round the farm', () => {
    const share = (x, z) => {
      let conifers = 0;
      for (let i = 0; i < 1000; i++) if (tjusta.species({ r: (i + 0.5) / 1000, x, z, extended: true }) < 2) conifers++;
      return conifers / 1000;
    };
    expect(share(-420, 500)).toBeCloseTo(0.72, 2);        // the big wood between the two halves
    expect(share(-15, -95)).toBeCloseTo(0.3, 2);          // the farm yard
    for (const r of [0, 0.3, 0.6, 0.9, 0.999]) expect([0, 1, 2, 3, 4]).toContain(tjusta.species({ r, x: 0, z: 0, extended: true }));
    for (const r of [0, 0.5, 0.999]) expect([0, 1, 2]).toContain(tjusta.species({ r, x: 0, z: 0 }));
  });

  it('keeps the barn windowless when the campus is not there', () => {
    expect(tjusta.clubhouse.windowRows).toEqual([]);
    expect(tjusta.architectureStatus().status).toBe('fallback');
  });
});

const published = new URL('models/tjusta/facilities-v1.json', PUBLIC);
describe.skipIf(!existsSync(published))('the published campus at Tjusta', () => {
  it('loads whole, and stands at the laser\'s levels', async () => {
    const manifest = JSON.parse(readFileSync(published, 'utf8')), data = readFileSync(new URL(manifest.asset.url, PUBLIC));
    const { buildings } = JSON.parse(readFileSync(new URL('../../../../../tjustabuild/course-model.json', import.meta.url), 'utf8')).infra;
    const scene = new THREE.Scene();
    const result = await loadCampusFacilities(tjusta.TJUSTA_CAMPUS, { THREE, scene, courseSlug: 'tjusta', buildings, terrainH: () => 20, v2Active: true,
      verticalDatumOffsetMetres: 0, baseUrl: 'https://example.test/golf/',
      fetchImpl: async url => (url.endsWith('.json') ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => arrayBuffer(data) }) });
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect([...result.replacedBuildingIds].sort()).toEqual(['w189730445', 'w293867832', 'w48232860', 'w48232863']);
    expect(result.report.triangles).toBeLessThan(20_000);
    const top = id => new THREE.Box3().setFromObject(result.root.children.find(c => c.userData.facilityId === id)).max.y;
    expect(top('clubhouse')).toBeCloseTo(33.69, 1);                       // the barn's ridge, in RH 2000
    expect(top('machine-hall')).toBeCloseTo(31.54, 1);
    expect(top('grey-hall')).toBeCloseTo(30.2, 1);
    expect(top('range-shelter')).toBeCloseTo(21.8, 1);
    const deck = manifest.facilities.find(f => f.id === 'clubhouse-terrace');
    expect(deck.evidence.levels).toMatch(/deck floor 22\.26/);
    expect(result.isFacilityInterior(669118.12 - 669130.5, 6611250.5 - 6611343.57)).toBe(true);   // under the barn's ridge
    expect(result.isFacilityInterior(0, 0)).toBe(false);
    result.dispose();
    expect(scene.children).toEqual([]);
  });

  it('names what each building was measured from, and what was not', () => {
    const manifest = JSON.parse(readFileSync(published, 'utf8'));
    for (const facility of manifest.facilities) {
      expect(facility.evidence.levels, facility.id).toMatch(/Laserdata Skog 2021-04-17/);
      expect(facility.evidence.estimated, facility.id).toBeTruthy();
    }
  });
});
