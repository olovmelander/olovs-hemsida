import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Normalize checkout newlines so Windows publication and Linux deployment
// agree. Public artifacts are bound separately by the course/ground identities.
export function courseSourceRevision(root) {
  const files = [];
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (/\.(?:mjs|js)$/.test(name) && !/\.(?:node-)?test\.mjs$/.test(name)) files.push(name);
    }
  };
  // Standalone study/editor pages do not produce course ground colors and
  // may be edited independently while a publication is running.
  files.push('apps/golf/src/main.js');
  walk('apps/golf/src/engine'); walk('apps/golf/src/loader'); walk('packages/course-v2');
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')).update('\0');
  hash.update(JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/package.json'))).dependencies.three);
  return hash.digest('hex');
}
