/**
 * Modal for configuring WR Chat folder diff watchers (LIST + EDIT).
 * Folder selection is picker-first (WR Desk / Electron); manual path is an advanced fallback.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { DiffTrigger } from '@shared/wrChat/diffTrigger'
import { normaliseTriggerTag } from '../../utils/normaliseTriggerTag'
import { hasNativeFolderPicker, pickWatchFolderPath } from '../../utils/pickWatchFolderPath'

export type { DiffTrigger }

function newDiffTriggerId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `diff_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }
}

export interface DiffTriggerDialogProps {
  open: boolean
  onClose: () => void
  watchers: DiffTrigger[]
  onSave: (watcher: DiffTrigger) => void
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  /** Matches WR Chat chrome (`PopupChatView` theme). Default `standard`. */
  theme?: 'pro' | 'dark' | 'standard'
  /** When true, LIST view shows host offline instead of watchers. */
  hostOffline?: boolean
  /** IDs of diff watchers that have been pinned to the top-edge strip. */
  pinnedDiffIds?: string[]
  /** Toggle pin state for a diff watcher by ID. */
  onToggleDiffPin?: (id: string) => void
}

type ViewMode = 'list' | 'edit'

export const DiffTriggerDialog: React.FC<DiffTriggerDialogProps> = ({
  open,
  onClose,
  watchers,
  onSave,
  onToggle,
  onDelete,
  theme = 'standard',
  hostOffline = false,
  pinnedDiffIds = [],
  onToggleDiffPin,
}) => {
  const isLight = theme === 'standard'
  const [view, setView] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [command, setCommand] = useState('')
  const [watchPath, setWatchPath] = useState('')
  /** When native picker exists, hide manual path unless user opts in. */
  const [showManualPath, setShowManualPath] = useState(false)

  const nativePicker = hasNativeFolderPicker()

  const borderDefault = isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.12)'
  const borderFocus = isLight ? '1px solid #6366f1' : '1px solid rgba(129,140,248,0.85)'
  const labelColor = isLight ? '#64748b' : 'rgba(255,255,255,0.65)'
  const titleColor = isLight ? '#0f172a' : 'rgba(255,255,255,0.92)'
  const panelBg = isLight ? '#f1f5f9' : 'rgba(15,23,42,0.98)'
  const cardBg = isLight ? '#ffffff' : 'rgba(255,255,255,0.055)'
  const inputBg = isLight ? '#ffffff' : 'rgba(255,255,255,0.08)'
  const inputColor = isLight ? '#0f172a' : '#f8fafc'
  const accent = '#6366f1'
  const accentSoft = isLight ? '#eef2ff' : 'rgba(99,102,241,0.22)'

  const cancelBtnStyle: React.CSSProperties = useMemo(
    () => ({
      padding: '8px 14px',
      background: isLight ? '#ffffff' : 'rgba(255,255,255,0.1)',
      border: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.2)',
      color: titleColor,
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
    }),
    [isLight, titleColor],
  )

  const saveBtnStyle: React.CSSProperties = useMemo(
    () => ({
      padding: '8px 18px',
      background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
      border: '1px solid #15803d',
      color: '#052e16',
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 700,
      boxShadow: '0 2px 8px rgba(22,163,74,0.35)',
    }),
    [],
  )

  const primaryPickStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      padding: '12px 16px',
      fontSize: 13,
      fontWeight: 700,
      borderRadius: 10,
      border: 'none',
      cursor: 'pointer',
      color: '#fff',
      background: `linear-gradient(135deg, ${accent} 0%, #4f46e5 100%)`,
      boxShadow: `0 4px 14px rgba(99,102,241,0.4)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    }),
    [accent],
  )

  useEffect(() => {
    if (!open) return
    setView('list')
    setEditingId(null)
    setName('')
    setTagInput('')
    setCommand('')
    setWatchPath('')
    setShowManualPath(!nativePicker)
  }, [open, nativePicker])

  const editValidation = useMemo(() => {
    const n = name.trim()
    const rawTag = tagInput.trim()
    const path = watchPath.trim()
    const tag = normaliseTriggerTag(rawTag.startsWith('#') ? rawTag : rawTag ? `#${rawTag}` : '')
    const errors: { name?: string; tag?: string; folder?: string } = {}
    if (!n) errors.name = 'Name is required.'
    if (!rawTag) errors.tag = 'Tag is required.'
    else if (!tag) errors.tag = 'Enter a valid tag (e.g. logwatch).'
    if (!path) errors.folder = 'Choose a folder or paste a path.'
    const valid = !errors.name && !errors.tag && !errors.folder
    return { errors, valid }
  }, [name, tagInput, watchPath])

  const showFieldErrors =
    name.trim().length > 0 || tagInput.trim().length > 0 || watchPath.trim().length > 0

  const openAdd = useCallback(() => {
    setEditingId(null)
    setName('')
    setTagInput('')
    setCommand('')
    setWatchPath('')
    setShowManualPath(!nativePicker)
    setView('edit')
  }, [nativePicker])

  const openEdit = useCallback((w: DiffTrigger) => {
    setEditingId(w.id)
    setName(w.name)
    setTagInput(w.tag.replace(/^#/, ''))
    setCommand(w.command ?? '')
    setWatchPath(w.watchPath)
    setShowManualPath(!nativePicker)
    setView('edit')
  }, [nativePicker])

  const handleSave = useCallback(() => {
    const n = name.trim()
    const rawTag = tagInput.trim()
    const path = watchPath.trim()
    const tag = normaliseTriggerTag(rawTag.startsWith('#') ? rawTag : `#${rawTag}`)
    if (!n || !rawTag || !path || !tag) {
      return
    }
    const now = Date.now()
    const existing = editingId ? watchers.find((w) => w.id === editingId) : undefined
    const watcher: DiffTrigger = {
      type: 'diff',
      id: editingId ?? newDiffTriggerId(),
      name: n,
      tag,
      command: command.trim() || undefined,
      watchPath: path,
      enabled: existing?.enabled ?? true,
      updatedAt: now,
      ...(existing?.debounceMs !== undefined ? { debounceMs: existing.debounceMs } : {}),
      ...(existing?.maxBytes !== undefined ? { maxBytes: existing.maxBytes } : {}),
      ...(existing?.maxFiles !== undefined ? { maxFiles: existing.maxFiles } : {}),
    }
    onSave(watcher)
    setView('list')
    setEditingId(null)
  }, [name, tagInput, command, watchPath, editingId, onSave, watchers])

  const handleChooseFolder = useCallback(async () => {
    const p = await pickWatchFolderPath()
    if (p) setWatchPath(p)
  }, [])

  const handleQuickFolderChange = useCallback(
    async (w: DiffTrigger) => {
      const p = await pickWatchFolderPath()
      if (!p || p === w.watchPath) return
      onSave({
        ...w,
        watchPath: p,
        updatedAt: Date.now(),
      })
    },
    [onSave],
  )

  const handleDeleteRow = useCallback(
    (id: string) => {
      if (!confirm('Delete this diff watcher?')) return
      onDelete(id)
    },
    [onDelete],
  )

  if (!open) return null

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <style>{`
        .wr-diff-dialog-field::placeholder { color: rgba(148,163,184,0.9); }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-diff-dialog-title"
        style={{
          width: '100%',
          maxWidth: 472,
          maxHeight: '90vh',
          overflow: 'auto',
          boxSizing: 'border-box',
          padding: '18px 20px',
          background: panelBg,
          borderRadius: 14,
          border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)',
          boxShadow: isLight
            ? '0 24px 64px rgba(15,23,42,0.14), 0 0 0 1px rgba(255,255,255,0.8) inset'
            : '0 24px 64px rgba(0,0,0,0.55)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {view === 'list' ? (
          <>
            <div
              id="wr-diff-dialog-title"
              style={{
                marginBottom: 4,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: labelColor,
              }}
            >
              Automation
            </div>
            <div
              style={{
                marginBottom: 14,
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: titleColor,
              }}
            >
              Diff Watchers
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5, color: labelColor }}>
              Watch folders for file changes and send diffs into WR Chat. Pick a folder from disk — no typing required
              when WR Desk is running.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {hostOffline ? (
                <div
                  style={{
                    fontSize: 12,
                    color: '#b91c1c',
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: isLight ? '#fef2f2' : 'rgba(248,113,113,0.12)',
                    border: '1px solid rgba(248,113,113,0.35)',
                  }}
                >
                  Host offline — orchestrator is not reachable at{' '}
                  <code style={{ fontSize: 11 }}>127.0.0.1:51248</code>. Start the desktop app and try again.
                </div>
              ) : watchers.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: labelColor,
                    padding: '22px 16px',
                    textAlign: 'center',
                    borderRadius: 12,
                    border: borderDefault,
                    background: cardBg,
                  }}
                >
                  No watchers yet. Add one to link a project folder.
                </div>
              ) : (
                watchers.map((w) => (
                  <div
                    key={w.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: cardBg,
                      border: borderDefault,
                      boxShadow: isLight ? '0 1px 2px rgba(15,23,42,0.04)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                      <div
                        style={{
                          flexShrink: 0,
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: accentSoft,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                        aria-hidden
                      >
                        📁
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: titleColor,
                            lineHeight: 1.3,
                          }}
                        >
                          {w.name}{' '}
                          <span style={{ fontWeight: 600, opacity: 0.75 }}>({w.tag})</span>
                        </div>
                        <div
                          title={w.watchPath}
                          style={{
                            marginTop: 6,
                            fontSize: 11,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            color: isLight ? '#475569' : 'rgba(226,232,240,0.85)',
                            lineHeight: 1.45,
                            wordBreak: 'break-all',
                          }}
                        >
                          {w.watchPath}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={w.enabled}
                          title={w.enabled ? 'Disable' : 'Enable'}
                          onClick={() => onToggle(w.id, !w.enabled)}
                          style={{
                            width: 46,
                            height: 26,
                            borderRadius: 13,
                            border: 'none',
                            cursor: 'pointer',
                            position: 'relative',
                            background: w.enabled ? '#22c55e' : isLight ? '#cbd5e1' : 'rgba(255,255,255,0.22)',
                            transition: 'background 0.15s',
                          }}
                        >
                          <span
                            style={{
                              position: 'absolute',
                              top: 3,
                              left: w.enabled ? 24 : 3,
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: '#fff',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                              transition: 'left 0.15s',
                            }}
                          />
                        </button>
                        {nativePicker ? (
                          <button
                            type="button"
                            title="Change folder"
                            aria-label={`Change folder for ${w.name}`}
                            onClick={() => void handleQuickFolderChange(w)}
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              border: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.2)',
                              background: isLight ? '#fff' : 'rgba(255,255,255,0.08)',
                              cursor: 'pointer',
                              fontSize: 15,
                              lineHeight: 1,
                              padding: 0,
                            }}
                          >
                            📂
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title={pinnedDiffIds.includes(w.id) ? 'Remove icon from top edge' : 'Pin shortcut on chat edge'}
                          onClick={() => onToggleDiffPin?.(w.id)}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            border: 'none',
                            background: pinnedDiffIds.includes(w.id) ? 'rgba(99,102,241,0.35)' : 'transparent',
                            cursor: 'pointer',
                            fontSize: 16,
                            lineHeight: 1,
                            padding: 0,
                            opacity: 0.9,
                          }}
                        >
                          {pinnedDiffIds.includes(w.id) ? '🟣' : '◎'}
                        </button>
                        <button
                          type="button"
                          title="Edit details"
                          aria-label={`Edit ${w.name}`}
                          onClick={() => openEdit(w)}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            border: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.2)',
                            background: isLight ? '#fff' : 'rgba(255,255,255,0.08)',
                            cursor: 'pointer',
                            fontSize: 14,
                            lineHeight: 1,
                            padding: 0,
                            color: titleColor,
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          aria-label={`Delete ${w.name}`}
                          onClick={() => handleDeleteRow(w.id)}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            border: 'none',
                            background: 'rgba(239,68,68,0.15)',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: 17,
                            lineHeight: 1,
                            padding: 0,
                            fontWeight: 700,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={openAdd}
                style={{
                  ...cancelBtnStyle,
                  borderStyle: 'dashed',
                  borderColor: accent,
                  color: accent,
                  background: accentSoft,
                }}
              >
                + Add watcher
              </button>
              <button type="button" onClick={onClose} style={cancelBtnStyle}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                marginBottom: 4,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: labelColor,
              }}
            >
              {editingId ? 'Edit' : 'New watcher'}
            </div>
            <div
              id="wr-diff-dialog-title"
              style={{
                marginBottom: 14,
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: titleColor,
              }}
            >
              {editingId ? 'Edit diff watcher' : 'Add diff watcher'}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 8,
                  color: labelColor,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Watched folder
              </div>
              <div
                style={{
                  borderRadius: 12,
                  padding: 14,
                  background: isLight ? '#ffffff' : 'rgba(0,0,0,0.2)',
                  border: borderDefault,
                }}
              >
                {watchPath.trim() ? (
                  <div
                    title={watchPath}
                    style={{
                      fontSize: 12,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      color: inputColor,
                      lineHeight: 1.5,
                      wordBreak: 'break-all',
                      marginBottom: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: inputBg,
                      border: borderDefault,
                    }}
                  >
                    {watchPath}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: labelColor,
                      marginBottom: 12,
                      padding: '10px 0',
                    }}
                  >
                    No folder selected yet.
                  </div>
                )}

                {nativePicker ? (
                  <>
                    <button type="button" onClick={() => void handleChooseFolder()} style={primaryPickStyle}>
                      <span aria-hidden>📂</span>
                      {watchPath.trim() ? 'Change folder…' : 'Choose folder…'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualPath((v) => !v)}
                      style={{
                        marginTop: 10,
                        width: '100%',
                        padding: 0,
                        border: 'none',
                        background: 'none',
                        color: accent,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textUnderlineOffset: 2,
                      }}
                    >
                      {showManualPath ? 'Hide manual path' : 'Paste path manually (advanced)'}
                    </button>
                  </>
                ) : (
                  <p style={{ fontSize: 11, color: labelColor, marginBottom: 10, lineHeight: 1.45 }}>
                    Open this screen from <strong>WR Desk</strong> to use the native folder picker. Otherwise paste an
                    absolute path below.
                  </p>
                )}

                {(showManualPath || !nativePicker) && (
                  <input
                    type="text"
                    className="wr-diff-dialog-field"
                    placeholder="C:\path\to\folder"
                    value={watchPath}
                    onChange={(e) => setWatchPath(e.target.value)}
                    onFocus={(e) => {
                      e.currentTarget.style.border = borderFocus
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.border = borderDefault
                    }}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: nativePicker ? 10 : 0,
                      padding: '10px 12px',
                      background: inputBg,
                      border: borderDefault,
                      color: inputColor,
                      borderRadius: 8,
                      fontSize: 12,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    }}
                  />
                )}
                {showFieldErrors && editValidation.errors.folder ? (
                  <div style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>{editValidation.errors.folder}</div>
                ) : null}
              </div>
            </div>

            <label
              htmlFor="wr-diff-name"
              style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6, color: labelColor }}
            >
              Display name
            </label>
            <input
              id="wr-diff-name"
              type="text"
              className="wr-diff-dialog-field"
              placeholder="e.g. Tax workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => {
                e.currentTarget.style.border = borderFocus
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = borderDefault
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                background: inputBg,
                border: borderDefault,
                color: inputColor,
                borderRadius: 8,
                fontSize: 13,
                marginBottom: showFieldErrors && editValidation.errors.name ? 6 : 12,
              }}
            />
            {showFieldErrors && editValidation.errors.name ? (
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 10 }}>{editValidation.errors.name}</div>
            ) : null}

            <label
              htmlFor="wr-diff-tag"
              style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6, color: labelColor }}
            >
              Trigger tag
            </label>
            <input
              id="wr-diff-tag"
              type="text"
              className="wr-diff-dialog-field"
              placeholder="tax"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onFocus={(e) => {
                e.currentTarget.style.border = borderFocus
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = borderDefault
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                background: inputBg,
                border: borderDefault,
                color: inputColor,
                borderRadius: 8,
                fontSize: 13,
                marginBottom: showFieldErrors && editValidation.errors.tag ? 6 : 12,
              }}
            />
            {showFieldErrors && editValidation.errors.tag ? (
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 10 }}>{editValidation.errors.tag}</div>
            ) : null}

            <label
              htmlFor="wr-diff-command"
              style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6, color: labelColor }}
            >
              Agent instruction <span style={{ fontWeight: 500, opacity: 0.8 }}>(optional)</span>
            </label>
            <textarea
              id="wr-diff-command"
              className="wr-diff-dialog-field"
              placeholder="Optional context for the AI when a diff is posted…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onFocus={(e) => {
                e.currentTarget.style.border = borderFocus
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = borderDefault
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                background: inputBg,
                border: borderDefault,
                color: inputColor,
                borderRadius: 8,
                fontSize: 12,
                minHeight: 80,
                marginBottom: 16,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setView('list')
                  setEditingId(null)
                }}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!editValidation.valid}
                style={{
                  ...saveBtnStyle,
                  opacity: editValidation.valid ? 1 : 0.45,
                  cursor: editValidation.valid ? 'pointer' : 'not-allowed',
                  boxShadow: editValidation.valid ? saveBtnStyle.boxShadow : 'none',
                }}
              >
                Save watcher
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
