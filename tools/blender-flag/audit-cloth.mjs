/* Measure the shipped asset, including areas lost to crossfades and stretch. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeFlagCloth, sampleFlagCloth, relaxFlagClothPose, flagBendingWeight } from '../../apps/golf/src/engine/flag-cloth.mjs';
import { flagBandBlend } from '../../apps/golf/src/engine/flag-motion.mjs';
import { clearFlagPole } from '../../apps/golf/src/engine/flag-appearance.mjs';
import { FLAG_CLOTH_ASSET } from '../../apps/golf/src/engine/flag-cloth-asset.mjs';
const cloth = await decodeFlagCloth(fs.readFileSync(new URL('../../apps/golf/public/'+FLAG_CLOTH_ASSET.path, import.meta.url)),
  async bytes=>new Uint8Array(zlib.inflateRawSync(bytes)));
const { nx, nz, width, height } = cloth.grid, comps = nx*nz*3;
const rows = cloth.bands.map(b => {
  let minPoleRadius=Infinity, maxStretch=0, minArea=Infinity, maxArea=0;
  const p=b.positions;
  const distance = (a,c) => Math.hypot(p[a]-p[c],p[a+1]-p[c+1],p[a+2]-p[c+2]);
  for(let f=0; f<cloth.frames; f++) {
    let area=0;
    for(let j=0; j<nz; j++) for(let i=0; i<nx; i++) {
      const k=f*comps+(j*nx+i)*3;
      if(i) minPoleRadius=Math.min(minPoleRadius,Math.hypot(p[k],p[k+2]));
      if(i) maxStretch=Math.max(maxStretch,distance(k,k-3)/(width/(nx-1)));
      if(j) maxStretch=Math.max(maxStretch,distance(k,k-3*nx)/(height/(nz-1)));
      if(i && j) {
        for(const [a,c,d] of [[k,k-3,k-3*nx],[k-3,k-3-3*nx,k-3*nx]]) {
          const ax=p[c]-p[a], ay=p[c+1]-p[a+1], az=p[c+2]-p[a+2];
          const bx=p[d]-p[a], by=p[d+1]-p[a+1], bz=p[d+2]-p[a+2];
          area+=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)/2;
        }
      }
    }
    minArea=Math.min(minArea,area); maxArea=Math.max(maxArea,area);
  }
  return {name:b.name,ms:b.ms,hangDeg:b.hangDeg,tailHz:b.tailHz,edgeSpeedMs:b.edgeSpeedMs,
    minPoleRadius,maxStretch,minAreaRatio:minArea/(width*height),maxAreaRatio:maxArea/(width*height)};
});
const blendAudit = { minAreaRatio: Infinity, maxAreaRatio: 0, ms:0, time:0, minPoleRadius: Infinity, maxStretch: 0, maxHoistDistanceM: 0 };
const pose = new Float32Array(comps);
for(let ms=0; ms<=28; ms+=0.25) for(let f=0; f<cloth.frames; f+=6) {
  const b=flagBandBlend(cloth,ms), time=(f+0.35)/cloth.fps;
  sampleFlagCloth(cloth,b,time,pose,false);
  relaxFlagClothPose(cloth.grid,pose,24,clearFlagPole,flagBendingWeight(ms));
  let area=0;
  for(let j=0; j<nz; j++) for(let i=1; i<nx; i++) {
    const k=(j*nx+i)*3;
    const distance=(a,c)=>Math.hypot(pose[a]-pose[c],pose[a+1]-pose[c+1],pose[a+2]-pose[c+2]);
    const stretch=Math.max(distance(k,k-3)/(width/(nx-1)),j ? distance(k,k-3*nx)/(height/(nz-1)) : 0);
    if(stretch>blendAudit.maxStretch) Object.assign(blendAudit,{maxStretch:stretch,stretchAt:{ms,time,i,j}});
    blendAudit.maxHoistDistanceM=Math.max(blendAudit.maxHoistDistanceM,distance(k,j*nx*3));
    if(pose[k+1]<=2.6) blendAudit.minPoleRadius=Math.min(blendAudit.minPoleRadius,Math.hypot(pose[k],pose[k+2]));
    if(!j) continue;
    for(const [a,c,d] of [[k,k-3,k-3*nx],[k-3,k-3-3*nx,k-3*nx]]) {
      const ax=pose[c]-pose[a],ay=pose[c+1]-pose[a+1],az=pose[c+2]-pose[a+2];
      const bx=pose[d]-pose[a],by=pose[d+1]-pose[a+1],bz=pose[d+2]-pose[a+2];
      area+=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)/2;
    }
  }
  const ratio=area/(width*height);
  blendAudit.maxAreaRatio=Math.max(blendAudit.maxAreaRatio,ratio);
  if(ratio<blendAudit.minAreaRatio) Object.assign(blendAudit,{minAreaRatio:ratio,ms,time});
}
const report={asset:FLAG_CLOTH_ASSET.path,bytes:FLAG_CLOTH_ASSET.bytes,grid:cloth.grid,fps:cloth.fps,frames:cloth.frames,blender:cloth.blender,bands:rows,blendAudit};
console.log(JSON.stringify(report,null,2));
if(process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
if(blendAudit.minAreaRatio<0.96 || blendAudit.maxStretch>1.17 || blendAudit.minPoleRadius<0.0269)
  throw new Error('Blended cloth exceeded the fabric/clearance limits');
