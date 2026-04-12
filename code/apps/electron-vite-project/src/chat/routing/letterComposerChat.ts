/**
 * Letter Composer — chatDirect flow (template or scanned-letter port). Reads Zustand stores; does not write them.
 */

import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import { useAiDraftContextStore } from '../../stores/useAiDraftContextStore'
import { useLetterComposerStore } from '../../stores/useLetterComposerStore'
import { buildLetterComposerSystemPrompt, buildLetterComposerUserPrompt } from './letterComposerPrompt'

const FALLBACK_FIELD = { label: 'Body', name: 'body' }

const LETTER_REFERENCE_PROMPT_KEYS = [
  'customer_number',
  'booking_account',
  'invoice_number',
  'contract_number',
  'order_number',
  'file_reference',
  'contact_person',
  'reference_number',
] as const

function formatReferenceDataFromLetter(ef: Record<string, string> | undefined): string | null {
  if (!ef) return null
  const lines = LETTER_REFERENCE_PROMPT_KEYS.filter((k) => (ef[k] ?? '').trim()).map(
    (k) => `${k}: ${(ef[k] ?? '').trim()}`,
  )
  if (lines.length === 0) return null
  return `REFERENCE DATA FROM ORIGINAL LETTER:\n${lines.join('\n')}`
}

export async function handleLetterComposerChat(params: {
  userQuery: string
  chatAttachmentText: string | null
  model: string
  provider: string
  stream: boolean
}): Promise<{ success: boolean; answer?: string; error?: string }> {
  const { focusMeta } = useChatFocusStore.getState()
  const letter = useLetterComposerStore.getState()
  const { documents } = useAiDraftContextStore.getState()

  const activeTemplateId = letter.activeTemplateId
  const templateId = focusMeta?.letterComposerTemplateId ?? activeTemplateId
  const tpl = templateId ? letter.templates.find((t) => t.id === templateId) : null

  const fieldId = focusMeta?.letterComposerApplyFieldId ?? letter.focusedTemplateFieldId
  let targetFieldLabel = FALLBACK_FIELD.label
  let targetFieldName = FALLBACK_FIELD.name
  if (tpl?.fields?.length) {
    const f = fieldId ? tpl.fields.find((x) => x.id === fieldId) : undefined
    if (f) {
      targetFieldLabel = f.label || f.name || FALLBACK_FIELD.label
      targetFieldName = f.name || FALLBACK_FIELD.name
    }
  }

  const systemPrompt = buildLetterComposerSystemPrompt({
    targetFieldLabel,
    targetFieldName,
  })

  let fieldSnapshot: string | null = null
  if (focusMeta?.letterComposerFields?.length && (fieldId || targetFieldName)) {
    const rows = focusMeta.letterComposerFields
    const row =
      (fieldId ? rows.find((r) => r.id === fieldId) : undefined) ??
      rows.find((r) => r.name === targetFieldName)
    const currentValue = row?.value?.trim()
    if (currentValue) {
      fieldSnapshot = `Current value of ${targetFieldLabel}: ${currentValue}`
    }
  }

  const contextDocumentsBlock =
    documents.length > 0
      ? documents.map((d) => `--- ${d.name || 'Document'} ---\n${d.text}`).join('\n\n')
      : null

  const { letterVaultPreview, letterVaultApplied } = useLetterComposerStore.getState()
  const vaultData = letterVaultApplied ? letterVaultPreview : null
  let senderIdentity: string | null = null
  if (vaultData) {
    const parts: string[] = []
    if (vaultData.companyName) parts.push(`Company: ${vaultData.companyName}`)
    if (vaultData.name) parts.push(`Name: ${vaultData.name}`)
    if (vaultData.address) parts.push(`Address: ${vaultData.address}`)
    if (vaultData.email) parts.push(`Email: ${vaultData.email}`)
    if (vaultData.phone) parts.push(`Phone: ${vaultData.phone}`)
    if (vaultData.signerName) parts.push(`Authorized signer: ${vaultData.signerName}`)
    senderIdentity = parts.length > 0 ? parts.join('\n') : null
  }

  const activeScan = letter.letters.find((l) => l.id === letter.activeLetterId)
  const referenceDataFromLetter = formatReferenceDataFromLetter(activeScan?.extractedFields)

  const userPrompt = buildLetterComposerUserPrompt({
    userInstruction: params.userQuery,
    // templateExcerpt: focusMeta?.letterComposerTemplateHtmlExcerpt ?? null,
    templateExcerpt: null, // Removed: HTML excerpt biases LLM language toward template language
    fieldSnapshot,
    scannedLetterText: focusMeta?.letterComposerLetterPageText ?? null,
    referenceDataFromLetter,
    contextDocuments: contextDocumentsBlock,
    chatAttachmentText: params.chatAttachmentText,
    senderIdentity,
  })

  const chatDirect = window.handshakeView?.chatDirect
  if (typeof chatDirect !== 'function') {
    return { success: false, error: 'chatDirect not available' }
  }

  try {
    const result = await chatDirect({
      model: params.model,
      provider: params.provider,
      systemPrompt,
      userPrompt,
      stream: params.stream,
    })
    if (!result.success) {
      const err = (result.error ?? result.message)?.trim() || 'chatDirect failed'
      return { success: false, error: err }
    }
    return { success: true, answer: result.answer }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}
