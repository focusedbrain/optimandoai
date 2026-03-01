/**
 * HsContextProfileEditor
 *
 * Edits a single HS Context Profile. Includes:
 *  - Profile metadata (name, description, scope, tags)
 *  - Default field sections: Business Identity, Tax & Identifiers,
 *    Contacts, Opening Hours, Billing, Logistics / Operations
 *  - Unlimited custom fields (label + multi-line value)
 *  - PDF document upload (delegates to HsContextDocumentUpload)
 */

import React, { useState, useEffect } from 'react'
import {
  getHsProfile,
  updateHsProfile,
  createHsProfile,
} from '../hsContextProfilesRpc'
import type {
  HsContextProfileDetail,
  ProfileFields,
  CustomField,
  ProfileDocumentSummary,
  CreateProfileInput,
  UpdateProfileInput,
} from '../hsContextProfilesRpc'
import { HsContextDocumentUpload } from './HsContextDocumentUpload'

interface Props {
  profileId?: string
  onSaved: (id: string) => void
  onCancel: () => void
  theme?: 'dark' | 'standard'
}

const EMPTY_FIELDS: ProfileFields = {}
const EMPTY_CUSTOMS: CustomField[] = []

export const HsContextProfileEditor: React.FC<Props> = ({
  profileId,
  onSaved,
  onCancel,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark'
  const textColor = isDark ? '#fff' : '#1f2937'
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : '#6b7280'
  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(147,51,234,0.15)'
  const inputBg = isDark ? 'rgba(255,255,255,0.07)' : 'white'
  const sectionBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(139,92,246,0.03)'

  const [loading, setLoading] = useState(!!profileId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<ProfileDocumentSummary[]>([])

  // Profile metadata
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'non_confidential' | 'confidential'>('non_confidential')
  const [tagsInput, setTagsInput] = useState('')

  // Structured fields
  const [fields, setFields] = useState<ProfileFields>(EMPTY_FIELDS)
  const [customFields, setCustomFields] = useState<CustomField[]>(EMPTY_CUSTOMS)
  const [currentProfileId, setCurrentProfileId] = useState<string | undefined>(profileId)

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    getHsProfile(profileId)
      .then((detail: HsContextProfileDetail) => {
        setName(detail.name)
        setDescription(detail.description ?? '')
        setScope(detail.scope)
        setTagsInput(detail.tags.join(', '))
        setFields(detail.fields ?? {})
        setCustomFields(detail.custom_fields ?? [])
        setDocuments(detail.documents ?? [])
      })
      .catch((err: any) => setError(err?.message ?? 'Failed to load profile'))
      .finally(() => setLoading(false))
  }, [profileId])

  const setField = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  const addCustomField = () => {
    setCustomFields((prev) => [...prev, { label: '', value: '' }])
  }

  const updateCustomField = (index: number, patch: Partial<CustomField>) => {
    setCustomFields((prev) => prev.map((cf, i) => i === index ? { ...cf, ...patch } : cf))
  }

  const removeCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index))
  }

  const addContact = () => {
    setField('contacts', [...(fields.contacts ?? []), {}])
  }

  const updateContact = (index: number, patch: any) => {
    const contacts = [...(fields.contacts ?? [])]
    contacts[index] = { ...contacts[index], ...patch }
    setField('contacts', contacts)
  }

  const removeContact = (index: number) => {
    setField('contacts', (fields.contacts ?? []).filter((_, i) => i !== index))
  }

  const addOpeningHours = () => {
    setField('openingHours', [...(fields.openingHours ?? []), { days: '', from: '', to: '' }])
  }

  const updateOpeningHours = (index: number, patch: any) => {
    const hours = [...(fields.openingHours ?? [])]
    hours[index] = { ...hours[index], ...patch }
    setField('openingHours', hours)
  }

  const removeOpeningHours = (index: number) => {
    setField('openingHours', (fields.openingHours ?? []).filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Profile name is required'); return }

    setSaving(true)
    setError(null)

    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    const input: CreateProfileInput | UpdateProfileInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      scope,
      tags,
      fields,
      custom_fields: customFields.filter((cf) => cf.label.trim()),
    }

    try {
      if (currentProfileId) {
        await updateHsProfile(currentProfileId, input as UpdateProfileInput)
        onSaved(currentProfileId)
      } else {
        const created = await createHsProfile(input as CreateProfileInput)
        setCurrentProfileId(created.id)
        onSaved(created.id)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const reloadDocuments = async () => {
    if (!currentProfileId) return
    try {
      const detail = await getHsProfile(currentProfileId)
      setDocuments(detail.documents ?? [])
    } catch {}
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px',
    background: inputBg, border: `1px solid ${borderColor}`,
    borderRadius: '7px', color: textColor, fontSize: '12px',
    outline: 'none', boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '10px', fontWeight: 700, color: mutedColor,
    textTransform: 'uppercase', letterSpacing: '0.5px',
    display: 'block', marginBottom: '5px',
  }

  const sectionStyle: React.CSSProperties = {
    background: sectionBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '10px',
    padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  }

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 700, color: isDark ? 'rgba(139,92,246,0.9)' : '#7c3aed',
    textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px',
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: mutedColor, fontSize: '13px' }}>
        Loading profile…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${borderColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: textColor }}>
          {currentProfileId ? 'Edit Profile' : 'New Profile'}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px', background: 'transparent',
              border: `1px solid ${borderColor}`, borderRadius: '7px',
              color: mutedColor, fontSize: '12px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '6px 14px',
              background: saving ? 'rgba(139,92,246,0.5)' : 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
              border: 'none', borderRadius: '7px',
              color: 'white', fontSize: '12px', fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {error && (
          <div style={{
            padding: '10px 12px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
            fontSize: '12px', color: '#ef4444',
          }}>
            {error}
          </div>
        )}

        {/* Profile Metadata */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Profile Info</div>
          <div>
            <label style={labelStyle}>Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Acme Corp — Supplier Profile" />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ ...inputStyle, minHeight: '56px', resize: 'vertical', lineHeight: 1.5 }}
              placeholder="Brief description of this profile's purpose"
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Scope</label>
              <select value={scope} onChange={(e) => setScope(e.target.value as any)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="non_confidential">Non-Confidential</option>
                <option value="confidential">Confidential</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Tags (comma-separated)</label>
              <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} style={inputStyle} placeholder="supplier, billing" />
            </div>
          </div>
        </div>

        {/* Business Identity */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Business Identity</div>
          {[
            ['legalCompanyName', 'Legal Company Name'],
            ['tradeName', 'Trade Name (optional)'],
            ['address', 'Address'],
            ['country', 'Country'],
            ['website', 'Website'],
          ].map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key as any, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
        </div>

        {/* Tax & Identifiers */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Tax & Identifiers</div>
          {[
            ['vatNumber', 'VAT Number'],
            ['companyRegistrationNumber', 'Company Registration Number'],
            ['supplierNumber', 'Supplier Number'],
            ['customerNumber', 'Customer Number'],
          ].map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key as any, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
        </div>

        {/* Contacts */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={sectionHeadingStyle}>Contacts</div>
            <button
              onClick={addContact}
              style={{
                fontSize: '11px', fontWeight: 600, padding: '4px 10px',
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '6px', color: isDark ? '#c4b5fd' : '#7c3aed', cursor: 'pointer',
              }}
            >
              + Add Contact
            </button>
          </div>
          {(fields.contacts ?? []).map((contact, idx) => (
            <div key={idx} style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Name</label>
                  <input value={contact.name ?? ''} onChange={(e) => updateContact(idx, { name: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Role / Department</label>
                  <input value={contact.role ?? ''} onChange={(e) => updateContact(idx, { role: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={contact.email ?? ''} onChange={(e) => updateContact(idx, { email: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Phone</label>
                  <input value={contact.phone ?? ''} onChange={(e) => updateContact(idx, { phone: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Availability / Notes</label>
                <input value={contact.notes ?? ''} onChange={(e) => updateContact(idx, { notes: e.target.value })} style={inputStyle} />
              </div>
              <button
                onClick={() => removeContact(idx)}
                style={{ alignSelf: 'flex-end', fontSize: '11px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Opening Hours */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={sectionHeadingStyle}>Opening Hours</div>
            <button
              onClick={addOpeningHours}
              style={{
                fontSize: '11px', fontWeight: 600, padding: '4px 10px',
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '6px', color: isDark ? '#c4b5fd' : '#7c3aed', cursor: 'pointer',
              }}
            >
              + Add Hours
            </button>
          </div>
          {(fields.openingHours ?? []).map((h, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Days</label>
                <input value={h.days} onChange={(e) => updateOpeningHours(idx, { days: e.target.value })} style={inputStyle} placeholder="Mon–Fri" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>From</label>
                <input value={h.from} onChange={(e) => updateOpeningHours(idx, { from: e.target.value })} style={inputStyle} placeholder="09:00" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>To</label>
                <input value={h.to} onChange={(e) => updateOpeningHours(idx, { to: e.target.value })} style={inputStyle} placeholder="17:00" />
              </div>
              <button onClick={() => removeOpeningHours(idx)} style={{ fontSize: '14px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', paddingBottom: '10px' }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Timezone</label>
              <input value={fields.timezone ?? ''} onChange={(e) => setField('timezone', e.target.value)} style={inputStyle} placeholder="Europe/London" />
            </div>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>Holiday Notes</label>
              <input value={fields.holidayNotes ?? ''} onChange={(e) => setField('holidayNotes', e.target.value)} style={inputStyle} placeholder="Closed Bank Holidays" />
            </div>
          </div>
        </div>

        {/* Billing */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Billing</div>
          {[
            ['billingEmail', 'Billing Email'],
            ['paymentTerms', 'Payment Terms'],
            ['bankDetails', 'Bank Details (confidential)'],
          ].map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key as any, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
        </div>

        {/* Logistics / Operations */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Logistics & Operations</div>
          {[
            ['receivingHours', 'Receiving Hours'],
            ['deliveryInstructions', 'Delivery Instructions'],
            ['supportHours', 'Support Hours'],
            ['escalationContact', 'Escalation Contact'],
          ].map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key as any, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
        </div>

        {/* Custom Fields */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={sectionHeadingStyle}>Custom Fields</div>
            <button
              onClick={addCustomField}
              style={{
                fontSize: '11px', fontWeight: 600, padding: '4px 10px',
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '6px', color: isDark ? '#c4b5fd' : '#7c3aed', cursor: 'pointer',
              }}
            >
              + Add Field
            </button>
          </div>
          {customFields.length === 0 && (
            <div style={{ fontSize: '12px', color: mutedColor }}>No custom fields. Click "+ Add Field" to add unlimited label/value pairs.</div>
          )}
          {customFields.map((cf, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: '8px', padding: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Label</label>
                  <input
                    value={cf.label}
                    onChange={(e) => updateCustomField(idx, { label: e.target.value })}
                    style={inputStyle}
                    placeholder="Field label"
                  />
                </div>
                <button
                  onClick={() => removeCustomField(idx)}
                  style={{ marginTop: '18px', fontSize: '14px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
              <div>
                <label style={labelStyle}>Value</label>
                <textarea
                  value={cf.value}
                  onChange={(e) => updateCustomField(idx, { value: e.target.value })}
                  style={{ ...inputStyle, minHeight: '56px', resize: 'vertical', lineHeight: 1.5 }}
                  placeholder="Field value (multi-line supported)"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Documents */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Attached Documents</div>
          {currentProfileId ? (
            <HsContextDocumentUpload
              profileId={currentProfileId}
              documents={documents}
              onDocumentsChanged={reloadDocuments}
              theme={theme}
            />
          ) : (
            <div style={{ fontSize: '12px', color: mutedColor }}>
              Save the profile first, then you can attach PDF documents.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
