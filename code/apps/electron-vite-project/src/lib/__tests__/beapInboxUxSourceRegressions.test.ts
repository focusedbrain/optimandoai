/**
 * File-level regressions (Node env, no jsdom) — same approach as ThisDeviceCard.test.tsx.
 * Guards IPC host gate, clone semantics string, and removal of legacy reply affordances.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evpRoot = join(__dirname, '../..') // src

function readRel(...segments: string[]): string {
  return readFileSync(join(evpRoot, ...segments), 'utf8')
}

describe('beapInbox Ux source regressions', () => {
  test('11: legacy “Reply using capsule fields” copy is not present in message detail', () => {
    const src = readRel('components', 'EmailMessageDetail.tsx')
    expect(src).not.toMatch(/Reply using capsule fields/i)
  })

  test('12: Reply control uses Reply tooltip/aria (beapInboxActionTooltips)', () => {
    const src = readRel('components', 'EmailMessageDetail.tsx')
    expect(src).toContain('beapInboxReplyTooltipProps()')
  })

  test('14: clone prepare IPC enforces Host orchestrator before vault/db', () => {
    const ipc = readRel('..', 'electron', 'main', 'email', 'ipc.ts')
    expect(ipc).toContain('if (!isHostMode())')
    expect(ipc).toContain('NOT_HOST_ORCHESTRATOR')
    expect(ipc).toContain('Sandbox clone is only available when this device is the Host orchestrator')
  })

  test('beapInboxCloneToSandbox documents no ciphertext reuse in package banner', () => {
    const src = readRel('lib', 'beapInboxCloneToSandbox.ts')
    expect(src).toContain('no original ciphertext reuse')
  })

  test('EmailInboxView + EmailMessageDetail use shared Host Sandbox click policy', () => {
    const inbox = readRel('components', 'EmailInboxView.tsx')
    const detail = readRel('components', 'EmailMessageDetail.tsx')
    expect(inbox).toContain('resolveHostSandboxCloneClickAction')
    expect(detail).toContain('resolveHostSandboxCloneClickAction')
  })
})
