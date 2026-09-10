import review from '../../../../nvgkbuild/mapping/storsanden-sand-review.json' with {type:'json'};
import {ringSDIndexed} from './ring-index.mjs';

export function createNorrfallsvikenCoastalSurfaces({origin,bridge}) {
  const a=review.geoTransform;
  const ring=review.pixelRing.map(([col,row])=>bridge.toLegacy(a[0]+col*a[1]-origin.easting,origin.northing-a[3]-row*a[5]));
  const bounds={x0:Math.min(...ring.map(p=>p[0]))-2,x1:Math.max(...ring.map(p=>p[0]))+2,
    z0:Math.min(...ring.map(p=>p[1]))-2,z1:Math.max(...ring.map(p=>p[1]))+2};
  return {ring,sourceId:review.sourceId,capturedAt:review.capturedAt,sandWeight(x,z) {
    if(x<bounds.x0||x>bounds.x1||z<bounds.z0||z>bounds.z1)return 0;
    const t=Math.max(0,Math.min(1,(1-ringSDIndexed(x,z,ring,2))/2));
    return t*t*(3-2*t);
  }};
}
