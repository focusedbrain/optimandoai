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
    const totalRamGb = totalRamBytes / (1024 ** 3)
    const cpuCores = os.cpus().length
    const osType = this.detectOS()
    
    const ramTier = this.determineRamTier(totalRamGb)
    const canRunMistral7B = totalRamGb >= 8
    const warnings = this.generateWarnings(totalRamGb, cpuCores)
    
    console.log('[HARDWARE] Detected:', {
      totalRamGb: Math.round(totalRamGb * 10) / 10,
      cpuCores,
      osType,
      ramTier,
      canRunMistral7B
    })
    
    return {
      totalRamGb: Math.round(totalRamGb * 10) / 10,
      cpuCores,
      osType,
      recommendedTier: ramTier,
      canRunMistral7B,
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
   * 
   * Thresholds:
   * - < 8 GB: insufficient (cannot run Mistral 7B)
   * - 8-12 GB: minimal (can run but may be slow)
   * - 12-20 GB: recommended (good performance)
   * - >= 20 GB: excellent (can run larger models)
   */
  private determineRamTier(ramGb: number): RamTier {
    if (ramGb < 8) return 'insufficient'
    if (ramGb < 12) return 'minimal'
    if (ramGb < 20) return 'recommended'
    return 'excellent'
  }
  
  /**
   * Generate user-friendly warnings based on hardware
   */
  private generateWarnings(ramGb: number, cores: number): string[] {
    const warnings: string[] = []
    
    if (ramGb < 8) {
      warnings.push('Mistral 7B requires at least 8GB RAM. Consider using a remote provider or smaller model.')
    } else if (ramGb < 12) {
      warnings.push('Limited RAM detected. Local model may run slowly. Close other applications for better performance.')
    }
    
    if (cores < 4) {
      warnings.push('Fewer than 4 CPU cores detected. Model inference may be slow.')
    }
    
    return warnings
  }
}

// Singleton instance
export const hardwareService = new HardwareCheckService()

