import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRendererProof } from './build-renderer-proof.mjs';

const output = await mkdtemp(join(tmpdir(), 'banvy-v2-renderer-'));

try {
  const result = await buildRendererProof(output);
  console.log(`course-v2 renderer build passed: Three r185 proof ${result.bytes} bytes`);
} finally {
  await rm(output, { recursive: true, force: true });
}
