import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const LOCK_WAIT_MS = 10_000;

async function acquireLock(lockPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return await open(lockPath, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(`publication lock is still held: ${lockPath}; confirm its publisher has stopped before removing the lock`);
      }
      await delay(20);
    }
  }
}

/** Serialize cooperating publishers' read/modify/write operations, then replace
 * the live file with a complete same-directory temporary file. update receives
 * the latest bytes (null when absent) and returns writeFile-compatible data;
 * null/undefined leaves the file untouched. Readers never see staged bytes.
 * A crashed publisher's lock is deliberately not stolen based on age alone. */
export async function updateFileAtomically(filePath, update, { lockTimeoutMs = LOCK_WAIT_MS } = {}) {
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) {
    throw new TypeError('lockTimeoutMs must be finite and non-negative');
  }
  const target = resolve(filePath);
  await mkdir(dirname(target), { recursive: true });
  const lockPath = `${target}.publish.lock`;
  const lock = await acquireLock(lockPath, lockTimeoutMs);
  let temporary;
  try {
    let current = null;
    try {
      current = await readFile(target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const next = await update(current);
    if (next == null) return false;
    temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, next, { flag: 'wx' });
    await rename(temporary, target);
    return true;
  } finally {
    try {
      if (temporary) await rm(temporary, { force: true });
    } finally {
      try {
        await lock.close();
      } finally {
        await rm(lockPath);
      }
    }
  }
}
