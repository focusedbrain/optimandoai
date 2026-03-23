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
export function openPolicyLightboxInContent(): () => void {
  // Create container immediately so cleanup always works
  const container = document.createElement('div')
  container.id = 'wr-policy-lightbox-root'
  container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 999999;'
  document.body.appendChild(container)

  const root = createRoot(container)

  const cleanup = () => {
    root.unmount()
    container.remove()
  }

  const resolveTheme = (raw: string): 'default' | 'dark' | 'professional' => {
    if (raw === 'standard' || raw === 'professional') return 'professional';
    if (raw === 'dark') return 'dark';
    return 'default';
  };

  const renderWith = (theme: 'default' | 'dark' | 'professional') => {
    root.render(
      <React.StrictMode>
        <PolicyLightboxInit theme={theme} onClose={cleanup} />
      </React.StrictMode>
    )
  };

  // Read theme from the same chrome.storage.local key the app uses
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(['optimando-ui-theme'], (result) => {
      renderWith(resolveTheme(result['optimando-ui-theme'] || 'default'));
    });
  } else {
    renderWith('default');
  }

  return cleanup
}



