/**
 * Rotating Log System for Ollama Diagnostics
 * Captures detailed logs with automatic rotation to prevent disk space issues
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export class RotatingLogger {
  private logPath: string
  private maxFileSize: number = 5 * 1024 * 1024 // 5MB
  private maxFiles: number = 3
  private logStream: fs.WriteStream | null = null
  
  constructor(logFilename: string = 'ollama-debug.log') {
    // Store logs in app data directory
    const userDataPath = app.getPath('userData')
    const logsDir = path.join(userDataPath, 'logs')
    
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    
    this.logPath = path.join(logsDir, logFilename)
    this.initializeStream()
  }
  
  private initializeStream() {
    try {
      this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' })
    } catch (error) {
      console.error('[RotatingLogger] Failed to initialize log stream:', error)
    }
  }
  
  /**
   * Log a message with timestamp
   */
  log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', category: string, message: string, data?: any) {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [${level}] [${category}] ${message}`
    const fullLog = data ? `${logLine} ${JSON.stringify(data)}\n` : `${logLine}\n`
    
    // Write to console
    if (level === 'ERROR') {
      console.error(logLine, data || '')
    } else if (level === 'WARN') {
      console.warn(logLine, data || '')
    } else {
      console.log(logLine, data || '')
    }
    
    // Write to file
    try {
      if (this.logStream) {
        this.logStream.write(fullLog)
        this.checkRotation()
      }
    } catch (error) {
      console.error('[RotatingLogger] Failed to write log:', error)
    }
  }
  
  /**
   * Check if log file needs rotation
   */
  private checkRotation() {
    try {
      const stats = fs.statSync(this.logPath)
      
      if (stats.size >= this.maxFileSize) {
        this.rotate()
      }
    } catch (error) {
      // File doesn't exist or can't be accessed
    }
  }
  
  /**
   * Rotate log files
   */
  private rotate() {
    try {
      // Close current stream
      if (this.logStream) {
        this.logStream.end()
        this.logStream = null
      }
      
      // Delete oldest log
      const oldestLog = `${this.logPath}.${this.maxFiles}`
      if (fs.existsSync(oldestLog)) {
        fs.unlinkSync(oldestLog)
      }
      
      // Rotate existing logs
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.logPath}.${i}`
        const newFile = `${this.logPath}.${i + 1}`
        
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile)
        }
      }
      
      // Move current log to .1
      if (fs.existsSync(this.logPath)) {
        fs.renameSync(this.logPath, `${this.logPath}.1`)
      }
      
      // Reinitialize stream
      this.initializeStream()
      this.log('INFO', 'RotatingLogger', 'Log file rotated')
    } catch (error) {
      console.error('[RotatingLogger] Failed to rotate logs:', error)
      // Try to reinitialize stream anyway
      this.initializeStream()
    }
  }
  
  /**
   * Get log file path
   */
  getLogPath(): string {
    return this.logPath
  }
  
  /**
   * Close log stream
   */
  close() {
    if (this.logStream) {
      this.logStream.end()
      this.logStream = null
    }
  }
}

// Singleton instance
export const ollamaLogger = new RotatingLogger('ollama-debug.log')












