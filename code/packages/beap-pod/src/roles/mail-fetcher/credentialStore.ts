/**
 * Tmpfs credential file storage (strategy §11.5).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AccountTmpfsFiles {
  readonly encryptedBundlePath: string;
  readonly wrappedAccountKeyPath: string;
}

export class CredentialStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  accountDir(accountId: string): string {
    return join(this.rootDir, sanitizeAccountId(accountId));
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async writeStartFiles(
    accountId: string,
    encryptedBundle: string,
    wrappedAccountKey: string,
  ): Promise<AccountTmpfsFiles> {
    const dir = this.accountDir(accountId);
    await mkdir(dir, { recursive: true });
    const encryptedBundlePath = join(dir, 'encrypted_bundle.json');
    const wrappedAccountKeyPath = join(dir, 'wrapped_account_key.bin');
    await writeFile(encryptedBundlePath, encryptedBundle, 'utf8');
    await writeFile(wrappedAccountKeyPath, wrappedAccountKey, 'utf8');
    return { encryptedBundlePath, wrappedAccountKeyPath };
  }

  async readEncryptedBundle(accountId: string): Promise<string> {
    const path = join(this.accountDir(accountId), 'encrypted_bundle.json');
    return readFile(path, 'utf8');
  }

  async hasTmpfsFiles(accountId: string): Promise<boolean> {
    try {
      await readFile(join(this.accountDir(accountId), 'encrypted_bundle.json'));
      return true;
    } catch {
      return false;
    }
  }

  async removeAccountFiles(accountId: string): Promise<void> {
    await rm(this.accountDir(accountId), { recursive: true, force: true });
  }

  async listAccountIds(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }
}

function sanitizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed || !/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error('Invalid account_id');
  }
  return trimmed;
}

export { sanitizeAccountId };
