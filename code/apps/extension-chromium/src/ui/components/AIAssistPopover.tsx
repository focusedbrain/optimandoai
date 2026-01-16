/**
 * AIAssistPopover Component
 * 
 * Popover for AI-assisted text generation.
 * Contains model selector and action buttons.
 */

import React, { useState, useRef, useEffect } from 'react'
import { 
  AI_ASSIST_ACTIONS, 
  MOCK_MODELS, 
  generateMockAIResponse 
} from '../../shared/ui/capabilities'

interface AIAssistPopoverProps {
  /** Whether the popover is open */
  isOpen: boolean
  /** Callback to close the popover */
  onClose: () => void
  /** Current text in the composer */
  inputText: string
  /** Callback when AI result should be applied */
  onApply: (text: string) => void
  /** Theme variant */
  theme?: 'default' | 'dark' | 'professional'
  /** Anchor element for positioning */
  anchorRef?: React.RefObject<HTMLElement>
}

export const AIAssistPopover: React.FC<AIAssistPopoverProps> = ({
  isOpen,
  onClose,
  inputText,
  onApply,
  theme = 'default',
  anchorRef
}) => {
  const [selectedModel, setSelectedModel] = useState(MOCK_MODELS[0].id)
  const [selectedAction, setSelectedAction] = useState(AI_ASSIST_ACTIONS[0].id)
  const [isProcessing, setIsProcessing] = useState(false)
  const [preview, setPreview] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Reset preview when opening
  useEffect(() => {
    if (isOpen) {
      setPreview('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleGenerate = () => {
    setIsProcessing(true)
    // Simulate processing delay
    setTimeout(() => {
      const result = generateMockAIResponse(selectedAction, inputText)
      setPreview(result)
      setIsProcessing(false)
    }, 500)
  }

  const handleApply = () => {
    if (preview) {
      onApply(preview)
      onClose()
    }
  }

  // Theme styles
  const getStyles = () => {
    const base = {
      container: {
        position: 'absolute' as const,
        bottom: '100%',
        right: '0',
        marginBottom: '8px',
        width: '280px',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 1000,
        overflow: 'hidden'
      },
      header: {
        padding: '10px 12px',
        fontWeight: 600,
        fontSize: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      },
      body: {
        padding: '12px'
      },
      label: {
        fontSize: '10px',
        fontWeight: 600,
        marginBottom: '6px',
        opacity: 0.7,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px'
      },
      select: {
        width: '100%',
        padding: '8px 10px',
        borderRadius: '6px',
        fontSize: '12px',
        marginBottom: '12px',
        outline: 'none'
      },
      actionGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '6px',
        marginBottom: '12px'
      },
      actionBtn: (active: boolean) => ({
        padding: '8px',
        borderRadius: '6px',
        fontSize: '11px',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        textAlign: 'center' as const,
        transition: 'all 0.15s ease'
      }),
      preview: {
        padding: '10px',
        borderRadius: '6px',
        fontSize: '12px',
        lineHeight: 1.5,
        marginBottom: '12px',
        minHeight: '60px',
        maxHeight: '120px',
        overflow: 'auto'
      },
      footer: {
        display: 'flex',
        gap: '8px',
        justifyContent: 'flex-end'
      },
      btn: (primary: boolean) => ({
        padding: '8px 14px',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        border: 'none'
      })
    }

    switch (theme) {
      case 'professional':
        return {
          ...base,
          container: { ...base.container, background: '#ffffff', border: '1px solid #e2e8f0' },
          header: { ...base.header, background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#0f172a' },
          body: { ...base.body, background: '#ffffff' },
          select: { ...base.select, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' },
          actionBtn: (active: boolean) => ({
            ...base.actionBtn(active),
            background: active ? 'rgba(59,130,246,0.15)' : '#f1f5f9',
            border: active ? '1px solid rgba(59,130,246,0.3)' : '1px solid #e2e8f0',
            color: active ? '#2563eb' : '#475569'
          }),
          preview: { ...base.preview, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' },
          btn: (primary: boolean) => ({
            ...base.btn(primary),
            background: primary ? '#3b82f6' : '#f1f5f9',
            color: primary ? 'white' : '#475569'
          })
        }
      case 'dark':
        return {
          ...base,
          container: { ...base.container, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)' },
          header: { ...base.header, background: '#0f172a', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb' },
          body: { ...base.body, background: '#1e293b' },
          select: { ...base.select, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e5e7eb' },
          actionBtn: (active: boolean) => ({
            ...base.actionBtn(active),
            background: active ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.08)',
            border: active ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
            color: active ? '#a78bfa' : '#94a3b8'
          }),
          preview: { ...base.preview, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb' },
          btn: (primary: boolean) => ({
            ...base.btn(primary),
            background: primary ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
            color: primary ? 'white' : '#94a3b8'
          })
        }
      default: // purple
        return {
          ...base,
          container: { ...base.container, background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', border: '1px solid rgba(255,255,255,0.2)' },
          header: { ...base.header, background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.15)', color: 'white' },
          body: { ...base.body },
          select: { ...base.select, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white' },
          actionBtn: (active: boolean) => ({
            ...base.actionBtn(active),
            background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
            border: active ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.15)',
            color: active ? 'white' : 'rgba(255,255,255,0.8)'
          }),
          preview: { ...base.preview, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.15)', color: 'white' },
          btn: (primary: boolean) => ({
            ...base.btn(primary),
            background: primary ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'rgba(255,255,255,0.15)',
            color: primary ? '#052e16' : 'white'
          })
        }
    }
  }

  const styles = getStyles()

  return (
    <div ref={popoverRef} style={styles.container}>
      <div style={styles.header}>
        <span>✨ AI Assist</span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            opacity: 0.6,
            color: 'inherit'
          }}
        >
          ×
        </button>
      </div>
      
      <div style={styles.body}>
        {/* Model Selector */}
        <div style={styles.label}>Model</div>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={styles.select}
        >
          {MOCK_MODELS.map(model => (
            <option key={model.id} value={model.id}>
              {model.name} - {model.description}
            </option>
          ))}
        </select>

        {/* Action Type */}
        <div style={styles.label}>Action</div>
        <div style={styles.actionGrid}>
          {AI_ASSIST_ACTIONS.map(action => (
            <button
              key={action.id}
              onClick={() => setSelectedAction(action.id)}
              style={styles.actionBtn(selectedAction === action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Preview */}
        {(preview || isProcessing) && (
          <>
            <div style={styles.label}>Preview</div>
            <div style={styles.preview}>
              {isProcessing ? (
                <span style={{ opacity: 0.6 }}>Generating...</span>
              ) : (
                preview
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div style={styles.footer}>
          <button
            onClick={handleGenerate}
            disabled={isProcessing || !inputText.trim()}
            style={{
              ...styles.btn(false),
              opacity: (isProcessing || !inputText.trim()) ? 0.5 : 1
            }}
          >
            {isProcessing ? '...' : 'Generate'}
          </button>
          <button
            onClick={handleApply}
            disabled={!preview || isProcessing}
            style={{
              ...styles.btn(true),
              opacity: (!preview || isProcessing) ? 0.5 : 1
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

export default AIAssistPopover








