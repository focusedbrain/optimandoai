import { EventEmitter } from 'events';
import { ParsedReview } from './ReviewParser';
import { CodeHunk } from './FileWatcher';

export interface IconTrigger {
  id: string;
  type: 'action' | 'status' | 'notification' | 'interaction';
  color: 'blue' | 'red' | 'green' | 'yellow' | 'orange' | 'purple' | 'gray';
  icon: string;
  label: string;
  description: string;
  priority: number; // 1-10, higher is more important
  targetFile?: string;
  targetLine?: number;
  reviewId?: string;
  payload: any;
  timestamp: Date;
  status: 'pending' | 'active' | 'completed' | 'expired' | 'cancelled';
}

export interface TriggerAction {
  id: string;
  triggerId: string;
  action: string;
  parameters: Record<string, any>;
  timestamp: Date;
  result?: any;
  error?: string;
}

export interface IconTriggerEvents {
  'trigger-created': (trigger: IconTrigger) => void;
  'trigger-activated': (trigger: IconTrigger) => void;
  'trigger-completed': (trigger: IconTrigger, result: any) => void;
  'trigger-expired': (trigger: IconTrigger) => void;
  'trigger-cancelled': (trigger: IconTrigger) => void;
  'action-executed': (action: TriggerAction) => void;
  'bulk-update': (triggers: IconTrigger[]) => void;
}

declare interface IconTriggerSystem {
  on<U extends keyof IconTriggerEvents>(event: U, listener: IconTriggerEvents[U]): this;
  emit<U extends keyof IconTriggerEvents>(event: U, ...args: Parameters<IconTriggerEvents[U]>): boolean;
}

class IconTriggerSystem extends EventEmitter {
  private triggers: Map<string, IconTrigger> = new Map();
  private actionHistory: Map<string, TriggerAction[]> = new Map();
  private activeOrchestrator: OrchestratorMessagePasser | null = null;

  // Color schema definitions
  private static readonly COLOR_SCHEMAS = {
    blue: {
      name: 'Information/Analysis',
      description: 'Informational actions, code analysis, explanations',
      actions: ['explain-code', 'analyze-complexity', 'show-documentation', 'type-info'],
      priority: 3,
    },
    red: {
      name: 'Critical/Security',
      description: 'Security vulnerabilities, critical errors, blocking issues',
      actions: ['security-scan', 'vulnerability-check', 'critical-error', 'breaking-change'],
      priority: 9,
    },
    green: {
      name: 'Success/Validation',
      description: 'Tests passing, validations successful, approved changes',
      actions: ['tests-passed', 'validation-ok', 'approved', 'deployed'],
      priority: 5,
    },
    yellow: {
      name: 'Warning/Attention',
      description: 'Potential issues, warnings, needs attention',
      actions: ['performance-warning', 'deprecated-usage', 'code-smell', 'review-needed'],
      priority: 6,
    },
    orange: {
      name: 'Action Required',
      description: 'Immediate action needed, refactoring suggestions',
      actions: ['refactor-needed', 'action-required', 'manual-review', 'decision-needed'],
      priority: 7,
    },
    purple: {
      name: 'Enhancement/Feature',
      description: 'Feature suggestions, enhancements, optimizations',
      actions: ['suggest-feature', 'optimization-opportunity', 'enhancement', 'idea'],
      priority: 4,
    },
    gray: {
      name: 'Neutral/Informational',
      description: 'Neutral information, logs, metadata',
      actions: ['log-info', 'metadata', 'trace', 'debug-info'],
      priority: 2,
    },
  };

  constructor() {
    super();
    this.setupCleanupInterval();
  }

  /**
   * Set the orchestrator for message passing
   */
  setOrchestrator(orchestrator: OrchestratorMessagePasser): void {
    this.activeOrchestrator = orchestrator;
  }

  /**
   * Create triggers from a parsed review
   */
  createTriggersFromReview(review: ParsedReview): IconTrigger[] {
    const triggers: IconTrigger[] = [];

    // Create main review trigger
    const mainTrigger = this.createReviewTrigger(review);
    triggers.push(mainTrigger);

    // Create triggers for each code hunk
    for (const hunk of review.codeHunks) {
      const hunkTriggers = this.createHunkTriggers(hunk, review);
      triggers.push(...hunkTriggers);
    }

    // Create triggers based on review type and priority
    const contextualTriggers = this.createContextualTriggers(review);
    triggers.push(...contextualTriggers);

    // Store and emit triggers
    for (const trigger of triggers) {
      this.triggers.set(trigger.id, trigger);
      this.emit('trigger-created', trigger);
    }

    this.emit('bulk-update', triggers);
    return triggers;
  }

  /**
   * Create a custom trigger
   */
  createTrigger(config: Partial<IconTrigger> & { type: IconTrigger['type']; color: IconTrigger['color'] }): IconTrigger {
    const trigger: IconTrigger = {
      id: config.id || this.generateTriggerId(),
      type: config.type,
      color: config.color,
      icon: config.icon || this.getDefaultIcon(config.color, config.type),
      label: config.label || this.generateLabel(config.color, config.type),
      description: config.description || this.generateDescription(config.color, config.type),
      priority: config.priority || this.getColorPriority(config.color),
      targetFile: config.targetFile,
      targetLine: config.targetLine,
      reviewId: config.reviewId,
      payload: config.payload || {},
      timestamp: new Date(),
      status: config.status || 'pending',
    };

    this.triggers.set(trigger.id, trigger);
    this.emit('trigger-created', trigger);
    return trigger;
  }

  /**
   * Activate a trigger
   */
  async activateTrigger(triggerId: string, parameters?: Record<string, any>): Promise<any> {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) {
      throw new Error(`Trigger ${triggerId} not found`);
    }

    trigger.status = 'active';
    this.emit('trigger-activated', trigger);

    try {
      // Execute the trigger action
      const result = await this.executeTriggerAction(trigger, parameters);
      
      trigger.status = 'completed';
      this.emit('trigger-completed', trigger, result);
      
      return result;
    } catch (error) {
      trigger.status = 'cancelled';
      this.emit('trigger-cancelled', trigger);
      throw error;
    }
  }

  /**
   * Cancel a trigger
   */
  cancelTrigger(triggerId: string): boolean {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    trigger.status = 'cancelled';
    this.emit('trigger-cancelled', trigger);
    return true;
  }

  /**
   * Get all triggers, optionally filtered
   */
  getTriggers(filters?: {
    status?: IconTrigger['status'][];
    color?: IconTrigger['color'][];
    type?: IconTrigger['type'][];
    reviewId?: string;
    targetFile?: string;
  }): IconTrigger[] {
    let triggers = Array.from(this.triggers.values());

    if (filters) {
      if (filters.status) {
        triggers = triggers.filter(t => filters.status!.includes(t.status));
      }
      if (filters.color) {
        triggers = triggers.filter(t => filters.color!.includes(t.color));
      }
      if (filters.type) {
        triggers = triggers.filter(t => filters.type!.includes(t.type));
      }
      if (filters.reviewId) {
        triggers = triggers.filter(t => t.reviewId === filters.reviewId);
      }
      if (filters.targetFile) {
        triggers = triggers.filter(t => t.targetFile === filters.targetFile);
      }
    }

    // Sort by priority (higher first) then by timestamp
    return triggers.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
  }

  /**
   * Get trigger by ID
   */
  getTrigger(id: string): IconTrigger | undefined {
    return this.triggers.get(id);
  }

  /**
   * Clear triggers by criteria
   */
  clearTriggers(criteria?: {
    status?: IconTrigger['status'][];
    olderThan?: Date;
    reviewId?: string;
  }): number {
    let cleared = 0;
    
    for (const [id, trigger] of this.triggers.entries()) {
      let shouldClear = false;
      
      if (criteria?.status && criteria.status.includes(trigger.status)) {
        shouldClear = true;
      }
      
      if (criteria?.olderThan && trigger.timestamp < criteria.olderThan) {
        shouldClear = true;
      }
      
      if (criteria?.reviewId && trigger.reviewId === criteria.reviewId) {
        shouldClear = true;
      }
      
      if (!criteria) {
        shouldClear = true; // Clear all if no criteria
      }
      
      if (shouldClear) {
        this.triggers.delete(id);
        cleared++;
      }
    }
    
    return cleared;
  }

  /**
   * Get action history for a trigger
   */
  getActionHistory(triggerId: string): TriggerAction[] {
    return this.actionHistory.get(triggerId) || [];
  }

  /**
   * Create main trigger for a review
   */
  private createReviewTrigger(review: ParsedReview): IconTrigger {
    const colorMap: Record<ParsedReview['priority'], IconTrigger['color']> = {
      critical: 'red',
      high: 'orange',
      medium: 'yellow',
      low: 'blue',
    };

    return this.createTrigger({
      type: 'action',
      color: colorMap[review.priority],
      label: `Review: ${review.title}`,
      description: `${review.reviewType} review - ${review.description}`,
      priority: this.priorityToNumber(review.priority),
      reviewId: review.id,
      targetFile: review.filePath,
      payload: {
        reviewType: review.reviewType,
        reviewData: review,
      },
    });
  }

  /**
   * Create triggers for code hunks
   */
  private createHunkTriggers(hunk: CodeHunk, review: ParsedReview): IconTrigger[] {
    const triggers: IconTrigger[] = [];

    // Security check trigger for sensitive changes
    if (this.containsSensitiveCode(hunk)) {
      triggers.push(this.createTrigger({
        type: 'action',
        color: 'red',
        label: 'Security Check Needed',
        description: 'This code change may have security implications',
        priority: 9,
        targetFile: hunk.filePath,
        targetLine: hunk.startLine,
        reviewId: review.id,
        payload: {
          action: 'security-scan',
          hunkId: hunk.id,
          changeType: hunk.changeType,
        },
      }));
    }

    // Performance warning for large changes
    if (hunk.addedLines.length + hunk.deletedLines.length > 50) {
      triggers.push(this.createTrigger({
        type: 'notification',
        color: 'yellow',
        label: 'Large Change Detected',
        description: 'Consider breaking this into smaller changes',
        priority: 6,
        targetFile: hunk.filePath,
        targetLine: hunk.startLine,
        reviewId: review.id,
        payload: {
          action: 'performance-warning',
          linesChanged: hunk.addedLines.length + hunk.deletedLines.length,
        },
      }));
    }

    // Code explanation trigger for complex changes
    if (this.isComplexChange(hunk)) {
      triggers.push(this.createTrigger({
        type: 'action',
        color: 'blue',
        label: 'Explain Code',
        description: 'Get AI explanation of this code change',
        priority: 3,
        targetFile: hunk.filePath,
        targetLine: hunk.startLine,
        reviewId: review.id,
        payload: {
          action: 'explain-code',
          codeContent: hunk.addedLines.join('\n'),
        },
      }));
    }

    return triggers;
  }

  /**
   * Create contextual triggers based on review metadata
   */
  private createContextualTriggers(review: ParsedReview): IconTrigger[] {
    const triggers: IconTrigger[] = [];

    // Documentation trigger for undocumented code
    if (review.reviewType === 'code-review' && !this.hasDocumentation(review)) {
      triggers.push(this.createTrigger({
        type: 'action',
        color: 'purple',
        label: 'Add Documentation',
        description: 'This code change would benefit from documentation',
        priority: 4,
        reviewId: review.id,
        payload: {
          action: 'suggest-documentation',
        },
      }));
    }

    // Test coverage trigger
    if (this.needsTestCoverage(review)) {
      triggers.push(this.createTrigger({
        type: 'action',
        color: 'orange',
        label: 'Add Tests',
        description: 'Consider adding tests for this functionality',
        priority: 7,
        reviewId: review.id,
        payload: {
          action: 'suggest-tests',
        },
      }));
    }

    return triggers;
  }

  /**
   * Execute a trigger action
   */
  private async executeTriggerAction(trigger: IconTrigger, parameters?: Record<string, any>): Promise<any> {
    const action: TriggerAction = {
      id: this.generateActionId(),
      triggerId: trigger.id,
      action: trigger.payload.action || 'generic',
      parameters: { ...trigger.payload, ...parameters },
      timestamp: new Date(),
    };

    try {
      let result: any;

      // Route to orchestrator if available
      if (this.activeOrchestrator) {
        result = await this.activeOrchestrator.executeAction(action);
      } else {
        // Fallback to local execution
        result = await this.executeLocalAction(action);
      }

      action.result = result;
      this.recordAction(action);
      this.emit('action-executed', action);
      
      return result;
    } catch (error) {
      action.error = error.message;
      this.recordAction(action);
      throw error;
    }
  }

  /**
   * Execute action locally (fallback)
   */
  private async executeLocalAction(action: TriggerAction): Promise<any> {
    switch (action.action) {
      case 'explain-code':
        return { 
          explanation: 'AI code explanation would be generated here',
          complexity: 'moderate',
          suggestions: ['Consider adding error handling', 'Add type annotations'],
        };
        
      case 'security-scan':
        return {
          vulnerabilities: [],
          riskLevel: 'low',
          recommendations: ['Review input validation'],
        };
        
      case 'performance-warning':
        return {
          metrics: { linesChanged: action.parameters.linesChanged },
          suggestions: ['Consider splitting into multiple commits'],
        };
        
      default:
        return { message: 'Action executed locally', action: action.action };
    }
  }

  /**
   * Record action in history
   */
  private recordAction(action: TriggerAction): void {
    const history = this.actionHistory.get(action.triggerId) || [];
    history.push(action);
    this.actionHistory.set(action.triggerId, history);
  }

  /**
   * Helper methods
   */
  private generateTriggerId(): string {
    return `trigger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateActionId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDefaultIcon(color: IconTrigger['color'], type: IconTrigger['type']): string {
    const iconMap = {
      blue: type === 'action' ? '🔍' : 'ℹ️',
      red: type === 'action' ? '🛡️' : '⚠️',
      green: type === 'action' ? '✅' : '🟢',
      yellow: type === 'action' ? '⚠️' : '🟡',
      orange: type === 'action' ? '🔧' : '🟠',
      purple: type === 'action' ? '💡' : '🟣',
      gray: type === 'action' ? '📄' : '⚫',
    };
    return iconMap[color];
  }

  private generateLabel(color: IconTrigger['color'], type: IconTrigger['type']): string {
    const schema = IconTriggerSystem.COLOR_SCHEMAS[color];
    return `${schema.name} ${type === 'action' ? 'Action' : 'Notification'}`;
  }

  private generateDescription(color: IconTrigger['color'], type: IconTrigger['type']): string {
    return IconTriggerSystem.COLOR_SCHEMAS[color].description;
  }

  private getColorPriority(color: IconTrigger['color']): number {
    return IconTriggerSystem.COLOR_SCHEMAS[color].priority;
  }

  private priorityToNumber(priority: ParsedReview['priority']): number {
    const map = { critical: 10, high: 8, medium: 5, low: 2 };
    return map[priority];
  }

  private containsSensitiveCode(hunk: CodeHunk): boolean {
    const sensitivePatterns = [
      /password|secret|key|token|credential/i,
      /auth|authorization|authenticate/i,
      /crypto|encrypt|decrypt|hash/i,
      /sql|query|database/i,
      /admin|root|sudo/i,
    ];

    const allContent = [...hunk.addedLines, ...hunk.deletedLines].join('\n');
    return sensitivePatterns.some(pattern => pattern.test(allContent));
  }

  private isComplexChange(hunk: CodeHunk): boolean {
    const complexity = hunk.addedLines.length + hunk.deletedLines.length;
    const hasLogic = /if|else|for|while|switch|try|catch|function|class/i.test(
      hunk.addedLines.join('\n')
    );
    return complexity > 10 || hasLogic;
  }

  private hasDocumentation(review: ParsedReview): boolean {
    return review.description.length > 50 || review.tags.includes('documentation');
  }

  private needsTestCoverage(review: ParsedReview): boolean {
    const hasTests = review.codeHunks.some(hunk => 
      hunk.filePath.includes('test') || hunk.filePath.includes('spec')
    );
    return !hasTests && review.reviewType === 'code-review';
  }

  private setupCleanupInterval(): void {
    setInterval(() => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.clearTriggers({ 
        status: ['completed', 'cancelled', 'expired'],
        olderThan: oneDayAgo,
      });
    }, 60 * 60 * 1000); // Run every hour
  }
}

/**
 * Interface for orchestrator message passing
 */
export interface OrchestratorMessagePasser {
  executeAction(action: TriggerAction): Promise<any>;
  sendMessage(message: any): Promise<void>;
  registerTriggerSystem(system: IconTriggerSystem): void;
}

export { IconTriggerSystem };
export default IconTriggerSystem;