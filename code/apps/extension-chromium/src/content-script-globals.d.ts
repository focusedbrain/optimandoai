/**
 * Ambient declarations for identifiers that live inside initializeExtension()
 * in content-script.tsx but are referenced by the module-scope message listener.
 *
 * At runtime the listener callback only fires after initializeExtension() has
 * been called, so these are guaranteed to be set when they are actually read.
 * TypeScript cannot verify this cross-scope relationship, hence these declarations.
 */

/* eslint-disable no-var */
declare var currentTabData: {
  tabId: string
  tabName: string
  isLocked: boolean
  goals: { shortTerm: string; midTerm: string; longTerm: string }
  userIntentDetection: { detected: string; confidence: number; lastUpdate: string }
  uiConfig: { leftSidebarWidth: number; rightSidebarWidth: number; bottomSidebarHeight: number }
  helperTabs: any
  displayGrids: any
  agentBoxHeights: Record<string, any>
  agentBoxes: any[]
  [key: string]: any
}
declare var saveTabDataToStorage: () => void
declare var getCurrentSessionKey: () => string | null
declare var saveCurrentSession: () => void
declare var ensureSessionInHistory: (sessionKey: string, sessionData: any, callback?: () => void) => void
declare var syncSessionName: (newName: string, source?: string, target?: string) => void
declare var reloadSessionFromSQLite: (sessionKey: string) => void
declare var beginScreenSelect: (target: HTMLElement, preset?: any) => void
declare var cropCapturedImageToRect: (dataUrl: string, rect: any) => Promise<string>
declare var getOrAssignAgentNumber: (id: string) => number
declare var openToolLibraryLightbox: (slotId: string) => void
declare var setDockedChatTheme: (theme: 'pro' | 'dark' | 'standard') => void
declare var createDockedChat: () => void
declare var removeDockedChat: () => void
declare var existingData: string
declare var agentKey: string
declare var capL: HTMLInputElement | null
declare var capR: HTMLInputElement | null
declare var capE: HTMLInputElement | null
declare var render: () => void
/* eslint-enable no-var */

interface Window {
  gridWebSocket?: WebSocket | null
}
