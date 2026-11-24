/* A light staging public root for Bro Hof (review-2026-11-24): every course's manifests (publish-vegetation resolves each
   root course) and Bro Hof's own ground and courses, copied from apps/golf/public into
   output/course-workflow/bro-hof/staging-public. Nothing under apps/ is written.
   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/light-staging.mjs */
import fs from 'node:fs';
import path from 'node:path';

const live = 'apps/golf/public', staging = 'output/course-workflow/bro-hof/staging-public';
fs.rmSync(staging, { recursive: true, force: true });
const copy = url => { const to = path.join(staging, url); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(live, url), to); };
for (const f of fs.readdirSync(path.join(live, 'courses'))) if (f.endsWith('.json')) copy(`courses/${f}`);
const root = JSON.parse(fs.readFileSync(path.join(live, 'courses/v2-index.json'), 'utf8'));
let files = 0;
for (const entry of root.courses) {
  copy(entry.manifest.url); files++;
  const course = JSON.parse(fs.readFileSync(path.join(live, entry.manifest.url), 'utf8'));
  copy(course.groundManifest.url); files++;
}
for (const dir of ['grounds/bro-hof', 'courses/bro-hof-stadium', 'courses/bro-hof-castle']) { fs.cpSync(path.join(live, dir), path.join(staging, dir), { recursive: true }); }
console.log(`light staging: ${root.courses.length} course entries, Bro Hof complete (${files} manifests)`);
