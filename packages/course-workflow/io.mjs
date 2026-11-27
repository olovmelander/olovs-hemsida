import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { relativePath } from './standard.mjs';
export const digest = v => createHash('sha256').update(v).digest('hex');
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const hashObject = v => digest(stable(v));
export function safePath(root, relative) {
  if (!relativePath(relative)) throw new Error(`unsafe repository path: ${relative}`);
  const base = fs.realpathSync(root);
  let cursor = base;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`symlinks are not accepted as workflow inputs/outputs: ${relative}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return cursor;
}
const TEXT = /\.(?:json|geojson|md|txt|csv|mjs|js|ts|css|html|yaml|yml|toml|py|svg)$/;
export function fileDigest(root, relative) {
  const bytes = fs.readFileSync(safePath(root, relative));
  return digest(TEXT.test(relative) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
}
export const readJson = (root, relative) => JSON.parse(fs.readFileSync(safePath(root, relative), 'utf8'));
export function writeJson(root, relative, value, { exclusive = false } = {}) {
  const file = safePath(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exclusive) fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  else {
    const tmp = file + `.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    try { fs.renameSync(tmp, file); } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
}
const IGNORE = new Set(['node_modules', '.git', '.cache', '.pixi', 'cache', '__pycache__']);
export function inventory(root, paths) {
  const files = {};
  function visit(relative) {
    const file = safePath(root, relative);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      const children = fs.readdirSync(file).filter(x => !IGNORE.has(x)).sort();
      if (!children.length) files[relative + '/'] = hashObject([]);
      for (const child of children) visit(`${relative}/${child}`);
    } else if (stat.isFile()) files[relative] = fileDigest(root, relative);
    else throw new Error(`not a regular input: ${relative}`);
  }
  for (const p of [...paths].sort()) visit(p);
  return files;
}
/* A WATCHED MODULE IS WATCHED WITH EVERYTHING IT IMPORTS, and with nothing else.
   The stage adapters import some seventy modules, one of them from the app. Watching whole directories instead
   (the app's 657 files among 1,038) let an edit to the start menu expire every stage of every ground, and at
   Tjusta each of those cost the 35-minute tree stage again (27 November 2026). Packages and Node's own modules
   are named by the lockfile, which a workflow watches beside its entry points. */
const IMPORT = /(?<![\w$.])(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?(['"])([^'"\n]+)\1|(?<![\w$.])import\(\s*(['"])([^'"\n]+)\3\s*\)/g;
const COMPUTED_IMPORT = /(?<![\w$.])import\(\s*(?!['")])/;
export function importClosure(root, entries) {
  const seen = new Set();
  const visit = relative => {
    if (seen.has(relative)) return;
    seen.add(relative);
    if (!/\.(?:mjs|js)$/.test(relative)) return;
    const text = fs.readFileSync(safePath(root, relative), 'utf8');
    if (COMPUTED_IMPORT.test(text)) throw new Error(`${relative}: a computed import() cannot be watched; import the module by name`);
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[2] ?? match[4];
      if (!specifier.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      if (!relativePath(target)) throw new Error(`${relative}: ${specifier} leaves the repository`);
      let isFile = false;
      try { isFile = fs.statSync(safePath(root, target)).isFile(); } catch { /* reported below */ }
      if (!isFile) throw new Error(`${relative}: imports ${specifier}, which is not a file`);
      visit(target);
    }
  };
  for (const entry of entries) visit(entry);
  return [...seen].sort();
}
/** The implementation a workflow watches: each module with its imports, each other path as it stands. */
export function codeInventory(root, watch) {
  return inventory(root, [...new Set(watch.flatMap(p => (/\.(?:mjs|js)$/.test(p) ? importClosure(root, [p]) : [p])))]);
}
// Promotion changes the physical root, never the logical names in receipts.
export function candidateInventory(root, paths, stagingRoot, publicRoot = stagingRoot) {
  const relocate = p => p === stagingRoot || p.startsWith(stagingRoot + '/') ? publicRoot + p.slice(stagingRoot.length) : p;
  const files = {};
  for (const p of paths) {
    const moved = relocate(p);
    for (const [key, value] of Object.entries(inventory(root, [moved]))) files[p + key.slice(moved.length)] = value;
  }
  return files;
}
