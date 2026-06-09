/**
 * Prompt 1 — Outlook inert ingestion FAILS CLOSED when the only proven opaque
 * input (raw MIME via Graph `/$value`) is not enabled. It must NEVER fall back to
 * parsing Graph fields on the host. The fail-closed throw happens before any
 * network call (the `/$value` preference is an env read), so no live account is
 * needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OutlookProvider, OutlookOpaqueUnprovenError } from '../providers/outlook'
import { __resetOpaqueIngestionCacheForTests } from '../opaqueIngestion'

const FLAG = 'WRDESK_SEAM_DEPACKAGE_CUTOVER'
const RAWPREF = 'WRDESK_OUTLOOK_OPAQUE_INPUT'

function clearEnv() {
  delete process.env[FLAG]
  delete process.env[RAWPREF]
  __resetOpaqueIngestionCacheForTests()
}

describe('Outlook inert ingestion — fail closed without proven /$value', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('inert active + /$value NOT enabled → fetchMessage rejects with OutlookOpaqueUnprovenError (no parse)', async () => {
    process.env[FLAG] = '1' // inert ingestion active
    // RAWPREF unset → default 'structured-json' → /$value unproven → fail closed.
    const provider = new OutlookProvider()
    await expect(provider.fetchMessage('msg-1')).rejects.toBeInstanceOf(OutlookOpaqueUnprovenError)
  })

  it('inert active + /$value ENABLED → takes the opaque path (no fail-closed error; fails on transport, never parse)', async () => {
    // Deterministic complement: with the proven opaque input enabled, the gate
    // passes and the provider attempts the /$value fetch. Unauthenticated here it
    // throws a transport/JWT error — crucially NOT the unproven fail-closed error,
    // and it never falls back to parseOutlookMessage.
    process.env[FLAG] = '1'
    process.env[RAWPREF] = 'value'
    const provider = new OutlookProvider()
    await expect(provider.fetchMessage('msg-2')).rejects.not.toBeInstanceOf(OutlookOpaqueUnprovenError)
  })
})
