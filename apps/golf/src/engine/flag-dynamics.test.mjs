import { describe,it,expect } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {decodeFlagCloth,sampleFlagCloth,flagClothIndex} from './flag-cloth.mjs';
import {FLAG_CLOTH_ASSET} from './flag-cloth-asset.mjs';
import {createFlagMotion,stepFlagMotion,flagBandBlend} from './flag-motion.mjs';
import {createFlagDynamics,stepFlagDynamics} from './flag-dynamics.mjs';
import {clearFlagPole} from './flag-appearance.mjs';

const cloth=await decodeFlagCloth(fs.readFileSync(new URL('../../public/'+FLAG_CLOTH_ASSET.path,import.meta.url)),async b=>zlib.inflateRawSync(b));
const grid=cloth.grid;
function setup() { return {motion:createFlagMotion(3,cloth.frames/cloth.fps),dynamics:createFlagDynamics(grid),out:new Float32Array(cloth.nv*3)}; }
function advance(rig,dt,wind,det=false) {
  const s=stepFlagMotion(rig.motion,dt,wind,det);
  sampleFlagCloth(cloth,flagBandBlend(cloth,s.ms,s.blend),s.poseTime,rig.out,false);
  stepFlagDynamics(grid,rig.dynamics,rig.out,s,det,clearFlagPole);
  return rig.out;
}
function area(p) {
  const {nx,nz}=grid; let sum=0;
  for(let j=1;j<nz;j++) for(let i=1;i<nx;i++) {
    const k=(j*nx+i)*3;
    for(const [a,b,c] of [[k,k-3,k-3*nx],[k-3,k-3-3*nx,k-3*nx]]) {
      const ax=p[b]-p[a],ay=p[b+1]-p[a+1],az=p[b+2]-p[a+2];
      const bx=p[c]-p[a],by=p[c+1]-p[a+1],bz=p[c+2]-p[a+2];
      sum+=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)/2;
    }
  }
  return sum/(grid.width*grid.height);
}

describe('inertial flag fabric',()=>{
  it('avoids sharp accordion wrinkles and jumps while a hanging flag moves',()=>{
    let maxBend=0,maxStep=0;
    for(const seed of [1,7,18]) {
      const rig=setup();rig.motion=createFlagMotion(seed,cloth.frames/cloth.fps);
      const previous=new Float32Array(rig.out.length);
      for(let f=0;f<900;f++) {
        const t=f/60,p=advance(rig,1/60,{ms:1.5+1.5*Math.sin(t*0.8),yaw:0.2*Math.sin(t*0.5)});
        if(f) for(let k=0;k<p.length;k+=3) maxStep=Math.max(maxStep,
          Math.hypot(p[k]-previous[k],p[k+1]-previous[k+1],p[k+2]-previous[k+2]));
        previous.set(p);
        if(f%6) continue;
        // Curvature in both fabric directions, excluding the sewn sleeve.
        for(let j=1;j<grid.nz-1;j++) for(let i=2;i<grid.nx;i++) {
          const k=(j*grid.nx+i)*3;
          for(const offset of i<grid.nx-1 ? [3,grid.nx*3] : [grid.nx*3]) {
            const ax=p[k]-p[k-offset],ay=p[k+1]-p[k-offset+1],az=p[k+2]-p[k-offset+2];
            const bx=p[k+offset]-p[k],by=p[k+offset+1]-p[k+1],bz=p[k+offset+2]-p[k+2];
            const cosine=(ax*bx+ay*by+az*bz)/Math.hypot(ax,ay,az)/Math.hypot(bx,by,bz);
            maxBend=Math.max(maxBend,Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI);
          }
        }
      }
    }
    expect(maxBend).toBeLessThan(75);
    expect(maxStep).toBeLessThan(0.025);
  });

  it('stays finite, attached and full-sized through gusts, reversals and lulls',()=>{
    const rig=setup(); let minArea=Infinity,maxArea=0,maxHoistError=0,minRadius=Infinity,maxStretch=0;
    const winds=[{ms:0,yaw:0},{ms:2,yaw:0},{ms:8,gust:14,yaw:0},
      {ms:16,yaw:Math.PI},{ms:24,yaw:-Math.PI/2},{ms:0,yaw:2}];
    for(const wind of winds) for(let f=0;f<150;f++) {
      const p=advance(rig,1/60,wind);
      expect(p.every(Number.isFinite)).toBe(true);
      if(f%10) continue;
      const ratio=area(p); minArea=Math.min(minArea,ratio); maxArea=Math.max(maxArea,ratio);
      for(let j=0;j<grid.nz;j++) {
        const k=j*grid.nx*3;
        maxHoistError=Math.max(maxHoistError,Math.abs(p[k]-grid.hoistX),Math.abs(p[k+1]-(grid.top-grid.height*j/(grid.nz-1))),Math.abs(p[k+2]));
        for(let i=1;i<grid.nx;i++) {
          const c=k+i*3;
          const distance=q=>Math.hypot(p[c]-p[q],p[c+1]-p[q+1],p[c+2]-p[q+2]);
          maxStretch=Math.max(maxStretch,distance(c-3)/(grid.width/(grid.nx-1)),j ? distance(c-grid.nx*3)/(grid.height/(grid.nz-1)) : 0);
          if(p[c+1]<=2.6) minRadius=Math.min(minRadius,Math.hypot(p[c],p[c+2]));
        }
      }
    }
    expect(minArea).toBeGreaterThan(0.95); expect(maxArea).toBeLessThan(1.08);
    expect(maxHoistError).toBeLessThan(0.00011); expect(minRadius).toBeGreaterThan(0.0269);
    expect(maxStretch).toBeLessThan(1.25);
  });

  it('keeps individual faces open without abrupt flips between moving wind bands',()=>{
    const indices=flagClothIndex(grid.nx,grid.nz);
    const restArea=grid.width*grid.height/(indices.length/3);
    for(const seed of [3,18]) for(const ms of [4,5,6,8]) {
      const rig=setup(); rig.motion=createFlagMotion(seed,cloth.frames/cloth.fps);
      const previousNormals=new Float64Array(indices.length);
      let minArea=Infinity,minDot=1,areaContext='',turnContext='';
      for(let frame=0;frame<540;frame++) {
        const p=advance(rig,1/60,{ms,yaw:0});
        for(let t=0;t<indices.length;t+=3) {
          const a=indices[t]*3,b=indices[t+1]*3,c=indices[t+2]*3;
          const ax=p[b]-p[a],ay=p[b+1]-p[a+1],az=p[b+2]-p[a+2];
          const bx=p[c]-p[a],by=p[c+1]-p[a+1],bz=p[c+2]-p[a+2];
          let x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;
          const length=Math.hypot(x,y,z),ratio=length*0.5/restArea;
          if(ratio<minArea) {
            minArea=ratio; areaContext=`seed ${seed}, ${ms} m/s, frame ${frame}, triangle ${t/3}`;
          }
          x/=length; y/=length; z/=length;
          const dot=x*previousNormals[t]+y*previousNormals[t+1]+z*previousNormals[t+2];
          if(frame && dot<minDot) {
            minDot=dot; turnContext=`seed ${seed}, ${ms} m/s, frame ${frame}, triangle ${t/3}`;
          }
          previousNormals[t]=x; previousNormals[t+1]=y; previousNormals[t+2]=z;
        }
      }
      // Total fabric area hid collapsing triangles and >150-degree normal
      // jumps in the previous independent moderate-wind bakes. Check each face
      // over motion, including startup and the loop seam, in the shipped mesh.
      const maxTurn=Math.acos(Math.max(-1,Math.min(1,minDot)))*180/Math.PI;
      expect(minArea,`collapsed face: ${areaContext}`).toBeGreaterThan(0.55);
      expect(maxTurn,`abrupt face turn: ${turnContext}`).toBeLessThan(90);
    }
  },15000);

  it('keeps the fly in world space as the sleeve changes its reference frame',()=>{
    const rig=setup();
    const s=rig.motion;
    s.ms=5; s.yaw=0; s.swing=0; s.clock=0;
    sampleFlagCloth(cloth,flagBandBlend(cloth,5),2,rig.out,false);
    stepFlagDynamics(grid,rig.dynamics,rig.out,s,false,clearFlagPole);
    const before=rig.out.slice();
    s.yaw=1; s.clock=0.001;
    sampleFlagCloth(cloth,flagBandBlend(cloth,5),2,rig.out,false);
    stepFlagDynamics(grid,rig.dynamics,rig.out,s,false,clearFlagPole);
    let displacement=0;
    for(let j=0;j<grid.nz;j++) {
      const k=(j*grid.nx+grid.nx-1)*3,p=rig.out;
      displacement=Math.max(displacement,Math.hypot(p[k]*Math.cos(1)+p[k+2]*Math.sin(1)-before[k],
        p[k+1]-before[k+1],-p[k]*Math.sin(1)+p[k+2]*Math.cos(1)-before[k+2]));
    }
    expect(displacement).toBeLessThan(0.035);
  });

  it('settles in calm and resets reproducibly for capture or a long hidden interval',()=>{
    const rig=setup();
    for(let i=0;i<180;i++) advance(rig,1/60,{ms:10,yaw:0});
    for(let i=0;i<900;i++) advance(rig,1/60,{ms:0,yaw:2});
    const settled=rig.out.slice();
    for(let i=0;i<60;i++) advance(rig,1/60,{ms:0,yaw:2});
    expect(Math.max(...rig.out.map((v,i)=>Math.abs(v-settled[i])))).toBeLessThan(0.001);
    const fresh=setup();
    advance(rig,1/30,{ms:7,yaw:1},true); advance(fresh,1/144,{ms:7,yaw:1},true);
    expect(rig.out).toEqual(fresh.out);
    expect(rig.dynamics.velocity.every(v=>v===0)).toBe(true);
    // Returning to live playback must not inherit a guide velocity from before
    // the deterministic reset, even after a different prior wind history.
    for(let i=0;i<12;i++) {
      advance(rig,1/60,{ms:7,yaw:1}); advance(fresh,1/60,{ms:7,yaw:1});
      expect(rig.out).toEqual(fresh.out);
    }
    rig.dynamics.time-=10;
    advance(rig,0,{ms:7,yaw:1});
    expect(rig.out.every(Number.isFinite)).toBe(true);
  });

  it('follows comparable trajectories through a full loop at different frame rates',()=>{
    const run=(fps,ms)=>{
      const rig=setup(),samples=[];
      for(let frame=0;frame<fps*6;frame++) {
        advance(rig,1/fps,{ms,yaw:0});
        // Common times, rather than just the final pose: a fast flag can pass
        // through the same endpoint despite visibly different motion before it.
        if((frame+1)%(fps/3)===0) samples.push(rig.out.slice());
      }
      return samples;
    };
    for(const ms of [0,2,5,12,24]) {
      const reference=run(144,ms);
      for(const fps of [15,30,60]) {
        const samples=run(fps,ms); let maxRms=0,maxVertex=0;
        for(let frame=0;frame<samples.length;frame++) {
          const p=samples[frame],r=reference[frame]; let squared=0;
          for(let k=0;k<p.length;k+=3) {
            const distance=Math.hypot(p[k]-r[k],p[k+1]-r[k+1],p[k+2]-r[k+2]);
            squared+=distance*distance; maxVertex=Math.max(maxVertex,distance);
          }
          maxRms=Math.max(maxRms,Math.sqrt(squared/p.length));
        }
        // Only the smallest, distant flags use 15 Hz; their fastest storm
        // flutter is necessarily less resolved than the nearby cloth.
        const distantStorm=fps===15 && ms===24;
        expect(maxRms,`${ms} m/s at ${fps} Hz`).toBeLessThan(distantStorm ? 0.06 : 0.025);
        expect(maxVertex,`${ms} m/s at ${fps} Hz`).toBeLessThan(distantStorm ? 0.24 : 0.1);
      }
    }
  },15000);

  it('gives comparable final cloth shapes at 15, 30, 60 and 144 Hz',()=>{
    const run=fps=>{
      const rig=setup();
      for(let i=0;i<fps*4;i++) advance(rig,1/fps,i<fps ? {ms:3,yaw:0} : {ms:8,yaw:1});
      return rig.out;
    };
    const reference=run(144);
    for(const fps of [15,30,60]) {
      const result=run(fps);
      const rms=Math.sqrt(result.reduce((sum,x,i)=>sum+(x-reference[i])**2,0)/result.length);
      expect(rms).toBeLessThan(0.025);
    }
  });
});
