import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface TlsMaterial {
  cert: string
  key: string
}

export function loadOrCreatePairingTls(stateDir: string): TlsMaterial {
  const certPath = join(stateDir, 'pairing.crt')
  const keyPath = join(stateDir, 'pairing.key')
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '825',
          '-subj',
          '/CN=wrdesk-edge-agent-pairing',
        ],
        { stdio: 'pipe' },
      )
    } catch (err) {
      throw new Error(
        `Failed to generate pairing TLS certificate (install openssl or pre-create ${certPath}): ${String(err)}`,
      )
    }
  }
  return {
    cert: readFileSync(certPath, 'utf8'),
    key: readFileSync(keyPath, 'utf8'),
  }
}
