/**
 * AI Chat Capture Configuration
 * 
 * A strongly-typed configuration interface for capturing AI chat interactions
 * (ChatGPT, Claude, Gemini, etc.) via button click or Enter key detection.
 * 
 * This config is used when DOM Parser trigger is set to "button_click" mode.
 * 
 * @module AIChatCaptureConfig
 * @version 1.0.0
 */

// =============================================================================
// Site Filters
// =============================================================================

/**
 * Site filter configuration.
 * Restricts capture to specific domains or URLs.
 */
export interface SiteFiltersConfig {
  /**
   * URL patterns to match (glob-style).
   * Examples: "*.openai.com/*", "https://claude.ai/*"
   * Empty array = match all sites.
   */
  patterns: string[];
}

// =============================================================================
// Auto-Detection Configuration
// =============================================================================

/**
 * Auto-detected selector results.
 * Populated when autoDetectSelectors is enabled and detection runs.
 */
export interface AutoDetectedSelectors {
  /** Auto-detected send button selector (via click tracking + NLP). */
  button: string;
  /** Auto-detected input selector (focused element at send time). */
  input: string;
  /** Auto-detected output selector (observed DOM changes after send). */
  output: string;
}

// =============================================================================
// Trigger Configuration
// =============================================================================

/**
 * Trigger configuration.
 * Defines how/when capture starts (button click or Enter key).
 */
export interface TriggerConfig {
  /**
   * Enable automatic selector discovery.
   * When true, tries to infer button/input/output selectors automatically.
   * @default false
   */
  autoDetectSelectors: boolean;
  
  /**
   * Auto-detected selectors from last detection run.
   * Null if auto-detection hasn't run or found nothing.
   */
  autoDetected: AutoDetectedSelectors | null;
  
  /**
   * CSS selectors for send/submit buttons.
   * First matching element wins.
   * @example ["button[data-testid='send-button']", ".send-btn", "#submit"]
   */
  buttonSelectors: string[];
  
  /**
   * Also trigger on Enter key press in the input field.
   * @default false
   */
  triggerOnEnterKey: boolean;
  
  /**
   * When triggerOnEnterKey is true, ignore Shift+Enter (allows newlines).
   * @default true
   */
  ignoreShiftEnter: boolean;
}

// =============================================================================
// Input Capture Configuration
// =============================================================================

/**
 * Input capture configuration.
 * Captures the user's prompt/question before sending.
 */
export interface InputCaptureConfig {
  /**
   * Whether input capture is enabled.
   * @default true
   */
  enabled: boolean;
  
  /**
   * CSS selectors for input/prompt elements.
   * First selector matching a non-empty field is used.
   * @example ["textarea[data-id='root']", "#prompt-textarea", ".chat-input"]
   */
  selectors: string[];
}

// =============================================================================
// Output Capture Configuration
// =============================================================================

/**
 * Response ready detection mode.
 */
export type ResponseReadyMode = 
  | 'first_change'    // Capture when first content appears
  | 'quiet_period'    // Wait until content stops changing
  | 'selector_signal'; // Wait for signal element (e.g., Copy button)

/**
 * Output capture configuration.
 * Captures the AI's response after it appears.
 */
export interface OutputCaptureConfig {
  /**
   * Whether output capture is enabled.
   * @default false
   */
  enabled: boolean;
  
  /**
   * CSS selectors for AI response elements.
   * Last matching element (most recent response) is captured.
   * @example ["[data-message-author-role='assistant']", ".markdown-body"]
   */
  selectors: string[];
  
  /**
   * How to detect when the response is ready.
   * @default 'first_change'
   */
  readyMode: ResponseReadyMode;
  
  /**
   * For 'quiet_period' mode: ms of no changes before capture.
   * @default 1500
   */
  quietPeriodMs: number;
  
  /**
   * For 'selector_signal' mode: CSS selector for the signal element.
   * @example "button[aria-label='Copy']"
   */
  signalSelector: string;
  
  /**
   * Maximum wait time before capturing whatever is available.
   * @default 60000
   */
  maxWaitMs: number;
}

// =============================================================================
// Context Capture Configuration
// =============================================================================

/**
 * Context/meta capture configuration.
 * Additional data captured alongside the chat content.
 */
export interface ContextCaptureConfig {
  /**
   * Include current page URL.
   * @default true
   */
  captureUrl: boolean;
  
  /**
   * Include page title.
   * @default false
   */
  capturePageTitle: boolean;
  
  /**
   * CSS selectors for additional context elements.
   * @example ["[data-conversation-id]", ".model-selector"]
   */
  contextSelectors: string[];
}

// =============================================================================
// Sanitization Configuration
// =============================================================================

/**
 * Text sanitization configuration.
 * Cleanup steps applied before sending captured text to agent.
 */
export interface SanitizationConfig {
  /**
   * Remove leading/trailing whitespace.
   * @default true
   */
  trim: boolean;
  
  /**
   * Remove markdown formatting.
   * @default false
   */
  stripMarkdown: boolean;
  
  /**
   * Remove common AI boilerplate phrases.
   * @default false
   */
  removeBoilerplate: boolean;
}

// =============================================================================
// Debug Configuration
// =============================================================================

/**
 * Debug/test capture result.
 * Returned when running a test capture.
 */
export interface DebugCaptureResult {
  /** Which button selector matched (null if none) */
  matchedButtonSelector: string | null;
  /** Which input selector matched */
  matchedInputSelector: string | null;
  /** Character count of captured input */
  inputCharCount: number;
  /** Which output selector matched */
  matchedOutputSelector: string | null;
  /** Character count of captured output */
  outputCharCount: number;
  /** Any errors encountered */
  errors: string[];
}

// =============================================================================
// Complete AI Chat Capture Configuration
// =============================================================================

/**
 * Complete configuration for AI Chat Capture mode.
 * Used when DOM Parser trigger is "button_click".
 */
export interface AIChatCaptureConfig {
  /**
   * Site filter patterns (optional).
   * Empty = capture on all sites.
   */
  siteFilters: SiteFiltersConfig;
  
  /**
   * Trigger configuration (button clicks, Enter key).
   */
  trigger: TriggerConfig;
  
  /**
   * Input/prompt capture settings.
   */
  inputCapture: InputCaptureConfig;
  
  /**
   * Output/response capture settings.
   */
  outputCapture: OutputCaptureConfig;
  
  /**
   * Context/meta data capture settings.
   */
  contextCapture: ContextCaptureConfig;
  
  /**
   * Text sanitization settings.
   */
  sanitization: SanitizationConfig;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Returns a default AI Chat Capture configuration.
 */
export function getDefaultAIChatCaptureConfig(): AIChatCaptureConfig {
  return {
    siteFilters: {
      patterns: [],
    },
    trigger: {
      autoDetectSelectors: false,
      autoDetected: null,
      buttonSelectors: [],
      triggerOnEnterKey: false,
      ignoreShiftEnter: true,
    },
    inputCapture: {
      enabled: true,
      selectors: [],
    },
    outputCapture: {
      enabled: false,
      selectors: [],
      readyMode: 'first_change',
      quietPeriodMs: 1500,
      signalSelector: '',
      maxWaitMs: 60000,
    },
    contextCapture: {
      captureUrl: true,
      capturePageTitle: false,
      contextSelectors: [],
    },
    sanitization: {
      trim: true,
      stripMarkdown: false,
      removeBoilerplate: false,
    },
  };
}

// =============================================================================
// Conversion Utilities
// =============================================================================

/**
 * Convert legacy trigger data to AIChatCaptureConfig.
 * Used for backward compatibility with existing saved triggers.
 */
export function fromLegacyTriggerData(data: any): AIChatCaptureConfig {
  const config = getDefaultAIChatCaptureConfig();
  
  // Site filters
  if (data.siteFilters?.length) {
    config.siteFilters.patterns = data.siteFilters;
  }
  
  // Trigger
  config.trigger.autoDetectSelectors = data.autoDetectSelectors ?? false;
  config.trigger.autoDetected = data.autoDetected ?? null;
  if (data.buttonSelectors?.length) {
    config.trigger.buttonSelectors = data.buttonSelectors;
  } else if (data.buttonSelector) {
    config.trigger.buttonSelectors = [data.buttonSelector];
  }
  config.trigger.triggerOnEnterKey = data.triggerOnEnterKey ?? false;
  config.trigger.ignoreShiftEnter = data.enterKeyIgnoreShift ?? true;
  
  // Input capture
  config.inputCapture.enabled = data.captureInput !== false;
  if (data.inputSelectors?.length) {
    config.inputCapture.selectors = data.inputSelectors;
  } else if (data.inputSelector) {
    config.inputCapture.selectors = [data.inputSelector];
  }
  
  // Output capture
  config.outputCapture.enabled = data.captureOutput ?? false;
  if (data.outputSelectors?.length) {
    config.outputCapture.selectors = data.outputSelectors;
  } else if (data.outputSelector) {
    config.outputCapture.selectors = [data.outputSelector];
  }
  config.outputCapture.readyMode = data.responseReadyMode ?? 'first_change';
  config.outputCapture.quietPeriodMs = data.quietPeriodMs ?? 1500;
  config.outputCapture.signalSelector = data.responseSignalSelector ?? '';
  config.outputCapture.maxWaitMs = data.maxWaitTimeMs ?? 60000;
  
  // Context capture
  config.contextCapture.captureUrl = data.captureUrl !== false;
  config.contextCapture.capturePageTitle = data.capturePageTitle ?? false;
  if (data.metaSelectors?.length) {
    config.contextCapture.contextSelectors = data.metaSelectors;
  }
  
  // Sanitization
  config.sanitization.trim = data.sanitizeTrim !== false;
  config.sanitization.stripMarkdown = data.sanitizeStripMarkdown ?? false;
  config.sanitization.removeBoilerplate = data.sanitizeRemoveBoilerplate ?? false;
  
  return config;
}

/**
 * Convert AIChatCaptureConfig to legacy trigger data format.
 * Used for saving in the existing storage format.
 */
export function toLegacyTriggerData(config: AIChatCaptureConfig): Record<string, any> {
  return {
    // Site filters
    siteFilters: config.siteFilters.patterns,
    
    // Trigger
    autoDetectSelectors: config.trigger.autoDetectSelectors,
    autoDetected: config.trigger.autoDetected,
    buttonSelectors: config.trigger.buttonSelectors,
    buttonSelector: config.trigger.buttonSelectors[0] ?? '',
    triggerOnEnterKey: config.trigger.triggerOnEnterKey,
    enterKeyIgnoreShift: config.trigger.ignoreShiftEnter,
    
    // Input capture
    captureInput: config.inputCapture.enabled,
    inputSelectors: config.inputCapture.selectors,
    inputSelector: config.inputCapture.selectors[0] ?? '',
    
    // Output capture
    captureOutput: config.outputCapture.enabled,
    outputSelectors: config.outputCapture.selectors,
    outputSelector: config.outputCapture.selectors[0] ?? '',
    responseReadyMode: config.outputCapture.readyMode,
    quietPeriodMs: config.outputCapture.quietPeriodMs,
    responseSignalSelector: config.outputCapture.signalSelector,
    maxWaitTimeMs: config.outputCapture.maxWaitMs,
    
    // Context capture
    captureUrl: config.contextCapture.captureUrl,
    capturePageTitle: config.contextCapture.capturePageTitle,
    metaSelectors: config.contextCapture.contextSelectors,
    
    // Sanitization
    sanitizeTrim: config.sanitization.trim,
    sanitizeStripMarkdown: config.sanitization.stripMarkdown,
    sanitizeRemoveBoilerplate: config.sanitization.removeBoilerplate,
  };
}

