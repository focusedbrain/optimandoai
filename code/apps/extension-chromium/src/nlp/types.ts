/**
 * NLP Classification Types
 * 
 * Defines the structured JSON format for classified input that flows
 * through the orchestrator pipeline from chat/OCR to agent dispatch.
 */

/**
 * Entity extracted from input text
 */
export interface ExtractedEntity {
  /** Entity type classification */
  type: 'date' | 'time' | 'person' | 'org' | 'number' | 'email' | 'url' | 'hashtag' | 'mention' | 'other'
  /** The extracted value */
  value: string
  /** Character start index in rawText */
  start: number
  /** Character end index in rawText */
  end: number
  /** Confidence score (0-1) if available */
  confidence?: number
}

/**
 * Agent reasoning configuration extracted from agent config
 */
export interface AgentReasoning {
  /** Agent's goals */
  goals: string
  /** Agent's role description */
  role: string
  /** Agent's rules/constraints */
  rules: string
  /** Custom fields */
  custom?: Array<{ key: string; value: string }>
  /** Apply for specific input types */
  applyFor?: string
}

/**
 * Output slot configuration for where agent output should be displayed
 */
export interface OutputSlot {
  /** Agent box ID if routed to a box */
  boxId?: string
  /** Agent box number */
  boxNumber?: number
  /** Human-readable destination description */
  destination: string
  /** Box title if available */
  title?: string
}

/**
 * Agent allocation - represents one agent that will process the input
 * 
 * Each input can trigger multiple agents, each with different reasoning,
 * LLM configuration, and output destination.
 */
export interface AgentAllocation {
  /** Unique agent identifier */
  agentId: string
  /** Human-readable agent name */
  agentName: string
  /** Agent icon/emoji */
  agentIcon: string
  /** Agent number (for display) */
  agentNumber?: number
  /** Agent's reasoning configuration (goals, role, rules) */
  reasoning: AgentReasoning
  /** LLM provider (e.g., 'ollama', 'openai') */
  llmProvider: string
  /** LLM model name */
  llmModel: string
  /** Where the output will be displayed */
  outputSlot: OutputSlot
  /** How the agent was matched */
  matchReason: 'trigger' | 'expected_context' | 'apply_for' | 'default'
  /** Human-readable match details */
  matchDetails: string
  /** Matched trigger name if applicable */
  triggerName?: string
  /** Trigger type if matched via trigger */
  triggerType?: 'active' | 'passive'
}

/**
 * Classified Input - The structured JSON format for all input
 * 
 * This is the central data structure that flows through the pipeline:
 * 1. Raw input (chat or OCR) -> NLP Classifier -> ClassifiedInput
 * 2. ClassifiedInput -> Input Coordinator -> ClassifiedInput with agentAllocations
 * 3. ClassifiedInput -> Agent Processing -> Output to agent boxes
 */
export interface ClassifiedInput {
  /** Original unmodified input text */
  rawText: string
  
  /** Normalized/cleaned version (lowercased, trimmed) */
  normalizedText: string
  
  /** 
   * Triggers found in input - tokens starting with #
   * Stored WITH the # prefix (e.g., ["#termin17", "#buchhaltung"])
   */
  triggers: string[]
  
  /** Entities extracted from the text */
  entities: ExtractedEntity[]
  
  /** Simple intent labels derived from keywords (optional) */
  intents?: string[]
  
  /** Where the input originated from */
  source: 'inline_chat' | 'ocr' | 'other'
  
  /** Non-fatal errors/warnings encountered during parsing */
  errors: string[]
  
  /** ISO timestamp when classification occurred */
  timestampIso: string
  
  /** 
   * Agent allocations - populated by InputCoordinator
   * Each allocation represents an agent that will process this input
   */
  agentAllocations?: AgentAllocation[]
  
  /** Original OCR confidence if source is 'ocr' */
  ocrConfidence?: number
  
  /** URL context where input was captured */
  sourceUrl?: string
  
  /** Session key for routing */
  sessionKey?: string
}

/**
 * Result of NLP classification operation
 */
export interface ClassificationResult {
  /** Whether classification succeeded */
  success: boolean
  /** The classified input */
  input: ClassifiedInput
  /** Processing time in milliseconds */
  processingTimeMs: number
}

/**
 * Configuration for the NLP Classifier
 */
export interface NlpClassifierConfig {
  /** Whether to enable debug logging */
  debug?: boolean
  /** Language code (default: 'en') */
  language?: string
  /** Whether to extract entities (default: true) */
  extractEntities?: boolean
  /** Whether to detect intents (default: false) */
  detectIntents?: boolean
  /** Custom trigger prefix (default: '#') */
  triggerPrefix?: string
}


