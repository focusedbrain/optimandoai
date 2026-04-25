/**
 * STEP 10 — WR Chat: manual regression pointer (Ollama must not block Host discovery order).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = join(__dir, '..', '..', 'components', 'WRChatDashboardView.tsx')
const content = readFileSync(src, 'utf-8')

describe('STEP 10 — WR Chat: Host discovery before local llm.getStatus (contract string)', () => {
  it('(10) refreshModels awaits fetchSelectorModelListFromHostDiscovery before getStatus; Ollama failure does not block Host pipeline', () => {
    expect(content).toMatch(/fetchSelectorModelListFromHostDiscovery\(/s)
    expect(content).toContain('Never fold local `llm.getStatus` into this `try`')
    expect(content).toContain('Ollama failure must not block Host discovery')
  })
})
