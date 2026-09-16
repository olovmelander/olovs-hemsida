// Current Node crown detector, independent of the reference annotations.
import fs from 'node:fs';
import path from 'node:path';
import {OUT,json,save} from './preview.mjs';
import {readRawRaster} from '../../packages/course-v2/vegetation/compile-vegetation.mjs';
import {createRaster,fillSingleCellVoids,medianFilter3x3,voidMask} from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import {deriveCrownCandidates,CROWN_PARAMETERS} from '../../packages/course-v2/vegetation/crown-detect.mjs';

const evidence=json(path.join(OUT,'canopy-evidence.json'));
const rasters=evidence.campaigns.map(c=>readRawRaster(c.files.chm.data,c.files.chm.sidecar));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]};
const scenesFile=option('--scenes',path.join(OUT,'scenes.json'));
const outputDirectory=option('--out',path.join(OUT,'detections'));
for(const scene of json(scenesFile)) {
  const size=scene.size+40, grid=rasters[0];
  const originEasting=grid.originEasting+Math.floor(scene.easting-size/2-grid.originEasting);
  const originNorthing=grid.originNorthing-Math.floor(grid.originNorthing-scene.northing-size/2);
  const width=Math.ceil(scene.easting+size/2-originEasting),height=Math.ceil(originNorthing-scene.northing+size/2);
  const heights=createRaster({width,height,sampleSpacingMetres:1,originEasting,originNorthing,values:new Float32Array(width*height).fill(NaN)});
  for(let r=0;r<height;r++)for(let c=0;c<width;c++)for(const src of rasters) {
    const sc=Math.floor((originEasting+c+.5-src.originEasting)/src.sampleSpacingMetres),sr=Math.floor((src.originNorthing-originNorthing+r+.5)/src.sampleSpacingMetres);
    if(sc>=0&&sr>=0&&sc<src.width&&sr<src.height){const h=src.values[sr*src.width+sc];if(Number.isFinite(h))heights.values[r*width+c]=h;}
  }
  const voids=voidMask(heights),filled=fillSingleCellVoids(heights),detection=medianFilter3x3(filled.raster??filled);
  const result=deriveCrownCandidates({heights,detection,voids,parameters:CROWN_PARAMETERS});
  const directory=outputDirectory;fs.mkdirSync(directory,{recursive:true});
  // Core labels are used consistently for all methods; extended crown labels remain available for review.
  fs.writeFileSync(path.join(directory,scene.id+'-node-current.i32'),Buffer.from(result.labels.buffer));
  save(path.join(directory,scene.id+'-node-current.json'),{...scene,width,height,originEasting,originNorthing,spacing:1,parameters:CROWN_PARAMETERS,crowns:result.crowns});
  console.log('Node completed',scene.id);
}
