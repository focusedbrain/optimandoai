/**
 * Hardware Diagnostics Module
 * Detects system capabilities and provides safe resource recommendations
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execAsync = promisify(exec)

export interface HardwareDiagnostics {
  cpu: {
    cores: number
    model: string
    physicalCores: number
  }
  memory: {
    totalGb: number
    freeGb: number
  }
  gpu: {
    detected: boolean
    name: string
    vendor: string
    isIntegratedGraphics: boolean
  }
  vulkan: {
    available: boolean
    healthy: boolean
    version?: string
    issues: string[]
  }
  recommendations: ResourceRecommendations
}

export interface ResourceRecommendations {
  useGPU: boolean
  maxContext: number
  maxBatch: number
  numThreads: number
  recommendedQuant: string
  fallbackMode: 'gpu' | 'cpu'
  warnings: string[]
}

export class HardwareDiagnosticsService {
  private cachedDiagnostics: HardwareDiagnostics | null = null
  
  /**
   * Run complete hardware diagnostics
   */
  async diagnose(): Promise<HardwareDiagnostics> {
    console.log('[HardwareDiagnostics] Starting system diagnostics...')
    
    const cpu = await this.detectCPU()
    const memory = await this.detectMemory()
    const gpu = await this.detectGPU()
    const vulkan = await this.checkVulkanHealth()
    
    const diagnostics: HardwareDiagnostics = {
      cpu,
      memory,
      gpu,
      vulkan,
      recommendations: this.generateRecommendations(cpu, memory, gpu, vulkan)
    }
    
    this.cachedDiagnostics = diagnostics
    this.logDiagnostics(diagnostics)
    
    return diagnostics
  }
  
  /**
   * Get cached diagnostics (or run new if not cached)
   */
  async getCached(): Promise<HardwareDiagnostics> {
    if (!this.cachedDiagnostics) {
      return await this.diagnose()
    }
    return this.cachedDiagnostics
  }
  
  /**
   * Detect CPU information
   */
  private async detectCPU() {
    const cpus = os.cpus()
    const logicalCores = cpus.length
    
    // Estimate physical cores (logical / 2 for hyperthreading)
    const physicalCores = Math.max(1, Math.floor(logicalCores / 2))
    
    return {
      cores: logicalCores,
      model: cpus[0]?.model || 'Unknown',
      physicalCores
    }
  }
  
  /**
   * Detect memory information
   */
  private async detectMemory() {
    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()
    
    return {
      totalGb: Math.round(totalBytes / (1024 ** 3) * 10) / 10,
      freeGb: Math.round(freeBytes / (1024 ** 3) * 10) / 10
    }
  }
  
  /**
   * Detect GPU information (Windows)
   */
  private async detectGPU() {
    try {
      if (process.platform === 'win32') {
        // Use WMIC to get GPU info
        const { stdout } = await execAsync(
          'wmic path win32_VideoController get name,AdapterCompatibility,AdapterRAM /format:csv',
          { timeout: 5000 }
        )
        
        const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('Node'))
        
        if (lines.length > 0) {
          // Parse first GPU
          const parts = lines[0].split(',')
          const vendor = parts[1]?.trim() || ''
          const name = parts[2]?.trim() || 'Unknown GPU'
          
          const isIntegrated = 
            name.includes('Intel HD') ||
            name.includes('Intel UHD') ||
            name.includes('Intel Iris') ||
            name.includes('AMD Radeon(TM)') ||
            name.includes('Integrated')
          
          return {
            detected: true,
            name,
            vendor,
            isIntegratedGraphics: isIntegrated
          }
        }
      }
      
      // Fallback for other platforms or if detection fails
      return {
        detected: false,
        name: 'Unknown',
        vendor: 'Unknown',
        isIntegratedGraphics: false
      }
    } catch (error) {
      console.warn('[HardwareDiagnostics] GPU detection failed:', error)
      return {
        detected: false,
        name: 'Unknown',
        vendor: 'Unknown',
        isIntegratedGraphics: false
      }
    }
  }
  
  /**
   * Check Vulkan health (Windows)
   */
  private async checkVulkanHealth() {
    const issues: string[] = []
    let available = false
    let healthy = false
    let version: string | undefined
    
    try {
      if (process.platform === 'win32') {
        // Try to run vulkaninfo
        try {
          const { stdout, stderr } = await execAsync('vulkaninfo --summary', {
            timeout: 10000,
            windowsHide: true
          })
          
          available = true
          
          // Check for version
          const versionMatch = stdout.match(/Vulkan Instance Version: (\d+\.\d+\.\d+)/)
          if (versionMatch) {
            version = versionMatch[1]
          }
          
          // Check for common issues
          if (stderr.includes('ERROR') || stderr.includes('FAILED')) {
            issues.push('Vulkan reports errors - drivers may be outdated')
            healthy = false
          } else if (stdout.includes('ERROR') || stdout.includes('No devices found')) {
            issues.push('No Vulkan-compatible devices found')
            healthy = false
          } else {
            healthy = true
          }
        } catch (vulkanError: any) {
          available = false
          issues.push('vulkaninfo command failed - Vulkan SDK not installed or broken')
        }
        
        // Check for known problematic hardware
        const gpu = await this.detectGPU()
        if (gpu.isIntegratedGraphics && gpu.name.includes('Intel')) {
          // Intel HD/UHD graphics often have Vulkan driver issues on Windows
          if (gpu.name.includes('HD 4000') || 
              gpu.name.includes('HD 3000') ||
              gpu.name.includes('HD 2000')) {
            issues.push('Old Intel integrated GPU - Vulkan likely unstable')
            healthy = false
          }
        }
      } else {
        // On non-Windows, assume Vulkan is available if GPU is present
        const gpu = await this.detectGPU()
        available = gpu.detected
        healthy = gpu.detected
      }
    } catch (error) {
      console.warn('[HardwareDiagnostics] Vulkan health check failed:', error)
      issues.push('Could not determine Vulkan health')
    }
    
    return {
      available,
      healthy,
      version,
      issues
    }
  }
  
  /**
   * Generate safe resource recommendations based on hardware
   */
  private generateRecommendations(
    cpu: any,
    memory: any,
    gpu: any,
    vulkan: any
  ): ResourceRecommendations {
    const warnings: string[] = []
    let useGPU = false
    let maxContext = 2048
    let maxBatch = 128
    let numThreads = 4
    let recommendedQuant = 'q4_K_M'
    let fallbackMode: 'gpu' | 'cpu' = 'cpu'
    
    // Determine GPU usage
    if (gpu.detected && vulkan.healthy) {
      useGPU = true
      fallbackMode = 'gpu'
    } else if (!vulkan.healthy && vulkan.issues.length > 0) {
      warnings.push(`GPU/Vulkan unstable: ${vulkan.issues.join(', ')}`)
      useGPU = false
      fallbackMode = 'cpu'
    }
    
    // Determine safe context size based on RAM
    if (memory.totalGb < 8) {
      maxContext = 512
      maxBatch = 8
      recommendedQuant = 'q2_K'
      warnings.push('Low RAM detected - using minimal context and extreme quantization')
    } else if (memory.totalGb < 16) {
      maxContext = 1024
      maxBatch = 16
      recommendedQuant = 'q4_K_M'
      warnings.push('Moderate RAM - using reduced context')
    } else if (memory.totalGb < 32) {
      maxContext = 2048
      maxBatch = 32
      recommendedQuant = 'q4_K_M'
    } else {
      maxContext = 4096
      maxBatch = 128
      recommendedQuant = 'q5_K_M'
    }
    
    // Determine thread count
    // Use physical cores, max 4 for weak systems to avoid overload
    if (memory.totalGb < 8 || cpu.physicalCores <= 2) {
      numThreads = Math.min(2, cpu.physicalCores)
      warnings.push('Weak CPU detected - limiting threads')
    } else {
      numThreads = Math.min(4, cpu.physicalCores)
    }
    
    // Check if CPU is very old
    if (cpu.model.includes('Celeron') || cpu.model.includes('Pentium') || cpu.model.includes('Atom')) {
      warnings.push('Older CPU detected - expect slower performance')
      maxContext = Math.min(maxContext, 512)
      maxBatch = Math.min(maxBatch, 8)
    }
    
    return {
      useGPU,
      maxContext,
      maxBatch,
      numThreads,
      recommendedQuant,
      fallbackMode,
      warnings
    }
  }
  
  /**
   * Log diagnostics results
   */
  private logDiagnostics(diag: HardwareDiagnostics) {
    console.log('[HardwareDiagnostics] ===== SYSTEM DIAGNOSTICS =====')
    console.log(`[HardwareDiagnostics] CPU: ${diag.cpu.model}`)
    console.log(`[HardwareDiagnostics] CPU Cores: ${diag.cpu.cores} logical, ${diag.cpu.physicalCores} physical`)
    console.log(`[HardwareDiagnostics] RAM: ${diag.memory.totalGb}GB total, ${diag.memory.freeGb}GB free`)
    console.log(`[HardwareDiagnostics] GPU: ${diag.gpu.name} (Integrated: ${diag.gpu.isIntegratedGraphics})`)
    console.log(`[HardwareDiagnostics] Vulkan: Available=${diag.vulkan.available}, Healthy=${diag.vulkan.healthy}`)
    if (diag.vulkan.issues.length > 0) {
      console.log(`[HardwareDiagnostics] Vulkan Issues: ${diag.vulkan.issues.join(', ')}`)
    }
    console.log('[HardwareDiagnostics] ===== RECOMMENDATIONS =====')
    console.log(`[HardwareDiagnostics] Use GPU: ${diag.recommendations.useGPU}`)
    console.log(`[HardwareDiagnostics] Max Context: ${diag.recommendations.maxContext}`)
    console.log(`[HardwareDiagnostics] Max Batch: ${diag.recommendations.maxBatch}`)
    console.log(`[HardwareDiagnostics] Threads: ${diag.recommendations.numThreads}`)
    console.log(`[HardwareDiagnostics] Recommended Quantization: ${diag.recommendations.recommendedQuant}`)
    console.log(`[HardwareDiagnostics] Fallback Mode: ${diag.recommendations.fallbackMode}`)
    if (diag.recommendations.warnings.length > 0) {
      console.log(`[HardwareDiagnostics] Warnings: ${diag.recommendations.warnings.join(' | ')}`)
    }
    console.log('[HardwareDiagnostics] ===============================')
  }
}

export const hardwareDiagnostics = new HardwareDiagnosticsService()







