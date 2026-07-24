/**

 * Wizard subsection: structured profile fields — always visible; richer types behind per-field reveal.

 */



import React, { useState } from 'react'

import type { CustomModeDraft, CustomModeProfileField, CustomModeProfileFieldType } from '../../../../shared/ui/customModeTypes'

import {

  createEmptyCustomModeProfileField,

  CUSTOM_MODE_PROFILE_FIELD_USAGE_OPTIONS,

  slugCustomModeProfileFieldKey,

} from '../../../../shared/ui/customModeTypes'

import { getThemeTokens, labelStyle } from '../../../../shared/ui/lightboxTheme'

import { wizardFieldColumnStyle, wizardTextareaStyle } from '../wizardStyles'



const ADVANCED_FIELD_TYPES: { value: Exclude<CustomModeProfileFieldType, 'text'>; label: string }[] = [

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



function effectiveFieldType(field: CustomModeProfileField): CustomModeProfileFieldType {

  return field.type ?? 'text'

}



function isAdvancedType(type: CustomModeProfileFieldType): boolean {

  return type !== 'text'

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

  const type = effectiveFieldType(field)

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

          <span style={{ fontSize: 12, color: t.textMuted }}>Add options in Advanced field types first.</span>

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

  const [advancedOpenByIndex, setAdvancedOpenByIndex] = useState<Record<number, boolean>>({})



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

    setAdvancedOpenByIndex((prev) => {

      const next: Record<number, boolean> = {}

      for (const [k, v] of Object.entries(prev)) {

        const i = Number(k)

        if (i < index) next[i] = v

        else if (i > index) next[i - 1] = v

      }

      return next

    })

  }



  const addField = () => {

    setFields([...fields, createEmptyCustomModeProfileField(fields.length)])

  }



  const toggleAdvanced = (index: number) => {

    setAdvancedOpenByIndex((prev) => ({ ...prev, [index]: !prev[index] }))

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

        Structured Context Fields{' '}

        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>

      </div>

      <div
        role="note"
        style={{
          margin: '0 0 12px',
          padding: '12px 14px',
          borderRadius: 8,
          border: `1px solid ${t.isLight ? '#93c5fd' : 'rgba(96, 165, 250, 0.45)'}`,
          background: t.isLight ? '#eff6ff' : 'rgba(59, 130, 246, 0.15)',
          color: t.text,
          fontSize: 12,
          lineHeight: 1.5,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }} aria-hidden>
          ℹ️
        </span>
        <p style={{ margin: 0, color: 'inherit' }}>
          <strong>
            This mode&apos;s AI uses everything you provide — your WR Expert file and these Structured Context Fields —
            as input. The more context you give, the better the mode can detect, respond, and (soon) run automations on
            your behalf.
          </strong>
        </p>
      </div>



      {fields.length === 0 ? (

        <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textMuted }}>No context fields yet.</p>

      ) : (

        <div style={{ ...wizardFieldColumnStyle(), marginBottom: 12 }}>

          {fields.map((field, index) => {

            const type = effectiveFieldType(field)

            const optionsText = (field.options ?? []).join('\n')

            const needsOptions = type === 'select' || type === 'multiselect'

            const advancedOpen = advancedOpenByIndex[index] === true || isAdvancedType(type)



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

                  <div>

                    <label htmlFor={`cmw-pf-usage-${index}`} style={labelStyle(t)}>

                      How to use this

                    </label>

                    <select

                      id={`cmw-pf-usage-${index}`}

                      value={field.usage ?? 'context'}

                      onChange={(e) =>

                        patchField(index, {

                          usage: e.target.value as CustomModeProfileField['usage'],

                        })

                      }

                      style={selectStyle}

                    >

                      {CUSTOM_MODE_PROFILE_FIELD_USAGE_OPTIONS.map((opt) => (

                        <option key={opt.value} value={opt.value} disabled={opt.disabled}>

                          {opt.label}

                          {opt.disabled ? ' (coming soon)' : ''}

                        </option>

                      ))}

                    </select>

                  </div>

                  <div>

                    <button

                      type="button"

                      onClick={() => toggleAdvanced(index)}

                      aria-expanded={advancedOpen}

                      style={{

                        padding: 0,

                        border: 'none',

                        background: 'transparent',

                        color: t.text,

                        fontSize: 12,

                        fontWeight: 600,

                        cursor: 'pointer',

                        textAlign: 'left',

                      }}

                    >

                      Advanced field types {advancedOpen ? '▾' : '▸'}

                    </button>

                    {advancedOpen ? (

                      <div style={{ ...wizardFieldColumnStyle(), marginTop: 8 }}>

                        <div>

                          <label htmlFor={`cmw-pf-type-${index}`} style={labelStyle(t)}>

                            Field type

                          </label>

                          <select

                            id={`cmw-pf-type-${index}`}

                            value={type}

                            onChange={(e) => {

                              const nextType = e.target.value as CustomModeProfileFieldType

                              const patch: Partial<CustomModeProfileField> = { type: nextType }

                              if (nextType === 'text') patch.options = undefined

                              if (nextType !== 'select' && nextType !== 'multiselect') patch.options = undefined

                              if (nextType === 'toggle') patch.value = field.value === 'yes' ? 'yes' : 'no'

                              if (nextType === 'multiselect' && field.type === 'select') {

                                patch.value = field.value

                              }

                              patchField(index, patch)

                            }}

                            style={selectStyle}

                          >

                            <option value="text">Short text</option>

                            {ADVANCED_FIELD_TYPES.map((opt) => (

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

                      </div>

                    ) : null}

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

  )

}


