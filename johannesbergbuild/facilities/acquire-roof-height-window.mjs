/* Private bounded Laserdata reference, never an automatic building-height edit.
   node --env-file=.env johannesbergbuild/facilities/acquire-roof-height-window.mjs
   The source URL is pinned in the campaign inventory; only COPC ranges needed
   by the estate-hub window are read. No credentials enter evidence or logs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';
import { openItem, readWindow } from '../../packages/course-geo/copc-reader/copc-window.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const serviceHallOnly = process.argv.includes('--service-hall');
const OUT = path.join(ROOT, 'johannesbergbuild/cache/facilities-reference/laser', ...(serviceHallOnly ? ['service-hall'] : []));
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const campaignsPath='geo_data/course-v2/johannesberg/acquisition/laser-campaigns.json';
const sourceModelPath='johannesbergbuild/course-model.json';
const migrationPath='geo_data/course-v2/johannesberg/migration/course-model.epsg3006.json';
const local=read(sourceModelPath), projected=read(migrationPath).geometry;
const buildings = local.infra.buildings.map((b,index)=>({ ...b, index })).filter(b=>{
  if (serviceHallOnly) return b.id === 'w296165889';
  const c=b.ring.reduce((a,p)=>[a[0]+p[0]/b.ring.length,a[1]+p[1]/b.ring.length],[0,0]);
  return c[0]>-270 && c[0]<230 && c[1]>-1050 && c[1]<-715;
}).map(b=>({...b, ringEpsg3006:projected.infra.buildings.find(p=>p.id===b.id).ring}));
const vertices=buildings.flatMap(b=>b.ringEpsg3006);
const bbox=[Math.floor(Math.min(...vertices.map(p=>p[0]))-18),Math.floor(Math.min(...vertices.map(p=>p[1]))-18),Math.ceil(Math.max(...vertices.map(p=>p[0]))+18),Math.ceil(Math.max(...vertices.map(p=>p[1]))+18)];
const item=read(campaignsPath).items.find(i=>i.id==='21c039-662_67');
if (!(bbox[0]>=item.projBbox[0]&&bbox[1]>=item.projBbox[1]&&bbox[2]<=item.projBbox[2]&&bbox[3]<=item.projBbox[3])) throw Error('Window leaves pinned campaign');
const credentials=lantmaterietCredentials();
if (!credentials) throw Error('Configured Lantmateriet credentials are required');
fs.mkdirSync(OUT,{recursive:true});
try {
  const opened=await openItem({url:item.assets.data.href,headers:authorizationHeaders(credentials)});
  const {points,statistics}=await readWindow(opened,bbox);
  const columns=[['x','easting.f64'],['y','northing.f64'],['z','height-rh2000.f32'],['classification','classification.u8'],['returnNumber','return-number.u8'],['numberOfReturns','number-of-returns.u8']];
  const files=columns.map(([key,name])=>{
    const file=path.join(OUT,name),array=points[key];
    fs.writeFileSync(file,Buffer.from(array.buffer,array.byteOffset,array.byteLength));
    return {dimension:key,path:path.relative(ROOT,file).replaceAll('\\','/'),sha256:hash(file),bytes:fs.statSync(file).size,storage:array.constructor.name,littleEndian:true};
  });
  const evidence={schemaVersion:1,groundId:'johannesberg',acquiredOn:new Date().toISOString().slice(0,10),sourceModel:{path:sourceModelPath,sha256:hash(path.join(ROOT,sourceModelPath))},migration:{path:migrationPath,sha256:hash(path.join(ROOT,migrationPath))},campaignInventory:{path:campaignsPath,sha256:hash(path.join(ROOT,campaignsPath))},source:{itemId:item.id,url:item.assets.data.href,captureStart:item.captureStart,captureEnd:item.captureEnd,fullAssetSha256FromPinnedStac:item.assets.data.sha256,fullAssetHashVerified:false,fullAssetDownloaded:false,declaredPointDensityPerSquareMetre:item.declaredPointDensityPerSquareMetre,compoundCrs:'EPSG:5845',horizontalCrs:'EPSG:3006',verticalCrs:'EPSG:5613',verticalDatum:'RH 2000'},bboxEpsg3006:bbox,statistics,transfer:opened.transfer,files,buildings,privacy:'Raw point bytes remain in ignored local cache; reference evidence only, no redistribution or course geometry mutation.',method:'Repo bounded COPC reader; header-extent hierarchy convention; exact decoded node counts; real-coordinate window filter.'};
  fs.writeFileSync(path.join(OUT,'window.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({bbox,buildings:buildings.length,statistics,transfer:opened.transfer},null,2));
} catch(error) {
  // Never print an exception carrying headers, URLs with credentials, or env.
  console.error('Bounded facility laser extraction failed: '+String(error.message).replaceAll(credentials.username||'\0','<redacted>').replaceAll(credentials.password||'\0','<redacted>').replaceAll(credentials.bearer||'\0','<redacted>').slice(0,200));
  process.exitCode=1;
}
