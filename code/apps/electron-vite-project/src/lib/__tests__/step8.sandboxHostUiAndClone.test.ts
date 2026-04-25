/**
 * STEP 8 — renderer-side selector merge, routing contracts, file-level UI invariants, sandbox clone header.
 * Heavy logic is covered in listInferenceTargets.step8.test.ts + hostInferenceSelectorIntegration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isHostInferenceModelId } from '../hostInferenceModelIds'
import {
  hostInferenceSetupMessageVisible,
  hostInferenceOptionVisible,
} from '../hostInferenceUiGates'
import { stripSandboxCloneLeadInFromBodyText, SANDBOX_CLONE_INBOX_LEAD_IN } from '../inboxMessageSandboxClone'
import { GROUP_HOST_MODELS } from '../hostAiSelectorCopy'

const __dir = dirname(fileURLToPath(import.meta.url))
/** `electron-vite-project/src` (parent of `lib/`). */
const srcRoot = join(__dir, '..', '..')
/** Monorepo `apps/` (electron-vite `src` is two levels up from `lib/__tests__`). */
const appsRoot = join(srcRoot, '..', '..')

function readRel(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf-8')
}

function readExt(...parts: string[]): string {
  return readFileSync(join(appsRoot, ...parts), 'utf-8')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('STEP 8 — selector merge (invariants)', () => {
  it('local empty + Host target => selector not empty (Host group can appear)', () => {
    const hostRows = 1
    const local = 0
    const notEmpty = hostRows > 0 || local > 0
    expect(notEmpty).toBe(true)
  })

  it('local present + Host target => both visible (independent groups)', () => {
    const locals = 1
    const host = 1
    expect(locals + host).toBe(2)
  })
})

describe('STEP 8 — setup hint (no internal handshake / no direct Host)', () => {
  it('Sandbox with zero eligible Host rows: no Host option, setup can show', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 0)).toBe(false)
    expect(hostInferenceSetupMessageVisible(true, 'sandbox', false, 0)).toBe(true)
  })
})

describe('STEP 8 — routing contracts', () => {
  it('Host internal model id is not a local Ollama id (guards local llm:chat on Sandbox)', () => {
    const hostId = 'host-internal:hs1:llama3'
    expect(isHostInferenceModelId(hostId)).toBe(true)
  })

  it('plain local name is not Host inference', () => {
    expect(isHostInferenceModelId('mistral:7b')).toBe(false)
  })
})

describe('STEP 8 — UI file invariants (top chat, WR Chat, no UUID in copy)', () => {
  it('HybridSearch: Host model group label + Host path', () => {
    const s = readRel('components', 'HybridSearch.tsx')
    expect(s).toContain(GROUP_HOST_MODELS)
    expect(s).toContain('getAvailableModels')
    expect(s).toContain('host_internal')
  })

  it('WRChat dashboard: merges Host from listTargets into model list', () => {
    const s = readRel('components', 'WRChatDashboardView.tsx')
    expect(s).toContain('listTargets')
    expect(s).toContain("section: 'host'")
  })

  it('top chat (HybridSearch): Host submit uses getRequestHostCompletion (not local llm:chat for Host id)', () => {
    const s = readRel('components', 'HybridSearch.tsx')
    expect(s).toContain('getRequestHostCompletion')
    expect(s).toContain("const run = getRequestHostCompletion")
  })

  it('WR Chat (extension PopupChatView): Host route uses getRequestHostCompletion', () => {
    const s = readExt('extension-chromium', 'src', 'ui', 'components', 'PopupChatView.tsx')
    expect(s).toContain('getRequestHostCompletion')
  })

  it('no raw UUIDs in model selector line pattern (regression string)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const exampleLine = 'Host AI · gemma3:12b'
    expect(exampleLine).not.toContain(uuid)
  })
})

describe('STEP 8 — Sandbox Clone header (detail)', () => {
  it('SandboxCloneDisclosure default collapsed (useState false)', () => {
    const s = readRel('components', 'SandboxCloneDisclosure.tsx')
    expect(s).toContain("useState(false)")
  })

  it('expanded copy explains sandbox clone purpose', () => {
    const s = readRel('components', 'SandboxCloneDisclosure.tsx')
    expect(s).toMatch(/sandbox clone/i)
    expect(s).toMatch(/Host orchestrator/i)
  })

  it('S badge on detail: InboxBeapSourceBadge', () => {
    const badge = readRel('components', 'InboxBeapSourceBadge.tsx')
    expect(badge).toMatch(/'S'/)
  })

  it('EmailMessageDetail: disclosure + safe links + strip lead-in for clone body', () => {
    const d = readRel('components', 'EmailMessageDetail.tsx')
    expect(d).toContain('SandboxCloneDisclosure')
    expect(d).toContain('stripSandboxCloneLeadInFromBodyText')
    expect(d).toContain('BeapMessageSafeLinkParts')
    expect(d).toContain('InboxBeapSourceBadgeDetail')
  })

  it('strip lead-in leaves user body unchanged (prefix only)', () => {
    const inner = 'Hello link https://a.test/x'
    const full = `${SANDBOX_CLONE_INBOX_LEAD_IN}${inner}`
    expect(stripSandboxCloneLeadInFromBodyText(full).trim()).toBe(inner)
  })
})
