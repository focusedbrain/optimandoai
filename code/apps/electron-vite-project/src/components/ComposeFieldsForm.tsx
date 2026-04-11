import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WRCHAT_APPEND_ASSISTANT_EVENT } from '@ext/stores/chatFocusStore'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../lib/wrdeskUiEvents'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import {
  useLetterComposerStore,
  type ComposeSession,
  type LetterTemplate,
  type ScannedLetter,
  type TemplateField,
} from '../stores/useLetterComposerStore'

const SENDER_PROFILE_KEY = 'wr-desk-letter-sender-profile'

type FieldGroup = 'sender' | 'recipient' | 'detail' | 'content' | 'other'

const GROUP_ORDER: FieldGroup[] = ['sender', 'recipient', 'detail', 'content', 'other']

const GROUP_TITLES: Record<FieldGroup, string> = {
  sender: 'Sender information',
  recipient: 'Recipient information',
  detail: 'Letter details',
  content: 'Content',
  other: 'Other fields',
}

function fieldGroup(field: TemplateField): FieldGroup {
  const n = field.name.toLowerCase()
  if (n.includes('recipient')) return 'recipient'
  if (
    n.includes('salutation') ||
    n === 'body' ||
    n.includes('body') ||
    n.includes('closing') ||
    n.includes('signer')
  ) {
    return 'content'
  }
  if (n === 'date' || n.includes('subject') || n.includes('reference')) return 'detail'
  if (n.includes('sender')) return 'sender'
  return 'other'
}

function resolveBodyFieldId(fields: TemplateField[]): string | null {
  const exact = fields.find((f) => f.name.toLowerCase() === 'body')
  if (exact) return exact.id
  const rt = fields.find((f) => f.type === 'richtext')
  if (rt) return rt.id
  const ml = fields.find((f) => f.type === 'multiline')
  if (ml) return ml.id
  const fuzzy = fields.find((f) => f.name.toLowerCase().includes('body'))
  return fuzzy?.id ?? null
}

function findRecipientNameField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n.includes('recipient') && !n.includes('address')
  })
}

function findRecipientAddressField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase().includes('recipient_address'))
}

function findSubjectField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase().includes('subject'))
}

function findReferenceField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n.includes('reference')
  })
}

function findDateField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase() === 'date' || f.type === 'date')
}

function loadSenderProfile(): { name: string; address: string } {
  try {
    const raw = localStorage.getItem(SENDER_PROFILE_KEY)
    if (!raw) return { name: '', address: '' }
    const o = JSON.parse(raw) as { name?: string; address?: string }
    return { name: o.name ?? '', address: o.address ?? '' }
  } catch {
    return { name: '', address: '' }
  }
}

function saveSenderProfile(name: string, address: string) {
  try {
    localStorage.setItem(SENDER_PROFILE_KEY, JSON.stringify({ name, address }))
  } catch {
    /* noop */
  }
}

export interface ComposeFieldsFormProps {
  template: LetterTemplate
  composeSession: ComposeSession | null
  replyToLetter: ScannedLetter | null
}

export function ComposeFieldsForm({ template, composeSession, replyToLetter }: ComposeFieldsFormProps) {
  const letters = useLetterComposerStore((s) => s.letters)
  const updateTemplateField = useLetterComposerStore((s) => s.updateTemplateField)
  const updateComposeSession = useLetterComposerStore((s) => s.updateComposeSession)
  const setTemplateVersions = useLetterComposerStore((s) => s.setTemplateVersions)
  const setActiveTemplateVersionIndex = useLetterComposerStore((s) => s.setActiveTemplateVersionIndex)
  const setFocusedTemplateField = useLetterComposerStore((s) => s.setFocusedTemplateField)

  const connectDraftRefine = useDraftRefineStore((s) => s.connect)
  const disconnectDraftRefine = useDraftRefineStore((s) => s.disconnect)
  const updateDraftRefineText = useDraftRefineStore((s) => s.updateDraftText)
  const draftConnected = useDraftRefineStore((s) => s.connected)
  const draftRefineTarget = useDraftRefineStore((s) => s.refineTarget)

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const lastReplyAutofillId = useRef<string | null>(null)
  const senderProfileAppliedForTemplate = useRef<string | null>(null)

  useEffect(() => {
    senderProfileAppliedForTemplate.current = null
    lastReplyAutofillId.current = null
  }, [template.id])

  const grouped = useMemo(() => {
    const m: Record<FieldGroup, TemplateField[]> = {
      sender: [],
      recipient: [],
      detail: [],
      content: [],
      other: [],
    }
    for (const f of template.fields) {
      m[fieldGroup(f)].push(f)
    }
    return m
  }, [template.fields])

  const updateFieldValue = useCallback(
    (fieldId: string, value: string) => {
      updateTemplateField(template.id, fieldId, value)
      if (draftConnected && draftRefineTarget === 'letter-template' && selectedFieldId === fieldId) {
        updateDraftRefineText(value)
      }
    },
    [
      template.id,
      updateTemplateField,
      draftConnected,
      draftRefineTarget,
      selectedFieldId,
      updateDraftRefineText,
    ],
  )

  const handleFieldSelect = useCallback(
    (field: TemplateField) => {
      setSelectedFieldId(field.id)
      setFocusedTemplateField(field.id)
      connectDraftRefine(
        null,
        field.label || field.name,
        field.value ?? '',
        (refined) => updateTemplateField(template.id, field.id, refined),
        'letter-template',
      )
    },
    [connectDraftRefine, setFocusedTemplateField, template.id, updateTemplateField],
  )

  useEffect(() => {
    return () => {
      disconnectDraftRefine()
      setFocusedTemplateField(null)
    }
  }, [disconnectDraftRefine, setFocusedTemplateField])

  useEffect(() => {
    if (!composeSession) return
    const id = replyToLetter?.id ?? null
    if (composeSession.replyToLetterId === id) return
    updateComposeSession(composeSession.id, { replyToLetterId: id })
  }, [composeSession, replyToLetter?.id, updateComposeSession])

  useEffect(() => {
    if (!replyToLetter?.extractedFields) return
    const rid = replyToLetter.id
    if (lastReplyAutofillId.current === rid) return
    lastReplyAutofillId.current = rid

    const ef = replyToLetter.extractedFields
    const fields = template.fields
    const patch = useLetterComposerStore.getState().updateTemplateField

    const rName = findRecipientNameField(fields)
    if (rName && ef.sender_name) patch(template.id, rName.id, ef.sender_name)

    const rAddr = findRecipientAddressField(fields)
    if (rAddr && ef.sender_address) patch(template.id, rAddr.id, ef.sender_address)

    const subj = findSubjectField(fields)
    if (subj && ef.subject) {
      const s = ef.subject.trim()
      const next = s.toLowerCase().startsWith('re:') ? s : `Re: ${s}`
      patch(template.id, subj.id, next)
    }

    const refF = findReferenceField(fields)
    if (refF && ef.reference_number) patch(template.id, refF.id, ef.reference_number)

    const dateF = findDateField(fields)
    if (dateF) {
      const today = new Date().toISOString().split('T')[0]
      patch(template.id, dateF.id, today)
    }
  }, [replyToLetter, template.fields, template.id])

  useEffect(() => {
    if (senderProfileAppliedForTemplate.current === template.id) return
    if (template.fields.length === 0) return
    const { name, address } = loadSenderProfile()
    if (!name && !address) {
      senderProfileAppliedForTemplate.current = template.id
      return
    }

    const fields = template.fields
    const nameField = fields.find((f) => {
      const n = f.name.toLowerCase()
      return (
        (n.includes('sender') && !n.includes('address') && !n.includes('recipient')) ||
        n === 'sender_name'
      )
    })
    const addrField = fields.find((f) => f.name.toLowerCase() === 'sender_address')
    const patch = useLetterComposerStore.getState().updateTemplateField
    if (nameField && name) patch(template.id, nameField.id, name)
    if (addrField && address) patch(template.id, addrField.id, address)
    senderProfileAppliedForTemplate.current = template.id
  }, [template.fields, template.id])

  const persistSenderIfNeeded = useCallback((field: TemplateField, value: string) => {
    const n = field.name.toLowerCase()
    if (n.includes('recipient')) return
    const prof = loadSenderProfile()
    if (n === 'sender_address' || (n.includes('sender') && n.includes('address'))) {
      saveSenderProfile(prof.name, value)
      return
    }
    if (n.includes('sender') && !n.includes('address')) {
      saveSenderProfile(value, prof.address)
    }
  }, [])

  const handleAiDraftBody = useCallback(() => {
    const bodyId = resolveBodyFieldId(template.fields)
    if (!bodyId) {
      setDraftError('No body field found — add a field named “body” or a richtext/multiline content field.')
      return
    }
    setDraftError(null)
    const bodyField = template.fields.find((f) => f.id === bodyId)
    if (!bodyField) return
    handleFieldSelect(bodyField)

    const replyLetter =
      (composeSession?.replyToLetterId
        ? letters.find((l) => l.id === composeSession.replyToLetterId)
        : null) ?? replyToLetter
    const letterContext = (replyLetter?.fullText ?? '').trim().slice(0, 3000)

    const recipientField = template.fields.find((f) => {
      const n = f.name.toLowerCase()
      return n.includes('recipient') && !n.includes('address')
    })
    const currentRecipient = recipientField?.value ?? ''
    const subjectField = template.fields.find((f) => f.name.toLowerCase().includes('subject'))
    const currentSubject = subjectField?.value ?? ''

    const contextMessage = [
      '\u{1F4DD} **Letter Composer** — Body field selected for AI drafting.',
      '',
      currentRecipient ? `Recipient: ${currentRecipient}` : '',
      currentSubject ? `Subject: ${currentSubject}` : '',
      letterContext
        ? `\n--- Incoming letter (for reply context) ---\n${letterContext.slice(0, 500)}${letterContext.length > 500 ? '\u2026' : ''}`
        : '',
      '',
      'Type your instruction in the chat bar (e.g. “write a formal response declining the offer”). Then click **Use** to apply the reply to the body field.',
    ]
      .filter(Boolean)
      .join('\n')

    window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
    window.dispatchEvent(
      new CustomEvent(WRCHAT_APPEND_ASSISTANT_EVENT, { detail: { text: contextMessage } }),
    )
  }, [
    composeSession?.replyToLetterId,
    handleFieldSelect,
    letters,
    replyToLetter,
    template.fields,
  ])

  const versionCount = composeSession?.versions.length ?? 0
  const versionIndex = composeSession?.activeVersionIndex ?? -1

  const bumpVersion = useCallback(
    (delta: number) => {
      if (versionCount === 0) return
      const next = Math.min(versionCount - 1, Math.max(0, versionIndex + delta))
      setActiveTemplateVersionIndex(template.id, next)
    },
    [template.id, versionCount, versionIndex, setActiveTemplateVersionIndex],
  )

  const renderFieldInput = (field: TemplateField, isAiWireActive: boolean) => {
    const v = field.value ?? ''
    const commonClass = `compose-field-input${isAiWireActive ? ' field-selected-for-ai' : ''}`
    const focusStyle = isAiWireActive
      ? {
          borderColor: '#6366f1',
          boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.15)',
        }
      : undefined

    if (field.type === 'richtext' || field.type === 'multiline' || field.type === 'address') {
      return (
        <textarea
          className={commonClass}
          style={focusStyle}
          rows={field.type === 'address' ? 4 : 6}
          value={v}
          onChange={(e) => {
            updateFieldValue(field.id, e.target.value)
            persistSenderIfNeeded(field, e.target.value)
          }}
        />
      )
    }

    if (field.type === 'date') {
      return (
        <input
          type="date"
          className={commonClass}
          style={focusStyle}
          value={v.length >= 10 ? v.slice(0, 10) : v}
          onChange={(e) => updateFieldValue(field.id, e.target.value)}
        />
      )
    }

    return (
      <input
        type="text"
        className={commonClass}
        style={focusStyle}
        value={v}
        onChange={(e) => {
          updateFieldValue(field.id, e.target.value)
          persistSenderIfNeeded(field, e.target.value)
        }}
      />
    )
  }

  return (
    <div className="compose-fields-form">
      <div className="compose-fields-form__header">
        <h4 className="compose-fields-form__title">Compose letter</h4>
        <p className="compose-fields-form__subtitle">
          Fill fields manually or select a field and use WR Chat to refine it. Choose the Template port in the chat
          banner for context.
        </p>
      </div>

      {versionCount > 0 ? (
        <div className="compose-version-bar">
          <span className="compose-version-bar__label">
            Body draft {versionIndex + 1} of {versionCount}
          </span>
          <button
            type="button"
            className="template-toolbar__btn template-toolbar__btn--ghost"
            disabled={versionIndex <= 0}
            onClick={() => bumpVersion(-1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="template-toolbar__btn template-toolbar__btn--ghost"
            disabled={versionIndex >= versionCount - 1}
            onClick={() => bumpVersion(1)}
          >
            Next
          </button>
        </div>
      ) : null}

      <div className="compose-ai-actions">
        <button
          type="button"
          className="template-toolbar__btn template-toolbar__btn--primary"
          onClick={() => handleAiDraftBody()}
        >
          {'\u2728 Draft reply with AI'}
        </button>
        {draftError ? <p className="compose-fields-form__error">{draftError}</p> : null}
      </div>

      {GROUP_ORDER.map((g) => {
        const list = grouped[g]
        if (list.length === 0) return null
        return (
          <section key={g} className="compose-field-group">
            <h5 className="compose-field-group__title">{GROUP_TITLES[g]}</h5>
            {list.map((field) => {
              const isFieldAiActive =
                draftConnected && draftRefineTarget === 'letter-template' && selectedFieldId === field.id
              return (
                <div key={field.id} className="compose-field-row">
                  <div
                    className="compose-field-header"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <span className="compose-field-row__label">{field.label}</span>
                    <button
                      type="button"
                      className={`field-ai-toggle${isFieldAiActive ? ' field-ai-toggle--active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isFieldAiActive) {
                          disconnectDraftRefine()
                          setSelectedFieldId(null)
                          setFocusedTemplateField(null)
                        } else {
                          handleFieldSelect(field)
                        }
                      }}
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: isFieldAiActive ? '1px solid #6366f1' : '1px solid #E8E8E6',
                        background: isFieldAiActive ? '#6366f1' : 'transparent',
                        color: isFieldAiActive ? '#fff' : '#888',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      {isFieldAiActive ? '\u261D Selected' : '\u261D AI'}
                    </button>
                  </div>
                  {renderFieldInput(field, isFieldAiActive)}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
