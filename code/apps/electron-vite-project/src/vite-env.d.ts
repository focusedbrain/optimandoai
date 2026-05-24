/// <reference types="vite/client" />

/** Build-time stamps from `vite.config.ts` define (renderer + preload). */
declare const __WR_RUNTIME_GIT_COMMIT__: string
declare const __WR_RUNTIME_GIT_BRANCH__: string
declare const __ORCHESTRATOR_BUILD_STAMP__: string

declare module 'ws'

interface CapturePresetPayload {
  mode: 'screenshot' | 'stream'
  rect: { x: number; y: number; w: number; h: number }
  displayId?: string
}

interface LmgtfyBridge {
  selectScreenshot: (opts?: { createTrigger?: boolean; addCommand?: boolean }) => Promise<unknown>
  selectStream: () => Promise<unknown>
  stopStream: () => Promise<unknown>
  getPresets: () => Promise<{ regions?: unknown[] }>
  capturePreset: (payload: CapturePresetPayload) => Promise<unknown>
  savePreset: (payload: object) => Promise<unknown>
  onCapture: (cb: (payload: unknown) => void) => () => void
  onHotkey: (cb: (kind: string) => void) => () => void
  onTriggersUpdated: (cb: () => void) => () => void
  onDashboardCommandAppend: (cb: (payload: unknown) => void) => () => void
  onDashboardTriggerPrompt: (cb: (payload: unknown) => void) => () => void
  onDashboardSelectionResult?: (cb: (payload: unknown) => void) => () => void
  onDashboardDiffResult?: (cb: (payload: unknown) => void) => () => void
  /** Main sends `{ scanId, threats }` when Electron watchdog completes a scan with threats. */
  onDashboardWatchdogAlert?: (cb: (payload: unknown) => void) => () => void
  /** Alias of `onDashboardWatchdogAlert` (same `watchdog-alert` IPC). */
  onWatchdogAlert?: (cb: (payload: unknown) => void) => () => void
  /** Removes all `watchdog-alert` listeners. */
  removeWatchdogAlertListener?: () => void
}

interface AnalysisDashboardBridge {
  onOpen: (cb: (rawPayload: unknown) => void) => () => void
  onThemeChange: (cb: (theme: string) => void) => () => void
  requestTheme: () => void
  setTheme: (theme: string) => void
  openBeapInbox: () => void
  openBeapDraft: () => void
  openEmailCompose: () => void
  openHandshakeRequest: () => void
  openWrChat: () => void
  /**
   * Open Chrome extension display grid tabs (Electron → extension WebSocket).
   * Optional orchestrator `session` JSON mirrors session-history restore (storage + `maybePresentOrchestratorDisplayGridSession`).
   */
  presentOrchestratorDisplayGrid: (
    sessionKey: string,
    session?: Record<string, unknown>,
    source?: string,
  ) => void
  /** Relay live Agent Box refresh to extension after dashboard WR Chat persists output (matches MV3 background broadcast). */
  relayAgentBoxOutputLive: (data: {
    agentBoxId: string
    agentBoxUuid: string
    output: string
    allBoxes: unknown[]
    sourceSurface?: 'dashboard' | 'sidepanel' | 'popup'
  }) => void
}

interface LifecycleBridge {
  onMainProcessMessage: (cb: (message: string) => void) => () => void
}

/** WR Chat dashboard helpers (`PICK_DIRECTORY` IPC). */
interface WrChatBridge {
  pickDirectory: () => Promise<string | null>
}

/** Open http(s) links in the OS default browser (`app:openExternal` IPC). */
interface AppShellBridge {
  openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

/** System LibreOffice `soffice` — detection and headless PDF conversion. */
interface LibreOfficeBridge {
  detect: () => Promise<{ available: boolean; path: string | null }>
  convertToPdf: (
    inputPath: string,
    outputDir: string,
  ) => Promise<{ ok: true; pdfPath: string } | { ok: false; error: string }>
  resetDetection: () => Promise<{ ok: true }>
  setManualPath: (manualPath: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  browseForSoffice: () => Promise<{ ok: true; path: string } | { ok: false; error?: string }>
}

/** Letter Composer — preload `letter:*` IPC (.docx / .odt templates). */
interface LetterComposerBridge {
  saveTemplateFromPath: (sourcePath: string, originalFileName: string) => Promise<string>
  saveTemplateBuffer: (fileName: string, data: ArrayBuffer) => Promise<string>
  /** DOCX via mammoth; ODT via content.xml (ZIP). */
  convertDocxToHtml: (filePath: string) => Promise<{ html: string; messages: unknown[] }>
  /** Directory for LibreOffice PDF output (under app letter-composer storage). */
  getConvertedPdfOutputDir: () => Promise<string>
  /** Rasterize a PDF on disk to PNG data URLs (template mapping preview). */
  renderPdfPages: (filePath: string) => Promise<{ pages: string[]; pageCount: number }>
  /** PDF text layer for mapping anchorText (normalized positions per page). */
  extractPdfTextPositions: (
    filePath: string,
  ) => Promise<Array<{ page: number; items: Array<{ text: string; x: number; y: number; w: number; h: number }> }>>
  detectTemplateFields: (filePath: string) => Promise<{
    ok: boolean
    fields: Array<{
      name: string
      label: string
      type: string
      mode: string
      page: number
      x: number
      y: number
      w: number
      h: number
    }>
    error?: string
  }>
  extractFields: (html: string) => Promise<unknown[]>
  exportFilledDocx: (payload: {
    sourcePath: string
    fields: Array<{ id: string; placeholder: string; value: string; anchorText?: string }>
    defaultName: string
  }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>
  /** Filled DOCX → LibreOffice → save PDF (original .docx unchanged). */
  exportFilledPdf: (payload: {
    sourcePath: string
    fields: Array<{ id: string; placeholder: string; value: string; anchorText?: string }>
    defaultName: string
  }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>
  /** Filled DOCX → temp PDF → system print dialog (or default viewer fallback). */
  printFilledLetter: (payload: {
    sourcePath: string
    fields: Array<{ id: string; placeholder: string; value: string; anchorText?: string }>
  }) => Promise<{ success: boolean; error?: string }>
  /** Path A — built-in layout: generate DOCX from field values + optional logo. */
  exportBuiltinDocx: (payload: {
    layout: string
    fields: Record<string, string>
    logoPath?: string | null
    defaultName?: string
  }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>
  exportBuiltinPdf: (payload: {
    layout: string
    fields: Record<string, string>
    logoPath?: string | null
    defaultName?: string
  }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>
  printBuiltinLetter: (payload: {
    layout: string
    fields: Record<string, string>
    logoPath?: string | null
  }) => Promise<{ success: boolean; error?: string }>
  saveLetterFromPath: (sourcePath: string, originalFileName: string) => Promise<string>
  saveLetterBuffer: (fileName: string, data: ArrayBuffer) => Promise<string>
  /** Deterministic hints from letter OCR / PDF text (Layer 1). */
  extractFromScan: (text: string) => Promise<{
    raw: {
      date: string | null
      sender_lines: string[]
      recipient_lines: string[]
      subject_line: string | null
      reference: string | null
      salutation_line: string | null
      customer_number: string | null
      booking_account: string | null
      invoice_number: string | null
      contract_number: string | null
      order_number: string | null
      file_reference: string | null
      contact_person: string | null
    }
  }>
  /** AI normalization + confidence (Layer 2); falls back to rules if model missing. */
  normalizeExtracted: (
    rawFields: unknown,
    fullText: string,
  ) => Promise<{
    ok: boolean
    fields: Record<string, string>
    confidence: Record<string, number>
    error?: string
  }>
  processLetterPdf: (filePath: string) => Promise<{
    pages: Array<{ pageNumber: number; imageDataUrl: string; text: string }>
    fullText: string
  }>
  processLetterImage: (filePath: string) => Promise<{ imageDataUrl: string; text: string }>
  processLetterImagePaths: (filePaths: string[]) => Promise<{
    pages: Array<{ pageNumber: number; imageDataUrl: string; text: string }>
    fullText: string
  }>
}

interface IntegrityCheck {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
}

interface IntegrityStatus {
  verified: boolean
  timestamp: number
  checks: IntegrityCheck[]
  summary: string
}

interface IntegrityBridge {
  getStatus: () => Promise<IntegrityStatus>
}

interface EdgeTierBridge {
  getStatus: () => Promise<Record<string, unknown>>
  getVerifications: (limit?: number) => Promise<Array<Record<string, unknown>>>
  getLocalPodRequirement?: () => Promise<{ ok: boolean; message: string | null }>
  onVerificationsUpdated?: (handler: () => void) => () => void
}

interface DashboardBridge {
  getReplicas: () => Promise<Array<Record<string, unknown>>>
  getVerifications: (limit?: number) => Promise<Array<Record<string, unknown>>>
  subscribeUpdates: () => Promise<{ ok: boolean }>
  onUpdates: (handler: (payload: Record<string, unknown>) => void) => () => void
  fetchReplicaLogs: (edgePodId: string) => Promise<{ ok: boolean; lines?: string[]; error?: string }>
  restartReplica: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }>
  redeployReplica: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }>
  removeReplica: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }>
  disableEdgeTier: () => Promise<{ ok: boolean }>
  onReplicaActionProgress: (
    handler: (payload: { operationId: string; event: Record<string, unknown> }) => void,
  ) => () => void
}

interface WizardBridge {
  getState: () => Promise<Record<string, unknown>>
  reset: () => Promise<Record<string, unknown>>
  authenticate: () => Promise<{
    ok: boolean
    plan?: string
    sub?: string
    error?: string
    state: Record<string, unknown>
  }>
  setVmCredentials: (input: {
    host: string
    port?: number
    user: string
    key: string
    passphrase?: string
  }) => Promise<{ state: Record<string, unknown> }>
  setReplicaCount: (count: number) => Promise<{ state: Record<string, unknown> }>
  probe: () => Promise<{ probe: Record<string, unknown>; state: Record<string, unknown> }>
  installPodman: (input: {
    operationId: string
    probe: Record<string, unknown>
  }) => Promise<{ ok: boolean; state: Record<string, unknown> }>
  generateAndDeploy: (input: {
    operationId: string
    replicaIndex: number
    totalReplicas: number
  }) => Promise<{ ok: boolean; state: Record<string, unknown> }>
  verifyAndSwitch: (input: { replicaIndex: number }) => Promise<{
    verified: boolean
    reason?: string
    state: Record<string, unknown>
  }>
  cancel: (operationId: string) => Promise<{ cancelled: boolean }>
  getLocalPodRequirement?: () => Promise<{ ok: boolean; message: string | null }>
  onInstallPodmanProgress?: (
    handler: (payload: { operationId: string; event: Record<string, unknown> }) => void,
  ) => () => void
  onGenerateAndDeployProgress?: (
    handler: (payload: { operationId: string; event: Record<string, unknown> }) => void,
  ) => () => void
}

/** Ollama status payload from `ollamaManager.getStatus()` / `llm:getStatus`. */
interface LlmOllamaStatus {
  installed: boolean
  running: boolean
  version?: string
  port: number
  modelsInstalled: Array<{
    name: string
    size: number
    modified: string
    digest?: string
    isActive?: boolean
  }>
  activeModel?: string
  /** Evidence-based local acceleration hints (optional for older backends). */
  localRuntime?: {
    classification: 'gpu_capable' | 'gpu_unconfirmed' | 'cpu_likely' | 'unknown'
    summary: string
    evidence?: string
    runtimeObservation?: 'none' | 'recent_warm_loads'
  }
  /** Unified WR Chat selector rows (local + host/cross-device + cloud). */
  wrChatAvailableModels?: Array<{
    id: string
    displayName: string
    kind: 'local_ollama' | 'host_internal' | 'cloud'
    displaySubtitle?: string
    execution_transport?: 'ollama_direct'
  }>
}

/**
 * Tier-ranked inference capability (`llm:resolveInferenceCapability`).
 * Sandbox devices get `hostHardware` reflecting the *Windows host* GPU/CPU,
 * not the local Linux probe.
 */
interface InferenceCapabilityForUi {
  backend: 'remote-host' | 'local-gpu' | 'local-cpu' | 'unavailable'
  hostHardware: 'gpu' | 'cpu' | 'unknown'
  modelName?: string
  remoteBaseUrl?: string
  handshakeId?: string
  peerDeviceId?: string
  unavailableReason?: string
  userMessage?: string
}

/** Main-process GPU offload diagnostics (`llm:getGpuStatus`). */
interface GpuStatusForUi {
  available: boolean
  reason: string | null
  detail: Record<string, unknown>
  userMessage: string
  technicalSummary: string
}

/** Block reason returned by `llm:resolveAutosortRuntime`. */
type AutosortBlockReason =
  | 'provider_not_ollama'
  | 'ollama_not_running'
  | 'no_model_installed'
  | 'no_stored_model_preference'
  | 'stored_model_not_installed'
  | 'gpu_not_verified'

/** Full resolved runtime state for inbox Auto-Sort. Returned by `llm:resolveAutosortRuntime`. */
interface ResolvedInboxRuntime {
  provider: string
  model: string | null
  endpoint: string
  storedModelId: string | null
  storedModelInstalled: boolean
  installedModels: string[]
  ollamaRunning: boolean
  gpuClassification: 'gpu_capable' | 'gpu_unconfirmed' | 'cpu_likely' | 'unknown'
  gpuEvidence: string | undefined
  autosortAllowed: boolean
  blockReason: AutosortBlockReason | null
  blockMessage: string | null
}

interface LlmBridge {
  getStatus: () => Promise<{ ok: true; data: LlmOllamaStatus } | { ok: false; error: string }>
  getGpuStatus: () => Promise<{ ok: true; data: GpuStatusForUi } | { ok: false; error: string }>
  setActiveModel: (modelId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  setAiExecutionContext: (
    ctx: Record<string, unknown>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onActiveModelChanged: (cb: (data: { modelId: string }) => void) => () => void
  resolveAutosortRuntime: () => Promise<
    { ok: true; data: ResolvedInboxRuntime } | { ok: false; error: string }
  >
  resolveInferenceCapability: () => Promise<
    { ok: true; data: InferenceCapabilityForUi } | { ok: false; error: string }
  >
}

/** TEMPORARY — main process log viewer (remove before production) */
interface MainProcessLogEntry {
  ts: string
  level: string
  line: string
}

interface DebugLogsBridge {
  onLog: (callback: (entry: MainProcessLogEntry) => void) => () => void
  removeLogListener: () => void
}

interface OrchestratorBridge {
  importSessionFromBeap: (payload: {
    sessionId: string
    sessionName: string
    importArtefact: Record<string, unknown>
    sourceMessageId: string
    handshakeId: string | null
  }) => Promise<{
    success: boolean
    dispatched?: boolean
    sessionKey?: string
    executed?: string[]
    error?: string
  }>
  /** Opens orchestrator SQLite (same as POST /api/orchestrator/connect). */
  connect: () => Promise<{ success: boolean; data?: unknown; error?: string }>
  listSessions: () => Promise<{ success: boolean; data?: unknown[]; error?: string }>
  /**
   * Fetch full session content by ID (agents, agent_boxes, display_grids, config).
   * Added PR 4/8 to support artefact construction at send time.
   */
  getSession: (id: string) => Promise<{
    success: boolean
    data?: { id: string; name: string; config: Record<string, unknown> }
    error?: string
  }>
}

/** BEAP capsule / inline composer bridge (preload). */
interface BeapBridge {
  sendCapsuleReply: (payload: unknown) => Promise<unknown>
  extractPdfText: (payload: {
    attachmentId: string
    base64: string
  }) => Promise<{
    success?: boolean
    extractedText?: string
    error?: string
    pageCount?: number
    pagesProcessed?: number
  }>
}

interface Window {
  /**
   * Project WIKI AI insert bridge: assigned by `ProjectOptimizationPanel` when a field or
   * milestone quick-edit is active; called from `HybridSearch` “Use” / “Use All”. Do not rename.
   */
  __wrdeskInsertDraft?: (text: string, mode: 'append' | 'replace') => void
  LETmeGIRAFFETHATFORYOU?: LmgtfyBridge
  analysisDashboard?: AnalysisDashboardBridge
  lifecycle?: LifecycleBridge
  /** Native folder picker for WR Chat Diff — `await window.wrChat?.pickDirectory()`. */
  wrChat?: WrChatBridge
  /** System browser for external links (not an in-app BrowserWindow). */
  appShell?: AppShellBridge
  integrity?: IntegrityBridge
  edgeTier?: EdgeTierBridge
  dashboard?: DashboardBridge
  wizard?: WizardBridge
  debugLogs?: DebugLogsBridge
  orchestrator?: OrchestratorBridge
  beap?: BeapBridge
  /** Preload: local Ollama status and persisted active model (same store as Backend Configuration). */
  llm?: LlmBridge
  /** Dashboard Letter Composer — mammoth + Ollama field extraction in main process. */
  letterComposer?: LetterComposerBridge
  /** User-installed LibreOffice — `soffice` detection and PDF conversion. */
  libreoffice?: LibreOfficeBridge
}
