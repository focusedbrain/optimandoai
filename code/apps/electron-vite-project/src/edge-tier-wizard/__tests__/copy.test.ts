/**
 * Wizard copy snapshot tests — provider-favoritism guard (P4.5).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  STEP2_VM_HELP,
  STEP4_REPLICA_HELP,
  STEP4_REPLICA_MULTI_NOTE,
  LOCAL_POD_REQUIRED_MESSAGE,
  STEP_LABELS,
} from '../copy.js'

describe('wizard copy snapshots', () => {
  it('STEP2_VM_HELP matches snapshot', () => {
    expect(STEP2_VM_HELP).toMatchSnapshot()
  })

  it('STEP4 replica help matches snapshot', () => {
    expect(STEP4_REPLICA_HELP).toMatchSnapshot()
    expect(STEP4_REPLICA_MULTI_NOTE).toMatchSnapshot()
  })

  it('step labels are eight steps', () => {
    expect(STEP_LABELS).toHaveLength(8)
    expect(STEP_LABELS[0]).toBe('Overview')
    expect(STEP_LABELS[7]).toBe('Email on edge')
    expect(LOCAL_POD_REQUIRED_MESSAGE).toContain('Podman')
  })
})

const PROVIDER_NAMES = [
  'Hetzner',
  'DigitalOcean',
  'Linode',
  'Vultr',
  'OVH',
  'AWS',
  'GCP',
  'Azure',
]

function collectTsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === '__snapshots__') continue
      out.push(...collectTsxFiles(full))
    } else if (entry.endsWith('.tsx') && entry !== 'copy.ts') {
      out.push(full)
    }
  }
  return out
}

describe('provider-agnostic UI guard', () => {
  it('provider names appear only in copy.ts help text', () => {
    const wizardRoot = join(process.cwd(), 'apps/electron-vite-project/src/edge-tier-wizard')
    const files = collectTsxFiles(wizardRoot)
    const copyPath = join(wizardRoot, 'copy.ts')
    const copyContent = readFileSync(copyPath, 'utf8')

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const name of PROVIDER_NAMES) {
        if (!content.includes(name)) continue
        expect(
          copyContent.includes(name),
          `${name} found in ${file} but must only live in copy.ts`,
        ).toBe(true)
      }
    }
  })
})
