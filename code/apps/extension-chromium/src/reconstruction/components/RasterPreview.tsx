/**
 * Raster Preview Component
 * 
 * Displays rasterized visual references from PDFium.
 * Thumbnail list with click-to-view for PDFs.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import type { RasterRef, RasterPage } from '../types'

interface RasterPreviewProps {
  rasterRefs: RasterRef[]
  theme: 'default' | 'dark' | 'professional'
}

export const RasterPreview: React.FC<RasterPreviewProps> = ({
  rasterRefs,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  
  const [selectedPage, setSelectedPage] = useState<{
    artefactId: string
    page: RasterPage
  } | null>(null)
  
  if (rasterRefs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 700,
          color: textColor,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🖼️</span>
          Visual Preview (Raster)
        </div>
        <div style={{
          padding: '30px',
          textAlign: 'center',
          color: mutedColor,
          background: cardBg,
          borderRadius: '10px',
          border: `1px solid ${borderColor}`
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🖼️</div>
          <div style={{ fontSize: '13px' }}>No rasterized previews available</div>
          <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
            Only PDF documents generate visual previews
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 700,
          color: textColor,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🖼️</span>
          Visual Preview (Raster)
        </div>
        <div style={{
          fontSize: '10px',
          color: mutedColor,
          fontStyle: 'italic'
        }}>
          Non-executable page images
        </div>
      </div>
      
      {/* Raster refs list */}
      {rasterRefs.map((ref) => (
        <div
          key={ref.artefactId}
          style={{
            background: cardBg,
            borderRadius: '10px',
            border: `1px solid ${borderColor}`,
            padding: '14px'
          }}
        >
          {/* Document header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>📄</span>
              <div>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: textColor
                }}>
                  {ref.artefactId.split('_att_')[1] 
                    ? `Attachment ${parseInt(ref.artefactId.split('_att_')[1]) + 1}`
                    : ref.artefactId}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: mutedColor
                }}>
                  {ref.totalPages} page{ref.totalPages !== 1 ? 's' : ''} • {ref.format.toUpperCase()}
                </div>
              </div>
            </div>
            <div style={{
              fontSize: '10px',
              color: mutedColor,
              fontFamily: 'monospace'
            }}>
              Hash: {ref.originalHash.substring(0, 12)}...
            </div>
          </div>
          
          {/* Page thumbnails */}
          <div style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap'
          }}>
            {ref.pages.map((page) => (
              <div
                key={page.pageNumber}
                onClick={() => setSelectedPage({ artefactId: ref.artefactId, page })}
                style={{
                  width: '80px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{
                  width: '80px',
                  height: '103px',
                  background: 'white',
                  borderRadius: '6px',
                  border: `2px solid ${borderColor}`,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  {/* Placeholder for actual raster image */}
                  <div style={{
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    color: '#94a3b8'
                  }}>
                    📄
                  </div>
                </div>
                <div style={{
                  fontSize: '10px',
                  color: mutedColor,
                  textAlign: 'center',
                  marginTop: '4px'
                }}>
                  Page {page.pageNumber}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      
      {/* Page viewer modal */}
      {selectedPage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => setSelectedPage(null)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#0f172a'
              }}>
                Page {selectedPage.page.pageNumber}
              </div>
              <button
                onClick={() => setSelectedPage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  color: '#64748b',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
            
            {/* Page image */}
            <div style={{
              width: '500px',
              height: '647px',
              background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
              <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>
                Rasterized Page Preview
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                {selectedPage.page.width} × {selectedPage.page.height} px
              </div>
              <div style={{
                fontSize: '10px',
                color: '#94a3b8',
                marginTop: '16px',
                fontFamily: 'monospace'
              }}>
                Hash: {selectedPage.page.imageHash.substring(0, 24)}...
              </div>
            </div>
            
            {/* Page info */}
            <div style={{
              marginTop: '16px',
              padding: '12px',
              background: '#f8fafc',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#64748b'
            }}>
              <strong>Note:</strong> This is a non-executable rasterized preview. 
              Original document remains encrypted.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

