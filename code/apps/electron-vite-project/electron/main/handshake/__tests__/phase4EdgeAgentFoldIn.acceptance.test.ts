/**
 * Phase 4 — Edge-agent fold-in (V8 / I3) [XI.3-I9] — acceptance test 7.
 *
 * The edge-agent pairing dialect (`apps/edge-agent/dist/pairingProtocol.js`,
 * `edge_ingestor` records held in the agent's own encrypted state) is RETIRED
 * for new formations. This codebase never contained the orchestrator-side
 * counterpart that would write `edge_ingestor` ledger rows; the retirement is
 * enforced structurally:
 *
 *  1. `edge_ingestor` is a retired dialect identifier — profile dispatch
 *     fails closed (`unknown_profile`), no adapter maps it to a registered
 *     profile, and the registry marks it retired.
 *  2. New same-principal device pairings form exclusively through the one
 *     pipeline under the `internal_device` profile.
 *  3. Structural absence: no production source in the Electron app or the
 *     shared packages reads or writes `edge_ingestor` records. Legacy agent
 *     pairings stay readable by the agent's own dist (read-only transition
 *     window, untouched here).
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import {
  resolveProfile,
  listProfileRecords,
  RETIRED_FORMATION_DIALECTS,
} from '@repo/ingestion-core'

describe('Phase 4 — edge-agent fold-in (V8/I3)', () => {
  it('edge_ingestor is a retired dialect: fail-closed refusal, never registered', () => {
    expect(RETIRED_FORMATION_DIALECTS).toContain('edge_ingestor')

    for (const retired of RETIRED_FORMATION_DIALECTS) {
      // Fail-closed dispatch: retired dialects resolve to a visible refusal.
      const res = resolveProfile(retired, 1)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.reason).toBe('unknown_profile')

      // And the registry itself never carries them under any version.
      expect(listProfileRecords().some((r) => r.id === retired)).toBe(false)
    }
  })

  it('internal_device is the one mechanism for same-principal device pairing', () => {
    const res = resolveProfile('internal_device', 1)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.record.same_principal).toBe(true)
      expect(res.record.mutual_consent_required).toBe(true)
    }
  })

  it('structural absence: no production source references edge_ingestor', () => {
    // Repo root: apps/electron-vite-project/electron/main/handshake/__tests__ → up 6.
    const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..', '..')
    const scanRoots = [
      join(repoRoot, 'apps', 'electron-vite-project', 'electron'),
      join(repoRoot, 'apps', 'electron-vite-project', 'src'),
      join(repoRoot, 'apps', 'extension-chromium', 'src'),
      join(repoRoot, 'packages'),
    ]
    const offenders: string[] = []

    const walk = (dir: string): void => {
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        const p = join(dir, entry)
        if (
          entry === 'node_modules' ||
          entry === 'dist' ||
          entry === 'dist-electron' ||
          entry === '__tests__' ||
          entry === '.git'
        ) {
          continue
        }
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          walk(p)
          continue
        }
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry) || /\.(test|spec)\./.test(entry)) continue
        const text = readFileSync(p, 'utf8')
        if (text.includes('edge_ingestor')) {
          // The retired-dialect registry marker is the single permitted mention.
          const isRegistryMarker = p.split(sep).join('/').endsWith('packages/ingestion-core/src/profileRegistry.ts')
          if (!isRegistryMarker) offenders.push(p)
        }
      }
    }

    for (const root of scanRoots) walk(root)
    expect(offenders).toEqual([])
  })
})
