/**
 * Per-mode pencil (edit) and x (delete) controls — separate click targets from row selection.
 */

import React, { useCallback } from 'react'
import { useCustomModesStore } from '../../stores/useCustomModesStore'
import { isModeDeletable } from '../../shared/ui/customModeTypes'
import { confirmDeleteMode, openModeEditWizard } from './modeRowActions'

export type ModeRowAffordancesProps = {
  modeId: string
  /** Called after edit opens or delete succeeds (e.g. close parent dropdown). */
  onAfterAction?: () => void
  /** When delete succeeds and this mode was active. */
  onDeleted?: (modeId: string) => void
  compact?: boolean
  /** Theme hint for icon contrast on light/dark dropdown surfaces. */
  tone?: 'light' | 'dark' | 'default'
}

const TONE_FG: Record<NonNullable<ModeRowAffordancesProps['tone']>, string> = {
  light: 'var(--text-secondary, #64748b)',
  dark: 'rgba(226,232,240,0.85)',
  default: 'var(--text-secondary, rgba(255,255,255,0.75))',
}

export function ModeRowAffordances({
  modeId,
  onAfterAction,
  onDeleted,
  compact = false,
  tone = 'default',
}: ModeRowAffordancesProps) {
  const def = useCustomModesStore((s) => s.modes.find((m) => m.id === modeId))
  const removeMode = useCustomModesStore((s) => s.removeMode)
  const canDelete = def != null && isModeDeletable(def)
  const fg = TONE_FG[tone]

  const iconBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: compact ? 22 : 26,
    height: compact ? 22 : 26,
    padding: 0,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: fg,
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: compact ? 12 : 13,
    lineHeight: 1,
  }

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openModeEditWizard(modeId)
      onAfterAction?.()
    },
    [modeId, onAfterAction],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!confirmDeleteMode(def, removeMode)) return
      onDeleted?.(modeId)
      onAfterAction?.()
    },
    [def, modeId, onAfterAction, onDeleted, removeMode],
  )

  return (
    <span
      className="mode-row-affordances"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title={`Edit mode${def?.name ? `: ${def.name}` : ''}`}
        aria-label={`Edit mode${def?.name ? `: ${def.name}` : ''}`}
        style={iconBtnStyle}
        onClick={handleEdit}
      >
        ✎
      </button>
      {canDelete ? (
        <button
          type="button"
          title={`Delete mode${def?.name ? `: ${def.name}` : ''}`}
          aria-label={`Delete mode${def?.name ? `: ${def.name}` : ''}`}
          style={{ ...iconBtnStyle, color: 'var(--text-primary, #b91c1c)' }}
          onClick={handleDelete}
        >
          ×
        </button>
      ) : null}
    </span>
  )
}
