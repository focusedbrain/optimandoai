/**
 * Hardware Capability Check Module
 * Determines if user's hardware is suitable for local LLM inference
 * Provides friendly recommendations for Cloud/Turbo Mode when needed
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { ollamaLogger } from './rotating-logger'

const execAsync = promisify(exec)

export type HardwareProfile = 'good' | 'limited' | 'too_old_for_local_llms'

export interface CPUCapabilities {
  name: string
  cores: number
  threads: number
  hasSSE42: boolean
  hasAVX: boolean
  hasAVX2: boolean
  hasAVX512: boolean
  generation?: string  // e.g., "7th Gen Intel", "Ryzen 5000"
}

export interface DiskInfo {
  type: 'SSD' | 'HDD' | 'Unknown'
  path: string
  freeSpaceGB: number
}

export interface HardwareCapabilityResult {
  cpu: CPUCapabilities
  ramGB: number
  disk: DiskInfo
  gpuVulkanHealthy: boolean
  profile: HardwareProfile
  reasons: string[]
  recommendation: {
    useCloud: boolean
    message: string
  }
}

export class HardwareCapabilityChecker {
  private cachedResult: HardwareCapabilityResult | null = null
  
  /**
   * Run complete hardware capability check
   */
  async check(): Promise<HardwareCapabilityResult> {
    ollamaLogger.log('INFO', 'HardwareCapability', '===== HARDWARE CAPABILITY CHECK =====')
    
    const cpu = await this.detectCPUCapabilities()
    const ramGB = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10
    const disk = await this.detectDiskType()
    const gpuVulkanHealthy = await this.checkGPUVulkanHealth()
    
    // Compute profile and recommendation
    const { profile, reasons } = this.computeProfile(cpu, ramGB, disk, gpuVulkanHealthy)
    const recommendation = this.generateRecommendation(profile, reasons)
    
    const result: HardwareCapabilityResult = {
      cpu,
      ramGB,
      disk,
      gpuVulkanHealthy,
      profile,
      reasons,
      recommendation
    }
    
    this.cachedResult = result
    this.logResult(result)
    
    return result
  }
  
  /**
   * Get cached result (or run new check if not cached)
   */
  async getCached(): Promise<HardwareCapabilityResult> {
    if (!this.cachedResult) {
      return await this.check()
    }
    return this.cachedResult
  }
  
  /**
   * Detect CPU capabilities including instruction sets
   */
  private async detectCPUCapabilities(): Promise<CPUCapabilities> {
    const cpus = os.cpus()
    const name = cpus[0]?.model || 'Unknown CPU'
    const threads = cpus.length
    const cores = Math.max(1, Math.floor(threads / 2))
    
    let hasSSE42 = false
    let hasAVX = false
    let hasAVX2 = false
    let hasAVX512 = false
    let generation: string | undefined
    
    try {
      if (process.platform === 'win32') {
        // Use WMIC to get CPU features
        const { stdout: _stdout } = await execAsync('wmic cpu get Name,NumberOfCores,NumberOfLogicalProcessors /format:list', {
          timeout: 5000,
          windowsHide: true
        })
        
        // Try to detect instruction sets via registry or feature flags
        // Windows: Check via PowerShell
        try {
          const { stdout: _psOutput } = await execAsync(
            `powershell -Command "Get-WmiObject Win32_Processor | Select-Object Name, Manufacturer"`,
            { timeout: 5000, windowsHide: true }
          )
          
          // Most modern Intel/AMD CPUs have these features
          // We'll do a best-effort detection based on CPU name
          const lowerName = name.toLowerCase()
          
          // Intel detection
          if (lowerName.includes('intel')) {
            // Extract generation (e.g., "i5-7200U" -> 7th Gen)
            const genMatch = name.match(/i[3579]-(\d+)\d{2,3}/)
            if (genMatch) {
              const gen = parseInt(genMatch[1])
              generation = `${gen}th Gen Intel`
              
              // AVX2 support: Intel 4th gen (Haswell) and newer
              hasAVX2 = gen >= 4
              hasAVX = gen >= 2  // Sandy Bridge (2011)
              hasSSE42 = gen >= 1  // Nehalem (2008)
              hasAVX512 = gen >= 10 // Ice Lake (2019) desktop, 10th+ mobile
            }
            
            // Old CPUs
            if (lowerName.includes('pentium') || lowerName.includes('celeron') || lowerName.includes('atom')) {
              hasAVX2 = false
              hasAVX = false
            }
          }
          
          // AMD detection
          if (lowerName.includes('amd') || lowerName.includes('ryzen')) {
            if (lowerName.includes('ryzen')) {
              const rGenMatch = name.match(/ryzen\s+\d+\s+(\d+)/)
              if (rGenMatch) {
                const series = parseInt(rGenMatch[1])
                generation = `Ryzen ${Math.floor(series / 1000)}`
                
                // Ryzen 1000+ all have AVX2
                hasAVX2 = true
                hasAVX = true
                hasSSE42 = true
                hasAVX512 = series >= 4000 // Zen 3+
              }
            } else if (lowerName.includes('fx') || lowerName.includes('athlon')) {
              // Older AMD
              hasAVX2 = false
              hasAVX = lowerName.includes('fx')
              hasSSE42 = true
            }
          }
        } catch (psError) {
          ollamaLogger.log('WARN', 'HardwareCapability', 'Failed to detect CPU features via PowerShell', { error: psError })
        }
        
      } else if (process.platform === 'linux') {
        // Linux: Read /proc/cpuinfo
        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8')
        const flags = cpuinfo.match(/flags\s*:\s*(.+)/i)
        
        if (flags && flags[1]) {
          const flagList = flags[1].toLowerCase()
          hasSSE42 = flagList.includes('sse4_2')
          hasAVX = flagList.includes('avx')
          hasAVX2 = flagList.includes('avx2')
          hasAVX512 = flagList.includes('avx512')
        }
      } else if (process.platform === 'darwin') {
        // macOS: Use sysctl
        try {
          const { stdout } = await execAsync('sysctl -a | grep machdep.cpu.features')
          const features = stdout.toLowerCase()
          hasSSE42 = features.includes('sse4.2')
          hasAVX = features.includes('avx1.0') || features.includes('avx')
          hasAVX2 = features.includes('avx2.0') || features.includes('avx2')
          hasAVX512 = features.includes('avx512')
        } catch (e) {
          // Fallback: All Apple Silicon Macs have modern features
          if (name.includes('Apple')) {
            hasAVX2 = true
            hasAVX = true
            hasSSE42 = true
          }
        }
      }
    } catch (error) {
      ollamaLogger.log('WARN', 'HardwareCapability', 'Failed to detect CPU capabilities', { error })
    }
    
    return {
      name,
      cores,
      threads,
      hasSSE42,
      hasAVX,
      hasAVX2,
      hasAVX512,
      generation
    }
  }
  
  /**
   * Detect disk type (SSD vs HDD)
   */
  private async detectDiskType(): Promise<DiskInfo> {
    let type: 'SSD' | 'HDD' | 'Unknown' = 'Unknown'
    const modelPath = path.join(app.getPath('userData'), 'models')
    let freeSpaceGB = 0
    
    try {
      if (process.platform === 'win32') {
        // Windows: Use PowerShell to detect drive type
        const drive = app.getPath('userData').substring(0, 2) // e.g., "C:"
        
        try {
          // Check if it's an SSD
          const { stdout } = await execAsync(
            `powershell -Command "Get-PhysicalDisk | Where-Object {$_.DeviceID -eq 0} | Select-Object MediaType"`,
            { timeout: 5000, windowsHide: true }
          )
          
          if (stdout.toLowerCase().includes('ssd') || stdout.toLowerCase().includes('solid')) {
            type = 'SSD'
          } else if (stdout.toLowerCase().includes('hdd') || stdout.toLowerCase().includes('hard disk')) {
            type = 'HDD'
          }
          
          // Alternative: Check via WMIC
          if (type === 'Unknown') {
            const { stdout: wmicOutput } = await execAsync(
              `wmic diskdrive get Model,MediaType /format:list`,
              { timeout: 5000, windowsHide: true }
            )
            
            if (wmicOutput.toLowerCase().includes('ssd') || wmicOutput.toLowerCase().includes('solid state')) {
              type = 'SSD'
            } else if (wmicOutput.toLowerCase().includes('fixed') || wmicOutput.toLowerCase().includes('hard')) {
              type = 'HDD'
            }
          }
          
          // Get free space
          const { stdout: spaceOutput } = await execAsync(
            `powershell -Command "Get-PSDrive ${drive.charAt(0)} | Select-Object Free"`,
            { timeout: 5000, windowsHide: true }
          )
          const spaceMatch = spaceOutput.match(/(\d+)/)
          if (spaceMatch) {
            freeSpaceGB = Math.round(parseInt(spaceMatch[1]) / (1024 ** 3))
          }
        } catch (e) {
          ollamaLogger.log('WARN', 'HardwareCapability', 'Failed to detect disk type on Windows', { error: e })
        }
      } else if (process.platform === 'linux') {
        // Linux: Check /sys/block/*/queue/rotational
        try {
          const { stdout } = await execAsync('lsblk -d -o name,rota')
          // rota=0 means SSD, rota=1 means HDD
          if (stdout.includes('0')) {
            type = 'SSD'
          } else if (stdout.includes('1')) {
            type = 'HDD'
          }
        } catch (e) {
          ollamaLogger.log('WARN', 'HardwareCapability', 'Failed to detect disk type on Linux', { error: e })
        }
      } else if (process.platform === 'darwin') {
        // macOS: Most modern Macs are SSD
        type = 'SSD'
      }
    } catch (error) {
      ollamaLogger.log('WARN', 'HardwareCapability', 'Failed to detect disk info', { error })
    }
    
    return {
      type,
      path: modelPath,
      freeSpaceGB
    }
  }
  
  /**
   * Check GPU/Vulkan health (simplified from existing diagnostics)
   */
  private async checkGPUVulkanHealth(): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync('vulkaninfo --summary', {
          timeout: 10000,
          windowsHide: true
        })
        
        // Check for errors
        if (stdout.includes('ERROR') || stdout.includes('No devices found')) {
          return false
        }
        
        return true
      }
      
      // On other platforms, assume OK
      return true
    } catch (error) {
      // Vulkan not available or broken
      return false
    }
  }
  
  /**
   * Compute hardware profile based on detected capabilities
   */
  private computeProfile(
    cpu: CPUCapabilities,
    ramGB: number,
    disk: DiskInfo,
    gpuVulkanHealthy: boolean
  ): { profile: HardwareProfile; reasons: string[] } {
    const reasons: string[] = []
    
    // Rule 1: No AVX2 = too old
    if (!cpu.hasAVX2) {
      reasons.push('CPU lacks AVX2 instruction set (required for fast inference)')
      return { profile: 'too_old_for_local_llms', reasons }
    }
    
    // Rule 2: Very low RAM (< 6GB)
    if (ramGB < 6) {
      reasons.push(`Only ${ramGB}GB RAM (minimum 6GB needed for local models)`)
      return { profile: 'too_old_for_local_llms', reasons }
    }
    
    // Rule 3: HDD + low RAM combo
    if (disk.type === 'HDD' && ramGB < 8) {
      reasons.push(`HDD storage with only ${ramGB}GB RAM (causes severe swap/paging)`)
      return { profile: 'too_old_for_local_llms', reasons }
    }
    
    // Rule 4: GPU/Vulkan repeatedly unstable (strict check)
    if (!gpuVulkanHealthy && ramGB < 12) {
      reasons.push('GPU/Vulkan unstable and insufficient RAM for CPU-only mode')
      // This is borderline - only mark as too_old if combined with other factors
    }
    
    // "Limited" profile: Can run but not ideal
    if (ramGB < 8 || disk.type === 'HDD' || !gpuVulkanHealthy) {
      if (reasons.length === 0) {
        reasons.push('Hardware is marginal for local LLMs')
      }
      return { profile: 'limited', reasons }
    }
    
    // "Good" profile: Should work well
    return { profile: 'good', reasons: ['Hardware is suitable for local LLMs'] }
  }
  
  /**
   * Generate user-friendly recommendation
   */
  private generateRecommendation(
    profile: HardwareProfile,
    reasons: string[]
  ): { useCloud: boolean; message: string } {
    if (profile === 'too_old_for_local_llms') {
      return {
        useCloud: true,
        message: `Quick heads-up: your computer is a bit too old for fast on-device AI. Local models will still work, but they may be very slow or feel laggy.\n\n` +
                 `The good news: this does not affect cloud-based AI at all. Cloud/Turbo Mode runs at full speed and quality on any hardware.\n\n` +
                 `Want the best experience? We'll switch you to Turbo Mode automatically — halleluja. You can still use Local Mode anytime if you prefer.\n\n` +
                 `Reasons: ${reasons.join(', ')}`
      }
    }
    
    if (profile === 'limited') {
      return {
        useCloud: false,
        message: `Your hardware can run local AI, but performance may be limited. Consider using Cloud/Turbo Mode for the best experience.\n\n` +
                 `Notes: ${reasons.join(', ')}`
      }
    }
    
    return {
      useCloud: false,
      message: 'Your hardware is well-suited for local AI models. Enjoy!'
    }
  }
  
  /**
   * Log the result in structured format
   */
  private logResult(result: HardwareCapabilityResult) {
    ollamaLogger.log('INFO', 'HardwareCapability', '===== CAPABILITY CHECK RESULTS =====')
    ollamaLogger.log('INFO', 'HardwareCapability', `CPU: ${result.cpu.name}`, {
      cores: result.cpu.cores,
      threads: result.cpu.threads,
      generation: result.cpu.generation
    })
    ollamaLogger.log('INFO', 'HardwareCapability', 'Instruction Sets', {
      SSE4_2: result.cpu.hasSSE42,
      AVX: result.cpu.hasAVX,
      AVX2: result.cpu.hasAVX2,
      AVX512: result.cpu.hasAVX512
    })
    ollamaLogger.log('INFO', 'HardwareCapability', `RAM: ${result.ramGB}GB`)
    ollamaLogger.log('INFO', 'HardwareCapability', `Disk: ${result.disk.type} (${result.disk.freeSpaceGB}GB free)`)
    ollamaLogger.log('INFO', 'HardwareCapability', `GPU/Vulkan Healthy: ${result.gpuVulkanHealthy}`)
    ollamaLogger.log('INFO', 'HardwareCapability', `Profile: ${result.profile}`)
    ollamaLogger.log('INFO', 'HardwareCapability', `Reasons: ${result.reasons.join(' | ')}`)
    ollamaLogger.log('INFO', 'HardwareCapability', `Recommendation: Use Cloud = ${result.recommendation.useCloud}`)
    ollamaLogger.log('INFO', 'HardwareCapability', '=======================================')
  }
}

// Singleton instance
export const hardwareCapabilityChecker = new HardwareCapabilityChecker()



