/* Inertial response around the Blender guide. The previous pose and velocity
   live in the flag's local frame; rebase them when the sleeve turns so that
   the fly keeps its world-space momentum. No per-frame allocations. */
import { relaxFlagClothPose, flagBendingWeight } from './flag-cloth.mjs';

export function createFlagDynamics(grid) {
  const count=grid.nx*grid.nz*3;
  return { positions:new Float32Array(count), velocity:new Float32Array(count),
    predicted:new Float32Array(count), previousGuide:new Float32Array(count), yaw:0, time:null };
}

export function stepFlagDynamics(grid, state, guide, motion, deterministic=false, finish=null) {
  const yaw=motion.yaw+motion.swing, elapsed=state.time===null ? 0 : motion.clock-state.time;
  const p=state.positions,v=state.velocity,previousGuide=state.previousGuide;
  const bending=flagBendingWeight(motion.ms);
  if (deterministic || state.time===null || elapsed>0.25 || elapsed<0) {
    // Cold poses need more passes; live frames start from the preceding cloth.
    p.set(guide); v.fill(0); relaxFlagClothPose(grid,p,24,finish,bending);
  } else if (elapsed>0) {
    const delta=state.yaw-yaw,c=Math.cos(delta),s=Math.sin(delta);
    // Rotate about the pole axis, not the sewn edge: the whole sleeve has moved.
    for(let k=0;k<p.length;k+=3) {
      const x=p[k],z=p[k+2],vx=v[k],vz=v[k+2],gx=previousGuide[k],gz=previousGuide[k+2];
      p[k]=x*c+z*s; p[k+2]=-x*s+z*c;
      v[k]=vx*c+vz*s; v[k+2]=-vx*s+vz*c;
      previousGuide[k]=gx*c+gz*s; previousGuide[k+2]=-gx*s+gz*c;
    }
    // Solve each spring against the guide moving between its last two samples.
    // Treating the newest guide as stationary throughout the interval makes
    // fast flutter lead its target at 15/30 Hz and changes the visible motion.
    // The reinforced hoist reacts quickly; the light fly has more travel time.
    for(let i=0;i<grid.nx;i++) {
      const u=i/(grid.nx-1), omega=140-(70-25*Math.min(motion.ms/12,1))*u;
      const decay=Math.exp(-omega*elapsed);
      for(let j=0;j<grid.nz;j++) {
        const start=(j*grid.nx+i)*3;
        for(let axis=0;axis<3;axis++) {
          const k=start+axis;
          if(i===0) { p[k]=guide[k]; v[k]=0; continue; }
          const guideVelocity=(guide[k]-previousGuide[k])/elapsed;
          // Damping acts on the cloth's own velocity. Including the guide's
          // velocity in damping would drag the fly during a sudden turn.
          const targetLag=2*guideVelocity/omega;
          const error=p[k]-previousGuide[k]+targetLag,relativeVelocity=v[k]-guideVelocity;
          const momentum=relativeVelocity+omega*error;
          p[k]=guide[k]-targetLag+(error+momentum*elapsed)*decay;
          v[k]=guideVelocity+(relativeVelocity-omega*momentum*elapsed)*decay;
        }
      }
    }
    state.predicted.set(p);
    relaxFlagClothPose(grid,p,8,finish,bending);
    // Constraint impulses affect the next frame, with damping to avoid pumping
    // energy into tightly folded cloth. Bound rebound after an abrupt reading.
    const impulse=0.2*(1-bending);
    for(let k=0;k<p.length;k++) v[k]=Math.max(-18,Math.min(18,v[k]+(p[k]-state.predicted[k])/elapsed*impulse));
  }
  if (finish) finish(grid,p);
  state.yaw=yaw; state.time=motion.clock;
  // Retain the unconstrained guide, not the projected/inertial display pose.
  previousGuide.set(guide);
  guide.set(p);
  return guide;
}
