import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateStream, readPack, sha256 } from './lib.mjs';
import { scorecardOf } from '../../apps/golf/src/shell/scorecard-model.mjs';

// The published compact rows are the same projection as the saved-pack fallback.
export function publishScorecard(meta, packBytes, directory) {
  const { header, sv } = readPack(packBytes);
  if (header.slug !== meta.slug) throw new Error(`${meta.slug}: incorrect scorecard pack`);
  const vectors = JSON.parse(inflateStream(sv));
  const card = scorecardOf(vectors, meta.tees.names.length);
  if (card.par !== meta.par || card.holes.length !== meta.holes) throw new Error(`${meta.slug}: scorecard totals differ from catalogue`);
  const data = JSON.stringify({ version: 1, slug: meta.slug, packSha256: sha256(packBytes), holes: card.holes }) + '\n';
  const digest = sha256(data);
  const name = `scorecard-${digest}.json`;
  const file = path.join(directory, name);
  if (!existsSync(file) || readFileSync(file, 'utf8') !== data) writeFileSync(file, data);
  return { url: `courses/${meta.slug}/${name}`, bytes: Buffer.byteLength(data), sha256: digest };
}
