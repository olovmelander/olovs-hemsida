#!/usr/bin/env node
/* Cell-by-cell scorecard verification & cross-source reconciliation.
 *
 * Enforces Banvy's verified-card rule (docs/second-courses.md):
 *  - exact hole count (9 or 18) and sequential numbering;
 *  - par in 3..5 with Out/In/Total sums checked against printed totals;
 *  - valid stroke-index permutation (1..18 for 18h, odd 1..17 for 9h, or all null if unrated);
 *  - every tee column's Out/In/Total sums matching independently printed totals;
 *  - explicit cell-by-cell cross-check against secondary official sources (e.g. SGF vs Caddee).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyScorecard(card, { secondaryCards = [], requireRated = true } = {}) {
  const errors = [];
  const warnings = [];
  const holes = card?.holes;
  const tees = card?.tees;
  if (!Array.isArray(holes) || ![9, 18].includes(holes.length)) {
    return { valid: false, errors: ['card.holes must contain 9 or 18 holes'], warnings, summary: null };
  }
  if (!Array.isArray(tees) || !tees.length) {
    return { valid: false, errors: ['card.tees must contain at least one tee'], warnings, summary: null };
  }

  const n = holes.length;
  const indices = [];
  let parOut = 0, parIn = 0;

  for (let i = 0; i < n; i++) {
    const h = holes[i];
    if (h.number !== i + 1) errors.push(`hole[${i}]: expected number ${i + 1}, got ${h.number}`);
    if (!Number.isInteger(h.par) || h.par < 3 || h.par > 5) errors.push(`hole ${h.number}: invalid par ${h.par}`);
    else if (i < 9) parOut += h.par;
    else parIn += h.par;
    indices.push(h.index);
  }

  const parTotal = parOut + parIn;
  if (card.par?.front !== undefined && card.par.front !== parOut) errors.push(`printed front par ${card.par.front} != summed ${parOut}`);
  if (card.par?.back !== undefined && n === 18 && card.par.back !== parIn) errors.push(`printed back par ${card.par.back} != summed ${parIn}`);
  if (card.par?.total !== undefined && card.par.total !== parTotal) errors.push(`printed total par ${card.par.total} != summed ${parTotal}`);

  const allNullIdx = indices.every(v => v === null || v === undefined);
  if (allNullIdx) {
    if (requireRated) errors.push('stroke index is missing on a rated course');
    else warnings.push('unrated card: stroke indexes are null');
  } else {
    const sorted = [...indices].sort((a, b) => a - b);
    const expected18 = Array.from({ length: 18 }, (_, i) => i + 1);
    const expected9Odd = Array.from({ length: 9 }, (_, i) => i * 2 + 1);
    const expected9Seq = Array.from({ length: 9 }, (_, i) => i + 1);
    const ok = n === 18
      ? JSON.stringify(sorted) === JSON.stringify(expected18)
      : JSON.stringify(sorted) === JSON.stringify(expected9Odd) || JSON.stringify(sorted) === JSON.stringify(expected9Seq);
    if (!ok) errors.push(`stroke index is not a valid permutation: [${indices.join(',')}]`);
    if (n === 9 && JSON.stringify(indices) === JSON.stringify(expected9Seq)) {
      warnings.push('9-hole stroke index is literally 1..9 in hole order; verify it is not a scrape artifact');
    }
  }

  const teeSummaries = [];
  for (const tee of tees) {
    if (!tee.id || !tee.name) errors.push(`tee missing id or name: ${JSON.stringify(tee)}`);
    let out = 0, inn = 0;
    for (let i = 0; i < n; i++) {
      const len = holes[i].lengths?.[tee.id];
      if (!Number.isInteger(len) || len <= 0) {
        errors.push(`hole ${i + 1} tee ${tee.id}: invalid length ${len}`);
      } else if (i < 9) out += len;
      else inn += len;
    }
    const total = out + inn;
    if (tee.front !== undefined && tee.front !== out) errors.push(`tee ${tee.id}: printed front ${tee.front} != summed ${out}`);
    if (tee.back !== undefined && n === 18 && tee.back !== inn) errors.push(`tee ${tee.id}: printed back ${tee.back} != summed ${inn}`);
    if (tee.total !== undefined && tee.total !== total) errors.push(`tee ${tee.id}: printed total ${tee.total} != summed ${total}`);
    teeSummaries.push({ id: tee.id, name: tee.name, front: out, back: n === 18 ? inn : null, total });
  }

  // Cell-by-cell reconciliation against secondary official sources (SGF vs Caddee vs Club)
  const crossChecks = [];
  for (const sec of secondaryCards) {
    const mismatches = [];
    const label = sec.sourceName || 'secondary';
    if (!Array.isArray(sec.holes) || sec.holes.length !== n) {
      mismatches.push(`hole count differs (${sec.holes?.length} vs ${n})`);
    } else {
      for (let i = 0; i < n; i++) {
        const a = holes[i], b = sec.holes[i];
        if (a.par !== b.par) mismatches.push(`h${i + 1} par: ${a.par} vs ${b.par}`);
        if (a.index !== b.index) mismatches.push(`h${i + 1} index: ${a.index} vs ${b.index}`);
        for (const tee of tees) {
          if (b.lengths && Object.hasOwn(b.lengths, tee.id) && a.lengths?.[tee.id] !== b.lengths[tee.id]) {
            mismatches.push(`h${i + 1} tee ${tee.id}: ${a.lengths?.[tee.id]} vs ${b.lengths[tee.id]}`);
          }
        }
      }
    }
    if (mismatches.length) errors.push(`cross-check vs ${label} failed (${mismatches.length} cells): ${mismatches.slice(0, 8).join('; ')}`);
    crossChecks.push({ sourceName: label, matched: mismatches.length === 0, mismatchCount: mismatches.length, mismatches });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: { holes: n, par: { front: parOut, back: n === 18 ? parIn : null, total: parTotal }, tees: teeSummaries, crossChecks },
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const primary = flag('--card');
  if (!primary) throw new Error('Usage: verify-scorecard.mjs --card FILE [--compare FILE] [--unrated]');
  const card = JSON.parse(fs.readFileSync(path.resolve(primary), 'utf8'));
  const secondaryCards = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--compare' && args[i + 1]) {
      const file = path.resolve(args[i + 1]);
      secondaryCards.push({ sourceName: path.basename(file), ...JSON.parse(fs.readFileSync(file, 'utf8')) });
    }
  }
  const result = verifyScorecard(card, { secondaryCards, requireRated: !args.includes('--unrated') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
