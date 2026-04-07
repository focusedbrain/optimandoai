/**
 * Wizard step: detection focus, ignore patterns, scan preset, optional WR Expert .md, external verification, scope, diff folders.
 */

import React, { useMemo, useRef } from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import {
  CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY,
  CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY,
  getDiffWatchFoldersDraftText,
  getScopeUrlsDraftText,
  getDetectionScanMode,
  getExternalWebVerificationEnabled,
} from '../../../../shared/ui/customModeTypes'
import type { DetectionScanModePreset } from '../../../../shared/ui/customModeTypes'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { inputStyleWithError, wizardFieldColumnStyle, wizardTextareaStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'
import { getElectronPickDirectory } from '../../../../utils/electronPickDirectory'
import { parseWrExpertMarkdown, sha256HexUtf8 } from '../../../../utils/parseWrExpertMarkdown'

const WR_EXPERT_MAX_BYTES = 256 * 1024

const SCAN_OPTIONS: { value: DetectionScanModePreset; label: string; hint: string }[] = [
  {
    value: 'quick_scan',
    label: 'Quick scan',
    hint: 'Visible active tab only. No external search.',
  },
  {
    value: 'structured_page_scan',
    label: 'Structured page scan',
    hint: 'Active tab DOM + screenshot. No external search.',
  },
  {
    value: 'verified_research',
    label: 'Verified research',
    hint: 'Page scan; optional read-only external verification (see below).',
  },
]

export function StepFocus({
  data,
  setData,
  t,
  fieldErrors,
}: {
  data: CustomModeDraft
  setData: (patch: Partial<CustomModeDraft>) => void
  t: ReturnType<typeof getThemeTokens>
  fieldErrors: InlineFieldErrors
}) {
  const scopeUrlErr = fieldErrors.scopeUrls
  const fileInputRef = useRef<HTMLInputElement>(null)
  const md = useMemo(
    () => (data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}),
    [data.metadata],
  )
  const scopeUrlsText = getScopeUrlsDraftText(md)
  const diffFoldersText = getDiffWatchFoldersDraftText(md)
  const canBrowse = typeof getElectronPickDirectory() === 'function'
  const scanMode = getDetectionScanMode(md)
  const externalOn = getExternalWebVerificationEnabled(md)
  const wrExpertName = typeof md.wrExpertFileName === 'string' ? md.wrExpertFileName : ''
  const wrExpertErr = typeof md._wrExpertUploadError === 'string' ? md._wrExpertUploadError : ''
  const hasWrExpert =
    md.wrExpertProfile &&
    typeof md.wrExpertProfile === 'object' &&
    !Array.isArray(md.wrExpertProfile)

  const patchMetadata = (patch: Record<string, unknown>) => {
    setData({
      metadata: {
        ...md,
        ...patch,
      },
    })
  }

  const setScanMode = (value: DetectionScanModePreset) => {
    patchMetadata({
      detectionScanMode: value,
      ...(value !== 'verified_research' ? { externalWebVerification: false } : {}),
    })
  }

  const onWrExpertPick = () => fileInputRef.current?.click()

  const onWrExpertFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.md')) {
      patchMetadata({ _wrExpertUploadError: 'Only Markdown (.md) files are allowed.' })
      return
    }
    if (f.size > WR_EXPERT_MAX_BYTES) {
      patchMetadata({ _wrExpertUploadError: 'File is too large (maximum 256 KB).' })
      return
    }
    void f.text().then(async (text) => {
      try {
        const parsed = parseWrExpertMarkdown(text)
        const fileSha256 = await sha256HexUtf8(text)
        patchMetadata({
          _wrExpertUploadError: undefined,
          wrExpertFileName: f.name,
          wrExpertProfile: { ...parsed, fileSha256 },
        })
      } catch {
        patchMetadata({ _wrExpertUploadError: 'Could not read this file.' })
      }
    })
  }

  const clearWrExpert = () => {
    patchMetadata({
      wrExpertFileName: undefined,
      wrExpertProfile: undefined,
      _wrExpertUploadError: undefined,
    })
  }

  const selectStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${t.border}`,
    background: t.tabBg,
    color: t.text,
    fontSize: 13,
    marginTop: 4,
  }

  const helperStyle: React.CSSProperties = {
    margin: '6px 0 0',
    fontSize: 11,
    color: t.textMuted,
    lineHeight: 1.45,
  }

  const toggleRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    padding: '12px 14px',
    borderRadius: 10,
    border: `1px solid ${t.border}`,
    background: t.isLight ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.04)',
  }

  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-focus" style={labelStyle(t)}>
          Detection focus{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <p style={helperStyle}>
          Topics, keywords, entities, or patterns the assistant should prioritize for this mode.
        </p>
        <textarea
          id="cmw-focus"
          value={safeDraftString(data.searchFocus)}
          onChange={(e) => setData({ searchFocus: e.target.value })}
          placeholder={'One idea per line or free text — e.g. invoice numbers, named entities, fraud signals…'}
          style={wizardTextareaStyle(t)}
        />
      </div>
      <div>
        <label htmlFor="cmw-ignore" style={labelStyle(t)}>
          Ignore patterns{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <p style={helperStyle}>Content or sections to skip (noise, boilerplate, off-topic areas).</p>
        <textarea
          id="cmw-ignore"
          value={safeDraftString(data.ignoreInstructions)}
          onChange={(e) => setData({ ignoreInstructions: e.target.value })}
          placeholder="Short phrases or section types to deprioritize…"
          style={wizardTextareaStyle(t)}
        />
      </div>

      <div>
        <label htmlFor="cmw-scan-mode" style={labelStyle(t)}>
          Scan mode
        </label>
        <p style={{ ...helperStyle, marginBottom: 8 }}>
          Preset for how the page is analyzed. External search is never used unless you choose Verified research and
          enable it below.
        </p>
        <select
          id="cmw-scan-mode"
          value={scanMode}
          onChange={(e) => setScanMode(e.target.value as DetectionScanModePreset)}
          style={selectStyle}
        >
          {SCAN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p style={helperStyle}>
          {SCAN_OPTIONS.find((o) => o.value === scanMode)?.hint ?? ''}
        </p>
      </div>

      <div style={toggleRowStyle}>
        <input
          id="cmw-external-verify"
          type="checkbox"
          checked={externalOn}
          disabled={scanMode !== 'verified_research'}
          onChange={(e) => patchMetadata({ externalWebVerification: e.target.checked })}
          style={{ marginTop: 2, width: 18, height: 18, cursor: scanMode === 'verified_research' ? 'pointer' : 'not-allowed' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <label
            htmlFor="cmw-external-verify"
            style={{ ...labelStyle(t), marginBottom: 4, cursor: scanMode === 'verified_research' ? 'pointer' : 'default' }}
          >
            External web verification
          </label>
          <p style={{ margin: 0, fontSize: 11, color: t.textMuted, lineHeight: 1.45 }}>
            When enabled, read-only web search may verify or enrich findings. This is never implied—you must turn it on
            here. Only available for <strong>Verified research</strong>.
          </p>
          {scanMode !== 'verified_research' ? (
            <p style={{ margin: '8px 0 0', fontSize: 11, color: t.textMuted }}>
              Switch scan mode to Verified research to use this option.
            </p>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 8,
          padding: '14px 14px',
          borderRadius: 10,
          border: `1px dashed ${t.border}`,
          background: t.isLight ? '#fafafa' : 'rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Advanced (optional)
        </div>
        <label style={{ ...labelStyle(t), marginBottom: 4 }}>WR Expert profile</label>
        <p style={{ margin: '0 0 10px', fontSize: 11, color: t.textMuted, lineHeight: 1.45 }}>
          Upload a single <strong>.md</strong> file to tune detection emphasis and ignore hints. The file is parsed into
          structured rules—not used as raw prompt text. Optional; main settings stay above.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          style={{ display: 'none' }}
          aria-hidden
          onChange={onWrExpertFile}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={onWrExpertPick}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              background: t.tabBg,
              color: t.text,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Choose .md file…
          </button>
          {hasWrExpert ? (
            <>
              <span style={{ fontSize: 12, color: t.text, wordBreak: 'break-all' }}>{wrExpertName || 'Profile loaded'}</span>
              <button
                type="button"
                onClick={clearWrExpert}
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  border: 'none',
                  background: 'transparent',
                  color: t.errorText ?? '#b91c1c',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Remove
              </button>
            </>
          ) : null}
        </div>
        {wrExpertErr ? (
          <p style={{ margin: '8px 0 0', fontSize: 11, color: t.errorText ?? '#b91c1c' }} role="alert">
            {wrExpertErr}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="cmw-scope-urls" style={labelStyle(t)}>
          Scope URLs{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
          Limit attention to specific sites when you are not using the whole workstation. One URL or host pattern per
          line (e.g. https://app.example.com/ or github.com/your-org).
        </p>
        <textarea
          id="cmw-scope-urls"
          value={scopeUrlsText}
          onChange={(e) => patchMetadata({ [CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY]: e.target.value })}
          placeholder={'https://example.com/\nhttps://another.example.com/path'}
          style={inputStyleWithError(wizardTextareaStyle(t), t, scopeUrlErr)}
          aria-invalid={scopeUrlErr ? true : undefined}
          aria-describedby={scopeUrlErr ? 'cmw-scope-urls-err' : undefined}
          rows={3}
        />
        <WizardFieldError id="cmw-scope-urls-err" message={scopeUrlErr} t={t} />
      </div>
      <div>
        <label htmlFor="cmw-diff-folders" style={labelStyle(t)}>
          Diff watch folders{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
          When the desktop app is running, file adds or changes under these folders can post a diff into WR Chat (same
          as the Diff button). One absolute path per line. Leave empty to rely on URLs / focus only.
        </p>
        <textarea
          id="cmw-diff-folders"
          value={diffFoldersText}
          onChange={(e) => patchMetadata({ [CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY]: e.target.value })}
          placeholder={'C:\\path\\to\\project\nD:\\other\\repo'}
          rows={3}
          style={wizardTextareaStyle(t)}
          spellCheck={false}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          {canBrowse && (
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const pick = getElectronPickDirectory()
                  if (!pick) return
                  const p = await pick()
                  if (!p) return
                  const cur = diffFoldersText.trim()
                  const next = cur ? `${cur}\n${p}` : p
                  patchMetadata({ [CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY]: next })
                })()
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${t.border}`,
                background: t.tabBg,
                color: t.text,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Add folder…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
