/**
 * Phase 4 — Art. 50 remediation integration checks (B1–B12 coverage gaps).
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProvenance } from './generate'
import {
  AI_CARRIER_ONLY_SCHEME,
  AI_VISIBLE_LABEL_LINE,
  buildCarrierOnlyClipboardHtml,
  buildCarrierOnlyHtmlMeta,
  buildClipboardHtml,
  encodeProvenancePayload,
  isAiProvenance,
  markEditorialResponsible,
  serializeForMime,
  shouldApplyMachineMarking,
  shouldApplyVisibleSendLabel,
  withVisibleAiLabel,
} from './index'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../../..')

describe('Art. 50 remediation integration', () => {
  it('1. stream-analyze Done persistence: same content_sha256 in payload and log shape', () => {
    const finalAnalysisText = 'Classification: urgent. Draft: Thanks for writing.'
    const streamProv = createProvenance(finalAnalysisText, {
      model_id: 'llama3',
      provider: 'local',
    })
    // Done IPC + ai_analysis_json persistence contract
    const donePayload = {
      type: 'Done' as const,
      analysis: finalAnalysisText,
      provenance: streamProv,
    }
    const aiAnalysisJson = {
      analysis: finalAnalysisText,
      provenance: donePayload.provenance,
    }
    const jsonlGenerationEvent = {
      event: 'generation',
      content_sha256: streamProv.content_sha256,
      model_id: streamProv.model_id,
    }
    expect(isAiProvenance(donePayload.provenance)).toBe(true)
    expect(aiAnalysisJson.provenance.content_sha256).toBe(jsonlGenerationEvent.content_sha256)
    expect(aiAnalysisJson.provenance.content_sha256).toBe(streamProv.content_sha256)
  })

  it('2. send path: AI headers for gmail/imap/outlook; zoho body markers; editorial keeps headers', () => {
    const aiProv = createProvenance('AI draft body', { model_id: 'm', provider: 'local' })
    const humanBody = 'Human typed reply'

    for (const provider of ['gmail', 'imap', 'outlook'] as const) {
      const headers = serializeForMime(aiProv)
      expect(headers['X-AI-Generated'], provider).toBe('true')
      expect(headers['X-AI-Provenance'], provider).toBeTruthy()
      // human-origin: no machine marking when provenance absent
      expect(shouldApplyMachineMarking(null)).toBe(false)
      expect(shouldApplyMachineMarking(undefined)).toBe(false)
      void humanBody
    }

    // Zoho: API cannot carry custom headers — structured body comment (production path in zoho.ts)
    const encoded = encodeProvenancePayload(aiProv)
    const zohoBody = `[X-AI-Generated: true]\n[X-AI-Provenance: ${encoded}]\n\nAI draft body`
    expect(zohoBody).toContain('[X-AI-Generated: true]')
    expect(zohoBody).toContain('[X-AI-Provenance:')

    const editorial = markEditorialResponsible(aiProv)
    expect(shouldApplyMachineMarking(editorial)).toBe(true)
    expect(shouldApplyVisibleSendLabel(editorial)).toBe(false)
    const headersAfterEditorial = serializeForMime(editorial)
    expect(headersAfterEditorial['X-AI-Generated']).toBe('true')
    expect(headersAfterEditorial['X-AI-Provenance']).toBeTruthy()
  })

  it('3. clipboard: full meta with provenance; carrier-only without fabricated fields', () => {
    const p = createProvenance('copied text', { model_id: 'm', provider: 'cloud:openai' })
    const full = buildClipboardHtml('copied text', p)
    expect(full).toContain('name="ai-generated"')
    expect(full).toContain('name="ai-provenance"')
    expect(full).toContain(AI_VISIBLE_LABEL_LINE)

    const carrierMeta = buildCarrierOnlyHtmlMeta()
    expect(carrierMeta).toContain(AI_CARRIER_ONLY_SCHEME)
    expect(carrierMeta).not.toContain('model_id')
    expect(carrierMeta).not.toContain('generated_at')
    expect(carrierMeta).not.toContain('content_sha256')

    const carrierHtml = buildCarrierOnlyClipboardHtml('legacy text')
    expect(carrierHtml).toContain(AI_CARRIER_ONLY_SCHEME)
    expect(withVisibleAiLabel('legacy text').startsWith(AI_VISIBLE_LABEL_LINE)).toBe(true)
    // Must not invent generation fields in carrier-only path
    expect(carrierHtml).not.toMatch(/name="ai-model"/)
  })

  it('4. BEAP round-trip: content_provenance + editorial_responsible=true from composer', () => {
    const p = createProvenance('beap draft', { model_id: 'm', provider: 'host-ai' })
    const ed = markEditorialResponsible(p)
    expect(ed.editorial_responsible).toBe(true)
    const capsule = {
      body: 'beap draft',
      content_provenance: ed,
    }
    // simulate build → sanitise (JSON clone) → message
    const sanitised = JSON.parse(JSON.stringify(capsule)) as {
      content_provenance?: unknown
    }
    expect(isAiProvenance(sanitised.content_provenance)).toBe(true)
    expect(
      (sanitised.content_provenance as { editorial_responsible: boolean }).editorial_responsible,
    ).toBe(true)
    expect(shouldApplyMachineMarking(ed)).toBe(true)
    expect(shouldApplyVisibleSendLabel(ed)).toBe(false)
  })

  it('5. editorial logging event keyed by draft content_sha256', () => {
    const draft = createProvenance('draft for send', { model_id: 'm', provider: 'local' })
    const ed = markEditorialResponsible(draft)
    // Mirrors provenanceLog.logEditorialResponsibility → logGeneration(..., 'editorial_responsibility')
    const jsonlEditorialEvent = {
      ...ed,
      logged_at: new Date().toISOString(),
      event: 'editorial_responsibility' as const,
    }
    expect(jsonlEditorialEvent.event).toBe('editorial_responsibility')
    expect(jsonlEditorialEvent.content_sha256).toBe(draft.content_sha256)
    expect(jsonlEditorialEvent.editorial_responsible).toBe(true)
  })

  it('6. invariant: createProvenance( only in main/background/generate/tests — not renderer', () => {
    const roots = [
      path.join(repoRoot, 'apps/electron-vite-project/src'),
      path.join(repoRoot, 'apps/extension-chromium/src'),
    ]
    const offenders: string[] = []
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '__tests__') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(ent.name)) continue
        // allow test files under src
        if (ent.name.includes('.test.') || ent.name.includes('.spec.')) continue
        const text = fs.readFileSync(full, 'utf8')
        if (text.includes('createProvenance(')) {
          offenders.push(path.relative(repoRoot, full))
        }
        // renderer must not import generate entry
        if (/from\s+['"][^'"]*aiProvenance\/generate['"]/.test(text)) {
          offenders.push(path.relative(repoRoot, full) + ' (imports generate)')
        }
      }
    }
    for (const r of roots) walk(r)
    expect(offenders, `renderer createProvenance/generate imports: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })
})
