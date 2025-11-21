/**
 * Hardware Detection Service
 * Detects system capabilities for LLM model recommendations
 */

import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { HardwareInfo, OsType, PerformanceEstimate, LlmModelConfig, ModelPerformanceEstimate } from './types'

const execAsync = promisify(exec)

export class HardwareService {
  /**
   * Detect all hardware capabilities
   */
  async detect(): Promise<HardwareInfo> {
    const totalRamBytes = os.totalmem()
    const freeRamBytes = os.freemem()
    const cpus = os.cpus()
    const cpuCores = cpus.length
    
    // Detect GPU (optional, best-effort)
    const gpu = await this.detectGpu()
    
    // Check available disk space
    const diskFree = await this.getDiskFree()
    
    // Determine OS type
    const osType = this.getOsType()
    
    // Calculate values
    const totalRamGb = Math.round(totalRamBytes / (1024**3) * 10) / 10
    const freeRamGb = Math.round(freeRamBytes / (1024**3) * 10) / 10
    const diskFreeGb = Math.round(diskFree / (1024**3) * 10) / 10
    
    // Generate warnings based on hardware
    const warnings = this.generateWarnings(totalRamGb, freeRamGb, cpuCores, diskFreeGb)
    
    // Get recommended models for this hardware
    const recommendedModels = this.getRecommendedModels(freeRamGb)
    
    return {
      totalRamGb,
      freeRamGb,
      cpuCores,
      cpuThreads: cpuCores, // Simplified: assume threads = cores
      gpuAvailable: gpu.available,
      gpuVramGb: gpu.vramGb,
      diskFreeGb,
      osType,
      warnings,
      recommendedModels
    }
  }
  
  /**
   * Get OS type
   */
  private getOsType(): OsType {
    const platform = os.platform()
    if (platform === 'win32') return 'windows'
    if (platform === 'darwin') return 'macos'
    return 'linux'
  }
  
  /**
   * Detect GPU capabilities (best effort)
   */
  private async detectGpu(): Promise<{ available: boolean; vramGb?: number }> {
    try {
      const platform = os.platform()
      
      if (platform === 'win32') {
        // Windows: Use wmic
        const { stdout } = await execAsync('wmic path win32_VideoController get AdapterRAM')
        const lines = stdout.split('\n').filter(l => l.trim() && l.trim() !== 'AdapterRAM')
        if (lines.length > 0) {
          const vramBytes = parseInt(lines[0].trim())
          if (vramBytes > 0) {
            return {
              available: true,
              vramGb: Math.round(vramBytes / (1024**3) * 10) / 10
            }
          }
        }
      } else if (platform === 'darwin') {
        // macOS: Use system_profiler
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType | grep "VRAM"')
        const match = stdout.match(/(\d+)\s*(MB|GB)/)
        if (match) {
          const value = parseInt(match[1])
          const unit = match[2]
          const vramGb = unit === 'GB' ? value : value / 1024
          return {
            available: true,
            vramGb: Math.round(vramGb * 10) / 10
          }
        }
      } else {
        // Linux: Use lspci
        const { stdout } = await execAsync('lspci | grep -i vga')
        if (stdout.includes('NVIDIA') || stdout.includes('AMD') || stdout.includes('Intel')) {
          return { available: true }
        }
      }
    } catch (error) {
      // GPU detection failed, not critical
      console.log('[Hardware] GPU detection failed:', error)
    }
    
    return { available: false }
  }
  
  /**
   * Get available disk space in bytes
   */
  private async getDiskFree(): Promise<number> {
    try {
      const platform = os.platform()
      
      if (platform === 'win32') {
        // Windows: Get system drive free space
        const { stdout } = await execAsync('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace')
        const lines = stdout.split('\n').filter(l => l.trim() && l.trim() !== 'FreeSpace')
        if (lines.length > 0) {
          return parseInt(lines[0].trim())
        }
      } else {
        // macOS/Linux: Use df
        const { stdout } = await execAsync('df -k . | tail -1 | awk \'{print $4}\'')
        return parseInt(stdout.trim()) * 1024 // Convert KB to bytes
      }
    } catch (error) {
      console.warn('[Hardware] Disk space detection failed:', error)
    }
    
    // Fallback: assume 50GB free
    return 50 * 1024**3
  }
  
  /**
   * Generate hardware warnings
   */
  private generateWarnings(totalRamGb: number, freeRamGb: number, cpuCores: number, diskFreeGb: number): string[] {
    const warnings: string[] = []
    
    // RAM warnings
    if (freeRamGb < 2) {
      warnings.push('Critical: Less than 2GB free RAM. Local models will not work reliably. Consider using remote API.')
    } else if (freeRamGb < 4) {
      warnings.push('Limited RAM: Only lightweight models (TinyLlama, Phi-3 Mini) recommended.')
    } else if (freeRamGb < 6) {
      warnings.push('Moderate RAM: Quantized models (Q4, Q5) recommended for best performance.')
    }
    
    if (totalRamGb < 8) {
      warnings.push('Low total RAM: Close other applications before using local models.')
    }
    
    // CPU warnings
    if (cpuCores < 4) {
      warnings.push('Limited CPU cores: Inference will be slower. Consider using 2 threads max.')
    }
    
    // Disk warnings
    if (diskFreeGb < 10) {
      warnings.push('Critical: Less than 10GB disk space. Model downloads may fail.')
    } else if (diskFreeGb < 30) {
      warnings.push('Limited disk space: You can install 1-2 small models only.')
    }
    
    return warnings
  }
  
  /**
   * Get recommended model IDs based on available RAM
   */
  private getRecommendedModels(freeRamGb: number): string[] {
    if (freeRamGb >= 60) {
      return ['qwen2:72b', 'llama3.1:70b', 'mixtral:8x7b']
    }
    if (freeRamGb >= 30) {
      return ['mixtral:8x7b', 'llama3.1:8b', 'mistral:7b']
    }
    if (freeRamGb >= 8) {
      return ['mistral:7b', 'llama3.1:8b', 'mistral:7b-instruct-q5_K_M']
    }
    if (freeRamGb >= 4) {
      return ['mistral:7b-instruct-q4_0', 'llama3:8b', 'mistral:7b-instruct-q5_K_M']
    }
    if (freeRamGb >= 3) {
      return ['mistral:7b-instruct-q4_0', 'phi3:mini']
    }
    if (freeRamGb >= 2) {
      return ['phi3:mini', 'tinyllama']
    }
    return ['tinyllama']
  }
  
  /**
   * Estimate performance for a specific model on given hardware
   */
  estimatePerformance(model: LlmModelConfig, hardware: HardwareInfo): ModelPerformanceEstimate {
    const freeRam = hardware.freeRamGb
    const ramMargin = freeRam - model.recommendedRamGb
    
    let estimate: PerformanceEstimate
    let reason: string
    let speedEstimate: string | undefined
    
    if (ramMargin >= 4) {
      estimate = 'fast'
      reason = `Excellent: ${ramMargin.toFixed(1)}GB RAM above recommended. Should run smoothly.`
      speedEstimate = hardware.cpuCores >= 8 ? '~15-20 tokens/sec' : '~10-15 tokens/sec'
    } else if (ramMargin >= 1) {
      estimate = 'usable'
      reason = `Good: ${ramMargin.toFixed(1)}GB RAM above recommended. Performance will be acceptable.`
      speedEstimate = hardware.cpuCores >= 8 ? '~8-12 tokens/sec' : '~5-8 tokens/sec'
    } else if (ramMargin >= -1) {
      estimate = 'slow'
      reason = `Marginal: Close to minimum RAM. May be slow or require closing other apps.`
      speedEstimate = '~2-5 tokens/sec'
    } else {
      estimate = 'unusable'
      reason = `Insufficient: ${Math.abs(ramMargin).toFixed(1)}GB below recommended. Will likely fail or be extremely slow.`
      speedEstimate = undefined
    }
    
    return {
      modelId: model.id,
      estimate,
      reason,
      ramUsageGb: model.recommendedRamGb,
      speedEstimate
    }
  }
}

// Singleton instance
export const hardwareService = new HardwareService()
