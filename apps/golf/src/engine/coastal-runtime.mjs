/* Keep ocean height and coverage in the same rendered frame as the terrain. */
export function coastalWorldBounds(bounds, origin, bridge) {
  const points=[];
  for(const e of [bounds.minEasting,bounds.maxEasting])for(const n of [bounds.minNorthing,bounds.maxNorthing])
    points.push(bridge.toLegacy(e-origin.easting,origin.northing-n));
  return {x0:Math.min(...points.map(p=>p[0])),x1:Math.max(...points.map(p=>p[0])),
    z0:Math.min(...points.map(p=>p[1])),z1:Math.max(...points.map(p=>p[1]))};
}

export function seaLevelInWorld(levelRH2000, bridge) {
  const offset=bridge?.verticalDatumOffsetMetres??0;
  if(!Number.isFinite(levelRH2000)||!Number.isFinite(offset))throw new TypeError('Sea level and datum offset must be finite');
  return levelRH2000+offset;
}

/* Ocean has one surface. Remove its cells from the independent lake detector
 * before bed carving, colour classification and flat-sheet construction. */
export function excludeOceanFromFlatWater(flat, ocean, toLegacy) {
  const mask=flat.mask.slice(),label=flat.label.slice(),remaining=new Map();
  const levels=new Map(flat.components.map(c=>[c.id,c.level]));
  let excludedCells=0;
  for(let row=0;row<flat.height;row++)for(let col=0;col<flat.width;col++) {
    const i=row*flat.width+col;
    if(!label[i])continue;
    const [x,z]=toLegacy(flat.x0+(col+.5)*flat.spacing,flat.z0+(row+.5)*flat.spacing);
    // A low dry skerry is not a separate lake. The old flat detector split
    // its sloping DTM into several stepped sheets near sea level.
    const drySkerry=levels.get(label[i])<=ocean.seaLevel+1&&ocean.isIslandAt?.(x,z);
    if(ocean.isSeaAt(x,z)||drySkerry){mask[i]=0;label[i]=0;excludedCells++;continue;}
    const count=remaining.get(label[i])||{cells:0,uncoveredCells:0};
    count.cells++;if(mask[i])count.uncoveredCells++;
    remaining.set(label[i],count);
  }
  const components=flat.components.flatMap(c=>{
    const count=remaining.get(c.id);
    // Removing the sea can leave a handful of shoreline samples from a huge
    // component. They no longer meet the detector's 300-cell lake threshold.
    // Preserve independently known water and components untouched by this cut.
    if(count&&count.cells<c.cells&&count.cells===count.uncoveredCells&&count.cells<300)return [];
    return count?[{...c,...count,knownCells:count.cells-count.uncoveredCells,
      hectares:count.cells*flat.spacing*flat.spacing/10000}]:[];
  });
  const kept=new Set(components.map(c=>c.id));
  for(let i=0;i<label.length;i++)if(label[i]&&!kept.has(label[i])){mask[i]=0;label[i]=0;}
  const cell=(x,z)=>{
    const col=Math.floor((x-flat.x0)/flat.spacing),row=Math.floor((z-flat.z0)/flat.spacing);
    return col>=0&&row>=0&&col<flat.width&&row<flat.height?row*flat.width+col:-1;
  };
  return {...flat,mask,label,components,excludedOceanCells:excludedCells,
    isWaterAt:(x,z)=>mask[cell(x,z)]===1,isFlatAt:(x,z)=>kept.has(label[cell(x,z)])};
}
