/**
 * Chat Trigger
 * 
 * Handles chat/message input triggers from sidepanel and popup.
 * This is a "manual" trigger that's invoked programmatically when
 * chat messages arrive.
 */

import type { TriggerSource, Modality, TriggerScope } from '../types'
import { BaseTrigger } from './BaseTrigger'

/**
 * Chat message input parameters
 */
export interface ChatInput {
  /** The message text */
  text: string
  
  /** Whether an image is attached */
  hasImage?: boolean
  
  /** Image URL if attached */
  imageUrl?: string
  
  /** Video URL if attached */
  videoUrl?: string
  
  /** Current page URL */
  url?: string
  
  /** Chrome tab ID */
  tabId?: number
  
  /** Session key */
  sessionKey?: string
  
  /** Target agent ID (if directed to specific agent) */
  agentId?: string
  
  /** Additional metadata */
  metadata?: Record<string, any>
}

/**
 * Chat Trigger
 * 
 * Unlike other triggers that listen for external events,
 * ChatTrigger is invoked programmatically when chat messages arrive.
 * 
 * @example
 * ```typescript
 * const chatTrigger = new ChatTrigger()
 * 
 * chatTrigger.subscribe((event) => {
 *   console.log('Chat message:', event.input)
 * })
 * 
 * chatTrigger.start()
 * 
 * // When a message arrives:
 * chatTrigger.handleMessage({
 *   text: 'Hello @Invoice',
 *   hasImage: false
 * })
 * ```
 */
export class ChatTrigger extends BaseTrigger {
  protected readonly source: TriggerSource = 'chat'
  
  constructor(id?: string) {
    super(id || 'chat_trigger')
  }
  
  /**
   * Start the trigger
   * 
   * For ChatTrigger, this just marks it as active since
   * messages are pushed programmatically.
   */
  start(): void {
    if (this.isActive) return
    this.isActive = true
    console.log('[ChatTrigger] Started')
  }
  
  /**
   * Stop the trigger
   */
  stop(): void {
    if (!this.isActive) return
    this.isActive = false
    console.log('[ChatTrigger] Stopped')
  }
  
  /**
   * Handle an incoming chat message
   * 
   * Call this when a new message arrives in the chat.
   * 
   * @param input - The chat message input
   */
  handleMessage(input: ChatInput): void {
    if (!this.isActive) {
      console.warn('[ChatTrigger] Received message but trigger is not active')
      return
    }
    
    // Determine modalities
    const modalities: Modality[] = ['text']
    if (input.hasImage || input.imageUrl) {
      modalities.push('image')
    }
    if (input.videoUrl) {
      modalities.push('video')
    }
    
    // Determine scope
    let scope: TriggerScope = 'global'
    if (input.agentId) {
      scope = 'agent'
    }
    
    // Create and emit the event
    const event = this.createEvent({
      input: input.text,
      modalities,
      scope,
      imageUrl: input.imageUrl,
      videoUrl: input.videoUrl,
      url: input.url,
      tabId: input.tabId,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      metadata: {
        ...input.metadata,
        hasImage: input.hasImage
      }
    })
    
    this.emit(event)
  }
  
  /**
   * Extract @mention patterns from text
   * 
   * @param text - The text to search
   * @returns Array of mentioned trigger names
   */
  static extractMentions(text: string): string[] {
    const matches = text.match(/@[\w-]+/g)
    if (!matches) return []
    return matches.map(m => m.substring(1)) // Remove @
  }
  
  /**
   * Check if text contains a specific @mention
   * 
   * @param text - The text to search
   * @param mention - The mention to look for (without @)
   * @returns Whether the mention is present
   */
  static hasMention(text: string, mention: string): boolean {
    const mentions = ChatTrigger.extractMentions(text)
    return mentions.some(m => m.toLowerCase() === mention.toLowerCase())
  }
}


