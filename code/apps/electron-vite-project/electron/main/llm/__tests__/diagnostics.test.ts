/**
 * Tests for Hardware Diagnostics and Auto-Fallback
 * Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { hardwareDiagnostics } from '../hardware-diagnostics'
import { OllamaManager } from '../ollama-manager-enhanced'
import { ollamaLogger } from '../rotating-logger'
import fs from 'fs'

describe('Hardware Diagnostics', () => {
  it('should detect CPU information', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    expect(diag.cpu).toBeDefined()
    expect(diag.cpu.cores).toBeGreaterThan(0)
    expect(diag.cpu.physicalCores).toBeGreaterThan(0)
    expect(diag.cpu.model).toBeTruthy()
  })
  
  it('should detect memory information', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    expect(diag.memory).toBeDefined()
    expect(diag.memory.totalGb).toBeGreaterThan(0)
    expect(diag.memory.freeGb).toBeGreaterThanOrEqual(0)
  })
  
  it('should generate safe recommendations', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    expect(diag.recommendations).toBeDefined()
    expect(diag.recommendations.maxContext).toBeGreaterThan(0)
    expect(diag.recommendations.maxBatch).toBeGreaterThan(0)
    expect(diag.recommendations.numThreads).toBeGreaterThan(0)
    expect(['gpu', 'cpu']).toContain(diag.recommendations.fallbackMode)
  })
  
  it('should cache diagnostics results', async () => {
    const diag1 = await hardwareDiagnostics.diagnose()
    const diag2 = await hardwareDiagnostics.getCached()
    
    expect(diag1).toEqual(diag2)
  })
  
  it('should adjust recommendations for low RAM', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    // If system has <8GB RAM
    if (diag.memory.totalGb < 8) {
      expect(diag.recommendations.maxContext).toBeLessThanOrEqual(512)
      expect(diag.recommendations.maxBatch).toBeLessThanOrEqual(8)
      expect(diag.recommendations.recommendedQuant).toBe('q2_K')
    }
  })
})

describe('Rotating Logger', () => {
  it('should create log file', () => {
    ollamaLogger.log('INFO', 'Test', 'Test message')
    
    const logPath = ollamaLogger.getLogPath()
    expect(fs.existsSync(logPath)).toBe(true)
  })
  
  it('should write logs with timestamp', () => {
    ollamaLogger.log('INFO', 'Test', 'Test log entry', { data: 'value' })
    
    const logPath = ollamaLogger.getLogPath()
    const contents = fs.readFileSync(logPath, 'utf8')
    
    expect(contents).toContain('[INFO]')
    expect(contents).toContain('[Test]')
    expect(contents).toContain('Test log entry')
  })
  
  it('should handle different log levels', () => {
    ollamaLogger.log('ERROR', 'Test', 'Error message')
    ollamaLogger.log('WARN', 'Test', 'Warning message')
    ollamaLogger.log('DEBUG', 'Test', 'Debug message')
    
    const logPath = ollamaLogger.getLogPath()
    const contents = fs.readFileSync(logPath, 'utf8')
    
    expect(contents).toContain('[ERROR]')
    expect(contents).toContain('[WARN]')
    expect(contents).toContain('[DEBUG]')
  })
})

describe('Ollama Manager - Integration', () => {
  let manager: OllamaManager
  
  beforeAll(() => {
    manager = new OllamaManager()
  })
  
  afterAll(async () => {
    // Cleanup
    if (manager) {
      await manager.stop()
    }
  })
  
  it('should initialize with diagnostics', async () => {
    await manager.initialize()
    
    const diag = manager.getDiagnostics()
    expect(diag).toBeDefined()
    expect(diag?.cpu).toBeDefined()
    expect(diag?.memory).toBeDefined()
  })
  
  it('should provide health status', async () => {
    await manager.initialize()
    
    const health = manager.getHealthStatus()
    expect(health).toBeDefined()
    expect(health.healthCheckPassed).toBeDefined()
    expect(health.cpuFallbackMode).toBeDefined()
    expect(health.logPath).toBeTruthy()
  })
  
  it('should check if Ollama is installed', async () => {
    const installed = await manager.checkInstalled()
    
    // This may be true or false depending on test environment
    expect(typeof installed).toBe('boolean')
  })
  
  it('should handle missing Ollama gracefully', async () => {
    const version = await manager.getVersion()
    
    // Version should be string or null (if not installed)
    expect(version === null || typeof version === 'string').toBe(true)
  })
})

describe('Auto-Fallback Simulation', () => {
  it('should simulate Vulkan unhealthy scenario', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    // If Vulkan is unhealthy
    if (!diag.vulkan.healthy) {
      expect(diag.recommendations.useGPU).toBe(false)
      expect(diag.recommendations.fallbackMode).toBe('cpu')
      expect(diag.vulkan.issues.length).toBeGreaterThan(0)
    }
  })
  
  it('should recommend CPU mode for old Intel iGPU', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    // If old Intel integrated GPU detected
    if (diag.gpu.name.includes('Intel HD 4000') || 
        diag.gpu.name.includes('Intel HD 3000')) {
      expect(diag.vulkan.healthy).toBe(false)
      expect(diag.recommendations.useGPU).toBe(false)
    }
  })
})

describe('Safe Model Options', () => {
  it('should generate conservative defaults when no diagnostics', () => {
    const manager = new OllamaManager()
    
    // Before initialization, should use conservative defaults
    const health = manager.getHealthStatus()
    expect(health.cpuFallbackMode).toBeDefined()
  })
  
  it('should adjust options based on RAM', async () => {
    const diag = await hardwareDiagnostics.diagnose()
    
    if (diag.memory.totalGb < 8) {
      // Low RAM scenario
      expect(diag.recommendations.maxContext).toBeLessThanOrEqual(512)
      expect(diag.recommendations.maxBatch).toBeLessThanOrEqual(8)
    } else if (diag.memory.totalGb >= 16) {
      // Good RAM scenario
      expect(diag.recommendations.maxContext).toBeGreaterThanOrEqual(1024)
    }
  })
})

describe('User-Friendly Error Messages', () => {
  let manager: OllamaManager
  
  beforeAll(() => {
    manager = new OllamaManager()
  })
  
  it('should convert timeout errors', () => {
    const manager = new OllamaManager()
    
    // Access private method via type casting (for testing only)
    const error = (manager as any).getUserFriendlyError('Model load timed out after 90s')
    
    expect(error).toContain('Model loading timed out')
    expect(error).toContain('Try')
  })
  
  it('should convert GPU errors', () => {
    const manager = new OllamaManager()
    
    const error = (manager as any).getUserFriendlyError('Vulkan driver error')
    
    expect(error).toContain('GPU')
    expect(error).toContain('CPU-only')
  })
  
  it('should convert memory errors', () => {
    const manager = new OllamaManager()
    
    const error = (manager as any).getUserFriendlyError('out of memory')
    
    expect(error).toContain('Insufficient memory')
    expect(error).toContain('Try')
  })
})

// Export for manual testing
export { hardwareDiagnostics, OllamaManager, ollamaLogger }





