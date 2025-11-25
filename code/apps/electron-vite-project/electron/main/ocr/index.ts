/**
 * OCR Module Entry Point
 * Exports all OCR functionality
 */

export * from './types'
export { ocrService, OCRService } from './ocr-service'
export { ocrRouter, OCRRouter } from './router'
export { registerOCRHandlers, unregisterOCRHandlers } from './ipc'

