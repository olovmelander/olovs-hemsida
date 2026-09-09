/* Display positions are provisional, separate from inherited tee-colour
 * references. They cannot establish a permanent marker or scorecard survey. */
import {pointInPoly,centroid} from '../lib.mjs';

const distance2=(a,b)=> (a[0]-b[0])**2+(a[1]-b[1])**2;
function edgeDistance(p,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
function candidates(ring) {
  const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
  const nx=Math.max(8,Math.min(60,Math.ceil((x1-x0)/.3))),nz=Math.max(8,Math.min(60,Math.ceil((z1-z0)/.3)));
  const points=[centroid(ring)];
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)points.push([x0+(i+.5)*(x1-x0)/nx,z0+(j+.5)*(z1-z0)/nz]);
  const interior=points.filter(p=>pointInPoly(...p,ring)).map(p=>({p,clearance:Math.min(...ring.map((a,i)=>edgeDistance(p,a,ring[(i+1)%ring.length])))}));
  if(!interior.length)throw new Error('Physical tee has no interior display point');
  const maximum=Math.max(...interior.map(c=>c.clearance));
  return interior.filter(c=>c.clearance>=Math.min(1.2,maximum*.8));
}

export function assignTeeDisplayAnchors(hole) {
  const pads=hole.tees.pads;
  const options=pads.map(p=>candidates(p.ring));
  for(const mark of hole.tees.marks) {
    // First choose the closest physical platform, then a point safely inside.
    const nearest=options.map((points,index)=>({index,point:points.reduce((a,b)=>distance2(a.p,mark.c)<distance2(b.p,mark.c)?a:b)}))
      .sort((a,b)=>distance2(a.point.p,mark.c)-distance2(b.point.p,mark.c))[0];
    const selected=nearest.point.p.map(v=>Number(v.toFixed(3)));
    if(!pointInPoly(...selected,pads[nearest.index].ring))throw new Error('Rounded tee display point left its physical platform');
    mark.displayC=selected;
    mark.displayPadIndex=nearest.index;
  }
  hole.tees.markerPositionStatus='provisional display anchors on nearest mapped physical platforms; original c retains inherited scorecard references; official colour ownership and daily marker positions unverified';
  hole.tees.status='provisional-display-anchors-colour-ownership-unverified';
  return hole;
}
