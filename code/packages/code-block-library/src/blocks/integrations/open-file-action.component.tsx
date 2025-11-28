import React from 'react';

// Chrome runtime types
declare const chrome: {
  runtime: {
    sendMessage: (message: any, callback: (response: any) => void) => void;
    lastError?: { message: string };
  };
};

interface OpenFileActionProps {
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
  highlightRange?: { start: number; end: number };
  onSuccess?: () => void;
  onError?: (error: string) => void;
  children?: React.ReactNode;
  asButton?: boolean;
}

/**
 * Open File Action Component
 * 
 * Provides functionality to open files in the editor via IPC.
 * Can render as:
 * - A clickable button/link (when children provided)
 * - An invisible trigger (when used programmatically)
 * 
 * Communicates with Electron orchestrator to open files in:
 * - VS Code
 * - Cursor
 * - Other configured editors
 */
export const OpenFileAction: React.FC<OpenFileActionProps> = ({
  filePath,
  lineNumber,
  columnNumber,
  highlightRange,
  onSuccess,
  onError,
  children,
  asButton = false
}) => {
  const handleOpen = async () => {
    try {
      // Check if running in extension environment
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // Send message to background script
        chrome.runtime.sendMessage({
          type: 'OPEN_FILE',
          filePath,
          lineNumber,
          columnNumber,
          highlightRange
        }, (response) => {
          if (chrome.runtime.lastError) {
            onError?.(chrome.runtime.lastError.message);
            return;
          }
          if (response?.success) {
            onSuccess?.();
          } else {
            onError?.(response?.error || 'Failed to open file');
          }
        });
      } else {
        // Fallback for non-extension environments
        console.log('Open file:', { filePath, lineNumber, columnNumber, highlightRange });
        onSuccess?.();
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (!children) {
    // Invisible trigger - call handler immediately when mounted
    React.useEffect(() => {
      handleOpen();
    }, []);
    return null;
  }

  if (asButton) {
    return (
      <button
        onClick={handleOpen}
        style={{
          padding: '6px 12px',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          color: '#3b82f6',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f0f9ff';
          e.currentTarget.style.borderColor = '#3b82f6';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#fff';
          e.currentTarget.style.borderColor = '#e2e8f0';
        }}
      >
        {children}
      </button>
    );
  }

  // Render as clickable link
  return (
    <span
      onClick={handleOpen}
      style={{
        color: '#3b82f6',
        cursor: 'pointer',
        textDecoration: 'underline'
      }}
    >
      {children}
    </span>
  );
};
