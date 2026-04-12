/**
 * Letter Composer — system and user prompt builders for chatDirect (no store access).
 */

export function buildLetterComposerSystemPrompt(params: {
  targetFieldLabel: string
  targetFieldName: string
  /** e.g. 'de', 'en', or undefined — reserved for future use; LLM follows user instruction language. */
  userLanguageHint?: string
}): string {
  const { targetFieldLabel, targetFieldName } = params
  return `You are an assistant for composing formal business letters.

TASK:
- The user is editing exactly ONE target field of the letter template: ${targetFieldLabel} (technical name: ${targetFieldName}).
- Produce ONLY the text for this field.
- Do not explain your reasoning. Do not offer alternatives unless asked.
- If sender identity details are provided, use them exactly as given. Do not invent placeholder brackets like [Your Name] or [Address] for information that was provided.

LANGUAGE (strict):
- Your output language MUST match the language of the INSTRUCTION section in the user message.
- If the instruction is in English, write in English. If in German, write in German (formal Sie-Form).
- Other parts of the user message (field values, template text, documents) may be in a different language. IGNORE their language for your output.
- Never switch languages based on context — only based on the INSTRUCTION.

FORMAT:
- Output ONLY the finished text for the target field.
- No markdown headings, no code blocks, no quote frames.
- No preamble like "Here is the text:" — start directly with the field content.
- If the field is a salutation or closing, output only that single line.`
}

function nonEmpty(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return t.length > 0 ? t : null
}

export function buildLetterComposerUserPrompt(params: {
  userInstruction: string
  templateExcerpt?: string | null
  fieldSnapshot?: string | null
  scannedLetterText?: string | null
  contextDocuments?: string | null
  chatAttachmentText?: string | null
  senderIdentity?: string | null
}): string {
  const parts: string[] = []

  const ex = nonEmpty(params.templateExcerpt)
  if (ex) parts.push(`TEMPLATE (current state):\n${ex}\n\n`)

  const fs = nonEmpty(params.fieldSnapshot)
  if (fs) parts.push(`CURRENT FIELD VALUES:\n${fs}\n\n`)

  const sl = nonEmpty(params.scannedLetterText)
  if (sl) parts.push(`SCANNED LETTER:\n${sl}\n\n`)

  const cd = nonEmpty(params.contextDocuments)
  if (cd) parts.push(`ADDITIONAL DOCUMENTS:\n${cd}\n\n`)

  const ca = nonEmpty(params.chatAttachmentText)
  if (ca) parts.push(`CHAT ATTACHMENTS:\n${ca}\n\n`)

  const senderIdentity = nonEmpty(params.senderIdentity)
  if (senderIdentity) {
    parts.push(
      'SENDER IDENTITY (use these exact details, never use bracket placeholders for them):\n' +
        senderIdentity +
        '\n\n',
    )
  }

  const instruction = nonEmpty(params.userInstruction) ?? ''
  parts.push(`INSTRUCTION (write your output in this language):\n${instruction}`)

  return parts.join('')
}
