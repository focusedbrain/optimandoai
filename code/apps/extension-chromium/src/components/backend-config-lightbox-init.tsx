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

  // Get theme from storage or default
  chrome.storage?.local?.get(['theme'], (result) => {
    const theme = result?.theme || 'default';
    currentRoot?.render(
      <BackendConfigLightbox 
        isOpen={true} 
        onClose={handleClose} 
        theme={theme} 
      />
    );
  });
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



