import { useCallback, useEffect } from 'react'
import type { ChangeEvent } from 'react'
import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import {
  canAccessLetterVaultCategory,
  fetchAndMapVaultItem,
  listLetterVaultItems,
} from '../chat/routing/letterVaultHelper'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { useLetterComposerStore } from '../stores/useLetterComposerStore'
import { LetterTemplatePort } from './LetterTemplatePort'
import { LetterViewerPort } from './LetterViewerPort'
import './LetterComposerView.css'

/** Pushes letter-composer into chat focus. `focusedPort` is set by port buttons or implicitly when a template field is focused (`setFocusedTemplateField`). */
function syncLetterComposerChatFocus() {
  const lc = useLetterComposerStore.getState()
  const st = useChatFocusStore.getState()
  if (!lc.focusedPort) {
    if (st.chatFocusMode.mode === 'letter-composer') {
      st.clearChatFocusMode()
    }
    return
  }
  const startedAt =
    st.chatFocusMode.mode === 'letter-composer' && 'startedAt' in st.chatFocusMode
      ? st.chatFocusMode.startedAt
      : new Date().toISOString()

  if (lc.focusedPort === 'template') {
    const t = lc.templates.find((x) => x.id === lc.activeTemplateId)
    const excerpt = t
      ? [
          `Letter template "${t.name}" (${t.pageCount} page(s), PDF preview).`,
          t.fields.length
            ? `Fields: ${t.fields.map((f) => `${f.label} (${f.name})`).join('; ')}`
            : 'Field mapping not completed yet.',
        ]
          .join('\n')
          .slice(0, 12_000)
      : ''
    st.setChatFocusMode(
      { mode: 'letter-composer', startedAt },
      {
        letterComposerPort: 'template',
        letterComposerTemplateId: lc.activeTemplateId,
        letterComposerFields: (t?.fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          value: f.value,
        })),
        letterComposerApplyFieldId: lc.focusedTemplateFieldId,
        letterComposerTemplateHtmlExcerpt: excerpt,
      },
    )
  } else {
    const letter = lc.letters.find((l) => l.id === lc.activeLetterId)
    const pageIdx = Math.max(0, lc.activeLetterPage)
    const page = letter?.pages[pageIdx]
    const fullExcerpt = (letter?.fullText ?? '').trim().slice(0, 12_000)
    const pageText = (page?.text ?? '').trim()
    const text = fullExcerpt || pageText
    const meta =
      letter && Object.keys(letter.extractedFields).length > 0
        ? `\n\nExtracted metadata (may need verification):\n${Object.entries(letter.extractedFields)
            .filter(([, v]) => (v ?? '').trim().length > 0)
            .map(([k, v]) => `- ${k}: ${v}`)
            .join('\n')}`
        : ''
    st.setChatFocusMode(
      { mode: 'letter-composer', startedAt },
      {
        letterComposerPort: 'letter',
        letterComposerLetterPageText: `${text}${meta}`,
      },
    )
  }
}

export function LetterComposerView({ onClose }: { onClose: () => void }) {
  const letterVaultSource = useLetterComposerStore((s) => s.letterVaultSource)
  const letterVaultItems = useLetterComposerStore((s) => s.letterVaultItems)
  const letterVaultSelectedItemId = useLetterComposerStore((s) => s.letterVaultSelectedItemId)
  const letterVaultPreview = useLetterComposerStore((s) => s.letterVaultPreview)
  const letterVaultApplied = useLetterComposerStore((s) => s.letterVaultApplied)
  const letterVaultLoading = useLetterComposerStore((s) => s.letterVaultLoading)
  const letterVaultError = useLetterComposerStore((s) => s.letterVaultError)

  const setLetterVaultSource = useLetterComposerStore((s) => s.setLetterVaultSource)
  const setLetterVaultItems = useLetterComposerStore((s) => s.setLetterVaultItems)
  const setLetterVaultSelectedItemId = useLetterComposerStore((s) => s.setLetterVaultSelectedItemId)
  const setLetterVaultPreview = useLetterComposerStore((s) => s.setLetterVaultPreview)
  const setLetterVaultData = useLetterComposerStore((s) => s.setLetterVaultData)
  const setLetterVaultLoading = useLetterComposerStore((s) => s.setLetterVaultLoading)
  const setLetterVaultError = useLetterComposerStore((s) => s.setLetterVaultError)
  const applyVaultDataToTemplate = useLetterComposerStore((s) => s.applyVaultDataToTemplate)

  const handleItemSelect = useCallback(
    async (itemId: string, category: 'company' | 'personal') => {
      if (!itemId) {
        setLetterVaultSelectedItemId(null)
        setLetterVaultPreview(null)
        setLetterVaultData(null)
        return
      }

      setLetterVaultLoading(true)
      setLetterVaultError(null)
      setLetterVaultSelectedItemId(itemId)

      const result = await fetchAndMapVaultItem(itemId, category)
      if (result.success && result.data) {
        setLetterVaultPreview(result.data)
        setLetterVaultData(result.data)
        setLetterVaultError(null)
      } else {
        setLetterVaultError(result.error ?? 'fetch_failed')
        setLetterVaultPreview(null)
        setLetterVaultData(null)
      }
      setLetterVaultLoading(false)
    },
    [
      setLetterVaultSelectedItemId,
      setLetterVaultPreview,
      setLetterVaultData,
      setLetterVaultLoading,
      setLetterVaultError,
    ],
  )

  const checkVaultAndLoadItems = useCallback(
    async (source: 'company' | 'personal') => {
      setLetterVaultLoading(true)
      setLetterVaultError(null)

      try {
        const status = await window.handshakeView?.getVaultStatus?.()
        if (!status?.isUnlocked) {
          setLetterVaultError('vault_locked')
          setLetterVaultItems([])
          setLetterVaultLoading(false)
          return
        }
      } catch {
        setLetterVaultError('vault_locked')
        setLetterVaultItems([])
        setLetterVaultLoading(false)
        return
      }

      const access = await canAccessLetterVaultCategory(source)
      if (!access.allowed) {
        setLetterVaultError(access.reason || 'tier_too_low')
        setLetterVaultItems([])
        setLetterVaultLoading(false)
        return
      }

      const listResult = await listLetterVaultItems(source)
      if (!listResult.success || !listResult.items?.length) {
        setLetterVaultError(listResult.error ?? 'no_items')
        setLetterVaultItems([])
        setLetterVaultLoading(false)
        return
      }

      setLetterVaultItems(listResult.items)

      if (listResult.items.length === 1) {
        await handleItemSelect(listResult.items[0].id, source)
      } else {
        setLetterVaultLoading(false)
      }
    },
    [
      handleItemSelect,
      setLetterVaultError,
      setLetterVaultItems,
      setLetterVaultLoading,
    ],
  )

  const handleCategoryChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const source = e.target.value as 'company' | 'personal' | 'none'
      setLetterVaultSource(source)
    },
    [setLetterVaultSource],
  )

  useEffect(() => {
    if (letterVaultSource === 'none') return
    void checkVaultAndLoadItems(letterVaultSource)
  }, [letterVaultSource, checkVaultAndLoadItems])

  useEffect(() => {
    const onVaultStatusChanged = () => {
      const src = useLetterComposerStore.getState().letterVaultSource
      if (src === 'none') return
      void checkVaultAndLoadItems(src)
    }
    window.addEventListener('vault-status-changed', onVaultStatusChanged)
    return () => window.removeEventListener('vault-status-changed', onVaultStatusChanged)
  }, [checkVaultAndLoadItems])

  const handleApplyClick = useCallback(() => {
    applyVaultDataToTemplate()
  }, [applyVaultDataToTemplate])

  const handleClose = useCallback(() => {
    useDraftRefineStore.getState().disconnect()
    useLetterComposerStore.getState().setFocusedTemplateField(null)
    onClose()
  }, [onClose])

  useEffect(() => {
    const unsub = useLetterComposerStore.subscribe(syncLetterComposerChatFocus)
    syncLetterComposerChatFocus()
    return () => {
      unsub()
      if (useChatFocusStore.getState().chatFocusMode.mode === 'letter-composer') {
        useChatFocusStore.getState().clearChatFocusMode()
      }
      useDraftRefineStore.getState().disconnect()
      useLetterComposerStore.getState().setFocusedTemplateField(null)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  const previewPrimary =
    letterVaultPreview?.name?.trim() ||
    letterVaultPreview?.companyName?.trim() ||
    ''
  const previewAddressLine = letterVaultPreview?.address
    ? letterVaultPreview.address.split('\n')[0]
    : ''
  const previewLine =
    letterVaultPreview && !letterVaultApplied
      ? [previewPrimary, previewAddressLine].filter(Boolean).join(' — ') ||
        letterVaultPreview.email?.trim() ||
        letterVaultPreview.phone?.trim() ||
        'Data loaded'
      : ''

  const vaultActive = letterVaultSource !== 'none'

  return (
    <div className="letter-composer-view">
      <div className="letter-composer-vault-bar">
        <label className="letter-composer-vault-bar__label" htmlFor="letter-vault-category">
          Sender data:
        </label>
        <select
          id="letter-vault-category"
          className="letter-composer-vault-bar__select"
          value={letterVaultSource}
          onChange={handleCategoryChange}
          aria-label="Sender data source"
        >
          <option value="none">Manual</option>
          <option value="company">Company Data (Vault)</option>
          <option value="personal">Personal Data (Vault)</option>
        </select>

        {vaultActive && letterVaultError === 'vault_locked' && (
          <span className="letter-composer-vault-bar__err letter-composer-vault-bar__err--pad">
            🔒 Vault is locked — unlock to use vault data
          </span>
        )}
        {vaultActive && letterVaultError === 'tier_too_low' && (
          <span className="letter-composer-vault-bar__err letter-composer-vault-bar__err--pad">
            ⭐ Upgrade required for this data category
          </span>
        )}
        {vaultActive && letterVaultError === 'no_items' && (
          <span className="letter-composer-vault-bar__err letter-composer-vault-bar__err--pad">
            No data found — set up in Data Manager
          </span>
        )}

        {vaultActive && letterVaultItems.length > 1 && !letterVaultError && (
          <select
            className="letter-composer-vault-bar__select"
            value={letterVaultSelectedItemId ?? ''}
            onChange={(e) =>
              void handleItemSelect(e.target.value, letterVaultSource as 'company' | 'personal')
            }
            aria-label="Vault item"
          >
            <option value="">Select profile…</option>
            {letterVaultItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}

        {vaultActive && letterVaultItems.length === 1 && !letterVaultError && (
          <span className="letter-composer-vault-bar__single-title">
            {letterVaultItems[0].title}
          </span>
        )}

        {letterVaultPreview && !letterVaultApplied && (
          <span className="letter-composer-vault-bar__preview" title={previewLine}>
            {previewLine}
          </span>
        )}

        {letterVaultPreview && !letterVaultApplied && (
          <button
            type="button"
            className="letter-composer-vault-bar__apply letter-composer-vault-bar__apply--primary"
            onClick={handleApplyClick}
          >
            Apply to Template
          </button>
        )}

        {letterVaultApplied && (
          <span className="letter-composer-vault-bar__applied">✓ Applied</span>
        )}

        {letterVaultLoading && (
          <span className="letter-composer-vault-bar__hint">Loading…</span>
        )}

        {vaultActive &&
          letterVaultError &&
          letterVaultError !== 'vault_locked' &&
          letterVaultError !== 'tier_too_low' &&
          letterVaultError !== 'no_items' && (
            <span className="letter-composer-vault-bar__err" title={letterVaultError}>
              {letterVaultError}
            </span>
          )}
      </div>
      <div className="letter-composer-grid">
        <div className="letter-composer-port letter-composer-port--template">
          <LetterTemplatePort />
        </div>

        <div className="letter-composer-port letter-composer-port--viewer">
          <LetterViewerPort />
        </div>
      </div>
    </div>
  )
}
