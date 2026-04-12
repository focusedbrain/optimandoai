import type { FieldMode, FieldType, TemplateField } from '../stores/useLetterComposerStore'
import { slugifyTemplateFieldName } from '../stores/useLetterComposerStore'
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_W = 0.012
const MIN_H = 0.012

export function getFieldColor(type: FieldType): string {
  switch (type) {
    case 'address':
      return '#2563eb'
    case 'date':
      return '#d97706'
    case 'text':
      return '#059669'
    case 'multiline':
      return '#7c3aed'
    case 'richtext':
      return '#dc2626'
    default:
      return '#6b7280'
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function clampRect(r: { x: number; y: number; w: number; h: number }): {
  x: number
  y: number
  w: number
  h: number
} {
  let { x, y, w, h } = r
  x = clamp01(x)
  y = clamp01(y)
  w = Math.max(MIN_W, Math.min(w, 1 - x))
  h = Math.max(MIN_H, Math.min(h, 1 - y))
  return { x, y, w, h }
}

function normalizeDrawRect(nx1: number, ny1: number, nx2: number, ny2: number) {
  const x = Math.min(nx1, nx2)
  const y = Math.min(ny1, ny2)
  const w = Math.abs(nx2 - nx1)
  const h = Math.abs(ny2 - ny1)
  return clampRect({ x, y, w, h })
}

export type PdfPageTextItem = { text: string; x: number; y: number; w: number; h: number }

/** Text items overlapping a normalized rect (PDF preview / overlay coordinates). */
export function getTextInRect(
  textItems: PdfPageTextItem[],
  rect: { x: number; y: number; w: number; h: number },
): string {
  const overlapping = textItems.filter((item) => {
    const itemRight = item.x + item.w
    const itemBottom = item.y + item.h
    const rectRight = rect.x + rect.w
    const rectBottom = rect.y + rect.h
    return item.x < rectRight && itemRight > rect.x && item.y < rectBottom && itemBottom > rect.y
  })
  overlapping.sort((a, b) => {
    const rowDiff = Math.round((a.y - b.y) * 100)
    if (Math.abs(rowDiff) > 2) return rowDiff
    return a.x - b.x
  })
  return overlapping.map((i) => i.text).join(' ').trim()
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

function fixedPointForCorner(
  field: { x: number; y: number; w: number; h: number },
  corner: ResizeCorner,
): { fx: number; fy: number } {
  const { x, y, w, h } = field
  switch (corner) {
    case 'nw':
      return { fx: x + w, fy: y + h }
    case 'ne':
      return { fx: x, fy: y + h }
    case 'sw':
      return { fx: x + w, fy: y }
    case 'se':
      return { fx: x, fy: y }
    default:
      return { fx: x, fy: y }
  }
}

export interface FieldMappingOverlayProps {
  pageImage: string
  pageIndex: number
  fields: TemplateField[]
  /** PDF text layer for this page (normalized positions) — used to set anchorText when drawing zones. */
  pageTextItems?: PdfPageTextItem[]
  /** AI-suggested zones (dashed) until the user confirms them into `fields`. */
  suggestionFields?: TemplateField[]
  readOnly?: boolean
  onFieldAdded: (field: Omit<TemplateField, 'id' | 'value'>) => void
  onFieldRemoved: (fieldId: string) => void
  onFieldUpdated: (fieldId: string, patch: Partial<TemplateField>) => void
  onSuggestionConfirm?: (fieldId: string) => void
  onSuggestionRemoved?: (fieldId: string) => void
  onSuggestionUpdated?: (fieldId: string, patch: Partial<TemplateField>) => void
}

type Preset = { name: string; label: string; type: FieldType; mode: FieldMode }

const PRESETS: Preset[] = [
  { name: 'sender_address', label: 'Sender Address', type: 'address', mode: 'fixed' },
  { name: 'recipient', label: 'Recipient', type: 'address', mode: 'fixed' },
  { name: 'date', label: 'Date', type: 'date', mode: 'fixed' },
  { name: 'subject', label: 'Subject', type: 'text', mode: 'flow' },
  { name: 'salutation', label: 'Salutation', type: 'text', mode: 'flow' },
  { name: 'body', label: 'Body', type: 'richtext', mode: 'flow' },
  { name: 'closing', label: 'Closing', type: 'text', mode: 'flow' },
  { name: 'signer', label: 'Signer Name', type: 'text', mode: 'fixed' },
]

export function FieldMappingOverlay({
  pageImage,
  pageIndex,
  fields,
  pageTextItems = [],
  suggestionFields = [],
  readOnly = false,
  onFieldAdded,
  onFieldRemoved,
  onFieldUpdated,
  onSuggestionConfirm,
  onSuggestionRemoved,
  onSuggestionUpdated,
}: FieldMappingOverlayProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })

  const [pendingPreset, setPendingPreset] = useState<Preset | null>(null)
  const drawRef = useRef<null | { nx1: number; ny1: number }>(null)
  const latestDraftRef = useRef<null | { x: number; y: number; w: number; h: number }>(null)
  const [draftRect, setDraftRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)

  const [newFieldRect, setNewFieldRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')
  const [newMode, setNewMode] = useState<FieldMode>('fixed')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editType, setEditType] = useState<FieldType>('text')
  const [editMode, setEditMode] = useState<FieldMode>('fixed')

  const resizeRef = useRef<null | { fieldId: string; fixNx: number; fixNy: number }>(null)

  const pageConfirmed = fields.filter((f) => f.page === pageIndex)
  const pageSuggestions = suggestionFields.filter((f) => f.page === pageIndex)
  const suggestionIdsRef = useRef<Set<string>>(new Set())
  suggestionIdsRef.current = new Set(suggestionFields.map((f) => f.id))

  const measureImage = useCallback(() => {
    const img = imageRef.current
    if (!img) return
    setImgSize({ w: img.clientWidth, h: img.clientHeight })
  }, [])

  useEffect(() => {
    const img = imageRef.current
    if (!img) return
    const ro = new ResizeObserver(() => measureImage())
    ro.observe(img)
    measureImage()
    return () => ro.disconnect()
  }, [measureImage, pageImage])

  const clientToNorm = useCallback((clientX: number, clientY: number) => {
    const img = imageRef.current
    if (!img) return { nx: 0, ny: 0 }
    const r = img.getBoundingClientRect()
    return {
      nx: clamp01((clientX - r.left) / r.width),
      ny: clamp01((clientY - r.top) / r.height),
    }
  }, [])

  const clearNewPopup = useCallback(() => {
    setNewFieldRect(null)
    setNewLabel('')
    setNewType('text')
    setNewMode('fixed')
  }, [])

  const pendingPresetRef = useRef(pendingPreset)
  pendingPresetRef.current = pendingPreset
  const pageIndexRef = useRef(pageIndex)
  pageIndexRef.current = pageIndex
  const onFieldAddedRef = useRef(onFieldAdded)
  onFieldAddedRef.current = onFieldAdded
  const onFieldUpdatedRef = useRef(onFieldUpdated)
  onFieldUpdatedRef.current = onFieldUpdated
  const onSuggestionUpdatedRef = useRef(onSuggestionUpdated)
  onSuggestionUpdatedRef.current = onSuggestionUpdated

  const pageTextItemsRef = useRef(pageTextItems)
  pageTextItemsRef.current = pageTextItems

  const normFromEvent = useCallback((e: MouseEvent) => {
    const img = imageRef.current
    if (!img) return { nx: 0, ny: 0 }
    const r = img.getBoundingClientRect()
    return {
      nx: clamp01((e.clientX - r.left) / r.width),
      ny: clamp01((e.clientY - r.top) / r.height),
    }
  }, [])

  useEffect(() => {
    if (readOnly) return

    const onMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const { fieldId, fixNx, fixNy } = resizeRef.current
        const { nx: mx, ny: my } = normFromEvent(e)
        const next = normalizeDrawRect(mx, my, fixNx, fixNy)
        if (suggestionIdsRef.current.has(fieldId)) {
          onSuggestionUpdatedRef.current?.(fieldId, next)
        } else {
          onFieldUpdatedRef.current?.(fieldId, next)
        }
        return
      }

      if (drawRef.current) {
        const { nx, ny } = normFromEvent(e)
        const r = normalizeDrawRect(drawRef.current.nx1, drawRef.current.ny1, nx, ny)
        latestDraftRef.current = r
        setDraftRect(r)
      }
    }

    const onUp = () => {
      if (resizeRef.current) {
        resizeRef.current = null
        return
      }

      if (drawRef.current) {
        const d = latestDraftRef.current
        drawRef.current = null
        latestDraftRef.current = null
        setDraftRect(null)
        const ok = d && d.w >= MIN_W && d.h >= MIN_H
        if (ok && d) {
          const preset = pendingPresetRef.current
          if (preset) {
            const anchor = getTextInRect(pageTextItemsRef.current, d)
            onFieldAddedRef.current({
              name: preset.name,
              label: preset.label,
              type: preset.type,
              mode: preset.mode,
              page: pageIndexRef.current,
              x: d.x,
              y: d.y,
              w: d.w,
              h: d.h,
              anchorText: anchor,
              defaultValue: anchor,
            })
            setPendingPreset(null)
          } else {
            setNewFieldRect(d)
            setNewLabel('')
            setNewType('text')
            setNewMode('fixed')
          }
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [readOnly, normFromEvent])

  const onMouseDownStage = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return
      if (e.button !== 0) return
      const t = e.target as HTMLElement
      if (t.closest('.field-rect') || t.closest('.field-mapping-popup') || t.closest('.field-presets')) return
      const { nx, ny } = clientToNorm(e.clientX, e.clientY)
      drawRef.current = { nx1: nx, ny1: ny }
      latestDraftRef.current = { x: nx, y: ny, w: 0, h: 0 }
      setDraftRect({ x: nx, y: ny, w: 0, h: 0 })
      setSelectedId(null)
    },
    [readOnly, clientToNorm],
  )

  const startPreset = useCallback((p: Preset) => {
    setPendingPreset(p)
    setSelectedId(null)
    clearNewPopup()
  }, [clearNewPopup])

  const cancelPreset = useCallback(() => setPendingPreset(null), [])

  const saveNewField = useCallback(() => {
    if (!newFieldRect) return
    const label = newLabel.trim() || 'Field'
    const anchor = getTextInRect(pageTextItems, newFieldRect)
    onFieldAdded({
      name: slugifyTemplateFieldName(label),
      label,
      type: newType,
      mode: newMode,
      page: pageIndex,
      x: newFieldRect.x,
      y: newFieldRect.y,
      w: newFieldRect.w,
      h: newFieldRect.h,
      anchorText: anchor,
      defaultValue: anchor,
    })
    clearNewPopup()
  }, [newFieldRect, newLabel, newType, newMode, pageIndex, pageTextItems, onFieldAdded, clearNewPopup])

  const openEdit = useCallback(
    (f: TemplateField) => {
      if (suggestionIdsRef.current.has(f.id)) return
      setSelectedId(f.id)
      setEditLabel(f.label)
      setEditType(f.type)
      setEditMode(f.mode)
      clearNewPopup()
    },
    [clearNewPopup],
  )

  const saveEdit = useCallback(() => {
    if (!selectedId) return
    const label = editLabel.trim() || 'Field'
    onFieldUpdated(selectedId, {
      label,
      name: slugifyTemplateFieldName(label),
      type: editType,
      mode: editMode,
    })
    setSelectedId(null)
  }, [selectedId, editLabel, editType, editMode, onFieldUpdated])

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent, field: TemplateField, corner: ResizeCorner) => {
      if (readOnly) return
      e.stopPropagation()
      e.preventDefault()
      const { fx, fy } = fixedPointForCorner(field, corner)
      resizeRef.current = { fieldId: field.id, fixNx: fx, fixNy: fy }
    },
    [readOnly],
  )

  return (
    <div      ref={stageRef}
      className={`field-mapping-stage${pendingPreset ? ' field-mapping-stage--crosshair' : ''}`}
    >
      <img
        ref={imageRef}
        src={pageImage}
        alt=""
        className="field-mapping-image"
        draggable={false}
        onLoad={measureImage}
      />
      {imgSize.w > 0 && imgSize.h > 0 ? (
        <div
          className="field-mapping-layer"
          style={{ width: imgSize.w, height: imgSize.h }}
          onMouseDown={onMouseDownStage}
        >
          {pageSuggestions.map((field) => {
            const c = getFieldColor(field.type)
            return (
              <div
                key={`s-${field.id}`}
                role="button"
                tabIndex={0}
                title="Click to confirm this suggested field"
                className={`field-rect field-rect--suggestion field-rect--${field.type}`}
                style={{
                  left: `${field.x * 100}%`,
                  top: `${field.y * 100}%`,
                  width: `${field.w * 100}%`,
                  height: `${field.h * 100}%`,
                  border: '2px dashed',
                  borderColor: c,
                  background: `${c}12`,
                  zIndex: 3,
                }}
                onMouseDown={(e) => {
                  if (readOnly) return
                  e.stopPropagation()
                  if ((e.target as HTMLElement).closest('.field-rect-delete')) return
                  if ((e.target as HTMLElement).closest('.field-rect-handle')) return
                  onSuggestionConfirm?.(field.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSuggestionConfirm?.(field.id)
                  }
                }}
              >
                <span className="field-rect-label">
                  {field.label}
                  <span className="field-rect-suggestion-badge"> AI</span>
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    className="field-rect-delete"
                    aria-label={`Dismiss suggestion ${field.label}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSuggestionRemoved?.(field.id)
                    }}
                  >
                    ×
                  </button>
                )}
                {!readOnly && (
                  <>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        className={`field-rect-handle field-rect-handle--${corner}`}
                        aria-label={`Resize ${corner}`}
                        onMouseDown={(e) => onResizeMouseDown(e, field, corner)}
                      />
                    ))}
                  </>
                )}
              </div>
            )
          })}
          {pageConfirmed.map((field) => {
            const c = getFieldColor(field.type)
            const isSel = selectedId === field.id
            return (
              <div
                key={field.id}
                role="button"
                tabIndex={0}
                className={`field-rect field-rect--confirmed field-rect--${field.type}${isSel ? ' field-rect--selected' : ''}`}
                style={{
                  left: `${field.x * 100}%`,
                  top: `${field.y * 100}%`,
                  width: `${field.w * 100}%`,
                  height: `${field.h * 100}%`,
                  border: '2px solid',
                  borderColor: c,
                  background: `${c}15`,
                  zIndex: 5,
                }}
                onMouseDown={(e) => {
                  if (readOnly) return
                  e.stopPropagation()
                  if ((e.target as HTMLElement).closest('.field-rect-delete')) return
                  if ((e.target as HTMLElement).closest('.field-rect-handle')) return
                  openEdit(field)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openEdit(field)
                  }
                }}
              >
                <span className="field-rect-label">{field.label}</span>
                {!readOnly && (
                  <button
                    type="button"
                    className="field-rect-delete"
                    aria-label={`Remove ${field.label}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onFieldRemoved(field.id)
                      if (selectedId === field.id) setSelectedId(null)
                    }}
                  >
                    ×
                  </button>
                )}
                {!readOnly && (
                  <>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        className={`field-rect-handle field-rect-handle--${corner}`}
                        aria-label={`Resize ${corner}`}
                        onMouseDown={(e) => onResizeMouseDown(e, field, corner)}
                      />
                    ))}
                  </>
                )}
              </div>
            )
          })}

          {!readOnly && draftRect && draftRect.w >= MIN_W && draftRect.h >= MIN_H ? (
            <div
              className="field-rect field-rect--draft"
              style={{
                left: `${draftRect.x * 100}%`,
                top: `${draftRect.y * 100}%`,
                width: `${draftRect.w * 100}%`,
                height: `${draftRect.h * 100}%`,
              }}
            />
          ) : null}

          {!readOnly && newFieldRect ? (
            <div className="field-mapping-popup" style={{ left: 8, top: 8 }}>
              <div className="field-mapping-popup__title">Field name?</div>
              <input
                className="field-mapping-popup__input"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Recipient Address"
                autoFocus
              />
              <label className="field-mapping-popup__row">
                Type
                <select
                  className="field-mapping-popup__select"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as FieldType)}
                >
                  <option value="text">text</option>
                  <option value="date">date</option>
                  <option value="multiline">multiline</option>
                  <option value="address">address</option>
                  <option value="richtext">richtext</option>
                </select>
              </label>
              <label className="field-mapping-popup__row">
                Mode
                <select
                  className="field-mapping-popup__select"
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as FieldMode)}
                >
                  <option value="fixed">fixed</option>
                  <option value="flow">flow</option>
                </select>
              </label>
              <div className="field-mapping-popup__actions">
                <button type="button" className="template-toolbar__btn template-toolbar__btn--primary" onClick={saveNewField}>
                  Save
                </button>
                <button
                  type="button"
                  className="template-toolbar__btn template-toolbar__btn--ghost"
                  onClick={clearNewPopup}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {!readOnly && selectedId && pageConfirmed.some((f) => f.id === selectedId) ? (
            <div className="field-mapping-popup field-mapping-popup--edit" style={{ right: 8, top: 8, left: 'auto' }}>
              <div className="field-mapping-popup__title">Edit field</div>
              <input
                className="field-mapping-popup__input"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
              <label className="field-mapping-popup__row">
                Type
                <select
                  className="field-mapping-popup__select"
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as FieldType)}
                >
                  <option value="text">text</option>
                  <option value="date">date</option>
                  <option value="multiline">multiline</option>
                  <option value="address">address</option>
                  <option value="richtext">richtext</option>
                </select>
              </label>
              <label className="field-mapping-popup__row">
                Mode
                <select
                  className="field-mapping-popup__select"
                  value={editMode}
                  onChange={(e) => setEditMode(e.target.value as FieldMode)}
                >
                  <option value="fixed">fixed</option>
                  <option value="flow">flow</option>
                </select>
              </label>
              <div className="field-mapping-popup__actions">
                <button type="button" className="template-toolbar__btn template-toolbar__btn--primary" onClick={saveEdit}>
                  Apply
                </button>
                <button
                  type="button"
                  className="template-toolbar__btn template-toolbar__btn--ghost"
                  onClick={() => setSelectedId(null)}
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!readOnly && (
        <div className="field-presets">
          <span className="field-presets__label">Quick add:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className={`field-presets__btn${pendingPreset?.name === p.name ? ' field-presets__btn--active' : ''}`}
              onClick={() => startPreset(p)}
            >
              {p.name === 'sender_address'
                ? 'Sender'
                : p.name === 'recipient'
                  ? 'Recipient'
                  : p.name === 'signer'
                    ? 'Signer'
                    : p.label.split(' ')[0]}
            </button>
          ))}
          {pendingPreset ? (
            <button type="button" className="field-presets__cancel template-toolbar__btn template-toolbar__btn--ghost" onClick={cancelPreset}>
              Cancel draw
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
