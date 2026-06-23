/**
 * Wizard subsection: collapsible advanced profile fields (rich types, collapsed by default when empty).
 */

import React, { useEffect, useState } from 'react'
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
  { value: 'number', label: 'Number' },
  { value: 'toggle', label: 'Yes / No toggle' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Single select' },
  { value: 'multiselect', label: 'Multi select' },
]

function shouldAutoKey(field: CustomModeProfileField, index: number, prevLabel: string): boolean {
  const autoFromPrev = slugCustomModeProfileFieldKey(prevLabel, index)
  const autoFromEmpty = slugCustomModeProfileFieldKey('', index)
  return !field.key || field.key === autoFromPrev || field.key === autoFromEmpty
}

function parseMultiselectValue(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function joinMultiselectValue(selected: string[]): string {
  return selected.join(', ')
}

function ProfileFieldValueInput({
  field,
  index,
  patchField,
  t,
  selectStyle,
  inputStyle,
}: {
  field: CustomModeProfileField
  index: number
  patchField: (index: number, patch: Partial<CustomModeProfileField>, prevLabel?: string) => void
  t: ReturnType<typeof getThemeTokens>
  selectStyle: React.CSSProperties
  inputStyle: React.CSSProperties
}) {
  const type = field.type ?? 'text'
  const id = `cmw-pf-value-${index}`

  if (type === 'longtext') {
    return (
      <textarea
        id={id}
        value={field.value}
        onChange={(e) => patchField(index, { value: e.target.value })}
        placeholder="Free-form profile detail…"
        rows={4}
        style={wizardTextareaStyle(t)}
      />
    )
  }
  if (type === 'number') {
    return (
      <input
        id={id}
        type="number"
        value={field.value}
        onChange={(e) => patchField(index, { value: e.target.value })}
        placeholder="0"
        style={inputStyle}
      />
    )
  }
  if (type === 'date') {
    return (
      <input
        id={id}
        type="date"
        value={field.value}
        onChange={(e) => patchField(index, { value: e.target.value })}
        style={inputStyle}
      />
    )
  }
  if (type === 'toggle') {
    const checked = field.value === 'yes'
    return (
      <label
        htmlFor={id}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
          fontSize: 13,
          color: t.text,
          cursor: 'pointer',
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => patchField(index, { value: e.target.checked ? 'yes' : 'no' })}
        />
        {checked ? 'Yes' : 'No'}
      </label>
    )
  }
  if (type === 'select') {
    return (
      <select
        id={id}
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
    )
  }
  if (type === 'multiselect') {
    const selected = new Set(parseMultiselectValue(field.value))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {(field.options ?? []).map((opt) => (
          <label
            key={opt}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.text }}
          >
            <input
              type="checkbox"
              checked={selected.has(opt)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(opt)
                else next.delete(opt)
                patchField(index, { value: joinMultiselectValue([...next]) })
              }}
            />
            {opt}
          </label>
        ))}
        {(field.options ?? []).length === 0 ? (
          <span style={{ fontSize: 12, color: t.textMuted }}>Add options below first.</span>
        ) : null}
      </div>
    )
  }
  return (
    <input
      id={id}
      type="text"
      value={field.value}
      onChange={(e) => patchField(index, { value: e.target.value })}
      placeholder="Field value"
      style={inputStyle}
    />
  )
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
  const [expanded, setExpanded] = useState(() => fields.length > 0)

  useEffect(() => {
    if (fields.length > 0) setExpanded(true)
  }, [fields.length])

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
    if (patch.type === 'toggle' && prev.type !== 'toggle' && !merged.value) {
      merged.value = 'no'
    }
    next[index] = merged
    setFields(next)
  }

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index))
  }

  const addField = () => {
    setExpanded(true)
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

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    color: t.text,
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={sectionHeaderStyle}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: t.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Advanced fields{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            (optional{fields.length ? ` · ${fields.length}` : ''})
          </span>
        </span>
        <span style={{ fontSize: 12, color: t.textMuted }} aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded ? (
        <div style={{ ...cardStyle, marginTop: 8 }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
            Structured profile data injected into the mode prefix — goals, location, criteria, and similar context.
          </p>

          {fields.length === 0 ? (
            <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textMuted }}>No advanced fields yet.</p>
          ) : (
            <div style={{ ...wizardFieldColumnStyle(), marginBottom: 12 }}>
              {fields.map((field, index) => {
                const optionsText = (field.options ?? []).join('\n')
                const type = field.type ?? 'text'
                const needsOptions = type === 'select' || type === 'multiselect'
                return (
                  <div key={`${field.key}-${index}`} style={cardStyle}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
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
                          value={type}
                          onChange={(e) => {
                            const nextType = e.target.value as CustomModeProfileFieldType
                            const patch: Partial<CustomModeProfileField> = { type: nextType }
                            if (nextType !== 'select' && nextType !== 'multiselect') patch.options = undefined
                            if (nextType === 'toggle') patch.value = field.value === 'yes' ? 'yes' : 'no'
                            if (nextType === 'multiselect' && field.type === 'select') {
                              patch.value = field.value
                            }
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
                      {needsOptions ? (
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
                        <ProfileFieldValueInput
                          field={field}
                          index={index}
                          patchField={patchField}
                          t={t}
                          selectStyle={selectStyle}
                          inputStyle={inputStyle}
                        />
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
            + Add field
          </button>
        </div>
      ) : null}
    </div>
  )
}
