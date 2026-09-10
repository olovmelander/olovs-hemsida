import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const manifestPath=path.join(dir,'source-manifest.json');
const d=JSON.parse((await fs.readFile(manifestPath,'utf8')).replace(/^\uFEFF/,''));
const notes={
 'club-contact--497_VisbyGK_JacobSjoman_16BITS_V1-copy.jpg':['high','Aerial looking along the shore: clubhouse compound roof intersections, dormer, seaward terrace, two separate station houses, modern tower, detached dark outbuilding and parking hut. Capture date unknown.'],
 'club-contact--large-VisbyGC_JacobSjoman_20210615_3118_v1.jpg':['high','Station from course: red keeper house with glazed veranda, white Fyrhuset and cylindrical modern tower. Long lens; cannot measure absolute distances. Filename suggests 2021-06-15 but capture date not verified.'],
 'fyrhuset--308_VisbyGK_JacobSjoman_16BITS_V1-copy-1.jpg':['high','White Fyrhuset gable and modern tower; clear roof/chimney/lantern silhouette but warm directional light.'],
 'fyrhuset--725_Visby_GK_Jacob_Sjomanbild-2026-2-scaled.jpg':['medium','Wide station overview and course context; 2026 in filename is not confirmed capture date.'],
 'fyrhuset--790_VisbyGK_JacobSjoman_16BITS_V2crop-2.jpg':['high','Opposite oblique aerial showing clubhouse seaward end, terraces, station position and parking.'],
 'fyrhuset--668_VisbyGK_JacobSjoman_16BITS_V1copy.jpeg':['high','Fyrhuset sea bay exterior close-up: white vertical cladding, large glazing, dark rail and raised concrete/granite base.'],
 'fyrhuset--261_VisbyGK_JacobSjoman_16BITS_V1copy.jpeg':['medium','Station seen across course; proportions and placement of white cottage and tower.'],
 'fyrhuset--254_VisbyGK_JacobSjoman_16BITS_V1copy.jpeg':['medium','Interior-facing view through Fyrhuset bay, useful for bay glazing only.'],
 'fyrhuset--Fyrhuset-3-copy-scaled.jpg':['medium','Interior with tiled stove and kitchen; external architecture limited.'],
 'fyrhuset--Fyren15-scaled.jpeg':['medium','Interior shows bay glazing and wall/ceiling materials.'],
 'commons-clubhouse-2009.jpg':['high','Dated historical view from 18th green: compound gabled clubhouse, conservatory and roof materials. Do not use as proof of current landscaping.'],
 'semester--DSC4575.jpg':['high','Near frontal east view of white Fyrhuset and tower, plus cellar entrance at right: cottage gable door and stair, six-light window, small attic window, vertical boards, granite plinth; tower shaft, balcony, mainly solid octagonal lantern, pyramid roof and finial.'],
 'semester--DSC4580.jpg':['high','Best clubhouse daylight facade: west-facing cross-gable has two upper windows and several ground windows; restaurant wing has ribbed metal roof, prominent WSW dormer, glazed ground floor, low stone-walled paved terrace and glazed polygonal SSE conservatory. Tiny red shore hut visible. Orientation inferred by matching 2026 orthophoto.'],
 'semester--DJI_0028.jpg':['high','Drone compound overview, spring vegetation and area layout. Inspect full image for visibility limits before assigning dimensions.'],
 'semester--DJI_0016.jpg':['medium','Ground/low camera view approaching 18th green, clubhouse and dark detached building behind trees. Despite DJI name this is not an orthophoto.'],
 'semester--DSC4613.jpg':['medium','Interior looking through door onto paved terrace: tile joints, timber outdoor furniture, low stone wall and red shoreline shed.'],
 'semester--DSC4610.jpg':['medium','Restaurant interior establishes seaside window arrangement, fireplace, furniture and terrace wall; red shoreline shed in background.'],
 'semester--DSC4619.jpg':['low','Restaurant service counter interior, little exterior modelling information.'],
 'semester--DSC4605.jpg':['medium','Glazed entrance with frosted club marks, automatic door hardware and white lintel.'],
 'semester--DSC4601.jpg':['medium','Putting area near clubhouse: small red numbered flags, toy tractors, pine trees, gravel path and shore. Seasonal/movable objects are not survey controls.'],
 'semester--DSC4589.jpg':['medium','Black multiarm direction sign for 9/18-hole course, restaurant, reception, range and shop; location not independently registered.'],
 'semester--DSC4554.jpg':['medium','White Fyrhuset bay from inside: five visible glazing faces/segments and sea-facing balcony rail.'],
 'semester--DSC4421.jpg':['high','Second east/southeast view of Fyrhuset and tower: roof, rainwater goods, entrance stair, stone plinth and modern tower lantern details.'],
 'chab-kronholmen-survey-2016.pdf':['high','18-page architectural survey of historic station; July/August 2016 inspection. Page 7 material description, page 8 keeper-house verandas, page 10 north-up scale/photo-location plan, page 18 original 1892 keeper-house elevations and plan. No numerical house height or pitch measurements found.'],
};
for(const a of d.assets){
 const n=notes[a.localFile];
 a.modellingRelevance=n?.[0]??'low';
 a.visualReview=n?.[1]??'Screened in contact sheet or page gallery; product, food, generic golf/practice or distant course image, not reliable building-envelope evidence.';
 a.visualReviewDate='2026-09-10';
 if(a.status==='downloaded'){
  const b=await fs.readFile(path.join(dir,a.localFile));
  if(b.length!==a.bytes||crypto.createHash('sha256').update(b).digest('hex')!==a.sha256)throw new Error('Hash mismatch '+a.localFile);
 }
}
d.primaryBuildingReferences=d.assets.filter(a=>a.modellingRelevance==='high').map(a=>a.id);
d.summary={downloadedAssets:d.assets.filter(a=>a.status==='downloaded').length,downloadedBytes:d.assets.filter(a=>a.status==='downloaded').reduce((s,a)=>s+a.bytes,0),highRelevance:d.primaryBuildingReferences.length,sha256Verified:true};
d.failedDownloads??=[];
for(const n of ['DSC4439','DSC4377','DSC4325','DSC4280'])if(!d.failedDownloads.some(a=>a.imageUrl.endsWith('/'+n+'.jpg')))d.failedDownloads.push({imageUrl:'https://semesterisverige.nu/wp-content/uploads/2023/04/'+n+'.jpg',error:'HTTP 429 on initial gallery batch; not retried because required building evidence already obtained',attemptedDate:'2026-09-10'});
await fs.writeFile(manifestPath,JSON.stringify(d,null,2)+'\n');
console.log(d.summary);
