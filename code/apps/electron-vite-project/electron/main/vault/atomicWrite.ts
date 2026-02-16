/**
 * Atomic file write — write-tmp → fsync → rename.
 *
 * Guarantees the target file is either the old content or the new content,
 * never a partial/corrupt state, even on process crash or power loss.
 *
 * Strategy:
 *   1. Write data to `<target>.tmp` with restrictive permissions (0600).
 *   2. fsync the temp file to flush OS buffers to durable storage.
 *   3. Rename (atomic on POSIX; near-atomic on NTFS) over the target path.
 *
 * The temp file sits in the same directory as the target, ensuring the
 * rename never crosses filesystem boundaries.
 */

import { writeFileSync, renameSync, openSync, closeSync, fsyncSync } from 'fs'

export function atomicWriteFileSync(targetPath: string, data: string): void {
  const tmpPath = targetPath + '.tmp'

  // 1. Write to temp file
  writeFileSync(tmpPath, data, { mode: 0o600 })

  // 2. fsync to flush to disk
  const fd = openSync(tmpPath, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  // 3. Atomic rename
  renameSync(tmpPath, targetPath)
}
