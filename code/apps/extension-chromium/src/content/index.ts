// Bootstrap file for Frame Overlay system
// Handles initialization, watchdog, and fullscreen management

import { FrameOverlay } from './ui/FrameOverlay';
import { FrameOptions } from './types.d';

// Global instance
let overlay: FrameOverlay | null = null;

// Default configuration
const DEFAULT_OPTIONS: FrameOptions = {
  railSize: {
    top: 56,
    right: 16,
    bottom: 16,
    left: 280,
  },
  show: {
    top: true,
    right: true,
    bottom: true,
    left: true,
  },
  mode: 'safe',
};

// Initialize the overlay system
function initializeOverlay(options: FrameOptions = DEFAULT_OPTIONS): void {
  console.log('[FrameOverlay Bootstrap] Initializing overlay system');
  
  try {
    // Create new overlay instance
    overlay = new FrameOverlay();
    
    // Mount with options
    overlay.mount(options);
    
    // Expose for manual QA and debugging
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__WR_FRAME__ = overlay;
    
    console.log('[FrameOverlay Bootstrap] Overlay system initialized successfully');
    console.log('[FrameOverlay Bootstrap] Manual control available at window.__WR_FRAME__');
    console.log('[FrameOverlay Bootstrap] Example: __WR_FRAME__.update({ railSize: { left: 320 } })');
    
  } catch (error) {
    console.error('[FrameOverlay Bootstrap] Failed to initialize overlay:', error);
  }
}

// Clean shutdown
function shutdownOverlay(): void {
  console.log('[FrameOverlay Bootstrap] Shutting down overlay system');
  
  if (overlay) {
    overlay.unmount();
    overlay = null;
  }
  
  // Clean up global reference
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__WR_FRAME__;
}

// Bootstrap logic - wait for DOM to be ready
function bootstrap(): void {
  console.log('[FrameOverlay Bootstrap] Starting bootstrap process');
  
  // Check if we should initialize
  if (document.readyState !== 'loading') {
    // DOM is already ready
    initializeOverlay();
  } else {
    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', () => {
      initializeOverlay();
    });
  }
}

// Handle page lifecycle events
function setupLifecycleHandlers(): void {
  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[FrameOverlay Bootstrap] Page hidden');
    } else {
      console.log('[FrameOverlay Bootstrap] Page visible');
      // Re-initialize if overlay was lost
      if (!overlay && document.getElementById('wr-frame-root') === null) {
        console.log('[FrameOverlay Bootstrap] Overlay lost, re-initializing');
        initializeOverlay();
      }
    }
  });
  
  // Handle before unload
  window.addEventListener('beforeunload', () => {
    shutdownOverlay();
  });
  
  // Handle navigation changes (for SPAs)
  let currentUrl = window.location.href;
  const urlCheckInterval = setInterval(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      console.log('[FrameOverlay Bootstrap] URL changed, checking overlay state');
      
      // Ensure overlay is still present after navigation
      if (overlay && !document.getElementById('wr-frame-root')) {
        console.log('[FrameOverlay Bootstrap] Overlay lost after navigation, re-initializing');
        overlay = null;
        initializeOverlay();
      }
    }
  }, 1000);
  
  // Clean up interval on unload
  window.addEventListener('beforeunload', () => {
    clearInterval(urlCheckInterval);
  });
}

// Site-specific configurations
function getSiteSpecificOptions(): FrameOptions {
  const hostname = window.location.hostname.toLowerCase();
  const options: FrameOptions = { ...DEFAULT_OPTIONS };
  
  // YouTube - larger top rail for video controls
  if (hostname.includes('youtube.com')) {
    options.railSize = {
      ...options.railSize,
      top: 72,
      left: 240,
    };
  }
  
  // ChatGPT - minimal side rails to preserve chat width
  else if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
    options.railSize = {
      ...options.railSize,
      left: 200,
      right: 200,
    };
  }
  
  // X/Twitter - preserve timeline width
  else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
    options.railSize = {
      ...options.railSize,
      left: 260,
      right: 320,
    };
  }
  
  // Google Docs - minimal interference
  else if (hostname.includes('docs.google.com')) {
    options.railSize = {
      ...options.railSize,
      top: 48,
      left: 160,
      right: 160,
    };
  }
  
  // Mobile responsive adjustments
  if (window.innerWidth < 768) {
    options.railSize = {
      top: 48,
      right: 8,
      bottom: 8,
      left: 8,
    };
  }
  
  return options;
}

// Public API for external control
export function mountFrameOverlay(options?: FrameOptions): void {
  const finalOptions = options || getSiteSpecificOptions();
  
  if (overlay) {
    overlay.update(finalOptions);
  } else {
    initializeOverlay(finalOptions);
  }
}

export function unmountFrameOverlay(): void {
  shutdownOverlay();
}

export function updateFrameOverlay(options: FrameOptions): void {
  if (overlay) {
    overlay.update(options);
  } else {
    console.warn('[FrameOverlay Bootstrap] Cannot update: overlay not mounted');
  }
}

export function getFrameOverlay(): FrameOverlay | null {
  return overlay;
}

// Message handling for extension communication
function setupMessageHandlers(): void {
  // Listen for messages from extension
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[FrameOverlay Bootstrap] Received message:', message);
      
      switch (message.type) {
        case 'MOUNT_FRAME_OVERLAY':
          mountFrameOverlay(message.options);
          sendResponse({ success: true });
          break;
          
        case 'UNMOUNT_FRAME_OVERLAY':
          unmountFrameOverlay();
          sendResponse({ success: true });
          break;
          
        case 'UPDATE_FRAME_OVERLAY':
          updateFrameOverlay(message.options);
          sendResponse({ success: true });
          break;
          
        case 'GET_FRAME_OVERLAY_STATUS':
          sendResponse({
            mounted: !!overlay,
            options: overlay?.getCurrentOptions(),
            compatMode: overlay?.isInCompatMode(),
          });
          break;
          
        default:
          // Let other handlers process unknown messages
          break;
      }
    });
  }
}

// Debug utilities
function setupDebugUtilities(): void {
  // Add keyboard shortcuts for quick testing
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+F = Toggle Frame Overlay
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      if (overlay) {
        unmountFrameOverlay();
      } else {
        mountFrameOverlay();
      }
    }
    
    // Ctrl+Shift+G = Toggle Center Guides
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      if (overlay) {
        const topRail = overlay.getRailElement('top');
        const guidesButton = topRail?.querySelector('button') as HTMLButtonElement;
        if (guidesButton && guidesButton.textContent === 'Center Guides') {
          guidesButton.click();
        }
      }
    }
    
    // Ctrl+Shift+M = Toggle Mode
    if (e.ctrlKey && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      if (overlay) {
        const currentMode = overlay.isInCompatMode() ? 'safe' : 'compatB';
        overlay.update({ mode: currentMode });
      }
    }
  });
  
  // Console utilities
  console.log('[FrameOverlay Bootstrap] Debug shortcuts:');
  console.log('  Ctrl+Shift+F = Toggle Frame Overlay');
  console.log('  Ctrl+Shift+G = Toggle Center Guides');
  console.log('  Ctrl+Shift+M = Toggle Safe/Compat Mode');
}

// CSP-safe initialization
function safeInit(): void {
  try {
    setupLifecycleHandlers();
    setupMessageHandlers();
    setupDebugUtilities();
    bootstrap();
  } catch (error) {
    console.error('[FrameOverlay Bootstrap] Initialization failed:', error);
  }
}

// Start the bootstrap process
// Use setTimeout to ensure we don't block the main thread
setTimeout(safeInit, 100);

// Export for manual control
export { FrameOverlay, DEFAULT_OPTIONS };


