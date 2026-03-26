/**
 * Lightweight contract checks for AutoSort session review IPC + bulk inbox navigation.
 * Guards against regressions without spinning Electron or React.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ipcPath = join(__dirname, '..', 'ipc.ts')
const bulkViewPath = join(__dirname, '..', '..', '..', '..', 'src', 'components', 'EmailInboxBulkView.tsx')

describe('autosort session review regression (source contracts)', () => {
  it('getSessionMessages SQL includes received_at and needs_reply', () => {
    const src = readFileSync(ipcPath, 'utf8')
    const idx = src.indexOf("ipcMain.handle('autosort:getSessionMessages'")
    expect(idx).toBeGreaterThan(-1)
    const snippet = src.slice(idx, idx + 1200)
    expect(snippet).toMatch(/received_at/)
    expect(snippet).toMatch(/needs_reply/)
  })

  it('bulk view opens session review messages with filter alignment and App-level selection', () => {
    const src = readFileSync(bulkViewPath, 'utf8')
    expect(src).toContain('handleOpenMessageFromSessionReview')
    expect(src).toContain('workflowFilterFromSessionReviewRow')
    expect(src).toContain('setFilter({ ...scopeClear, filter: tab })')
    expect(src).toContain('onSelectMessage?.(id)')
    expect(src).toContain('await selectMessage(id)')
    expect(src).toMatch(/onNavigateToMessage=\{\(m\)\s*=>\s*void handleOpenMessageFromSessionReview\(m\)\}/)
  })
})
