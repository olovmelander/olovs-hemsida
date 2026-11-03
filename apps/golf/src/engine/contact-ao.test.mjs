import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DepthTexture, PerspectiveCamera } from 'three/webgpu';
import { texture } from 'three/tsl';
import { CONTACT_AO, contactAoFor, createContactAO } from './contact-ao.mjs';

describe('contact shadows', () => {
  it('darkens only real contact, within a metre, at half resolution', () => {
    expect(CONTACT_AO.radius).toBeLessThanOrEqual(1);
    expect(CONTACT_AO.resolutionScale).toBe(0.5);
    expect(CONTACT_AO.contact[0]).toBeGreaterThan(0);
    expect(CONTACT_AO.contact[1]).toBeGreaterThan(CONTACT_AO.contact[0]);
    expect(CONTACT_AO.strength).toBeLessThanOrEqual(0.6);
    expect(contactAoFor('golden')).toBe(1);
  });
  it('builds GTAO on the scene depth and applies it to a colour', async () => {
    const camera = new PerspectiveCamera(48, 16 / 9, 0.5, 4000);
    const contact = await createContactAO({ depthNode: texture(new DepthTexture(4, 4)), camera });
    expect(contact.node.resolutionScale).toBe(0.5);
    expect(contact.node.radius.value).toBe(CONTACT_AO.radius);
    expect(typeof contact.apply).toBe('function');
    contact.setPreset('storm');
    contact.dispose();
  });
  it('is joined to the output in main.js before the bloom and the god rays, behind ?ao=0', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const CONTACT_AO_ON = new URLSearchParams\(location\.search\)\.get\('ao'\) !== '0';/);
    expect(main).toContain('const aoColor = contactAO ? contactAO.apply(sceneColor) : sceneColor;');
    /* the temporal AA blends the frames after the contact shadows (temporal-aa.mjs) */
    expect(main).toContain('const litColor = resolved ?? aoColor;');
    expect(main).toContain('const out = litColor.add(bloomNode);');
    expect(main).toContain('post.outputNode = vec4(litColor.rgb.add(godRays.node), litColor.a).add(bloomNode);');
    /* the bloom reads the scene's own colour */
    expect(main).toContain('const bloomNode = bloom(resolved ?? sceneColor, 0.14, GLOW.radius, GLOW.threshold);');
    /* declared before setPreset can reach it */
    expect(main.indexOf('let contactAO = null;')).toBeLessThan(main.indexOf('function setPreset('));
  });
});
