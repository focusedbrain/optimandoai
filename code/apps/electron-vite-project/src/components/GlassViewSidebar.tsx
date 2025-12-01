/**
 * GlassViewSidebar Component
 * 
 * Renders the GlassView mini-app in the Electron sidebar.
 * Uses the template-driven architecture to build the UI.
 */

import React, { useState, useEffect, useCallback } from 'react'

// Declare the miniAppAPI on window
declare global {
  interface Window {
    miniAppAPI?: {
      toggleSidebar: (appId?: string) => void
      showSidebar: (appId?: string) => void
      hideSidebar: () => void
      loadTemplate: (templatePath: string) => Promise<{ success: boolean; template?: string; error?: string }>
      loadTemplateText: (templateText: string) => Promise<{ success: boolean; template?: string; error?: string }>
      requestAI: (prompt: string, context?: any) => Promise<{ success: boolean; result?: string; error?: string }>
      openFile: (filePath: string, lineNumber?: number) => void
      onSidebarShow: (cb: (data: any) => void) => void
      onSidebarHide: (cb: (data: any) => void) => void
      onTemplateLoaded: (cb: (data: any) => void) => void
      onCursorFiles: (cb: (data: any) => void) => void
      onAppMessage: (cb: (data: any) => void) => void
      sendMessage: (type: string, data: any) => void
    }
  }
}

interface GlassViewSidebarProps {
  visible: boolean
  onClose: () => void
  width?: number
}

// Embedded GlassView template (fallback if file loading fails)
const GLASSVIEW_TEMPLATE = `---
name: GLASSVIEW_APP
version: 1.0.0
description: Cursor file change viewer with AI-powered code analysis triggers

bootstrap:
  blockId: react-app
  props:
    title: "GlassView"
    description: "View and analyze cursor file changes"
    initialState:
      isConnected: false
      cursorChangedFiles: []
      selectedFileIndex: 0
      selectedHunk: null
      isLoading: false

layout:
  - type: container
    props:
      className: "glassview-container"
    children:
      - blockId: slider-navigation
        id: file-slider
        props:
          items: "$state.cursorChangedFiles"
          showDots: true
          showArrows: true
          autoPlay: false
        events:
          onSelect: handleFileSelection

      - blockId: code-hunk-display
        id: diff-viewer
        props:
          hunks: "$state.selectedHunk"
          showLineNumbers: true
          enableSyntaxHighlight: true
          
      - type: container
        props:
          className: "trigger-bar"
        children:
          - blockId: icon-trigger
            props:
              color: blue
              icon: info
              label: "Explain Code"
              action: requestAIExplanation
              
          - blockId: icon-trigger
            props:
              color: red
              icon: security
              label: "Security Check"
              action: requestSecurityAnalysis
              
          - blockId: icon-trigger
            props:
              color: green
              icon: check
              label: "Suggest Improvements"
              action: requestImprovements

actions:
  handleFileSelection:
    type: updateState
    params:
      key: selectedFileIndex
      value: "$event.index"
      
  requestAIExplanation:
    type: orchestrator
    params:
      action: ai_request
      prompt: "Explain this code change"
      
  requestSecurityAnalysis:
    type: orchestrator
    params:
      action: ai_request
      prompt: "Check for security issues"
      
  requestImprovements:
    type: orchestrator
    params:
      action: ai_request
      prompt: "Suggest improvements"

events:
  CURSOR_FILES_CHANGED:
    action: updateState
    params:
      key: cursorChangedFiles
      value: "$event.files"
---
`

export function GlassViewSidebar({ visible, onClose, width = 380 }: GlassViewSidebarProps) {
  const [template, setTemplate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursorFiles, setCursorFiles] = useState<string[]>([])
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // Load template on mount
  useEffect(() => {
    async function loadTemplate() {
      setLoading(true)
      setError(null)
      
      try {
        // Try to load from file first
        if (window.miniAppAPI) {
          const result = await window.miniAppAPI.loadTemplate('templates/glassview.template.md')
          if (result.success && result.template) {
            setTemplate(result.template)
            setLoading(false)
            return
          }
        }
        
        // Fallback to embedded template
        console.log('[GlassViewSidebar] Using embedded template')
        setTemplate(GLASSVIEW_TEMPLATE)
        
      } catch (err) {
        console.error('[GlassViewSidebar] Failed to load template:', err)
        setError(String(err))
        // Still use embedded template as fallback
        setTemplate(GLASSVIEW_TEMPLATE)
      } finally {
        setLoading(false)
      }
    }
    
    loadTemplate()
  }, [])

  // Set up event listeners
  useEffect(() => {
    if (!window.miniAppAPI) return
    
    // Listen for cursor file changes
    window.miniAppAPI.onCursorFiles((data) => {
      console.log('[GlassViewSidebar] Cursor files changed:', data.files)
      setCursorFiles(data.files || [])
    })
    
    // Listen for template loads
    window.miniAppAPI.onTemplateLoaded((data) => {
      console.log('[GlassViewSidebar] Template loaded:', data.path)
      if (data.template) {
        setTemplate(data.template)
      }
    })
  }, [])

  // Handle AI request
  const handleAIRequest = useCallback(async (prompt: string) => {
    if (!window.miniAppAPI) return
    
    setAiLoading(true)
    setAiResponse(null)
    
    try {
      const result = await window.miniAppAPI.requestAI(prompt, {
        file: cursorFiles[selectedFileIndex],
        fileIndex: selectedFileIndex
      })
      
      if (result.success) {
        setAiResponse(result.result || null)
      } else {
        setAiResponse(`Error: ${result.error}`)
      }
    } catch (err) {
      setAiResponse(`Error: ${err}`)
    } finally {
      setAiLoading(false)
    }
  }, [cursorFiles, selectedFileIndex])

  // Handle file open
  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    if (window.miniAppAPI) {
      window.miniAppAPI.openFile(filePath, line)
    }
  }, [])

  if (!visible) return null

  return (
    <div style={styles.container as React.CSSProperties}>
      {/* Header */}
      <div style={styles.header as React.CSSProperties}>
        <div style={styles.headerTitle as React.CSSProperties}>
          <span style={{ fontWeight: 600 }}>GlassView</span>
          <span style={{ fontSize: 11, color: '#808080', marginLeft: 8 }}>v1.0.0</span>
        </div>
        <div style={styles.headerControls as React.CSSProperties}>
          <button style={styles.controlButton as React.CSSProperties} onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={styles.content as React.CSSProperties}>
        {loading ? (
          <div style={styles.loading as React.CSSProperties}>
            <span>Loading GlassView...</span>
          </div>
        ) : error ? (
          <div style={styles.error as React.CSSProperties}>
            <h4>Error</h4>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {/* File Slider */}
            <div style={styles.section as React.CSSProperties}>
              <div style={styles.sectionTitle as React.CSSProperties}>Changed Files</div>
              {cursorFiles.length === 0 ? (
                <div style={styles.emptyState as React.CSSProperties}>
                  <p>No file changes detected</p>
                  <p style={{ fontSize: 11, color: '#666' }}>
                    Changes from Cursor will appear here
                  </p>
                </div>
              ) : (
                <div style={styles.fileList as React.CSSProperties}>
                  {cursorFiles.map((file, index) => (
                    <div
                      key={file}
                      style={{
                        ...styles.fileItem as React.CSSProperties,
                        backgroundColor: index === selectedFileIndex ? '#2d4a7c' : 'transparent'
                      }}
                      onClick={() => setSelectedFileIndex(index)}
                    >
                      <span style={styles.fileName as React.CSSProperties}>
                        {file.split('/').pop()}
                      </span>
                      <button
                        style={styles.openButton as React.CSSProperties}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenFile(file)
                        }}
                        title="Open in editor"
                      >
                        ↗
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Triggers */}
            <div style={styles.section as React.CSSProperties}>
              <div style={styles.sectionTitle as React.CSSProperties}>AI Triggers</div>
              <div style={styles.triggerBar as React.CSSProperties}>
                <button
                  style={{ ...styles.trigger as React.CSSProperties, backgroundColor: '#3b82f6' }}
                  onClick={() => handleAIRequest('Explain this code change in detail')}
                  disabled={aiLoading}
                  title="Explain Code"
                >
                  💡
                </button>
                <button
                  style={{ ...styles.trigger as React.CSSProperties, backgroundColor: '#ef4444' }}
                  onClick={() => handleAIRequest('Check this code for security vulnerabilities')}
                  disabled={aiLoading}
                  title="Security Check"
                >
                  🔒
                </button>
                <button
                  style={{ ...styles.trigger as React.CSSProperties, backgroundColor: '#22c55e' }}
                  onClick={() => handleAIRequest('Suggest improvements for this code')}
                  disabled={aiLoading}
                  title="Suggest Improvements"
                >
                  ✨
                </button>
                <button
                  style={{ ...styles.trigger as React.CSSProperties, backgroundColor: '#f97316' }}
                  onClick={() => handleAIRequest('Review this code for best practices')}
                  disabled={aiLoading}
                  title="Code Review"
                >
                  📋
                </button>
                <button
                  style={{ ...styles.trigger as React.CSSProperties, backgroundColor: '#a855f7' }}
                  onClick={() => handleAIRequest('Generate tests for this code')}
                  disabled={aiLoading}
                  title="Generate Tests"
                >
                  🧪
                </button>
              </div>
            </div>

            {/* AI Response */}
            {(aiLoading || aiResponse) && (
              <div style={styles.section as React.CSSProperties}>
                <div style={styles.sectionTitle as React.CSSProperties}>AI Response</div>
                <div style={styles.aiResponse as React.CSSProperties}>
                  {aiLoading ? (
                    <span style={{ color: '#808080' }}>Analyzing...</span>
                  ) : (
                    <pre style={styles.responseText as React.CSSProperties}>{aiResponse}</pre>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer as React.CSSProperties}>
        <div style={styles.statusIndicator as React.CSSProperties}>
          <div style={{
            ...styles.statusDot as React.CSSProperties,
            backgroundColor: cursorFiles.length > 0 ? '#4ec9b0' : '#808080'
          }} />
          <span>{cursorFiles.length > 0 ? 'Connected' : 'Waiting for changes'}</span>
        </div>
        <span style={{ fontSize: 10, color: '#666' }}>Template-Driven</span>
      </div>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
    fontSize: '13px',
    borderLeft: '1px solid #3c3c3c'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3c3c3c'
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center'
  },
  headerControls: {
    display: 'flex',
    gap: '4px'
  },
  controlButton: {
    background: 'transparent',
    border: 'none',
    color: '#808080',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '3px',
    fontSize: '12px'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '8px'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#808080'
  },
  error: {
    padding: '16px',
    color: '#f44747',
    backgroundColor: '#3a1d1d',
    borderRadius: '4px'
  },
  section: {
    marginBottom: '16px'
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#808080',
    textTransform: 'uppercase' as const,
    marginBottom: '8px'
  },
  emptyState: {
    padding: '24px',
    textAlign: 'center' as const,
    color: '#808080'
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px'
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  fileName: {
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
  },
  openButton: {
    background: 'transparent',
    border: 'none',
    color: '#808080',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: '12px'
  },
  triggerBar: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const
  },
  trigger: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    transition: 'opacity 0.2s'
  },
  aiResponse: {
    padding: '12px',
    backgroundColor: '#252526',
    borderRadius: '4px',
    maxHeight: '200px',
    overflow: 'auto'
  },
  responseText: {
    margin: 0,
    fontSize: '12px',
    fontFamily: 'Consolas, monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    backgroundColor: '#252526',
    borderTop: '1px solid #3c3c3c',
    fontSize: '11px'
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  }
}

export default GlassViewSidebar
