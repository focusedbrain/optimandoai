/**
 * PopupChatView
 *
 * Full-featured WR Chat for the popup window — mirrors the docked sidepanel's
 * chat pipeline exactly: LLM routing via processFlow, drag-and-drop with visual
 * overlay, orchestrator-side PDF extraction, pending-doc injection, OCR for images.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'

const BASE_URL = 'http://127.0.0.1:51248'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  imageUrl?: string
  timestamp?: number
}

export interface PopupChatViewProps {
  theme?: 'pro' | 'dark' | 'standard'
  availableModels?: Array<{ name: string; size?: string }>
  activeLlmModel?: string
  onModelSelect?: (name: string) => void
  onRefreshModels?: () => Promise<void>
  sessionName?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: any) => {
        if (chrome.runtime.lastError) { resolve(null); return }
        resolve(resp?.secret ?? null)
      })
    } catch { resolve(null) }
  })
}

function buildHeaders(secret: string | null, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (secret) h['X-Launch-Secret'] = secret
  return h
}

async function parseDataTransfer(dt: DataTransfer): Promise<any[]> {
  const out: any[] = []
  try {
    for (const f of Array.from(dt.files || [])) {
      const t = (f.type || '').toLowerCase()
      const kind = t.startsWith('image/') ? 'image' : 'file'
      out.push({ kind, payload: f, mime: f.type, name: f.name })
    }
    const url = dt.getData('text/uri-list') || dt.getData('text/url')
    if (url) out.push({ kind: 'url', payload: url })
    const txt = dt.getData('text/plain')
    if (txt && !url) out.push({ kind: 'text', payload: txt })
  } catch {}
  return out
}

async function extractPdfText(file: File, secret: string | null): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const base64 = btoa(binary)
    const attachmentId = `popup-drop-${file.name.replace(/[^a-zA-Z0-9]/g, '_')}-${file.size}`
    const response = await fetch(`${BASE_URL}/api/parser/pdf/extract`, {
      method: 'POST',
      headers: buildHeaders(secret),
      body: JSON.stringify({ attachmentId, base64 }),
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) return ''
    const result = await response.json()
    if (result.success && result.extractedText?.trim().length > 0) return result.extractedText.trim()
    return ''
  } catch { return '' }
}

async function runOcr(imageUrl: string, secret: string | null): Promise<string> {
  try {
    const res = await fetch(`${BASE_URL}/api/ocr/process`, {
      method: 'POST',
      headers: buildHeaders(secret),
      body: JSON.stringify({ image: imageUrl })
    })
    if (!res.ok) return ''
    const json = await res.json()
    return json.ok && json.data?.text ? (json.data.text as string) : ''
  } catch { return '' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const PopupChatView: React.FC<PopupChatViewProps> = ({
  theme = 'pro',
  availableModels = [],
  activeLlmModel,
  onModelSelect,
  onRefreshModels,
  sessionName = 'Active Session',
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pendingDoc, setPendingDoc] = useState<{ name: string; text: string } | null>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  const secretRef = useRef<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch launch secret once on mount
  useEffect(() => {
    let cancelled = false
    const fetch_ = async () => {
      const secret = await getLaunchSecret()
      if (!cancelled) secretRef.current = secret
    }
    fetch_()
    // Retry once after 3 s in case background hasn't received handshake yet
    const timer = setTimeout(async () => {
      if (!secretRef.current) {
        const secret = await getLaunchSecret()
        if (!cancelled) secretRef.current = secret
      }
    }, 3000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // Check connection status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (r: any) => {
      if (!chrome.runtime.lastError) setIsConnected(!!r?.data?.isConnected)
    })
  }, [])

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', handler) }
  }, [showModelDropdown])

  const scrollToBottom = () => {
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, 0)
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const items = await parseDataTransfer(e.dataTransfer)
    if (!items.length) return

    for (const item of items) {
      if (item.kind === 'image' && item.payload instanceof File) {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          setMessages(prev => [...prev, { role: 'user', text: `📎 ${item.name || 'image'}`, imageUrl: dataUrl }])
          scrollToBottom()
        }
        reader.readAsDataURL(item.payload)
        continue
      }

      if (item.kind === 'text') {
        setPendingDoc({ name: 'Dropped text', text: (item.payload as string).slice(0, 6000) })
        setMessages(prev => [...prev, { role: 'user', text: `📄 **Dropped text** attached — send your question below.` }])
        continue
      }

      if (item.kind === 'url') {
        setMessages(prev => [...prev, { role: 'user', text: `🔗 ${item.payload}` }])
        continue
      }

      if (item.payload instanceof File) {
        const file = item.payload as File
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const isText = ['txt','md','csv','json','js','ts','py','html','css','xml','log','yaml','yml'].includes(ext)

        if (isText) {
          const reader = new FileReader()
          reader.onload = () => {
            setPendingDoc({ name: file.name, text: (reader.result as string).slice(0, 6000) })
            setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — send your question below.` }])
            scrollToBottom()
          }
          reader.readAsText(file)
        } else {
          // PDF / binary — send to orchestrator parser
          setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — extracting text…` }])
          scrollToBottom()
          extractPdfText(file, secretRef.current).then(extracted => {
            if (extracted && extracted.length > 50) {
              setPendingDoc({ name: file.name, text: extracted.slice(0, 8000) })
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.text?.includes('extracting text')) {
                  updated[updated.length - 1] = { ...last, text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — ${extracted.split(/\s+/).length.toLocaleString()} words extracted. Send your question below.` }
                }
                return updated
              })
            } else {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.text?.includes('extracting text')) {
                  updated[updated.length - 1] = { ...last, text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — no selectable text found (scanned PDF?). Send your question below.` }
                }
                return updated
              })
            }
          })
        }
      }
    }
    scrollToBottom()
  }, [])

  // ── File input (upload button) ───────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const isImage = file.type.startsWith('image/')
    const isText = ['txt','md','csv','json','js','ts','py','html','css','xml','log','yaml','yml'].includes(ext)

    if (isImage) {
      const reader = new FileReader()
      reader.onload = () => {
        setMessages(prev => [...prev, { role: 'user', text: `📎 ${file.name}`, imageUrl: reader.result as string }])
        scrollToBottom()
      }
      reader.readAsDataURL(file)
      return
    }

    if (isText) {
      const reader = new FileReader()
      reader.onload = () => {
        setPendingDoc({ name: file.name, text: (reader.result as string).slice(0, 6000) })
        setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — send your question below.` }])
        scrollToBottom()
      }
      reader.readAsText(file)
      return
    }

    // PDF / binary
    const fileCopy = file
    setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — extracting text…` }])
    scrollToBottom()
    extractPdfText(fileCopy, secretRef.current).then(extracted => {
      if (extracted && extracted.length > 50) {
        setPendingDoc({ name: fileCopy.name, text: extracted.slice(0, 8000) })
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.text?.includes('extracting text')) {
            updated[updated.length - 1] = { ...last, text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — ${extracted.split(/\s+/).length.toLocaleString()} words extracted. Send your question below.` }
          }
          return updated
        })
      } else {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.text?.includes('extracting text')) {
            updated[updated.length - 1] = { ...last, text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — no selectable text found (scanned PDF?). Send your question below.` }
          }
          return updated
        })
      }
    })
  }, [])

  // ── Send message ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim()
    const docCtx = pendingDoc
    if (docCtx) setPendingDoc(null)

    const lastUserMsgWithImage = [...messages].reverse().find(m => m.role === 'user' && m.imageUrl)
    const currentTurnImageUrl = lastUserMsgWithImage?.imageUrl
    const hasImage = !!currentTurnImageUrl

    if (!text && !hasImage && !docCtx) {
      if (isLoading) return
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `💡 **How to use WR Chat:**\n\n• Ask questions about the orchestrator or your workflow\n• Trigger automations using **#tagname** (e.g., "#summarize")\n• Drop or upload a file 📎 to attach it, then ask a question about it\n\nTry: "What can you help me with?"`
      }])
      scrollToBottom()
      return
    }

    if (isLoading) return

    if (!activeLlmModel) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `⚠️ No LLM model available. Please go to Admin panel → LLM Settings and install a model.`
      }])
      scrollToBottom()
      return
    }

    // Build the text we send to the LLM (with doc content injected)
    const llmText = docCtx
      ? `[Attached document: ${docCtx.name}]\n\n${docCtx.text}\n\n---\n${text}`
      : text

    const userDisplayText = text || (docCtx ? `📄 ${docCtx.name}` : '')
    const newMessages: ChatMessage[] = userDisplayText
      ? [...messages, { role: 'user' as const, text: userDisplayText }]
      : [...messages]

    setMessages(newMessages)
    setInput('')
    setIsLoading(true)
    scrollToBottom()

    try {
      // OCR for image if present
      let ocrText = ''
      if (hasImage && currentTurnImageUrl) {
        ocrText = await runOcr(currentTurnImageUrl, secretRef.current)
      }

      // Build messages array for LLM
      let processedMessages = await Promise.all(newMessages.map(async (msg) => {
        if (msg.imageUrl && msg.role === 'user') {
          const ocr = await runOcr(msg.imageUrl, secretRef.current)
          return {
            role: msg.role as string,
            content: ocr
              ? `${msg.text || 'Image:'}\n\n[OCR extracted text]:\n${ocr}`
              : msg.text || '[Image attached - OCR unavailable]'
          }
        }
        return { role: msg.role as string, content: msg.text }
      }))

      // Inject doc content into last user message
      if (docCtx) {
        processedMessages = [...processedMessages]
        for (let i = processedMessages.length - 1; i >= 0; i--) {
          if (processedMessages[i].role === 'user') {
            processedMessages[i] = {
              ...processedMessages[i],
              content: `[Attached document: ${docCtx.name}]\n\n${docCtx.text}\n\n---\n${processedMessages[i].content}`
            }
            break
          }
        }
      }

      // Try routing via processFlow agents, fall back to Butler
      let answered = false
      try {
        const { routeInput, wrapInputForAgent, updateAgentBoxOutput, getButlerSystemPrompt: _getButler } = await import('../../services/processFlow')
        const enrichedText = ocrText ? `${llmText}\n\n[Image Text]:\n${ocrText}` : llmText

        let currentUrl = ''
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          currentUrl = tab?.url || ''
        } catch {}

        const routingDecision = await routeInput(enrichedText, hasImage, isConnected, sessionName, activeLlmModel, currentUrl)

        if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
          // Show Butler's forwarding confirmation first
          if (routingDecision.butlerResponse) {
            setMessages(prev => [...prev, { role: 'assistant', text: routingDecision.butlerResponse }])
          }

          // PATH A: Agent processing
          for (const match of routingDecision.matchedAgents) {
            const agentInput = wrapInputForAgent(enrichedText, match, {})
            const agentMessages = [
              { role: 'system', content: agentInput.systemPrompt },
              ...processedMessages.filter(m => m.role === 'user')
            ]
            // Use agent's own model if configured, otherwise fall back to active model
            const modelToUse = match.agentBoxModel || activeLlmModel
            const agentRes = await fetch(`${BASE_URL}/api/llm/chat`, {
              method: 'POST',
              headers: buildHeaders(secretRef.current),
              body: JSON.stringify({ modelId: modelToUse, messages: agentMessages })
            })
            if (agentRes.ok) {
              const agentJson = await agentRes.json()
              const agentReply = (agentJson.ok && agentJson.data?.content) ? agentJson.data.content : ''
              if (agentReply) {
                if (match.agentBoxId) {
                  // Route to Agent Box — show brief confirmation in chat, not full reply
                  try { await updateAgentBoxOutput(match.agentBoxId, agentReply) } catch {}
                  const boxNum = String(match.agentBoxNumber ?? '').padStart(2, '0')
                  const confirm = `✓ ${match.agentIcon} **${match.agentName}** processed your request.\n→ Output displayed in Agent Box ${boxNum}`
                  setMessages(prev => [...prev, { role: 'assistant', text: confirm }])
                } else {
                  // No Agent Box configured — print full reply inline
                  setMessages(prev => [...prev, { role: 'assistant', text: `${match.agentIcon} **${match.agentName}**:\n\n${agentReply}` }])
                }
                answered = true
              }
            }
          }
        }
      } catch (e) {
        console.warn('[PopupChat] Agent routing failed, falling back to Butler:', e)
      }

      if (!answered) {
        // PATH B: Butler (general assistant)
        const { getButlerSystemPrompt } = await import('../../services/processFlow')
        const agentCount = 0
        const butlerPrompt = getButlerSystemPrompt(sessionName, agentCount, isConnected)
        const butlerMessages = [
          { role: 'system', content: butlerPrompt },
          ...processedMessages
        ]
        const butlerRes = await fetch(`${BASE_URL}/api/llm/chat`, {
          method: 'POST',
          headers: buildHeaders(secretRef.current),
          body: JSON.stringify({ modelId: activeLlmModel, messages: butlerMessages })
        })
        if (butlerRes.ok) {
          const butlerJson = await butlerRes.json()
          const butlerReply = (butlerJson.ok && butlerJson.data?.content) ? butlerJson.data.content : ''
          if (butlerReply) {
            setMessages(prev => [...prev, { role: 'assistant', text: butlerReply }])
          } else {
            setMessages(prev => [...prev, { role: 'assistant', text: `⚠️ LLM returned an empty response. The model may still be loading — please try again.` }])
          }
        } else {
          const errText = await butlerRes.text().catch(() => butlerRes.statusText)
          setMessages(prev => [...prev, { role: 'assistant', text: `❌ LLM error (${butlerRes.status}): ${errText}` }])
        }
      }
    } catch (err: any) {
      console.error('[PopupChat] handleSend error:', err)
      setMessages(prev => [...prev, { role: 'assistant', text: `❌ Error: ${err?.message || 'Unknown error'}` }])
    } finally {
      setIsLoading(false)
      scrollToBottom()
    }
  }, [input, messages, pendingDoc, activeLlmModel, isLoading, isConnected, sessionName])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── Theme ────────────────────────────────────────────────────────────────────

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  const isPro = theme === 'pro'

  const colors = {
    bg: isLight ? '#f8f9fb' : 'transparent',
    header: isLight ? '#ffffff' : isPro ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.2)',
    headerBorder: isLight ? '#e1e8ed' : 'rgba(255,255,255,0.1)',
    headerText: isLight ? '#0f172a' : 'white',
    badgeBg: isLight ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.15)',
    badgeText: isLight ? '#2563eb' : 'white',
    composerBorder: isLight ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.12)',
    composerBg: isLight ? '#ffffff' : 'transparent',
    inputBg: isLight ? '#ffffff' : 'rgba(255,255,255,0.08)',
    inputBorder: isLight ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.18)',
    inputText: isLight ? '#0f172a' : '#f1f5f9',
    userBubbleBg: isLight ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.14)',
    userBubbleBorder: isLight ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.5)',
    aiBubbleBg: isLight ? '#ffffff' : 'rgba(255,255,255,0.1)',
    aiBubbleBorder: isLight ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)',
    bubbleText: isLight ? '#0f172a' : '#f1f5f9',
    muted: isLight ? '#64748b' : 'rgba(255,255,255,0.5)',
    pendingBg: isLight ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.15)',
    pendingBorder: isLight ? '#c7d2fe' : 'rgba(99,102,241,0.4)',
    pendingText: isLight ? '#4338ca' : '#a5b4fc',
    dragOverlay: 'rgba(99,102,241,0.85)',
    btnBg: isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)',
    btnBorder: isLight ? '#e1e8ed' : 'rgba(255,255,255,0.18)',
    btnText: isLight ? '#374151' : 'rgba(255,255,255,0.75)',
  }

  const noModels = availableModels.length === 0
  const canSend = !isLoading && (!!input.trim() || !!pendingDoc)

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative', background: colors.bg }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: colors.dragOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', borderRadius: '8px'
        }}>
          <span style={{ fontSize: 32, marginRight: 10 }}>📎</span>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>Drop file or image here</span>
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: '8px 12px', fontSize: '11px', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: '8px',
        background: colors.header, borderBottom: `1px solid ${colors.headerBorder}`, color: colors.headerText
      }}>
        <span style={{
          padding: '3px 8px', borderRadius: '4px', fontSize: '10px',
          background: colors.badgeBg, color: colors.badgeText
        }}>⚡ Command Session</span>
      </div>

      {/* Messages */}
      <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px'
      }}>
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px', fontSize: '12px', color: colors.muted }}>
            Type a command to get started…
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            maxWidth: '85%', padding: '10px 12px', borderRadius: '10px',
            fontSize: '12px', lineHeight: 1.45,
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            wordBreak: 'break-word', overflowWrap: 'anywhere',
            background: msg.role === 'user' ? colors.userBubbleBg : colors.aiBubbleBg,
            border: msg.role === 'user' ? colors.userBubbleBorder : colors.aiBubbleBorder,
            color: colors.bubbleText
          }}>
            {msg.imageUrl && (
              <img src={msg.imageUrl} alt="attachment" style={{ maxWidth: '100%', borderRadius: 6, display: 'block', marginBottom: msg.text ? 6 : 0 }} />
            )}
            {msg.text && <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>}
          </div>
        ))}
        {isLoading && (
          <div style={{
            maxWidth: '85%', padding: '10px 12px', borderRadius: '10px',
            fontSize: '12px', alignSelf: 'flex-start',
            background: colors.aiBubbleBg, border: colors.aiBubbleBorder, color: colors.muted
          }}>
            ⏳ Thinking…
          </div>
        )}
      </div>

      {/* Pending doc indicator */}
      {pendingDoc && (
        <div style={{
          margin: '0 8px', padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
          background: colors.pendingBg, border: `1px solid ${colors.pendingBorder}`, color: colors.pendingText, fontSize: 11
        }}>
          <span>📎</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{pendingDoc.name}</strong> attached — type your question and Send
          </span>
          <button onClick={() => setPendingDoc(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'inherit', fontSize: 13
          }}>×</button>
        </div>
      )}

      {/* Composer */}
      <div style={{
        padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px',
        background: colors.composerBg, borderTop: colors.composerBorder
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          {/* Hidden file input */}
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />

          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach file or PDF"
            style={{
              width: 44, height: 44, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
              background: colors.btnBg, border: `1px solid ${colors.btnBorder}`, color: colors.btnText,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
            }}
          >
            📎
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Start a conversation… or Command the Orchestrator… or Upload a BEAP™ Message"
            disabled={isLoading}
            style={{
              flex: 1, minHeight: 42, maxHeight: 120, resize: 'vertical',
              padding: '10px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', outline: 'none',
              background: colors.inputBg, border: colors.inputBorder, color: colors.inputText
            }}
          />

          {/* Send / model selector */}
          <div ref={modelDropdownRef} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
            <button
              onClick={handleSend}
              disabled={!canSend}
              style={{
                height: 44, padding: '4px 14px', cursor: canSend ? 'pointer' : 'not-allowed',
                border: 'none', fontWeight: 700, fontSize: 13, transition: 'all 0.2s ease',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16',
                borderRadius: onModelSelect ? '10px 0 0 10px' : '10px',
                opacity: canSend ? 1 : 0.65,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1
              }}
            >
              <span>{isLoading ? '…' : 'Run'}</span>
              {activeLlmModel && (
                <span style={{ fontSize: 9, opacity: 0.85, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeLlmModel}
                </span>
              )}
            </button>

            {onModelSelect && onRefreshModels && (
              <>
                <button
                  onClick={async () => {
                    if (!showModelDropdown && onRefreshModels) await onRefreshModels()
                    setShowModelDropdown(s => !s)
                  }}
                  disabled={isLoading}
                  style={{
                    height: 44, padding: '4px 10px', border: 'none', fontWeight: 700, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16',
                    borderRadius: '0 10px 10px 0', borderLeft: '1px solid rgba(0,0,0,0.1)', minWidth: 36,
                    opacity: isLoading ? 0.65 : 1, fontSize: 13
                  }}
                >▾</button>

                {showModelDropdown && (
                  <div style={{
                    position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
                    background: isLight ? '#ffffff' : '#1e293b',
                    border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                    zIndex: 1000, minWidth: 180, maxHeight: 220, overflowY: 'auto'
                  }}>
                    <div style={{
                      padding: '8px 12px', fontSize: 10, fontWeight: 700,
                      color: isLight ? '#475569' : 'rgba(255,255,255,0.7)',
                      borderBottom: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)'
                    }}>SELECT MODEL</div>
                    {noModels && (
                      <div style={{ padding: '10px 12px', fontSize: 11, color: colors.muted }}>
                        No models available. Install models in LLM Settings.
                      </div>
                    )}
                    {availableModels.map(m => (
                      <div
                        key={m.name}
                        onClick={() => { onModelSelect(m.name); setShowModelDropdown(false) }}
                        style={{
                          padding: '10px 12px', fontSize: 12, cursor: 'pointer',
                          color: isLight ? '#0f172a' : '#f1f5f9',
                          background: m.name === activeLlmModel ? 'rgba(34,197,94,0.12)' : 'transparent',
                          borderLeft: m.name === activeLlmModel ? '3px solid #22c55e' : '3px solid transparent'
                        }}
                      >{m.name}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PopupChatView
