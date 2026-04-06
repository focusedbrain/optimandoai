/**
 * Wizard step: search focus and ignore instructions.
 */

import React, { useMemo } from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import {
  CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY,
  CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY,
  getDiffWatchFoldersDraftText,
  getScopeUrlsDraftText,
} from '../../../../shared/ui/customModeTypes'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { inputStyleWithError, wizardFieldColumnStyle, wizardTextareaStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'
import { getElectronPickDirectory } from '../../../../utils/electronPickDirectory'

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
  const md = useMemo(
    () => (data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}),
    [data.metadata],
  )
  const scopeUrlsText = getScopeUrlsDraftText(md)
  const diffFoldersText = getDiffWatchFoldersDraftText(md)
  const canBrowse = typeof getElectronPickDirectory() === 'function'

  const patchMetadata = (patch: Record<string, unknown>) => {
    setData({
      metadata: {
        ...md,
        ...patch,
      },
    })
  }

  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-focus" style={labelStyle(t)}>
          What this mode should look for{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <textarea
          id="cmw-focus"
          value={safeDraftString(data.searchFocus)}
          onChange={(e) => setData({ searchFocus: e.target.value })}
          placeholder="Topics, signals, or goals the assistant should prioritize in this mode…"
          style={wizardTextareaStyle(t)}
        />
      </div>
      <div>
        <label htmlFor="cmw-ignore" style={labelStyle(t)}>
          Ignore instructions{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <textarea
          id="cmw-ignore"
          value={safeDraftString(data.ignoreInstructions)}
          onChange={(e) => setData({ ignoreInstructions: e.target.value })}
          placeholder="What to deprioritize or skip (noise, off-topic areas)…"
          style={wizardTextareaStyle(t)}
        />
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
