/**
 * Per-account IMAP UID / hash skip list for quarantined messages (P5.5).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface QuarantineSkipRecord {
  skipped_uids: number[];
  skipped_hashes: string[];
}

export class QuarantineSkipStore {
  constructor(private readonly rootDir: string) {}

  private filePath(accountId: string): string {
    return join(this.rootDir, `${accountId}.json`);
  }

  async read(accountId: string): Promise<QuarantineSkipRecord> {
    try {
      const raw = await readFile(this.filePath(accountId), 'utf8');
      const parsed = JSON.parse(raw) as QuarantineSkipRecord;
      return {
        skipped_uids: Array.isArray(parsed.skipped_uids) ? parsed.skipped_uids : [],
        skipped_hashes: Array.isArray(parsed.skipped_hashes) ? parsed.skipped_hashes : [],
      };
    } catch {
      return { skipped_uids: [], skipped_hashes: [] };
    }
  }

  async addSkipped(accountId: string, uid: number, hash: string): Promise<void> {
    const current = await this.read(accountId);
    const skipped_uids = current.skipped_uids.includes(uid)
      ? current.skipped_uids
      : [...current.skipped_uids, uid];
    const skipped_hashes = current.skipped_hashes.includes(hash)
      ? current.skipped_hashes
      : [...current.skipped_hashes, hash];
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(
      this.filePath(accountId),
      JSON.stringify({ skipped_uids, skipped_hashes } satisfies QuarantineSkipRecord),
      'utf8',
    );
  }

  async isSkipped(accountId: string, uid: number, hash: string): Promise<boolean> {
    const current = await this.read(accountId);
    return current.skipped_uids.includes(uid) || current.skipped_hashes.includes(hash);
  }
}
