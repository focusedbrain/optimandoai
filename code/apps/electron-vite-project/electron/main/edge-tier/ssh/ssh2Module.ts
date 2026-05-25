/**
 * ssh2 is CommonJS; ESM named imports fail at runtime in the packaged Electron main bundle.
 * Load via createRequire (same pattern as better-sqlite3 in vault/db.ts).
 */

import { createRequire } from 'node:module'

import type { Client, ConnectConfig, SFTPWrapper } from 'ssh2'

const require = createRequire(import.meta.url)

interface Ssh2Module {
  Client: typeof Client
  utils: typeof import('ssh2').utils
}

const ssh2 = require('ssh2') as Ssh2Module

export const Ssh2Client = ssh2.Client
export const ssh2Utils = ssh2.utils

export type { Client, ConnectConfig, SFTPWrapper }
