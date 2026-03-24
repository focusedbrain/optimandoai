/**
 * Debug-only raw node-imap connect: no gateway, no account cache, no decryption.
 */

import * as ImapMod from 'imap'
import { imapUsesImplicitTls } from './domain/securityModeNormalize'

const ImapCtor = (ImapMod as any).default ?? ImapMod

const DIAGNOSE_OVERALL_MS = 45_000

export type DiagnoseImapParams = {
  host: string
  port: number
  security: 'ssl' | 'starttls' | 'none'
  username: string
  password: string
}

export type DiagnoseImapResult = {
  success: boolean
  events: string[]
  error?: string
  tlsInfo?: {
    implicitTls: boolean
    host: string
    port: number
    security: string
  }
}

export function runDiagnoseImapStandalone(p: DiagnoseImapParams): Promise<DiagnoseImapResult> {
  const events: string[] = []
  const log = (line: string) => {
    const entry = `[${new Date().toISOString()}] ${line}`
    events.push(entry)
    console.log('[email:diagnoseImap]', entry)
  }

  const implicitTls = imapUsesImplicitTls(p.security)
  const tlsInfo: DiagnoseImapResult['tlsInfo'] = {
    implicitTls,
    host: p.host,
    port: p.port,
    security: p.security,
  }

  return new Promise((resolve) => {
    if (typeof ImapCtor !== 'function') {
      const err = 'imap package did not export a constructor (check ESM interop)'
      log(err)
      resolve({ success: false, events, error: err, tlsInfo })
      return
    }

    const client = new ImapCtor({
      user: p.username,
      password: p.password,
      host: p.host,
      port: p.port,
      tls: implicitTls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30_000,
      authTimeout: 30_000,
    })

    let settled = false
    let sawReady = false

    const safeResolve = (result: DiagnoseImapResult) => {
      if (settled) return
      settled = true
      clearTimeout(overallTimer)
      try {
        client.removeAllListeners()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    const overallTimer = setTimeout(() => {
      log(`event:timeout overall ${DIAGNOSE_OVERALL_MS}ms`)
      try {
        client.end()
      } catch {
        /* ignore */
      }
      safeResolve({
        success: false,
        events,
        error: `Diagnostic timed out after ${DIAGNOSE_OVERALL_MS}ms`,
        tlsInfo,
      })
    }, DIAGNOSE_OVERALL_MS)

    client.on('ready', () => {
      sawReady = true
      log('event:ready')
      try {
        client.end()
      } catch (e: any) {
        log(`event:end-after-ready-throw ${e?.message || e}`)
        safeResolve({ success: false, events, error: e?.message || String(e), tlsInfo })
      }
    })

    client.on('error', (err: Error) => {
      log(`event:error ${err?.message || String(err)}`)
      safeResolve({ success: false, events, error: err?.message || String(err), tlsInfo })
    })

    client.on('alert', (message: string) => {
      log(`event:alert ${message}`)
    })

    client.on('mail', (numNewMsgs: number) => {
      log(`event:mail ${numNewMsgs}`)
    })

    client.on('close', (hadError?: boolean) => {
      log(`event:close hadError=${hadError === true}`)
    })

    client.on('end', () => {
      log('event:end')
      if (sawReady && !settled) {
        safeResolve({ success: true, events, tlsInfo })
      }
    })

    log('connect() invoked')
    try {
      client.connect()
    } catch (e: any) {
      const msg = e?.message || String(e)
      log(`connect() threw: ${msg}`)
      safeResolve({ success: false, events, error: msg, tlsInfo })
    }
  })
}
