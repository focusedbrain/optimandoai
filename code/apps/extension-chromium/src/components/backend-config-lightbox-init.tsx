import React from 'react';
import { createRoot } from 'react-dom/client';
import { BackendConfigLightbox } from './BackendConfigLightbox';

let currentRoot: ReturnType<typeof createRoot> | null = null;
let overlayElement: HTMLDivElement | null = null;

export function openBackendConfigLightbox() {
  // If already open, just return
  if (overlayElement && document.body.contains(overlayElement)) {
    return;
  }

  // Create overlay container
  overlayElement = document.createElement('div');
  overlayElement.id = 'backend-config-lightbox-overlay';
  
  // Append to body
  document.body.appendChild(overlayElement);

  // Create React root and render
  currentRoot = createRoot(overlayElement);
  
  const handleClose = () => {
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
  };

  // Read theme from the same chrome.storage.local key the app uses
  const resolveTheme = (raw: string): 'default' | 'dark' | 'professional' => {
    if (raw === 'standard' || raw === 'professional') return 'professional';
    if (raw === 'dark') return 'dark';
    return 'default';
  };

  const renderWith = (theme: 'default' | 'dark' | 'professional') => {
    currentRoot?.render(
      <BackendConfigLightbox 
        isOpen={true} 
        onClose={handleClose} 
        theme={theme} 
      />
    );
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(['optimando-ui-theme'], (result) => {
      renderWith(resolveTheme(result['optimando-ui-theme'] || 'default'));
    });
  } else {
    renderWith('default');
  }
}

export function closeBackendConfigLightbox() {
  if (currentRoot) {
    currentRoot.unmount();
    currentRoot = null;
  }
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
}




