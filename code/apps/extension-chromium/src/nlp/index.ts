/**
 * NLP Module
 * 
 * Provides text classification and entity extraction for the orchestrator pipeline.
 * Uses wink-nlp for NLP with a fallback regex parser for resilience.
 */

export { NlpClassifier, nlpClassifier } from './NlpClassifier'

export type {
  ClassifiedInput,
  ClassificationResult,
  ExtractedEntity,
  AgentAllocation,
  AgentReasoning,
  OutputSlot,
  NlpClassifierConfig
} from './types'


