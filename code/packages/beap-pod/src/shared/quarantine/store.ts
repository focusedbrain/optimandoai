/**
 * Shared pod quarantine store at /var/lib/quarantine (Phase 5 — P5.5).
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { filterEnvelopeSubject } from '@repo/beap-cert';

import { encryptQuarantineBytes } from './crypto.js';
import { getQuarantineKey } from './keyStore.js';
import type { QuarantineMetadata } from './types.js';

export const DEFAULT_QUARANTINE_DIR = '/var/lib/quarantine';

export interface WriteQuarantineEntryArgs {
  hash: string;
  rawBytes: Buffer;
  envelopeFrom: string;
  envelopeTo: string;
  envelopeDate: string;
  envelopeSubject: string;
  failedContainerRole: string;
  failedStage: string;
  accountId?: string;
  imapUid?: number;
  quarantinedAt?: string;
}

export class QuarantineStore {
  constructor(private readonly rootDir: string = DEFAULT_QUARANTINE_DIR) {}

  entryDir(hash: string): string {
    return join(this.rootDir, hash);
  }

  async writeEntry(args: WriteQuarantineEntryArgs): Promise<void> {
    const key = getQuarantineKey();
    if (!key) {
      throw new Error('quarantine_key_not_delivered');
    }

    const metadata: QuarantineMetadata = {
      hash: args.hash,
      size: args.rawBytes.length,
      envelope_from: args.envelopeFrom,
      envelope_to: args.envelopeTo,
      envelope_date: args.envelopeDate,
      envelope_subject_filtered: filterEnvelopeSubject(args.envelopeSubject),
      quarantined_at: args.quarantinedAt ?? new Date().toISOString(),
      failed_container_role: args.failedContainerRole,
      failed_stage: args.failedStage,
      ...(args.accountId ? { account_id: args.accountId } : {}),
      ...(args.imapUid !== undefined ? { imap_uid: args.imapUid } : {}),
    };

    const dir = this.entryDir(args.hash);
    await mkdir(dir, { recursive: true });
    const wire = encryptQuarantineBytes(args.rawBytes, key);
    await writeFile(join(dir, 'raw_bytes'), JSON.stringify(wire), 'utf8');
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata), 'utf8');
  }

  async hasEntry(hash: string): Promise<boolean> {
    try {
      await readFile(join(this.entryDir(hash), 'metadata.json'), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  async readMetadata(hash: string): Promise<QuarantineMetadata | null> {
    try {
      const raw = await readFile(join(this.entryDir(hash), 'metadata.json'), 'utf8');
      return JSON.parse(raw) as QuarantineMetadata;
    } catch {
      return null;
    }
  }

  async listHashes(): Promise<string[]> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async deleteEntry(hash: string): Promise<void> {
    await rm(this.entryDir(hash), { recursive: true, force: true });
  }

  /** Delete entries older than retentionDays. Returns removed hashes. */
  async cleanupExpired(retentionDays: number, now = new Date()): Promise<string[]> {
    const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    const removed: string[] = [];
    for (const hash of await this.listHashes()) {
      const meta = await this.readMetadata(hash);
      if (!meta?.quarantined_at) continue;
      const ts = Date.parse(meta.quarantined_at);
      if (Number.isNaN(ts) || ts < cutoffMs) {
        await this.deleteEntry(hash);
        removed.push(hash);
      }
    }
    return removed;
  }
}
