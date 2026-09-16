import fs from 'node:fs';
import path from 'node:path';
import {OUT,ROOT,json,save} from './preview.mjs';
import {readChunk} from '../../packages/course-v2/chunk-node.mjs';
import {courseExclusionFeatures,EXCLUSION_REASONS} from '../../packages/course-v2/vegetation/semantic-exclusions.mjs';
import {reviewedPlayingAreas} from '../../visbybuild/mapping/orthophoto-vegetation.mjs';

const geometry=json(path.join(ROOT,'geo_data/course-v2/visby/migration/course-model.epsg3006.json')).geometry;
const features=courseExclusionFeatures(geometry);
const areas=reviewedPlayingAreas(json(path.join(ROOT,'visbybuild/mapping/orthophoto-review-2026.json')));
save(path.join(OUT,'exclusions.json'),{features,reasons:EXCLUSION_REASONS,reviewedPlayingAreas:areas,geometry});
const baseline=json(path.join(OUT,'baseline.json'));const metadata=[];
for(const tile of baseline.ground.tiles)if(tile.lod===0&&tile.layers.stands){
 const chunk=readChunk(fs.readFileSync(path.join(OUT,'before',tile.layers.stands.url)));
 const file=tile.id.replaceAll('/','-')+'.u8';
 fs.mkdirSync(path.join(OUT,'stand-inputs'),{recursive:true});fs.writeFileSync(path.join(OUT,'stand-inputs',file),chunk.payload);
 metadata.push({tile,header:chunk.header,file});
}
save(path.join(OUT,'stand-inputs/index.json'),metadata);
console.log('Exported immutable stand fields and source exclusions');
