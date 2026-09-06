import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLightingEnvironment, deriveEnvironmentPalette, LIGHTING_ENVIRONMENT_INTENSITY } from './lighting-environment.mjs';

// Exercise the live presets: a second hand-maintained table could miss a change
// that makes the sky/reflection combination disagree again.
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const presetBlock = main.match(/const PRESETS = (\{[\s\S]*?\n\});/);
const PRESETS = Function(`return (${presetBlock[1]});`)();

function fixture(options = {}) {
  const scene = { environment: null };
  const targets = [];
  let generatorDisposals = 0;
  const baker = {
    bake(palette) {
      const target = {
        palette,
        texture: { id: targets.length },
        disposals: 0,
        dispose() {
          // Eviction must never leave a live scene sampling a released texture.
          expect(scene.environment).not.toBe(this.texture);
          this.disposals++;
        },
      };
      targets.push(target);
      return target;
    },
    dispose() { generatorDisposals++; },
  };
  const controller = createLightingEnvironment(null, scene, { baker, ...options });
  return { scene, targets, baker, controller, generatorDisposals: () => generatorDisposals };
}

describe('preset reflection palette', () => {
  it('preserves the exact original colours in baseline mode', () => {
    const palette = deriveEnvironmentPalette(PRESETS.golden, false);
    expect(Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, value.getHex()]))).toEqual({
      ground: 0x8fa88f, horizon: 0xcfe2e8, zenith: 0x3d7fb8,
    });
  });

  it('reflects golden/autumn warmth while noon and mist remain cool', () => {
    for (const name of ['golden', 'host']) {
      const { horizon, zenith } = deriveEnvironmentPalette(PRESETS[name]);
      expect(horizon.r).toBeGreaterThan(horizon.b);
      expect(zenith.b).toBeGreaterThan(zenith.r);
    }
    for (const name of ['noon', 'mist']) {
      const { horizon } = deriveEnvironmentPalette(PRESETS[name]);
      expect(horizon.b).toBeGreaterThan(horizon.r);
    }
  });

  it('keeps distinct dawn and golden palettes, valid linear colours and bright horizons', () => {
    const dawn = deriveEnvironmentPalette(PRESETS.dawn);
    const golden = deriveEnvironmentPalette(PRESETS.golden);
    expect(dawn.horizon.getHex()).not.toBe(golden.horizon.getHex());
    for (const preset of Object.values(PRESETS)) {
      const palette = deriveEnvironmentPalette(preset);
      for (const value of Object.values(palette)) {
        for (const channel of value.toArray()) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
      const brightness = value => value.r * 0.2126 + value.g * 0.7152 + value.b * 0.0722;
      expect(brightness(palette.horizon)).toBeGreaterThan(brightness(palette.zenith));
    }
  });
});

describe('lighting environment resource ownership', () => {
  it('bakes lazily, reuses current/recent presets, and evicts the least recently used map', () => {
    const { controller, scene, targets } = fixture();
    expect(targets).toHaveLength(0);
    const golden = controller.setPreset('golden', PRESETS.golden);
    expect(controller.setPreset('golden', PRESETS.golden)).toBe(golden);
    controller.setPreset('noon', PRESETS.noon);
    expect(controller.setPreset('golden', PRESETS.golden)).toBe(golden);
    controller.setPreset('dawn', PRESETS.dawn);
    expect(targets).toHaveLength(3);
    expect(targets.map(target => target.disposals)).toEqual([0, 1, 0]);
    expect(controller.snapshot().cachedPresets).toEqual(['golden', 'dawn']);
    expect(scene.environmentIntensity).toBe(LIGHTING_ENVIRONMENT_INTENSITY);
    controller.setPreset('noon', PRESETS.noon);
    expect(targets).toHaveLength(4);
    expect(targets[0].disposals).toBe(1);
  });

  it('keeps one unchanging map across all preset changes when disabled', () => {
    const { controller, targets, scene } = fixture({ enabled: false });
    for (const [name, preset] of Object.entries(PRESETS)) controller.setPreset(name, preset);
    expect(targets).toHaveLength(1);
    expect(scene.environment).toBe(targets[0].texture);
    expect(targets[0].palette.horizon.getHex()).toBe(0xcfe2e8);
  });

  it('releases every owned resource once and cannot bake after disposal', () => {
    const { controller, targets, generatorDisposals, scene } = fixture();
    for (const [name, preset] of Object.entries(PRESETS)) controller.setPreset(name, preset);
    controller.dispose();
    controller.dispose();
    expect(targets.every(target => target.disposals === 1)).toBe(true);
    expect(generatorDisposals()).toBe(1);
    expect(scene.environment).toBeNull();
    expect(() => controller.setPreset('noon', PRESETS.noon)).toThrow('disposed');
  });

  it('retains the last usable map if a later bake fails', () => {
    const { controller, scene, targets, baker } = fixture();
    const texture = controller.setPreset('golden', PRESETS.golden);
    baker.bake = () => { throw new Error('GPU allocation failed'); };
    expect(() => controller.setPreset('noon', PRESETS.noon)).toThrow('GPU allocation failed');
    expect(scene.environment).toBe(texture);
    expect(targets[0].disposals).toBe(0);
    expect(controller.snapshot().cachedPresets).toEqual(['golden']);
    controller.dispose();
  });
});
