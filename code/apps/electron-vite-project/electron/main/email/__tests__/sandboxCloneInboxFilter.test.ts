import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isPersistedInboxRowSandboxClone,
  SANDBOX_CLONE_INBOX_BODY_BANNER,
  sandboxCloneInboxSqlPredicate,
} from '../sandboxCloneInboxFilter'
import { buildInboxMessagesWhereClause } from '../inboxWhereClause'

const isSandboxMode = vi.fn(() => false)
vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isSandboxMode: () => isSandboxMode(),
}))

describe('isPersistedInboxRowSandboxClone', () => {
  it('detects body banner marker', () => {
    expect(
      isPersistedInboxRowSandboxClone({ body_text: `${SANDBOX_CLONE_INBOX_BODY_BANNER}\nHello` }),
    ).toBe(true)
  })

  it('detects beap_package_json sandbox_clone metadata', () => {
    const pkg = JSON.stringify({
      metadata: {
        inbox_response_path: {
          sandbox_clone: true,
          automation_sandbox_clone: true,
          sandbox_clone_provenance: { beap_sandbox_clone: { original_message_id: 'm1' } },
        },
      },
    })
    expect(isPersistedInboxRowSandboxClone({ beap_package_json: pkg })).toBe(true)
  })

  it('detects sandbox_clone_quarantine in package json', () => {
    const pkg = JSON.stringify({
      metadata: { inbox_response_path: { sandbox_clone_quarantine: true } },
    })
    expect(isPersistedInboxRowSandboxClone({ beap_package_json: pkg })).toBe(true)
  })

  it('rejects non-clone synced mail row shape', () => {
    expect(
      isPersistedInboxRowSandboxClone({
        body_text: 'Weekly newsletter',
        beap_package_json: null,
        depackaged_json: '{"subject":"News"}',
      }),
    ).toBe(false)
  })
})

describe('buildInboxMessagesWhereClause — sandbox clone-only gate', () => {
  beforeEach(() => {
    isSandboxMode.mockReturnValue(false)
  })

  it('host mode: no sandbox clone predicate', () => {
    const { where } = buildInboxMessagesWhereClause({ filter: 'all' })
    expect(where).not.toContain('sandbox_clone')
    expect(where).not.toContain(SANDBOX_CLONE_INBOX_BODY_BANNER)
  })

  it('sandbox mode: adds clone-only predicate', () => {
    isSandboxMode.mockReturnValue(true)
    const { where } = buildInboxMessagesWhereClause({ filter: 'all' })
    expect(where).toContain(SANDBOX_CLONE_INBOX_BODY_BANNER)
    expect(where).toContain('sandbox_clone_provenance')
  })

  it('sandboxCloneInboxSqlPredicate matches filter markers', () => {
    const sql = sandboxCloneInboxSqlPredicate()
    expect(sql).toContain('beap_sandbox_clone')
    expect(sql).toContain('sandbox_clone_quarantine')
  })
})
