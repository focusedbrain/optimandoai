/**
 * Modal for configuring WR Chat folder diff watchers (LIST + EDIT).
 * Styling aligned with `showTriggerPrompt` panels in PopupChatView / sidepanel.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { DiffTrigger } from '@shared/wrChat/diffTrigger'
import { normaliseTriggerTag } from '../../utils/normaliseTriggerTag'

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
}

type ViewMode = 'list' | 'edit'

function getPickDirectoryFn(): (() => Promise<string | null>) | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as Window & {
    electronAPI?: { pickDirectory?: () => Promise<string | null> }
    wrChat?: { pickDirectory?: () => Promise<string | null> }
  }
  return w.electronAPI?.pickDirectory ?? w.wrChat?.pickDirectory
}

export const DiffTriggerDialog: React.FC<DiffTriggerDialogProps> = ({
  open,
  onClose,
  watchers,
  onSave,
  onToggle,
  onDelete,
  theme = 'standard',
  hostOffline = false,
}) => {
  const isLight = theme === 'standard'
  const [view, setView] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [command, setCommand] = useState('')
  const [watchPath, setWatchPath] = useState('')

  const borderDefault = isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
  const borderFocus = isLight ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
  const labelColor = isLight ? '#475569' : 'rgba(255,255,255,0.70)'
  const titleColor = isLight ? '#0f172a' : 'rgba(255,255,255,0.85)'
  const panelBg = isLight ? '#f8fafc' : 'rgba(15,23,42,0.96)'
  const inputBg = isLight ? '#ffffff' : 'rgba(255,255,255,0.12)'
  const inputColor = isLight ? '#0f172a' : '#f8fafc'

  const cancelBtnStyle: React.CSSProperties = useMemo(
    () => ({
      padding: '6px 12px',
      background: isLight ? '#ffffff' : 'rgba(255,255,255,0.15)',
      border: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
      color: isLight ? '#0f172a' : '#ffffff',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
    }),
    [isLight],
  )

  const saveBtnStyle: React.CSSProperties = useMemo(
    () => ({
      padding: '6px 12px',
      background: '#22c55e',
      border: '1px solid #16a34a',
      color: '#0b1e12',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: 700,
    }),
    [],
  )

  const canBrowse = typeof getPickDirectoryFn() === 'function'

  useEffect(() => {
    if (!open) return
    setView('list')
    setEditingId(null)
    setName('')
    setTagInput('')
    setCommand('')
    setWatchPath('')
  }, [open])

  const editValidation = useMemo(() => {
    const n = name.trim()
    const rawTag = tagInput.trim()
    const path = watchPath.trim()
    const tag = normaliseTriggerTag(rawTag.startsWith('#') ? rawTag : rawTag ? `#${rawTag}` : '')
    const errors: { name?: string; tag?: string; folder?: string } = {}
    if (!n) errors.name = 'Name is required.'
    if (!rawTag) errors.tag = 'Tag is required.'
    else if (!tag) errors.tag = 'Enter a valid tag (e.g. logwatch).'
    if (!path) errors.folder = 'Folder path is required.'
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
    setView('edit')
  }, [])

  const openEdit = useCallback((w: DiffTrigger) => {
    setEditingId(w.id)
    setName(w.name)
    setTagInput(w.tag.replace(/^#/, ''))
    setCommand(w.command ?? '')
    setWatchPath(w.watchPath)
    setView('edit')
  }, [])

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

  const handleBrowse = useCallback(async () => {
    const fn = getPickDirectoryFn()
    if (typeof fn !== 'function') return
    try {
      const p = await fn()
      if (p) setWatchPath(p)
    } catch {
      /* noop */
    }
  }, [])

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
        background: 'rgba(0,0,0,0.45)',
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
        .wr-diff-dialog-field::placeholder { color: rgba(150,150,150,0.75); }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-diff-dialog-title"
        style={{
          width: '100%',
          maxWidth: 440,
          maxHeight: '90vh',
          overflow: 'auto',
          boxSizing: 'border-box',
          padding: '14px 16px',
          background: panelBg,
          borderRadius: 10,
          border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.12)',
          boxShadow: isLight ? '0 12px 40px rgba(15,23,42,0.12)' : '0 12px 40px rgba(0,0,0,0.45)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {view === 'list' ? (
          <>
            <div
              id="wr-diff-dialog-title"
              style={{
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 700,
                color: titleColor,
              }}
            >
              Diff Watchers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {hostOffline ? (
                <div
                  style={{
                    fontSize: 12,
                    color: '#b91c1c',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: isLight ? '#fef2f2' : 'rgba(248,113,113,0.15)',
                    border: '1px solid rgba(248,113,113,0.45)',
                  }}
                >
                  Host offline — WR Desk™ orchestrator is not reachable at{' '}
                  <code style={{ fontSize: 11 }}>127.0.0.1:51248</code>. Start the desktop app and try again.
                </div>
              ) : watchers.length === 0 ? (
                <div style={{ fontSize: 12, color: labelColor, padding: '8px 0' }}>No diff watchers yet.</div>
              ) : (
                watchers.map((w) => (
                  <div
                    key={w.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '10px 10px',
                      borderRadius: 8,
                      background: isLight ? '#ffffff' : 'rgba(255,255,255,0.06)',
                      border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.10)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: titleColor,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {w.name}{' '}
                          <span style={{ fontWeight: 500, opacity: 0.85 }}>({w.tag})</span>
                        </div>
                        <div
                          title={w.watchPath}
                          style={{
                            fontSize: 11,
                            color: labelColor,
                            marginTop: 2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {w.watchPath}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={w.enabled}
                        title={w.enabled ? 'Disable' : 'Enable'}
                        onClick={() => onToggle(w.id, !w.enabled)}
                        style={{
                          flexShrink: 0,
                          width: 44,
                          height: 24,
                          borderRadius: 12,
                          border: 'none',
                          cursor: 'pointer',
                          position: 'relative',
                          background: w.enabled ? '#22c55e' : isLight ? '#cbd5e1' : 'rgba(255,255,255,0.25)',
                          transition: 'background 0.15s',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: 3,
                            left: w.enabled ? 22 : 3,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: '#fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            transition: 'left 0.15s',
                          }}
                        />
                      </button>
                      <button
                        type="button"
                        title="Edit"
                        aria-label={`Edit ${w.name}`}
                        onClick={() => openEdit(w)}
                        style={{
                          flexShrink: 0,
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
                          background: isLight ? '#ffffff' : 'rgba(255,255,255,0.12)',
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
                          flexShrink: 0,
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: 'none',
                          background: 'rgba(239,68,68,0.22)',
                          color: '#f87171',
                          cursor: 'pointer',
                          fontSize: 16,
                          lineHeight: 1,
                          padding: 0,
                          fontWeight: 700,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
              <button type="button" onClick={openAdd} style={{ ...cancelBtnStyle, borderStyle: 'dashed' }}>
                + Add Watcher
              </button>
              <button type="button" onClick={onClose} style={cancelBtnStyle}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              id="wr-diff-dialog-title"
              style={{
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 700,
                color: titleColor,
              }}
            >
              {editingId ? 'Edit Diff Watcher' : 'Add Diff Watcher'}
            </div>

            <label
              htmlFor="wr-diff-folder"
              style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: labelColor }}
            >
              Folder
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: showFieldErrors && editValidation.errors.folder ? 4 : 10, alignItems: 'stretch' }}>
              <input
                id="wr-diff-folder"
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
                  flex: 1,
                  minWidth: 0,
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  background: inputBg,
                  border: borderDefault,
                  color: inputColor,
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              {canBrowse ? (
                <button
                  type="button"
                  onClick={handleBrowse}
                  style={{
                    flexShrink: 0,
                    padding: '0 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: isLight ? '#eef2ff' : 'rgba(99,102,241,0.25)',
                    border: isLight ? '1px solid #a5b4fc' : '1px solid rgba(165,180,252,0.45)',
                    color: isLight ? '#3730a3' : '#e0e7ff',
                  }}
                >
                  Browse…
                </button>
              ) : null}
            </div>
            {showFieldErrors && editValidation.errors.folder ? (
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 10 }}>{editValidation.errors.folder}</div>
            ) : null}

            <label
              htmlFor="wr-diff-name"
              style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: labelColor }}
            >
              Name
            </label>
            <input
              id="wr-diff-name"
              type="text"
              className="wr-diff-dialog-field"
              placeholder="My watcher"
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
                padding: '8px 10px',
                background: inputBg,
                border: borderDefault,
                color: inputColor,
                borderRadius: 6,
                fontSize: 12,
                marginBottom: showFieldErrors && editValidation.errors.name ? 4 : 10,
              }}
            />
            {showFieldErrors && editValidation.errors.name ? (
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 10 }}>{editValidation.errors.name}</div>
            ) : null}

            <label
              htmlFor="wr-diff-tag"
              style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: labelColor }}
            >
              Tag <span style={{ fontWeight: 400, opacity: 0.85 }}>(# prefix)</span>
            </label>
            <input
              id="wr-diff-tag"
              type="text"
              className="wr-diff-dialog-field"
              placeholder="#logwatch"
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
                padding: '8px 10px',
                background: inputBg,
                border: borderDefault,
                color: inputColor,
                borderRadius: 6,
                fontSize: 12,
                marginBottom: showFieldErrors && editValidation.errors.tag ? 4 : 10,
              }}
            />
            {showFieldErrors && editValidation.errors.tag ? (
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 10 }}>{editValidation.errors.tag}</div>
            ) : null}

            <label
              htmlFor="wr-diff-command"
              style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: labelColor }}
            >
              Command
            </label>
            <textarea
              id="wr-diff-command"
              className="wr-diff-dialog-field"
              placeholder="Optional instruction for the AI agent..."
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
                padding: '8px 10px',
                background: inputBg,
                border: borderDefault,
                color: inputColor,
                borderRadius: 6,
                fontSize: 12,
                minHeight: 72,
                marginBottom: 12,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
                }}
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
