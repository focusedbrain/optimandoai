/**
 * Wizard subsection: dynamic structured profile fields (career-builder-capable).
 */

import React from 'react'
import type { CustomModeDraft, CustomModeProfileField, CustomModeProfileFieldType } from '../../../../shared/ui/customModeTypes'
import {
  createEmptyCustomModeProfileField,
  slugCustomModeProfileFieldKey,
} from '../../../../shared/ui/customModeTypes'
import { getThemeTokens, labelStyle } from '../../../../shared/ui/lightboxTheme'
import { wizardFieldColumnStyle, wizardTextareaStyle } from '../wizardStyles'

const FIELD_TYPES: { value: CustomModeProfileFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'select', label: 'Select' },
]

function shouldAutoKey(field: CustomModeProfileField, index: number, prevLabel: string): boolean {
  const autoFromPrev = slugCustomModeProfileFieldKey(prevLabel, index)
  const autoFromEmpty = slugCustomModeProfileFieldKey('', index)
  return !field.key || field.key === autoFromPrev || field.key === autoFromEmpty
}

export function StepProfileFields({
  data,
  setData,
  t,
}: {
  data: CustomModeDraft
  setData: (patch: Partial<CustomModeDraft>) => void
  t: ReturnType<typeof getThemeTokens>
}) {
  const fields = data.profileFields ?? []

  const setFields = (next: CustomModeProfileField[]) => {
    setData({ profileFields: next.length ? next : undefined })
  }

  const patchField = (index: number, patch: Partial<CustomModeProfileField>, prevLabel?: string) => {
    const next = [...fields]
    const prev = next[index]
    if (!prev) return
    const merged = { ...prev, ...patch }
    if (patch.label !== undefined && prevLabel !== undefined && shouldAutoKey(prev, index, prevLabel)) {
      merged.key = slugCustomModeProfileFieldKey(patch.label, index)
    }
    next[index] = merged
    setFields(next)
  }

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index))
  }

  const addField = () => {
    setFields([...fields, createEmptyCustomModeProfileField(fields.length)])
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

  const inputStyle: React.CSSProperties = {
    ...selectStyle,
    marginTop: 4,
  }

  const cardStyle: React.CSSProperties = {
    padding: '12px 12px',
    borderRadius: 10,
    border: `1px solid ${t.border}`,
    background: t.tabBg,
    color: t.text,
  }

  return (
    <div
      style={{
        ...cardStyle,
        marginTop: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: t.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 8,
        }}
      >
        Structured profile fields{' '}
        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
        Add labeled fields the model should reason against—goals, location, search criteria, dos and don&apos;ts, and
        similar profile data. Each field is injected into the mode prefix as <strong style={{ color: t.text }}>label: value</strong>.
      </p>

      {fields.length === 0 ? (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textMuted }}>No profile fields yet.</p>
      ) : (
        <div style={{ ...wizardFieldColumnStyle(), marginBottom: 12 }}>
          {fields.map((field, index) => {
            const optionsText = (field.options ?? []).join('\n')
            return (
              <div key={`${field.key}-${index}`} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>Field {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeField(index)}
                    style={{
                      padding: '4px 8px',
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
                </div>
                <div style={wizardFieldColumnStyle()}>
                  <div>
                    <label htmlFor={`cmw-pf-label-${index}`} style={labelStyle(t)}>
                      Label
                    </label>
                    <input
                      id={`cmw-pf-label-${index}`}
                      type="text"
                      value={field.label}
                      onChange={(e) => patchField(index, { label: e.target.value }, field.label)}
                      placeholder="e.g. Target location"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor={`cmw-pf-type-${index}`} style={labelStyle(t)}>
                      Type
                    </label>
                    <select
                      id={`cmw-pf-type-${index}`}
                      value={field.type ?? 'text'}
                      onChange={(e) => {
                        const type = e.target.value as CustomModeProfileFieldType
                        const patch: Partial<CustomModeProfileField> = { type }
                        if (type !== 'select') patch.options = undefined
                        patchField(index, patch)
                      }}
                      style={selectStyle}
                    >
                      {FIELD_TYPES.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(field.type ?? 'text') === 'select' ? (
                    <div>
                      <label htmlFor={`cmw-pf-options-${index}`} style={labelStyle(t)}>
                        Options
                      </label>
                      <textarea
                        id={`cmw-pf-options-${index}`}
                        value={optionsText}
                        onChange={(e) => {
                          const options = e.target.value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter(Boolean)
                          patchField(index, { options: options.length ? options : undefined })
                        }}
                        placeholder={'One option per line\nRemote\nHybrid\nOn-site'}
                        rows={3}
                        style={wizardTextareaStyle(t)}
                      />
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor={`cmw-pf-value-${index}`} style={labelStyle(t)}>
                      Value
                    </label>
                    {(field.type ?? 'text') === 'longtext' ? (
                      <textarea
                        id={`cmw-pf-value-${index}`}
                        value={field.value}
                        onChange={(e) => patchField(index, { value: e.target.value })}
                        placeholder="Free-form profile detail…"
                        rows={4}
                        style={wizardTextareaStyle(t)}
                      />
                    ) : (field.type ?? 'text') === 'select' ? (
                      <select
                        id={`cmw-pf-value-${index}`}
                        value={field.value}
                        onChange={(e) => patchField(index, { value: e.target.value })}
                        style={selectStyle}
                      >
                        <option value="">— Select —</option>
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`cmw-pf-value-${index}`}
                        type="text"
                        value={field.value}
                        onChange={(e) => patchField(index, { value: e.target.value })}
                        placeholder="Field value"
                        style={inputStyle}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={addField}
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
        + Add profile field
      </button>
    </div>
  )
}
