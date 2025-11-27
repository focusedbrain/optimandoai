/**
 * Cron Trigger
 * 
 * Handles scheduled/time-based triggers using cron expressions.
 * 
 * Cron expression format:
 * ┌─────────── minute (0-59)
 * │ ┌───────── hour (0-23)
 * │ │ ┌─────── day of month (1-31)
 * │ │ │ ┌───── month (1-12)
 * │ │ │ │ ┌─── day of week (0-6, 0=Sunday)
 * │ │ │ │ │
 * * * * * *
 * 
 * Special characters:
 * - * : any value
 * - , : list separator (e.g., 1,3,5)
 * - - : range (e.g., 1-5)
 * - / : step (e.g., *\/5 for every 5)
 */

import type { TriggerSource, TriggerScope } from '../types'
import { BaseTrigger } from './BaseTrigger'

/**
 * Parsed cron schedule
 */
interface CronSchedule {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
}

/**
 * Scheduled job
 */
interface ScheduledJob {
  id: string
  name?: string
  expression: string
  schedule: CronSchedule
  lastRun?: number
  agentId?: string
  metadata?: Record<string, any>
}

/**
 * Cron Trigger
 * 
 * Schedules jobs using cron expressions and emits events when they fire.
 * 
 * @example
 * ```typescript
 * const cronTrigger = new CronTrigger()
 * 
 * cronTrigger.subscribe((event) => {
 *   console.log('Cron fired:', event.metadata.jobId)
 * })
 * 
 * cronTrigger.start()
 * 
 * // Schedule a job to run every 5 minutes
 * cronTrigger.schedule('my-job', '*\/5 * * * *', {
 *   name: 'Five Minute Check',
 *   agentId: 'agent1'
 * })
 * ```
 */
export class CronTrigger extends BaseTrigger {
  protected readonly source: TriggerSource = 'cron'
  
  /** Scheduled jobs */
  private jobs: Map<string, ScheduledJob> = new Map()
  
  /** Check interval handle */
  private checkInterval: ReturnType<typeof setInterval> | null = null
  
  /** Check interval in ms (default: 60 seconds) */
  private readonly checkIntervalMs: number
  
  constructor(id?: string, checkIntervalMs: number = 60000) {
    super(id || 'cron_trigger')
    this.checkIntervalMs = checkIntervalMs
  }
  
  /**
   * Start the cron scheduler
   */
  start(): void {
    if (this.isActive) return
    
    this.isActive = true
    
    // Check for jobs every interval
    this.checkInterval = setInterval(() => {
      this.checkJobs()
    }, this.checkIntervalMs)
    
    // Also check immediately
    this.checkJobs()
    
    console.log(`[CronTrigger] Started with ${this.jobs.size} jobs`)
  }
  
  /**
   * Stop the cron scheduler
   */
  stop(): void {
    if (!this.isActive) return
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    
    this.isActive = false
    console.log('[CronTrigger] Stopped')
  }
  
  /**
   * Schedule a new job
   * 
   * @param id - Unique job identifier
   * @param expression - Cron expression
   * @param options - Optional job configuration
   */
  schedule(
    id: string, 
    expression: string, 
    options?: {
      name?: string
      agentId?: string
      metadata?: Record<string, any>
    }
  ): void {
    const schedule = this.parseCronExpression(expression)
    
    this.jobs.set(id, {
      id,
      name: options?.name,
      expression,
      schedule,
      agentId: options?.agentId,
      metadata: options?.metadata
    })
    
    console.log(`[CronTrigger] Scheduled job '${id}': ${expression}`)
  }
  
  /**
   * Unschedule a job
   * 
   * @param id - The job ID to remove
   */
  unschedule(id: string): void {
    if (this.jobs.delete(id)) {
      console.log(`[CronTrigger] Unscheduled job '${id}'`)
    }
  }
  
  /**
   * Get all scheduled jobs
   */
  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values())
  }
  
  /**
   * Check if any jobs should run now
   */
  private checkJobs(): void {
    const now = new Date()
    
    for (const job of this.jobs.values()) {
      if (this.shouldRun(job, now)) {
        this.runJob(job, now)
      }
    }
  }
  
  /**
   * Check if a job should run at the given time
   */
  private shouldRun(job: ScheduledJob, now: Date): boolean {
    const { schedule } = job
    
    // Check each field
    if (!schedule.minutes.includes(now.getMinutes())) return false
    if (!schedule.hours.includes(now.getHours())) return false
    if (!schedule.daysOfMonth.includes(now.getDate())) return false
    if (!schedule.months.includes(now.getMonth() + 1)) return false // JS months are 0-indexed
    if (!schedule.daysOfWeek.includes(now.getDay())) return false
    
    // Check if we already ran in this minute
    if (job.lastRun) {
      const lastRunMinute = Math.floor(job.lastRun / 60000)
      const currentMinute = Math.floor(now.getTime() / 60000)
      if (lastRunMinute === currentMinute) return false
    }
    
    return true
  }
  
  /**
   * Run a job and emit its event
   */
  private runJob(job: ScheduledJob, now: Date): void {
    job.lastRun = now.getTime()
    
    const scope: TriggerScope = job.agentId ? 'agent' : 'global'
    
    const event = this.createEvent({
      input: `[CRON] ${job.name || job.id} triggered at ${now.toISOString()}`,
      modalities: ['text'],
      scope,
      agentId: job.agentId,
      metadata: {
        jobId: job.id,
        jobName: job.name,
        expression: job.expression,
        scheduledTime: now.toISOString(),
        ...job.metadata
      }
    })
    
    console.log(`[CronTrigger] Firing job '${job.id}'`)
    this.emit(event)
  }
  
  /**
   * Parse a cron expression into a schedule
   * 
   * @param expression - Cron expression (5 fields)
   * @returns Parsed schedule
   */
  private parseCronExpression(expression: string): CronSchedule {
    const parts = expression.trim().split(/\s+/)
    
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`)
    }
    
    return {
      minutes: this.parseField(parts[0], 0, 59),
      hours: this.parseField(parts[1], 0, 23),
      daysOfMonth: this.parseField(parts[2], 1, 31),
      months: this.parseField(parts[3], 1, 12),
      daysOfWeek: this.parseField(parts[4], 0, 6)
    }
  }
  
  /**
   * Parse a single cron field
   * 
   * @param field - The field value
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns Array of matching values
   */
  private parseField(field: string, min: number, max: number): number[] {
    const values: number[] = []
    
    // Handle comma-separated values
    const parts = field.split(',')
    
    for (const part of parts) {
      // Handle step values (*/5 or 1-10/2)
      const [range, stepStr] = part.split('/')
      const step = stepStr ? parseInt(stepStr, 10) : 1
      
      if (range === '*') {
        // All values with step
        for (let i = min; i <= max; i += step) {
          values.push(i)
        }
      } else if (range.includes('-')) {
        // Range (e.g., 1-5)
        const [startStr, endStr] = range.split('-')
        const start = parseInt(startStr, 10)
        const end = parseInt(endStr, 10)
        for (let i = start; i <= end && i <= max; i += step) {
          if (i >= min) values.push(i)
        }
      } else {
        // Single value
        const value = parseInt(range, 10)
        if (value >= min && value <= max) {
          values.push(value)
        }
      }
    }
    
    // Remove duplicates and sort
    return [...new Set(values)].sort((a, b) => a - b)
  }
  
  /**
   * Calculate next run time for a job
   * 
   * @param jobId - The job ID
   * @returns Next run date or null if job not found
   */
  getNextRun(jobId: string): Date | null {
    const job = this.jobs.get(jobId)
    if (!job) return null
    
    const now = new Date()
    const { schedule } = job
    
    // Simple implementation: check next 24 hours minute by minute
    // (A more efficient implementation would be ideal for production)
    const maxIterations = 24 * 60
    const checkTime = new Date(now)
    checkTime.setSeconds(0, 0) // Start from beginning of current minute
    
    for (let i = 0; i < maxIterations; i++) {
      checkTime.setMinutes(checkTime.getMinutes() + 1)
      
      if (
        schedule.minutes.includes(checkTime.getMinutes()) &&
        schedule.hours.includes(checkTime.getHours()) &&
        schedule.daysOfMonth.includes(checkTime.getDate()) &&
        schedule.months.includes(checkTime.getMonth() + 1) &&
        schedule.daysOfWeek.includes(checkTime.getDay())
      ) {
        return checkTime
      }
    }
    
    return null // No match in next 24 hours
  }
  
  /**
   * Manually trigger a job (for testing)
   * 
   * @param jobId - The job ID to trigger
   */
  triggerNow(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) {
      console.warn(`[CronTrigger] Job '${jobId}' not found`)
      return
    }
    
    this.runJob(job, new Date())
  }
}




