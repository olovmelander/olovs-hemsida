#!/usr/bin/env node
// A local review page using the original PNGs; no resampling or image synthesis.
// node tools/performance-gallery.mjs path/to/shots/report.json [output.html]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const file = path.resolve(process.argv[2]);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(report.kind, 'shots');
const out = path.resolve(process.argv[3] ?? path.join(path.dirname(file), 'index.html'));
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const images = new Map();
for (const run of report.runs) for (const row of run.views) {
  if (!images.has(row.id)) images.set(row.id, []);
  images.get(row.id).push({ label: run.variant, path: path.relative(path.dirname(out), path.join(path.dirname(file), row.image)).replaceAll('\\', '/'), shadow: row.shadowMap?.sha256 });
}
const sections = [...images].map(([id, items]) => `<section><h2>${escape(id)}</h2><div class="row">${items.map(item => `<figure><figcaption>${escape(item.label)}</figcaption><a href="${escape(item.path)}"><img src="${escape(item.path)}" alt="${escape(`${id}, ${item.label}`)}"></a><small>Shadow SHA-256: ${escape(item.shadow ?? 'not recorded')}</small></figure>`).join('')}</div></section>`).join('\n');
fs.writeFileSync(out, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(report.course)} GPU comparison</title>
<style>body{font:16px system-ui;margin:24px;background:#17201c;color:#edf3ef}h1{font-size:26px}h2{font-size:20px}a{color:inherit}.row{display:flex;overflow:auto;gap:16px}figure{margin:0;flex:0 0 calc(50% - 8px);min-width:440px}img{width:100%;display:block}figcaption{padding:8px 0;font-weight:650}small{display:block;font:11px monospace;overflow-wrap:anywhere;margin:8px 0}section{margin:32px 0}</style>
<h1>${escape(report.course)}: GPU screenshot comparison</h1><p>${escape(report.backend)}, ${escape(report.quality)}, ${report.viewport.join(' × ')}, DPR ${report.dpr}, det=${Number(report.det)}. Click an image for its original size. Scroll each row to compare additional variants.</p>${sections}</html>`);
console.log(out);
