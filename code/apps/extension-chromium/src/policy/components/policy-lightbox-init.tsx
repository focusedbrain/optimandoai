/**
 * Policy Lightbox Dynamic Loader
 * 
 * Used by the content script to dynamically open the policy lightbox.
 */

import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { PolicyLightbox } from './PolicyLightbox'

interface PolicyLightboxInitProps {
  onClose?: () => void
  theme?: 'default' | 'dark' | 'professional'
}

function PolicyLightboxInit({ onClose, theme = 'default' }: PolicyLightboxInitProps) {
  const [isOpen, setIsOpen] = useState(true)

  const handleClose = () => {
    setIsOpen(false)
    onClose?.()
  }

  useEffect(() => {
    // Prevent body scroll when lightbox is open
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <PolicyLightbox
      isOpen={isOpen}
      onClose={handleClose}
      theme={theme}
    />
  )
}

/**
 * Open the policy lightbox in the content script context
 */
export function openPolicyLightboxInContent(theme: 'default' | 'dark' | 'professional' = 'default'): () => void {
  console.log('[PolicyLightbox] Opening in content script')

  // Create container
  const container = document.createElement('div')
  container.id = 'wr-policy-lightbox-root'
  container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 999999;'
  document.body.appendChild(container)

  // Create React root
  const root = createRoot(container)

  const cleanup = () => {
    console.log('[PolicyLightbox] Cleaning up')
    root.unmount()
    container.remove()
  }

  root.render(
    <React.StrictMode>
      <PolicyLightboxInit theme={theme} onClose={cleanup} />
    </React.StrictMode>
  )

  return cleanup
}



