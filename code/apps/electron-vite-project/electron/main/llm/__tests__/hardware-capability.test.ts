/**
 * Unit Tests for Hardware Capability Check
 * Tests edge cases: no AVX2, low RAM, HDD, Vulkan fail
 */

import { describe, it, expect, jest } from '@jest/globals'
import { HardwareCapabilityChecker, type CPUCapabilities, type DiskInfo } from '../hardware-capability-check'

describe('Hardware Capability Checker', () => {
  
  describe('Profile: too_old_for_local_llms', () => {
    
    it('should mark as too_old when CPU lacks AVX2', async () => {
      const checker = new HardwareCapabilityChecker()
      
      // Mock CPU without AVX2
      const cpuNoAVX2: CPUCapabilities = {
        name: 'Intel Pentium G4400',
        cores: 2,
        threads: 2,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: false,  // Missing AVX2
        hasAVX512: false
      }
      
      const ramGB = 8
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 100 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuNoAVX2, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('too_old_for_local_llms')
      expect(result.reasons).toContain('CPU lacks AVX2 instruction set (required for fast inference)')
    })
    
    it('should mark as too_old when RAM < 6GB', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuGood: CPUCapabilities = {
        name: 'Intel Core i5-8250U',
        cores: 4,
        threads: 8,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false
      }
      
      const ramGB = 4  // Too low
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 100 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuGood, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('too_old_for_local_llms')
      expect(result.reasons.some((r: string) => r.includes('RAM'))).toBe(true)
    })
    
    it('should mark as too_old when HDD + low RAM combo', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuGood: CPUCapabilities = {
        name: 'Intel Core i5-7200U',
        cores: 2,
        threads: 4,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false
      }
      
      const ramGB = 6  // Marginal
      const disk: DiskInfo = { type: 'HDD', path: '/test', freeSpaceGB: 100 }  // HDD
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuGood, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('too_old_for_local_llms')
      expect(result.reasons.some((r: string) => r.includes('HDD'))).toBe(true)
    })
    
    it('should mark as too_old for very old CPU (Pentium, Celeron)', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuOld: CPUCapabilities = {
        name: 'Intel Celeron N3060',
        cores: 2,
        threads: 2,
        hasSSE42: false,
        hasAVX: false,
        hasAVX2: false,  // No modern features
        hasAVX512: false
      }
      
      const ramGB = 8
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 100 }
      const gpuVulkanHealthy = false
      
      const result = (checker as any).computeProfile(cpuOld, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('too_old_for_local_llms')
    })
  })
  
  describe('Profile: limited', () => {
    
    it('should mark as limited when RAM < 8GB but has AVX2', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuGood: CPUCapabilities = {
        name: 'Intel Core i5-8250U',
        cores: 4,
        threads: 8,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false
      }
      
      const ramGB = 7  // Between 6-8GB
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 100 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuGood, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('limited')
    })
    
    it('should mark as limited when HDD but enough RAM', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuGood: CPUCapabilities = {
        name: 'Intel Core i7-8700K',
        cores: 6,
        threads: 12,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false
      }
      
      const ramGB = 16
      const disk: DiskInfo = { type: 'HDD', path: '/test', freeSpaceGB: 500 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuGood, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('limited')
    })
    
    it('should mark as limited when Vulkan unhealthy but otherwise OK', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuGood: CPUCapabilities = {
        name: 'Intel Core i5-7200U',
        cores: 2,
        threads: 4,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false
      }
      
      const ramGB = 8
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 100 }
      const gpuVulkanHealthy = false  // Vulkan broken
      
      const result = (checker as any).computeProfile(cpuGood, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('limited')
    })
  })
  
  describe('Profile: good', () => {
    
    it('should mark as good for modern system', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuModern: CPUCapabilities = {
        name: 'Intel Core i7-10700K',
        cores: 8,
        threads: 16,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: true,
        generation: '10th Gen Intel'
      }
      
      const ramGB = 32
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 500 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuModern, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('good')
      expect(result.reasons).toContain('Hardware is suitable for local LLMs')
    })
    
    it('should mark as good for Ryzen system', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuRyzen: CPUCapabilities = {
        name: 'AMD Ryzen 7 5800X',
        cores: 8,
        threads: 16,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false,
        generation: 'Ryzen 5'
      }
      
      const ramGB = 16
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 200 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuRyzen, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('good')
    })
    
    it('should mark as good even with moderate specs if AVX2 present', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuModerate: CPUCapabilities = {
        name: 'Intel Core i5-6200U',
        cores: 2,
        threads: 4,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,  // Key feature
        hasAVX512: false,
        generation: '6th Gen Intel'
      }
      
      const ramGB = 8
      const disk: DiskInfo = { type: 'SSD', path: '/test', freeSpaceGB: 50 }
      const gpuVulkanHealthy = true
      
      const result = (checker as any).computeProfile(cpuModerate, ramGB, disk, gpuVulkanHealthy)
      
      expect(result.profile).toBe('good')
    })
  })
  
  describe('Recommendation Generation', () => {
    
    it('should recommend cloud for too_old profile', () => {
      const checker = new HardwareCapabilityChecker()
      const reasons = ['CPU lacks AVX2']
      
      const recommendation = (checker as any).generateRecommendation('too_old_for_local_llms', reasons)
      
      expect(recommendation.useCloud).toBe(true)
      expect(recommendation.message).toContain('Cloud/Turbo')
      expect(recommendation.message).toContain('Reasons')
    })
    
    it('should not mandate cloud for limited profile', () => {
      const checker = new HardwareCapabilityChecker()
      const reasons = ['Low RAM']
      
      const recommendation = (checker as any).generateRecommendation('limited', reasons)
      
      expect(recommendation.useCloud).toBe(false)
      expect(recommendation.message).toContain('limited')
    })
    
    it('should be positive for good profile', () => {
      const checker = new HardwareCapabilityChecker()
      const reasons = ['Hardware is suitable']
      
      const recommendation = (checker as any).generateRecommendation('good', reasons)
      
      expect(recommendation.useCloud).toBe(false)
      expect(recommendation.message).toContain('well-suited')
    })
  })
  
  describe('CPU Generation Detection', () => {
    
    it('should detect Intel generation from model name', async () => {
      const checker = new HardwareCapabilityChecker()
      
      // Mock Intel 7th gen
      const result = await checker.check()
      
      // This will vary by test environment, but we check the structure
      expect(result.cpu).toHaveProperty('generation')
      expect(result.cpu).toHaveProperty('hasAVX2')
    })
  })
  
  describe('Edge Cases', () => {
    
    it('should handle unknown CPU gracefully', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuUnknown: CPUCapabilities = {
        name: 'Unknown CPU',
        cores: 1,
        threads: 1,
        hasSSE42: false,
        hasAVX: false,
        hasAVX2: false,
        hasAVX512: false
      }
      
      const result = (checker as any).computeProfile(cpuUnknown, 8, { type: 'SSD', path: '/', freeSpaceGB: 100 }, true)
      
      expect(result.profile).toBe('too_old_for_local_llms')
    })
    
    it('should handle disk type Unknown', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const cpuGood: CPUCapabilities = {
        name: 'Intel Core i5-8250U',
        cores: 4,
        threads: 8,
        hasSSE42: true,
        hasAVX: true,
        hasAVX2: true,
        hasAVX512: false
      }
      
      const disk: DiskInfo = { type: 'Unknown', path: '/test', freeSpaceGB: 100 }
      
      const result = (checker as any).computeProfile(cpuGood, 16, disk, true)
      
      // Should still work with Unknown disk type
      expect(['good', 'limited']).toContain(result.profile)
    })
    
    it('should cache results', async () => {
      const checker = new HardwareCapabilityChecker()
      
      const result1 = await checker.check()
      const result2 = await checker.getCached()
      
      expect(result1).toEqual(result2)
    })
  })
})



