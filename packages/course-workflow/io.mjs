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
