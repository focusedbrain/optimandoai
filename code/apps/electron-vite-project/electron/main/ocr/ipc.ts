/**
 * OCR IPC Handlers
 * Exposes OCR functionality to the renderer process
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { ocrService } from './ocr-service'
import { ocrRouter } from './router'
import { OCROptions, OCRInput, CloudAIConfig } from './types'

/**
 * Register OCR IPC handlers
 */
export function registerOCRHandlers(): void {
  console.log('[OCR IPC] Registering handlers...')

  // Process image with OCR (smart routing)
  ipcMain.handle('ocr:processImage', async (
    _event: IpcMainInvokeEvent,
    input: OCRInput,
    options?: OCROptions
  ) => {
    try {
      console.log('[OCR IPC] Processing image:', { inputType: input.type, options })
      const result = await ocrRouter.processImage(input, options)
      console.log('[OCR IPC] Result:', { 
        textLength: result.text.length, 
        method: result.method,
        confidence: result.confidence 
      })
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[OCR IPC] Error processing image:', error)
      return { ok: false, error: error.message }
    }
  })

  // Process screenshot file
  ipcMain.handle('ocr:processScreenshot', async (
    _event: IpcMainInvokeEvent,
    filePath: string,
    options?: OCROptions
  ) => {
    try {
      console.log('[OCR IPC] Processing screenshot:', filePath)
      const result = await ocrRouter.processImage(
        { type: 'path', filePath },
        options
      )
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[OCR IPC] Error processing screenshot:', error)
      return { ok: false, error: error.message }
    }
  })

  // Process base64 image
  ipcMain.handle('ocr:processBase64', async (
    _event: IpcMainInvokeEvent,
    base64Data: string,
    options?: OCROptions
  ) => {
    try {
      console.log('[OCR IPC] Processing base64 image')
      const result = await ocrRouter.processImage(
        { type: 'base64', data: base64Data },
        options
      )
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[OCR IPC] Error processing base64:', error)
      return { ok: false, error: error.message }
    }
  })

  // Process data URL
  ipcMain.handle('ocr:processDataUrl', async (
    _event: IpcMainInvokeEvent,
    dataUrl: string,
    options?: OCROptions
  ) => {
    try {
      console.log('[OCR IPC] Processing data URL')
      const result = await ocrRouter.processImage(
        { type: 'dataUrl', dataUrl },
        options
      )
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[OCR IPC] Error processing data URL:', error)
      return { ok: false, error: error.message }
    }
  })

  // Get OCR service status
  ipcMain.handle('ocr:getStatus', async () => {
    try {
      const status = ocrService.getStatus()
      const availableProviders = ocrRouter.getAvailableProviders()
      return { 
        ok: true, 
        data: { 
          ...status, 
          cloudAvailable: availableProviders.length > 0,
          availableProviders 
        } 
      }
    } catch (error: any) {
      console.error('[OCR IPC] Error getting status:', error)
      return { ok: false, error: error.message }
    }
  })

  // Get supported languages
  ipcMain.handle('ocr:getLanguages', async () => {
    try {
      const languages = ocrService.getSupportedLanguages()
      return { ok: true, data: languages }
    } catch (error: any) {
      console.error('[OCR IPC] Error getting languages:', error)
      return { ok: false, error: error.message }
    }
  })

  // Update cloud AI configuration
  ipcMain.handle('ocr:setCloudConfig', async (
    _event: IpcMainInvokeEvent,
    config: CloudAIConfig
  ) => {
    try {
      console.log('[OCR IPC] Updating cloud config')
      ocrRouter.setCloudConfig(config)
      return { ok: true }
    } catch (error: any) {
      console.error('[OCR IPC] Error setting cloud config:', error)
      return { ok: false, error: error.message }
    }
  })

  // Check routing decision (for UI preview)
  ipcMain.handle('ocr:checkRouting', async (
    _event: IpcMainInvokeEvent,
    options?: OCROptions
  ) => {
    try {
      const decision = ocrRouter.shouldUseCloud(options)
      return { ok: true, data: decision }
    } catch (error: any) {
      console.error('[OCR IPC] Error checking routing:', error)
      return { ok: false, error: error.message }
    }
  })

  // Initialize OCR with specific language
  ipcMain.handle('ocr:initialize', async (
    _event: IpcMainInvokeEvent,
    language?: string
  ) => {
    try {
      console.log('[OCR IPC] Initializing with language:', language || 'eng')
      await ocrService.initialize(language as any || 'eng')
      return { ok: true }
    } catch (error: any) {
      console.error('[OCR IPC] Error initializing:', error)
      return { ok: false, error: error.message }
    }
  })

  // Terminate OCR worker
  ipcMain.handle('ocr:terminate', async () => {
    try {
      console.log('[OCR IPC] Terminating worker')
      await ocrService.terminate()
      return { ok: true }
    } catch (error: any) {
      console.error('[OCR IPC] Error terminating:', error)
      return { ok: false, error: error.message }
    }
  })

  console.log('[OCR IPC] Handlers registered successfully')
}

/**
 * Unregister OCR IPC handlers (for cleanup)
 */
export function unregisterOCRHandlers(): void {
  const handlers = [
    'ocr:processImage',
    'ocr:processScreenshot',
    'ocr:processBase64',
    'ocr:processDataUrl',
    'ocr:getStatus',
    'ocr:getLanguages',
    'ocr:setCloudConfig',
    'ocr:checkRouting',
    'ocr:initialize',
    'ocr:terminate'
  ]

  handlers.forEach(channel => {
    ipcMain.removeHandler(channel)
  })

  console.log('[OCR IPC] Handlers unregistered')
}

