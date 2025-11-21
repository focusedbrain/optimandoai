/**
 * Hardware Check Service
 * Detects system capabilities (RAM, CPU, OS) and recommends model tiers
 */

import os from 'node:os'
import type { HardwareInfo, RamTier } from './types'

export class HardwareCheckService {
  /**
   * Check system hardware and determine if it can run local LLMs
   */
  async checkHardware(): Promise<HardwareInfo> {
    const totalRamBytes = os.totalmem()
    const freeRamBytes = os.freemem()
    const totalRamGb = totalRamBytes / (1024 ** 3)
    const freeRamGb = freeRamBytes / (1024 ** 3)
    const cpuCores = os.cpus().length
    const osType = this.detectOS()
    
    // Use free RAM for more accurate assessment
    const effectiveRamGb = freeRamGb + 2  // Assume 2GB can be freed
    const ramTier = this.determineRamTier(totalRamGb, freeRamGb)
    
    // More conservative check: need 4GB free for quantized, 8GB for full model
    const canRunQuantized = freeRamGb >= 3
    const canRunFull = freeRamGb >= 6
    
    const warnings = this.generateWarnings(totalRamGb, freeRamGb, cpuCores)
    const recommendedModel = this.recommendModel(totalRamGb, freeRamGb, cpuCores)
    
    console.log('[HARDWARE] Detected:', {
      totalRamGb: Math.round(totalRamGb * 10) / 10,
      freeRamGb: Math.round(freeRamGb * 10) / 10,
      cpuCores,
      osType,
      ramTier,
      canRunQuantized,
      canRunFull,
      recommendedModel
    })
    
    return {
      totalRamGb: Math.round(totalRamGb * 10) / 10,
      freeRamGb: Math.round(freeRamGb * 10) / 10,
      cpuCores,
      osType,
      recommendedTier: ramTier,
      canRunMistral7B: canRunFull,
      canRunQuantized,
      recommendedModel,
      warnings
    }
  }
  
  /**
   * Detect operating system type
   */
  private detectOS(): 'windows' | 'macos' | 'linux' {
    const platform = os.platform()
    if (platform === 'win32') return 'windows'
    if (platform === 'darwin') return 'macos'
    return 'linux'
  }
  
  /**
   * Determine recommended RAM tier based on available memory
   * Now considers both total and free RAM
   * 
   * Thresholds (based on FREE RAM):
   * - < 3 GB free: insufficient (cannot run quantized models)
   * - 3-6 GB free: minimal (can run quantized 4-bit models)
   * - 6-10 GB free: recommended (can run full 7B models)
   * - >= 10 GB free: excellent (can run larger models)
   */
  private determineRamTier(totalRamGb: number, freeRamGb: number): RamTier {
    // Prioritize free RAM over total
    if (freeRamGb < 3) return 'insufficient'
    if (freeRamGb < 6) return 'minimal'
    if (freeRamGb < 10) return 'recommended'
    return 'excellent'
  }
  
  /**
   * Recommend the best model based on hardware
   */
  private recommendModel(totalRamGb: number, freeRamGb: number, cores: number): string {
    // Very limited hardware
    if (freeRamGb < 2 || cores < 2) {
      return 'tinyllama'  // 1.1B params, ~1GB RAM
    }
    
    // Low-end hardware  
    if (freeRamGb < 4 || totalRamGb < 6) {
      return 'phi3:mini'  // 3B params, ~2-3GB RAM
    }
    
    // Mid-range hardware
    if (freeRamGb < 6 || totalRamGb < 10) {
      return 'mistral:7b-instruct-q4_0'  // 7B quantized, ~4GB RAM
    }
    
    // Good hardware
    if (freeRamGb >= 6 && totalRamGb >= 10) {
      return 'mistral:7b-instruct-q5_K_M'  // 7B better quantization, ~5GB RAM
    }
    
    // Excellent hardware
    return 'mistral:7b'  // Full model
  }
  
  /**
   * Generate user-friendly warnings based on hardware
   */
  private generateWarnings(totalRamGb: number, freeRamGb: number, cores: number): string[] {
    const warnings: string[] = []
    
    if (freeRamGb < 2) {
      warnings.push('⚠️ Critical: Less than 2GB free RAM. Local models will not work. Use remote API instead.')
    } else if (freeRamGb < 4) {
      warnings.push('⚠️ Limited RAM: Only lightweight models (Phi-3 Mini, TinyLlama) recommended.')
    } else if (freeRamGb < 6) {
      warnings.push('ℹ️ Moderate RAM: Quantized models (Q4, Q5) recommended for best performance.')
    }
    
    if (totalRamGb < 6) {
      warnings.push('ℹ️ Low total RAM: Close other applications before using local models.')
    }
    
    if (cores < 4) {
      warnings.push('ℹ️ Limited CPU cores: Inference will be slower. Consider using 2 threads max.')
    }
    
    return warnings
  }
}

// Singleton instance
export const hardwareService = new HardwareCheckService()

