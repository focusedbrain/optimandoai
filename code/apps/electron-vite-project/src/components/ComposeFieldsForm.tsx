import type { ChangeEvent } from 'react'
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

const LANGUAGE_DEFAULTS: Record<string, { salutation: string; closing: string }> = {
  en: { salutation: 'Dear Sir or Madam,', closing: 'Kind regards' },
  de: { salutation: 'Sehr geehrte Damen und Herren,', closing: 'Mit freundlichen Grüßen' },
  fr: {
    salutation: 'Madame, Monsieur,',
    closing: "Veuillez agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
  },
  es: { salutation: 'Estimado/a Sr./Sra.,', closing: 'Atentamente' },
  it: { salutation: 'Egregio/a Signore/Signora,', closing: 'Distinti saluti' },
  nl: { salutation: 'Geachte heer/mevrouw,', closing: 'Met vriendelijke groet' },
  pt: { salutation: 'Prezado(a) Senhor(a),', closing: 'Atenciosamente' },
  pl: { salutation: 'Szanowni Państwo,', closing: 'Z poważaniem' },
  tr: { salutation: 'Sayın Yetkili,', closing: 'Saygılarımla' },
  ja: { salutation: '\u62DD\u5553', closing: '\u656C\u5177' },
  zh: { salutation: '尊敬的先生/女士：', closing: '此致敬礼' },
  ar: { salutation: 'السيد/السيدة المحترم/ة،', closing: 'مع فائق الاحترام والتقدير' },
  ko: { salutation: '\uc548\ub155\ud558\uc138\uc694,', closing: '\uac10\uc0ac\ud569\ub2c8\ub2e4' },
  ru: { salutation: 'Уважаемые дамы и господа,', closing: 'С уважением' },
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  nl: 'Dutch',
  pt: 'Portuguese',
  pl: 'Polish',
  tr: 'Turkish',
  ja: 'Japanese',
  zh: 'Chinese',
  ar: 'Arabic',
  ko: 'Korean',
  ru: 'Russian',
}

const SUPPORTED_LANG_CODES = new Set(Object.keys(LANGUAGE_DEFAULTS))

function normalizeDetectedLang(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return 'en'
  const t = raw.trim().toLowerCase()
  const two = t.slice(0, 2)
  if (SUPPORTED_LANG_CODES.has(two)) return two
  if (t.startsWith('zh')) return 'zh'
  if (t.startsWith('ja')) return 'ja'
  if (t.startsWith('ko')) return 'ko'
  return 'en'
}

function templateLogoDisplayUrl(logoPath: string | null | undefined): string {
  if (!logoPath?.trim()) return ''
  const t = logoPath.trim()
  if (t.startsWith('data:')) return t
  if (t.startsWith('file:')) return t
  const norm = t.replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(norm) ? `file:///${norm}` : `file://${norm}`
}

function fieldGroup(field: TemplateField): FieldGroup {
  const n = field.name.toLowerCase()
  if (n === 'company_logo') return 'sender'
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

function loadSenderProfile(): { sender: string } {
  try {
    const raw = localStorage.getItem(SENDER_PROFILE_KEY)
    if (!raw) return { sender: '' }
    const o = JSON.parse(raw) as { sender?: string; name?: string; address?: string }
    if (typeof o.sender === 'string') return { sender: o.sender }
    const legacy = [o.name, o.address].filter((x) => typeof x === 'string' && x.trim()).join('\n')
    return { sender: legacy }
  } catch {
    return { sender: '' }
  }
}

function saveSenderProfile(sender: string) {
  try {
    localStorage.setItem(SENDER_PROFILE_KEY, JSON.stringify({ sender }))
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
  const updateTemplate = useLetterComposerStore((s) => s.updateTemplate)
  const updateComposeSession = useLetterComposerStore((s) => s.updateComposeSession)
  const setTemplateVersions = useLetterComposerStore((s) => s.setTemplateVersions)
  const setActiveTemplateVersionIndex = useLetterComposerStore((s) => s.setActiveTemplateVersionIndex)
  const focusedTemplateFieldId = useLetterComposerStore((s) => s.focusedTemplateFieldId)
  const setFocusedTemplateField = useLetterComposerStore((s) => s.setFocusedTemplateField)

  const connectDraftRefine = useDraftRefineStore((s) => s.connect)
  const disconnectDraftRefine = useDraftRefineStore((s) => s.disconnect)
  const updateDraftRefineText = useDraftRefineStore((s) => s.updateDraftText)
  const draftConnected = useDraftRefineStore((s) => s.connected)
  const draftRefineTarget = useDraftRefineStore((s) => s.refineTarget)

  const [draftError, setDraftError] = useState<string | null>(null)

  const prevLanguageRef = useRef<string | null>(null)
  const lastDetectedLangLetterId = useRef<string | null>(null)

  const language = composeSession?.language ?? 'en'

  const setComposeLanguage = useCallback(
    (code: string) => {
      if (composeSession) updateComposeSession(composeSession.id, { language: code })
    },
    [composeSession, updateComposeSession],
  )

  useEffect(() => {
    lastDetectedLangLetterId.current = null
    prevLanguageRef.current = null
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
      if (f.name === 'company_logo') continue
      m[fieldGroup(f)].push(f)
    }
    return m
  }, [template.fields])

  const logoField = useMemo(
    () => template.fields.find((f) => f.name === 'company_logo'),
    [template.fields],
  )

  const updateFieldValue = useCallback(
    (fieldId: string, value: string) => {
      updateTemplateField(template.id, fieldId, value)
      if (
        draftConnected &&
        draftRefineTarget === 'letter-template' &&
        focusedTemplateFieldId === fieldId
      ) {
        updateDraftRefineText(value)
      }
    },
    [
      template.id,
      updateTemplateField,
      draftConnected,
      draftRefineTarget,
      focusedTemplateFieldId,
      updateDraftRefineText,
    ],
  )

  const connectFieldToDraftRefine = useCallback(
    (field: TemplateField) => {
      const subject = `Letter: ${field.label || field.name}`
      const currentValue = field.value ?? ''

      const replyLetter =
        (composeSession?.replyToLetterId
          ? letters.find((l) => l.id === composeSession.replyToLetterId)
          : null) ?? replyToLetter
      const scanFallback = letters.length > 0 ? letters[letters.length - 1] : null
      const letterContext = (replyLetter?.fullText ?? scanFallback?.fullText ?? '').trim().substring(0, 3000)

      connectDraftRefine(
        null,
        subject,
        currentValue,
        (refined) => updateTemplateField(template.id, field.id, refined),
        'letter-template',
      )
      setFocusedTemplateField(field.id)

      const langLine = `Write in ${LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.en}.`
      if (letterContext) {
        const contextualDraft = currentValue
          ? `${currentValue}\n\n--- Context: Received Letter ---\n${letterContext}`
          : `--- Context: Received Letter ---\n${letterContext}`
        updateDraftRefineText(`${langLine}\n\n${contextualDraft}`)
      } else {
        updateDraftRefineText(
          currentValue.trim() ? `${langLine}\n\n${currentValue}` : `${langLine}\n`,
        )
      }

      window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
    },
    [
      composeSession?.replyToLetterId,
      language,
      letters,
      replyToLetter,
      template.id,
      connectDraftRefine,
      setFocusedTemplateField,
      updateTemplateField,
      updateDraftRefineText,
    ],
  )

  const handleFieldSelect = useCallback(
    (field: TemplateField) => {
      if (
        draftConnected &&
        draftRefineTarget === 'letter-template' &&
        focusedTemplateFieldId === field.id
      ) {
        disconnectDraftRefine()
        setFocusedTemplateField(null)
        return
      }
      connectFieldToDraftRefine(field)
    },
    [
      draftConnected,
      draftRefineTarget,
      focusedTemplateFieldId,
      disconnectDraftRefine,
      setFocusedTemplateField,
      connectFieldToDraftRefine,
    ],
  )

  const handleFieldFocusForAi = useCallback(
    (field: TemplateField) => {
      if (draftConnected && draftRefineTarget === 'letter-template' && focusedTemplateFieldId === field.id) {
        return
      }
      connectFieldToDraftRefine(field)
    },
    [draftConnected, draftRefineTarget, focusedTemplateFieldId, connectFieldToDraftRefine],
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
    if (!composeSession || !replyToLetter?.extractedFields) return
    const detected = replyToLetter.extractedFields.detected_language
    if (!detected?.trim()) return
    if (lastDetectedLangLetterId.current === replyToLetter.id) return
    lastDetectedLangLetterId.current = replyToLetter.id
    const code = normalizeDetectedLang(detected)
    if (code !== composeSession.language) {
      updateComposeSession(composeSession.id, { language: code })
    }
  }, [
    composeSession,
    replyToLetter?.id,
    replyToLetter?.extractedFields?.detected_language,
    updateComposeSession,
  ])

  useEffect(() => {
    const prev = prevLanguageRef.current
    prevLanguageRef.current = language
    if (prev === null) return
    if (prev === language) return

    const defaults = LANGUAGE_DEFAULTS[language] || LANGUAGE_DEFAULTS.en
    const oldDefaults = LANGUAGE_DEFAULTS[prev] || LANGUAGE_DEFAULTS.en
    const salutationField = template.fields.find((f) => f.name.toLowerCase().includes('salutation'))
    const closingField = template.fields.find((f) => {
      const n = f.name.toLowerCase()
      return n.includes('closing') && !n.includes('salutation')
    })

    if (salutationField) {
      const cur = (salutationField.value ?? '').trim()
      if (!cur || cur === oldDefaults.salutation) {
        updateTemplateField(template.id, salutationField.id, defaults.salutation)
      }
    }
    if (closingField) {
      const cur = (closingField.value ?? '').trim()
      if (!cur || cur === oldDefaults.closing) {
        updateTemplateField(template.id, closingField.id, defaults.closing)
      }
    }
  }, [language, template.fields, template.id, updateTemplateField])

  const persistSenderIfNeeded = useCallback((field: TemplateField, value: string) => {
    const n = field.name.toLowerCase()
    if (n.includes('recipient')) return
    if (n === 'sender') {
      saveSenderProfile(value)
    }
  }, [])

  const applyLogoFile = useCallback(
    (file: File | undefined) => {
      if (!file || !logoField) return
      const okMime = /^image\/(png|jpeg|jpg|svg\+xml)$/i.test(file.type)
      const okSvgName = file.name.toLowerCase().endsWith('.svg')
      if (!okMime && !okSvgName) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        if (!dataUrl) return
        updateTemplate(template.id, { logoPath: dataUrl })
        updateTemplateField(template.id, logoField.id, '')
      }
      reader.readAsDataURL(file)
    },
    [logoField, template.id, updateTemplate, updateTemplateField],
  )

  const handleLogoUpload = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      applyLogoFile(file)
    },
    [applyLogoFile],
  )

  const handleChangeLogo = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/svg+xml'
    input.onchange = () => applyLogoFile(input.files?.[0])
    input.click()
  }, [applyLogoFile])

  const handleRemoveLogo = useCallback(() => {
    if (!logoField) return
    updateTemplate(template.id, { logoPath: null })
    updateTemplateField(template.id, logoField.id, '')
  }, [logoField, template.id, updateTemplate, updateTemplateField])

  const handleAiDraftBody = useCallback(() => {
    const bodyField = template.fields.find((f) => {
      const n = f.name.toLowerCase()
      return (
        n === 'body' ||
        n.includes('body') ||
        f.type === 'richtext' ||
        f.type === 'multiline'
      )
    })
    if (!bodyField) {
      console.warn('[ComposeFieldsForm] No body field found')
      setDraftError('No body field found — add a field named “body” or a richtext/multiline content field.')
      return
    }
    setDraftError(null)

    connectFieldToDraftRefine(bodyField)

    const replyLetter =
      (composeSession?.replyToLetterId
        ? letters.find((l) => l.id === composeSession.replyToLetterId)
        : null) ?? replyToLetter
    const letterContext = (replyLetter?.fullText ?? '').substring(0, 3000)

    const currentSubject =
      template.fields.find((f) => f.name.toLowerCase().includes('subject'))?.value ?? ''
    const currentRecipient =
      template.fields.find((f) => f.name === 'recipient')?.value ??
      template.fields.find((f) => {
        const n = f.name.toLowerCase()
        return n.includes('recipient') && !n.includes('sender')
      })?.value ??
      ''

    const hint = [
      '\u{1F4DD} **Letter Composer** — Body field selected for AI drafting.',
      '',
      `Language: ${LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.en}.`,
      currentRecipient ? `Recipient: ${currentRecipient}` : null,
      currentSubject ? `Subject: ${currentSubject}` : null,
      letterContext.trim() ? '\nIncoming letter context available.' : null,
      '',
      'Type your instruction in the chat bar above (e.g. “write a formal response declining the offer”).',
    ]
      .filter(Boolean)
      .join('\n')

    window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
    window.dispatchEvent(new CustomEvent(WRCHAT_APPEND_ASSISTANT_EVENT, { detail: { text: hint } }))
  }, [
    composeSession?.replyToLetterId,
    connectFieldToDraftRefine,
    language,
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

  const renderFieldInput = (field: TemplateField, isFieldSelected: boolean) => {
    const v = field.value ?? ''
    const commonClass = `compose-field-input${isFieldSelected ? ' field-selected-for-ai' : ''}`
    const selectedStyle = isFieldSelected
      ? {
          borderColor: '#6366f1',
          boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.15)',
        }
      : undefined

    if (field.type === 'richtext' || field.type === 'multiline' || field.type === 'address') {
      return (
        <textarea
          className={commonClass}
          style={selectedStyle}
          rows={field.type === 'address' ? 4 : 6}
          value={v}
          onFocus={() => handleFieldFocusForAi(field)}
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
          style={selectedStyle}
          value={v.length >= 10 ? v.slice(0, 10) : v}
          onChange={(e) => updateFieldValue(field.id, e.target.value)}
        />
      )
    }

    return (
      <input
        type="text"
        className={commonClass}
        style={selectedStyle}
        value={v}
        onFocus={() => handleFieldFocusForAi(field)}
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

      <div className="compose-language-row">
        <label htmlFor="compose-letter-language">Letter language</label>
        <select
          id="compose-letter-language"
          value={language}
          onChange={(e) => setComposeLanguage(e.target.value)}
          disabled={!composeSession}
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
          <option value="it">Italiano</option>
          <option value="nl">Nederlands</option>
          <option value="pt">Português</option>
          <option value="pl">Polski</option>
          <option value="tr">Türkçe</option>
          <option value="ja">日本語</option>
          <option value="zh">中文</option>
          <option value="ar">العربية</option>
          <option value="ko">한국어</option>
          <option value="ru">Русский</option>
        </select>
      </div>

      {logoField ? (
        <div className="compose-logo-row">
          <div className="compose-field-header compose-logo-row__header">
            <label className="compose-field-row__label">{logoField.label}</label>
          </div>
          {template.logoPath ? (
            <div className="compose-logo-row__preview">
              <img
                src={templateLogoDisplayUrl(template.logoPath)}
                alt=""
                className="compose-logo-row__img"
              />
              <button type="button" className="compose-logo-row__btn" onClick={handleChangeLogo}>
                Change
              </button>
              <button type="button" className="compose-logo-row__btn" onClick={handleRemoveLogo}>
                Remove
              </button>
            </div>
          ) : (
            <label className="compose-logo-row__upload">
              <span className="compose-logo-row__upload-label">{'\u{1F4CE}'} Upload logo image</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={handleLogoUpload}
              />
              <span className="compose-logo-row__hint">PNG, JPG, or SVG</span>
            </label>
          )}
        </div>
      ) : null}

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
              const isFieldSelected =
                draftConnected &&
                draftRefineTarget === 'letter-template' &&
                focusedTemplateFieldId === field.id
              const showAiToggle = field.name !== 'company_logo'
              return (
                <div
                  key={field.id}
                  className={`compose-field-row${isFieldSelected ? ' compose-field-row--ai-active' : ''}`}
                >
                  <div
                    className="compose-field-header"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <label
                      className="compose-field-row__label"
                      style={{ fontSize: 12, fontWeight: 600, margin: 0 }}
                    >
                      {field.label}
                    </label>
                    {showAiToggle ? (
                      <button
                        type="button"
                        className={`field-ai-toggle${isFieldSelected ? ' field-ai-toggle--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleFieldSelect(field)
                        }}
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: isFieldSelected ? '1px solid #6366f1' : '1px solid #ddd',
                          background: isFieldSelected ? '#6366f1' : 'transparent',
                          color: isFieldSelected ? '#fff' : '#888',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          flexShrink: 0,
                        }}
                      >
                        {isFieldSelected ? '\u261D Selected' : '\u261D AI'}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                  {renderFieldInput(field, isFieldSelected)}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
