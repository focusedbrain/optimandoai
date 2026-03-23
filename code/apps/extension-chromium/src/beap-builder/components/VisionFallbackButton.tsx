/**
 * VisionFallbackButton — Extract with Vision AI when parsing fails
 *
 * Shown when PDF parsing returns no text (scanned/image-based PDF).
 * User can supply Anthropic API key and retry extraction via Vision API.
 *
 * @version 1.0.0
 */

import React, { useState, useCallback } from 'react'
import { extractPdfTextWithVision } from '../visionExtractionService'
import {
  hasAnthropicApiKey,
  getAnthropicApiKey,
  saveAnthropicApiKey,
  validateAnthropicApiKey,
} from '../anthropicApiKeyStorage'
import type { CapsuleAttachment } from '../canonical-types'

export interface VisionFallbackButtonProps {
  attachment: CapsuleAttachment
  dataBase64: string
  onSuccess: (extractedText: string) => void
  theme?: 'default' | 'standard' | 'dark' | 'professional'
}

export const VisionFallbackButton: React.FC<VisionFallbackButtonProps> = ({
  attachment,
  dataBase64,
  onSuccess,
  theme = 'default',
}) => {
  const isLight = theme === 'standard' || theme === 'professional'
  const textColor = isLight ? '#1f2937' : 'white'
  const mutedColor = isLight ? '#6b7280' : 'rgba(255,255,255,0.6)'
  const borderColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)'

  const [loading, setLoading] = useState(false)
  const [showKeyDialog, setShowKeyDialog] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [hasStoredKey, setHasStoredKey] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  const checkStoredKey = useCallback(async () => {
    const has = await hasAnthropicApiKey()
    setHasStoredKey(has)
    return has
  }, [])

  const handleExtractWithStoredKey = useCallback(async () => {
    const key = await getAnthropicApiKey()
    if (!key) {
      setShowKeyDialog(true)
      return
    }
    await runExtraction(key)
  }, [dataBase64, onSuccess])

  const handleSaveKeyAndExtract = useCallback(async () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed.startsWith('sk-ant-')) {
      setKeyError('API key must start with sk-ant-')
      return
    }
    setKeyError(null)
    const validation = await validateAnthropicApiKey(trimmed)
    if (!validation.valid) {
      setKeyError(validation.error ?? 'Invalid API key')
      return
    }
    try {
      await saveAnthropicApiKey(trimmed)
      setShowKeyDialog(false)
      setApiKeyInput('')
      setHasStoredKey(true)
      await runExtraction(trimmed)
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to save key')
    }
  }, [apiKeyInput, dataBase64, onSuccess])

  const runExtraction = useCallback(
    async (apiKey: string) => {
      setLoading(true)
      setExtractError(null)
      setProgress('Starting…')
      try {
        const result = await extractPdfTextWithVision(dataBase64, apiKey, {
          onProgress: (cur, total) => setProgress(`Page ${cur} of ${total}…`),
        })
        if (result.success && result.extractedText) {
          onSuccess(result.extractedText)
        } else {
          setExtractError(result.error ?? 'Extraction failed')
        }
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : 'Extraction failed')
      } finally {
        setLoading(false)
        setProgress(null)
      }
    },
    [dataBase64, onSuccess]
  )

  const handleClick = useCallback(async () => {
    const has = hasStoredKey ?? (await checkStoredKey())
    if (has) {
      await handleExtractWithStoredKey()
    } else {
      setShowKeyDialog(true)
    }
  }, [hasStoredKey, checkStoredKey, handleExtractWithStoredKey])

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: '2px 8px',
          fontSize: '10px',
          fontWeight: 600,
          background: 'rgba(139,92,246,0.15)',
          border: '1px solid rgba(139,92,246,0.4)',
          borderRadius: '4px',
          color: '#a855f7',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (progress ?? '⏳ Extracting…') : 'Extract with Vision AI'}
      </button>

      {extractError && (
        <span style={{ fontSize: '9px', color: '#ef4444', marginLeft: 4 }} title={extractError}>
          {extractError.slice(0, 25)}…
        </span>
      )}

      {showKeyDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => !loading && setShowKeyDialog(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: isLight ? '#fff' : '#1f2937',
              borderRadius: 8,
              padding: 20,
              maxWidth: 380,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              border: `1px solid ${borderColor}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: textColor, marginBottom: 8 }}>
              Anthropic API Key (Vision AI)
            </div>
            <p style={{ fontSize: 12, color: mutedColor, margin: '0 0 12px 0', lineHeight: 1.5 }}>
              Text extraction failed for <strong>{attachment.originalName}</strong>. This may be a scanned or image-based PDF.
              Enter your Anthropic API key to extract text using AI Vision.
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => { setApiKeyInput(e.target.value); setKeyError(null) }}
              placeholder="sk-ant-..."
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 12,
                fontFamily: 'monospace',
                background: isLight ? '#f9fafb' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${keyError ? '#ef4444' : borderColor}`,
                borderRadius: 6,
                color: textColor,
                marginBottom: 8,
              }}
            />
            {keyError && (
              <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>{keyError}</div>
            )}
            <p style={{ fontSize: 10, color: mutedColor, margin: '0 0 12px 0' }}>
              Key is stored locally and only sent to Anthropic for extraction.{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#a855f7' }}
              >
                Get API key
              </a>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowKeyDialog(false)}
                disabled={loading}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: 'transparent',
                  border: `1px solid ${borderColor}`,
                  borderRadius: 6,
                  color: mutedColor,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveKeyAndExtract}
                disabled={loading || !apiKeyInput.trim()}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: '#a855f7',
                  border: 'none',
                  borderRadius: 6,
                  color: 'white',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Extracting…' : 'Save & Extract'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
