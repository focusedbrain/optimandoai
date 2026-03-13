/**
 * HsContextProfileEditor
 *
 * Edits a single HS Context Profile. Includes:
 *  - Profile metadata (name, description, scope, tags)
 *  - Default field sections: Business Documents, Company / Organization,
 *    Links / Online Presence, Tax & Identifiers, Contacts, Opening Hours,
 *    Billing, Logistics / Operations — each with per-section custom fields
 *  - Legacy catch-all "Other Custom Fields" section (backward compat)
 *  - Extraction status polling — auto-refreshes until all uploads resolve
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  getHsProfile,
  updateHsProfile,
  createHsProfile,
  deleteHsProfile,
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
import {
  validateUrl,
  validateEmail,
  validatePhone,
  validateIdentifier,
  validatePlainText,
  validateOpeningHoursEntry,
} from '@shared/handshake/hsContextFieldValidation'
import { shouldDeleteDraftOnCancel, resolveNameAfterDraftCreation } from './hsContextDraftLogic'

interface Props {
  profileId?: string
  onSaved: (id: string) => void
  onCancel: () => void
  theme?: 'dark' | 'standard'
}

const EMPTY_FIELDS: ProfileFields = {}
const EMPTY_CUSTOMS: CustomField[] = []

/** Shared promise to prevent duplicate draft creation on React Strict Mode double-mount */
let _draftCreationPromise: Promise<{ id: string }> | null = null

/** Document icon — stroke-based, matches product style */
const DocumentIcon = ({ color, size = 18 }: { color: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
)

// ── Per-section custom field rows ────────────────────────────────────────────

interface SectionCustomFieldsProps {
  fields: Array<{ _idx: number; label: string; value: string }>
  onAdd: () => void
  onUpdate: (globalIdx: number, patch: { label?: string; value?: string }) => void
  onRemove: (globalIdx: number) => void
  inputStyle: React.CSSProperties
  isDark: boolean
  mutedColor: string
  borderColor: string
  textColor: string
}

const SectionCustomFields: React.FC<SectionCustomFieldsProps> = ({
  fields, onAdd, onUpdate, onRemove,
  inputStyle, isDark, mutedColor, borderColor, textColor,
}) => {
  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: '6px', alignItems: 'center',
    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    borderRadius: '6px', padding: '5px 6px',
  }
  const miniInput: React.CSSProperties = {
    ...inputStyle,
    fontSize: '11px', padding: '4px 7px',
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
      {fields.map(({ _idx, label, value }) => (
        <div key={_idx} style={rowStyle}>
          <input
            value={label}
            onChange={(e) => onUpdate(_idx, { label: e.target.value })}
            placeholder="Field name"
            style={{ ...miniInput, flex: '0 0 120px' }}
          />
          <input
            value={value}
            onChange={(e) => onUpdate(_idx, { value: e.target.value })}
            placeholder="Value"
            style={{ ...miniInput, flex: 1 }}
          />
          <button
            onClick={() => onRemove(_idx)}
            style={{
              fontSize: '12px', color: '#ef4444', background: 'transparent',
              border: 'none', cursor: 'pointer', padding: '2px 4px', flexShrink: 0,
              lineHeight: 1,
            }}
          >✕</button>
        </div>
      ))}
      <button
        onClick={onAdd}
        style={{
          alignSelf: 'flex-start', fontSize: '10px', fontWeight: 600,
          padding: '3px 9px',
          background: 'rgba(139,92,246,0.08)', border: '1px dashed rgba(139,92,246,0.3)',
          borderRadius: '5px', color: isDark ? 'rgba(196,181,253,0.75)' : '#7c3aed',
          cursor: 'pointer',
        }}
      >
        + custom field
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const [draftCreating, setDraftCreating] = useState(!profileId)
  const [retryCount, setRetryCount] = useState(0)

  const mountedRef = useRef(true)
  const hasUploadedRef = useRef(false)
  const currentProfileIdRef = useRef<string | undefined>(profileId)

  useEffect(() => {
    currentProfileIdRef.current = currentProfileId
  }, [currentProfileId])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Load / draft creation ─────────────────────────────────────────────────

  useEffect(() => {
    if (profileId) {
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
    } else {
      const applyDraft = (created: { id: string }) => {
        if (!mountedRef.current) return
        setCurrentProfileId(created.id)
        setDescription('')
        setDraftCreating(false)
        setName((prev) => resolveNameAfterDraftCreation(prev))
      }
      if (_draftCreationPromise) {
        _draftCreationPromise
          .then(applyDraft)
          .catch((err: any) => {
            _draftCreationPromise = null
            if (!mountedRef.current) return
            setError(err?.message ?? 'Failed to prepare editor')
            setDraftCreating(false)
          })
      } else {
        // Helper: is this a vault session binding error that may be transient?
        const isBindingError = (msg: string) =>
          /vault session not bound|vault.*bind|session not bound/i.test(msg)

        const attemptDraftCreation = (attemptsLeft: number) => {
          _draftCreationPromise = createHsProfile({
            name: 'Untitled',
            description: '',
            scope: 'non_confidential',
            tags: [],
            fields: {},
            custom_fields: [],
          })
            .then((created) => {
              applyDraft(created)
              _draftCreationPromise = null
              return created
            })
            .catch((err: any) => {
              _draftCreationPromise = null
              if (!mountedRef.current) return
              // Auto-retry once after a short delay for transient vault binding errors.
              // The background service worker's VSBT recovery from chrome.storage.session
              // is async — the vault may be unlocked but the token not yet restored.
              if (attemptsLeft > 0 && isBindingError(err?.message ?? '')) {
                setTimeout(() => {
                  if (!mountedRef.current) return
                  attemptDraftCreation(attemptsLeft - 1)
                }, 800)
                return
              }
              setError(err?.message ?? 'Failed to prepare editor')
              setDraftCreating(false)
            })
        }
        attemptDraftCreation(3) // up to 3 auto-retries (~2.4 s total)
      }
    }
  }, [profileId, retryCount])

  // ── Document reload (stable, used by polling & upload callback) ───────────

  const reloadDocuments = useCallback(async () => {
    const pid = currentProfileIdRef.current
    if (!pid) return
    try {
      const detail = await getHsProfile(pid)
      if (!mountedRef.current) return
      setDocuments(detail.documents ?? [])
    } catch {}
  }, [])

  const handleDocumentsChanged = useCallback(() => {
    hasUploadedRef.current = true
    reloadDocuments()
  }, [reloadDocuments])

  // ── Field helpers ─────────────────────────────────────────────────────────

  const setField = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  // Section-scoped custom field helpers (uses `section` tag on CustomField)
  const getSectionFields = (section: string) =>
    customFields
      .map((cf, i) => ({ ...cf, _idx: i }))
      .filter((cf) => cf.section === section)

  const addSectionField = (section: string) => {
    setCustomFields((prev) => [...prev, { label: '', value: '', section }])
  }

  const updateSectionField = (globalIdx: number, patch: { label?: string; value?: string }) => {
    setCustomFields((prev) => prev.map((cf, i) => i === globalIdx ? { ...cf, ...patch } : cf))
  }

  const removeSectionField = (globalIdx: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== globalIdx))
  }

  // Legacy catch-all custom fields (no section assigned — backward compat)
  const legacyCustomFields = customFields
    .map((cf, i) => ({ ...cf, _idx: i }))
    .filter((cf) => !cf.section)

  const addLegacyField = () => {
    setCustomFields((prev) => [...prev, { label: '', value: '' }])
  }

  // ── Contact persons ───────────────────────────────────────────────────────

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

  // ── Opening hours ─────────────────────────────────────────────────────────

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

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!currentProfileId) { setError('Editor not ready'); return }
    if (!name.trim()) { setError('Profile name is required'); return }

    setSaving(true)
    setError(null)

    const validatedFields = { ...fields }
    const urlFields: Array<keyof ProfileFields> = ['website', 'linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'officialLink', 'supportUrl']
    for (const k of urlFields) {
      const v = (fields as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.trim()) {
        const r = validateUrl(v)
        if (!r.ok) { setError(`${k}: ${r.error}`); setSaving(false); return }
        ;(validatedFields as Record<string, string>)[k] = r.value
      }
    }
    if (fields.billingEmail?.trim()) {
      const r = validateEmail(fields.billingEmail)
      if (!r.ok) { setError(`Billing email: ${r.error}`); setSaving(false); return }
      validatedFields.billingEmail = r.value
    }
    if (fields.generalPhone?.trim()) {
      const r = validatePhone(fields.generalPhone)
      if (!r.ok) { setError(`General phone: ${r.error}`); setSaving(false); return }
      validatedFields.generalPhone = r.value
    }
    if (fields.generalEmail?.trim()) {
      const r = validateEmail(fields.generalEmail)
      if (!r.ok) { setError(`General email: ${r.error}`); setSaving(false); return }
      validatedFields.generalEmail = r.value
    }
    if (fields.supportEmail?.trim()) {
      const r = validateEmail(fields.supportEmail)
      if (!r.ok) { setError(`Support email: ${r.error}`); setSaving(false); return }
      validatedFields.supportEmail = r.value
    }
    const validatedContacts: Array<{ name?: string; role?: string; email?: string; phone?: string; notes?: string }> = []
    for (const c of fields.contacts ?? []) {
      const out = { ...c }
      if (c.email?.trim()) {
        const r = validateEmail(c.email)
        if (!r.ok) { setError(`Contact email: ${r.error}`); setSaving(false); return }
        out.email = r.value
      }
      if (c.phone?.trim()) {
        const r = validatePhone(c.phone)
        if (!r.ok) { setError(`Contact phone: ${r.error}`); setSaving(false); return }
        out.phone = r.value
      }
      validatedContacts.push(out)
    }
    validatedFields.contacts = validatedContacts
    const idFields: Array<keyof ProfileFields> = ['vatNumber', 'companyRegistrationNumber', 'supplierNumber', 'customerNumber']
    for (const k of idFields) {
      const v = (fields as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.trim()) {
        const r = validateIdentifier(v)
        if (!r.ok) { setError(`${k}: ${r.error}`); setSaving(false); return }
        ;(validatedFields as Record<string, string>)[k] = r.value
      }
    }
    if (description.trim()) {
      const r = validatePlainText(description)
      if (!r.ok) { setError(`Description: ${r.error}`); setSaving(false); return }
    }
    const validatedOpeningHours: Array<{ days: string; from: string; to: string }> = []
    for (const h of fields.openingHours ?? []) {
      if (!h.days && !h.from && !h.to) {
        validatedOpeningHours.push({ days: h.days ?? '', from: h.from ?? '', to: h.to ?? '' })
        continue
      }
      const r = validateOpeningHoursEntry(h)
      if (!r.ok) { setError(`Opening hours: ${r.error}`); setSaving(false); return }
      validatedOpeningHours.push(r.value)
    }
    validatedFields.openingHours = validatedOpeningHours

    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    const input: CreateProfileInput | UpdateProfileInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      scope,
      tags,
      fields: validatedFields,
      custom_fields: customFields.filter((cf) => cf.label.trim()),
    }

    try {
      await updateHsProfile(currentProfileId!, input as UpdateProfileInput)
      onSaved(currentProfileId!)
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  const handleCancel = async () => {
    if (shouldDeleteDraftOnCancel(profileId, currentProfileId, name, hasUploadedRef.current)) {
      try { await deleteHsProfile(currentProfileId!) } catch {}
    }
    onCancel()
  }

  // ── Shared styles ─────────────────────────────────────────────────────────

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
    textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '2px',
  }

  const dividerStyle: React.CSSProperties = {
    borderTop: `1px dashed ${isDark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.12)'}`,
    margin: '2px 0',
  }

  const addBtnStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, padding: '4px 10px',
    background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
    borderRadius: '6px', color: isDark ? '#c4b5fd' : '#7c3aed', cursor: 'pointer',
  }

  const primaryBtnStyle: React.CSSProperties = {
    padding: '6px 14px',
    background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    border: 'none', borderRadius: '7px',
    color: '#ffffff', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer',
  }

  const primaryBtnDisabledStyle: React.CSSProperties = {
    ...primaryBtnStyle,
    background: 'rgba(139,92,246,0.45)',
    cursor: 'not-allowed',
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: mutedColor, fontSize: '13px' }}>
        Loading profile…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${borderColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: textColor }}>
          {currentProfileId ? 'Edit Profile' : 'New Profile'}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleCancel}
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
            disabled={saving || !currentProfileId}
            style={saving || !currentProfileId ? primaryBtnDisabledStyle : primaryBtnStyle}
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
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

        {/* ── Profile Info ── */}
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

        {/* ── Business Documents ── */}
        <div style={{
          ...sectionStyle,
          padding: '20px',
          border: `1px solid ${isDark ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.2)'}`,
          background: isDark ? 'rgba(139,92,246,0.04)' : 'rgba(139,92,246,0.03)',
        }}>
          <div style={{
            fontSize: '13px', fontWeight: 700,
            color: isDark ? '#c4b5fd' : '#7c3aed',
            marginBottom: '6px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <DocumentIcon color={isDark ? '#c4b5fd' : '#7c3aed'} size={18} />
            Business Documents
          </div>
          <div style={{ fontSize: '12px', color: mutedColor, lineHeight: 1.5, marginBottom: '14px' }}>
            Upload PDFs now — they parse immediately into safe handshake context. Review suggested labels and types, then use in handshakes. Originals stay protected.
          </div>
          <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '12px' }}>
            Examples: contracts, user manuals, pricing lists, brochures, certificates, custom PDFs.
          </div>
          {draftCreating ? (
            <div style={{
              padding: '20px', textAlign: 'center',
              border: `2px dashed ${isDark ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.25)'}`,
              borderRadius: '12px',
              background: isDark ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.04)',
              fontSize: '12px', color: mutedColor,
            }}>
              Preparing document upload…
            </div>
          ) : currentProfileId ? (
            <HsContextDocumentUpload
              profileId={currentProfileId}
              documents={documents}
              onDocumentsChanged={handleDocumentsChanged}
              theme={theme}
            />
          ) : (
            <div style={{
              padding: '20px', textAlign: 'center',
              border: `2px dashed ${isDark ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.25)'}`,
              borderRadius: '12px',
              background: isDark ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.04)',
              fontSize: '12px', color: mutedColor,
            }}>
              <div style={{ marginBottom: '12px' }}>Unable to prepare upload. {error || 'Please unlock the vault and try again.'}</div>
              <button
                onClick={() => { setError(null); setDraftCreating(true); _draftCreationPromise = null; setRetryCount((c) => c + 1) }}
                style={primaryBtnStyle}
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* ── Company / Organization ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Company / Organization</div>
          {([
            ['legalCompanyName', 'Legal Company Name'],
            ['tradeName', 'Display Name (if distinct)'],
            ['address', 'Address'],
            ['country', 'Country'],
          ] as [keyof ProfileFields, string][]).map(([key, label]) => (
            <div key={key as string}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key, e.target.value as any)}
                style={inputStyle}
              />
            </div>
          ))}
          <hr style={dividerStyle} />
          <SectionCustomFields
            fields={getSectionFields('company')}
            onAdd={() => addSectionField('company')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />
        </div>

        {/* ── Links / Online Presence ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Links / Online Presence</div>
          {([
            ['website', 'Website'],
            ['linkedin', 'LinkedIn'],
            ['twitter', 'Twitter / X'],
            ['facebook', 'Facebook'],
            ['instagram', 'Instagram'],
            ['youtube', 'YouTube'],
            ['officialLink', 'Official Link'],
            ['supportUrl', 'Support URL'],
          ] as [keyof ProfileFields, string][]).map(([key, label]) => (
            <div key={key as string}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key, e.target.value as any)}
                style={inputStyle}
                placeholder="https://…"
              />
            </div>
          ))}
          <hr style={dividerStyle} />
          <SectionCustomFields
            fields={getSectionFields('links')}
            onAdd={() => addSectionField('links')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />
        </div>

        {/* ── Tax & Identifiers ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Tax & Identifiers</div>
          {([
            ['vatNumber', 'VAT Number'],
            ['companyRegistrationNumber', 'Company Registration Number'],
            ['supplierNumber', 'Supplier Number'],
            ['customerNumber', 'Customer Number'],
          ] as [keyof ProfileFields, string][]).map(([key, label]) => (
            <div key={key as string}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key, e.target.value as any)}
                style={inputStyle}
              />
            </div>
          ))}
          <hr style={dividerStyle} />
          <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '-2px' }}>
            Add country-specific identifiers here: EORI, DUNS, chamber numbers, regional tax codes, etc.
          </div>
          <SectionCustomFields
            fields={getSectionFields('tax')}
            onAdd={() => addSectionField('tax')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />
        </div>

        {/* ── Contacts ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Contacts</div>

          {/* General contact channels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle}>General Phone</label>
              <input value={fields.generalPhone ?? ''} onChange={(e) => setField('generalPhone', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>General Email</label>
              <input type="email" value={fields.generalEmail ?? ''} onChange={(e) => setField('generalEmail', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Support Email</label>
              <input type="email" value={fields.supportEmail ?? ''} onChange={(e) => setField('supportEmail', e.target.value)} style={inputStyle} />
            </div>
          </div>

          <hr style={dividerStyle} />
          <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '-2px' }}>
            Add extra channels here: escalation hotline, fax, regional office, procurement desk, etc.
          </div>
          <SectionCustomFields
            fields={getSectionFields('contacts')}
            onAdd={() => addSectionField('contacts')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />

          {/* Contact persons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <div style={sectionHeadingStyle}>Contact Persons</div>
            <button onClick={addContact} style={addBtnStyle}>+ Add Contact</button>
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

        {/* ── Opening Hours / Operations ── */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={sectionHeadingStyle}>Opening Hours</div>
            <button onClick={addOpeningHours} style={addBtnStyle}>+ Add Hours</button>
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
          <hr style={dividerStyle} />
          <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '-2px' }}>
            Add operation-specific fields: dispatch cut-off, warehouse code, holiday handling, etc.
          </div>
          <SectionCustomFields
            fields={getSectionFields('hours')}
            onAdd={() => addSectionField('hours')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />
        </div>

        {/* ── Billing ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Billing</div>
          {([
            ['billingEmail', 'Billing Email'],
            ['paymentTerms', 'Payment Terms'],
            ['bankDetails', 'Bank Details (confidential)'],
          ] as [keyof ProfileFields, string][]).map(([key, label]) => (
            <div key={key as string}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key, e.target.value as any)}
                style={inputStyle}
              />
            </div>
          ))}
          <hr style={dividerStyle} />
          <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '-2px' }}>
            Add country-specific billing references: IBAN, procurement portal ID, cost center, etc.
          </div>
          <SectionCustomFields
            fields={getSectionFields('billing')}
            onAdd={() => addSectionField('billing')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />
        </div>

        {/* ── Logistics & Operations ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Logistics & Operations</div>
          {([
            ['receivingHours', 'Receiving Hours'],
            ['deliveryInstructions', 'Delivery Instructions'],
            ['supportHours', 'Support Hours'],
            ['escalationContact', 'Escalation Contact'],
          ] as [keyof ProfileFields, string][]).map(([key, label]) => (
            <div key={key as string}>
              <label style={labelStyle}>{label}</label>
              <input
                value={(fields as any)[key] ?? ''}
                onChange={(e) => setField(key, e.target.value as any)}
                style={inputStyle}
              />
            </div>
          ))}
          <hr style={dividerStyle} />
          <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '-2px' }}>
            Add logistics-specific fields: warehouse codes, carrier accounts, SLA references, etc.
          </div>
          <SectionCustomFields
            fields={getSectionFields('logistics')}
            onAdd={() => addSectionField('logistics')}
            onUpdate={updateSectionField}
            onRemove={removeSectionField}
            inputStyle={inputStyle}
            isDark={isDark}
            mutedColor={mutedColor}
            borderColor={borderColor}
            textColor={textColor}
          />
        </div>

        {/* ── Other / Legacy Custom Fields (backward compat) ── */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={sectionHeadingStyle}>Other Custom Fields</div>
            <button onClick={addLegacyField} style={addBtnStyle}>+ Add Field</button>
          </div>
          {legacyCustomFields.length === 0 && (
            <div style={{ fontSize: '12px', color: mutedColor }}>
              Any field that doesn't fit above. Click "+ Add Field" for free-form label/value pairs.
            </div>
          )}
          {legacyCustomFields.map(({ _idx, label, value }) => (
            <div key={_idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: '8px', padding: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Label</label>
                  <input
                    value={label}
                    onChange={(e) => updateSectionField(_idx, { label: e.target.value })}
                    style={inputStyle}
                    placeholder="Field label"
                  />
                </div>
                <button
                  onClick={() => removeSectionField(_idx)}
                  style={{ marginTop: '18px', fontSize: '14px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
              <div>
                <label style={labelStyle}>Value</label>
                <textarea
                  value={value}
                  onChange={(e) => updateSectionField(_idx, { value: e.target.value })}
                  style={{ ...inputStyle, minHeight: '56px', resize: 'vertical', lineHeight: 1.5 }}
                  placeholder="Field value (multi-line supported)"
                />
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
