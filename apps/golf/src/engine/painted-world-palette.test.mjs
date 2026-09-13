import {describe,it,expect} from 'vitest';
import {Color} from 'three/webgpu';
import {ATMOSPHERE_PRESETS} from './atmosphere-presets.mjs';
import {PAINTED_ATMOSPHERES,PAINTED_GROUND,AUTUMN_FOLIAGE,paintedAtmosphere} from './painted-world-palette.mjs';
import {setPaintedWorldLighting,paintedSeason,paintedDirect,paintedWaterShallow,paintedWaterDeep,paintedWaterLight,paintedWaterSparkle,paintedTurfStrength,paintedGrassSheen} from './painted-world-lighting.mjs';
import {setFoliageLighting,foliageLight} from './ghibli-foliage-material.mjs';
import {createAtmosphericSky,setAtmospherePreset,atmosphereState} from './atmospheric-sky.mjs';

const luminance=hex=>{const c=new Color(hex);return c.r*.2126+c.g*.7152+c.b*.0722;};
describe('painted world palette',()=>{
  it('composes every atmosphere without changing the natural mode or sun positions',()=>{
    const original=structuredClone(ATMOSPHERE_PRESETS);
    expect(Object.keys(PAINTED_ATMOSPHERES).sort()).toEqual(Object.keys(original).sort());
    for(const [name,base] of Object.entries(ATMOSPHERE_PRESETS)){
      const p=paintedAtmosphere(name,base);
      expect(p.dir).toEqual(base.dir);
      expect(p.water.every(Number.isInteger)).toBe(true);
      expect(p.exp).toBeGreaterThan(0);
      expect(p.foliage.direct).toBeGreaterThanOrEqual(0);
      expect(p.foliage.direct).toBeLessThanOrEqual(1);
    }
    expect(ATMOSPHERE_PRESETS).toEqual(original);
  });
  it('switches all eight palettes and back without rebuilding sky or water uniforms',()=>{
    const sky=createAtmosphericSky({deterministic:true,painted:true});
    const node=sky.material.colorNode,geometry=sky.geometry;
    const shallow=paintedWaterShallow.value,deep=paintedWaterDeep.value,foliage=foliageLight.value;
    try{
      for(const name of [...Object.keys(ATMOSPHERE_PRESETS),'golden','host','golden','noon']){
        const p=paintedAtmosphere(name,ATMOSPHERE_PRESETS[name]);
        setPaintedWorldLighting(p,name);setFoliageLighting(p);setAtmospherePreset(sky,p);
        expect(paintedSeason.value).toBe(name==='host'?1:0);
        expect(paintedTurfStrength.value).toBe(name==='noon'?.85:1);
        expect(paintedGrassSheen.value).toBeGreaterThan(0);
        expect(atmosphereState(sky).sunGlowStrength>0).toBe(name==='golden');
        expect(paintedWaterShallow.value).toBe(shallow);expect(paintedWaterDeep.value).toBe(deep);
        expect(foliageLight.value).toBe(foliage);
        expect(shallow.getHex()).toBe(p.water[0]);expect(deep.getHex()).toBe(p.water[1]);
        expect(sky.material.colorNode).toBe(node);expect(sky.geometry).toBe(geometry);
        expect(atmosphereState(sky).cloudSpeed).toBe(0);
        expect(paintedWaterLight.value).toBeGreaterThan(0);
      }
      expect(paintedSeason.value).toBe(0);
    }finally{sky.geometry.dispose();sky.material.dispose();}
  });
  it('removes directional hot spots and water sparkle under diffuse lighting',()=>{
    for(const name of ['bluehour','storm','mist']){
      const p=paintedAtmosphere(name,ATMOSPHERE_PRESETS[name]);
      setPaintedWorldLighting(p,name);setFoliageLighting(p);
      expect(paintedDirect.value).toBeLessThan(.2);
      expect(paintedWaterSparkle.value).toBeLessThan(.1);
      expect(foliageLight.value.r).toBeLessThan(PAINTED_ATMOSPHERES.noon.foliage.strength);
    }
  });
  it('keeps readable warm sand, cool putting greens and darker woodland',()=>{
    const c=Object.fromEntries(Object.entries(PAINTED_GROUND).map(([k,v])=>[k,new Color(v)]));
    expect(luminance(PAINTED_GROUND.sand)).toBeGreaterThan(luminance(PAINTED_GROUND.fair)*2);
    expect(luminance(PAINTED_GROUND.canopy)).toBeLessThan(luminance(PAINTED_GROUND.rough));
    expect(c.green.b/c.green.g).toBeGreaterThan(c.fair.b/c.fair.g*1.5);
    expect(Math.max(c.gravel.r,c.gravel.g,c.gravel.b)-Math.min(c.gravel.r,c.gravel.g,c.gravel.b)).toBeLessThan(.05);
  });
  it('reserves gold, orange and crimson families for deciduous trees',()=>{
    expect(AUTUMN_FOLIAGE.gran).toBeUndefined();expect(AUTUMN_FOLIAGE.tall).toBeUndefined();
    for(const {ramps} of Object.values(AUTUMN_FOLIAGE))for(const ramp of ramps){
      expect(luminance(ramp[1])).toBeGreaterThan(luminance(ramp[0])*1.5);
      expect(luminance(ramp[2])).toBeGreaterThan(luminance(ramp[1])*1.3);
    }
    const gold=new Color(AUTUMN_FOLIAGE.bjork.ramps[0][1]);
    const red=new Color(AUTUMN_FOLIAGE.ek.ramps[2][1]);
    expect(gold.g/gold.r).toBeGreaterThan(.4);
    expect(red.r).toBeGreaterThan(red.g*4);
  });
});
