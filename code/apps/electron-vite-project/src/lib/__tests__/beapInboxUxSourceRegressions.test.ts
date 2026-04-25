/** @vitest-environment node */
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
  test('no undefined isBeap: EmailInboxView must not reference isBeap (crash guard)', () => {
    const inbox = readRel('components', 'EmailInboxView.tsx')
    expect(inbox).not.toMatch(/\bisBeap\b/)
  })

  test('LinkWarningDialog: security copy + Sandbox button with icon label', () => {
    const dlg = readRel('components', 'LinkWarningDialog.tsx')
    expect(dlg).toMatch(/Open external link\?/)
    expect(dlg).toMatch(/KVM switch with hotkeys/)
    expect(dlg).toMatch(/BeapInboxSandboxCloneIcon/)
    expect(dlg).toMatch(/Sandbox/)
    expect(dlg).toMatch(/Open link/)
    expect(dlg).not.toMatch(/Open anyway/)
    expect(dlg).toMatch(/I understand the risks of opening external links/)
    expect(dlg).toMatch(/contextKey/)
    expect(dlg).toMatch(/disabled=\{!riskAccepted\}/)
  })

  test('11: legacy “Reply using capsule fields” copy is not present in message detail', () => {
    const src = readRel('components', 'EmailMessageDetail.tsx')
    expect(src).not.toMatch(/Reply using capsule fields/i)
  })

  test('11b: Inbox message body uses shared safe-link parts (no raw body_html innerHTML)', () => {
    const detail = readRel('components', 'EmailMessageDetail.tsx')
    expect(detail).toContain('beapInboxMessageBodyToLinkParts')
    expect(detail).toContain('BeapMessageSafeLinkParts')
    expect(detail).not.toMatch(/dangerouslySetInnerHTML=\{\{ __html:.*body_html/s)
  })

  test('12: Reply is icon-only (class + tooltip); no visible Reply label in the control', () => {
    const src = readRel('components', 'EmailMessageDetail.tsx')
    expect(src).toContain('beapInboxReplyTooltipProps()')
    expect(src).toContain('inbox-action-icon-only')
    expect(src).toContain('inbox-detail-reply-icon-only')
    expect(src).not.toMatch(/className="[^"]*inbox-detail-icon-btn[^"]*--reply/)
  })

  test('15: Redirect is icon-only in detail + list row; no button text node Redirect', () => {
    const detail = readRel('components', 'EmailMessageDetail.tsx')
    const inbox = readRel('components', 'EmailInboxView.tsx')
    expect(detail).toContain('InboxRedirectActionIcon')
    expect(detail).toContain('beapInboxRedirectTooltipPropsForDetail()')
    expect(detail).not.toMatch(/>Redirect</)
    expect(inbox).toContain('InboxRedirectActionIcon')
    expect(inbox).toContain('row')
    expect(inbox).not.toMatch(/>Redirect</)
  })

  test('Sandbox UI: Host gate on orchestratorMode; shared icon components', () => {
    const vis = readRel('lib', 'beapInboxSandboxVisibility.ts')
    expect(vis).toContain("orchestratorMode !== 'host'")
    const detail = readRel('components', 'EmailMessageDetail.tsx')
    const inbox = readRel('components', 'EmailInboxView.tsx')
    const beapBtn = readRel('components', 'BeapActionIconButton.tsx')
    expect(beapBtn).toContain('BeapInboxSandboxCloneIcon')
    expect(detail).toContain('InboxSandboxCloneActionIcon')
    expect(detail).toContain('showSandboxCloneIcon')
    expect(detail).not.toMatch(/showHostSandboxStrip/)
    expect(inbox).toContain('InboxSandboxCloneActionIcon')
    expect(detail).toContain('authoritativeDeviceInternalRole')
    expect(detail).toContain('internalSandboxListReady')
    expect(detail).toContain('canShowSandboxCloneAction(')
    expect(vis).not.toMatch(/\bhasActiveInternalSandboxHandshake\b/)
    expect(vis).toContain('logSandboxActionVisibility')
    expect(inbox).toContain('logSandboxActionVisibility')
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
