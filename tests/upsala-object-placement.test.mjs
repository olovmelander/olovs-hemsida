import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

// The standalone page intentionally carries this dependency-free helper inline.
// Verify parity, then exercise its selection decisions rather than Three.js meshes.
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const selectors = source => source.split('/*@MAPPED_OBJECT_SELECTORS*/')[1].split('/*@/MAPPED_OBJECT_SELECTORS*/')[0];
const source = selectors(read('apps/golf/src/main.js'));
const { mappedPowerSupports, mappedPointObjects } = new Function(`${source}; return { mappedPowerSupports, mappedPointObjects };`)();
const osm = JSON.parse(read('upsalabuild/osm-features.json'));

describe('evidence-only Upsala object selection', () => {
  it('keeps the app and standalone selection contracts identical', () => {
    expect(selectors(read('upsala3d.html'))).toBe(source);
  });

  it('uses explicit support tags even when voltage is absent and ignores untagged way vertices', () => {
    const power = { towers: [[0, 0]], poles: [[20, 0], [0, 0]],
      lines: [{ voltage: null, line: [[0, 0], [10, 0], [20, 0]] }] };
    const supports = mappedPowerSupports(power);
    expect(supports.map(p => [p.kind, p.c])).toEqual([['tower', [0, 0]], ['pole', [20, 0]]]);
    expect(power.lines[0].line).toHaveLength(3);
    expect(() => mappedPowerSupports({ towers: [[NaN, 0]] })).toThrow(/Invalid mapped power support/);
  });

  it('retains all seven mapped towers and fourteen poles at their recorded coordinates', () => {
    const supports = mappedPowerSupports(osm.power);
    expect(supports.filter(s => s.kind === 'tower').map(s => s.c)).toEqual(osm.power.towers);
    expect(supports.filter(s => s.kind === 'pole').map(s => s.c)).toEqual(osm.power.poles);
    expect(supports.filter(s => s.kind === 'tower')).toHaveLength(7);
    expect(supports.filter(s => s.kind === 'pole')).toHaveLength(14);
  });

  it('selects seven tagged objects without duplicating the 228 OSM trees over LiDAR crowns', () => {
    expect(osm.points).toHaveLength(235);
    const selected = mappedPointObjects(osm.points);
    expect(selected).toHaveLength(7);
    expect(selected.map(p => p.kind).sort()).toEqual(['flagpole', 'fountain', 'fountain', 'fountain', 'gate', 'gate', 'mast']);
    for (const p of selected) expect(p.c).toEqual(osm.points.find(o => o.id === p.id).c);
    expect(mappedPointObjects([...osm.points, osm.points.find(p => p.tags.man_made === 'flagpole')])).toHaveLength(7);
  });
});
