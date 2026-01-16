/**
 * Delivery Service
 * 
 * Handles external delivery of BEAP packages:
 * - Email delivery via connected accounts
 * - Messenger insertion (copy to clipboard or inject)
 * - Download (file, USB, wallet, offline)
 * 
 * INVARIANTS:
 * - External delivery is ONLY available in Drafts
 * - WR Chat uses Silent Mode (inline capsules only)
 * 
 * @version 1.0.0
 */

import type { DeliveryConfig, DeliveryMethod, BeapBuildResult } from './types'
import { usePackageStore } from '../packages/usePackageStore'

// =============================================================================
// Delivery Result
// =============================================================================

export interface DeliveryResult {
  success: boolean
  method: DeliveryMethod
  packageId: string
  error?: string
  details?: {
    emailMessageId?: string
    downloadUrl?: string
    clipboardCopied?: boolean
  }
}

// =============================================================================
// Email Delivery
// =============================================================================

async function sendViaEmail(
  packageId: string,
  capsuleRef: string,
  config: NonNullable<DeliveryConfig['email']>,
  subject: string,
  body: string
): Promise<DeliveryResult> {
  try {
    // Send message to background script
    const response = await chrome.runtime.sendMessage({
      type: 'BEAP_SEND_EMAIL',
      payload: {
        packageId,
        capsuleRef,
        accountId: config.accountId,
        to: config.to,
        cc: config.cc || [],
        bcc: config.bcc || [],
        subject,
        body,
        // Attach the BEAP capsule as an encrypted payload
        attachments: [{
          filename: `beap-package-${packageId.slice(0, 8)}.beap`,
          contentType: 'application/x-beap+encrypted',
          data: capsuleRef
        }]
      }
    })
    
    if (response?.success) {
      return {
        success: true,
        method: 'email',
        packageId,
        details: {
          emailMessageId: response.messageId
        }
      }
    } else {
      return {
        success: false,
        method: 'email',
        packageId,
        error: response?.error || 'Failed to send email'
      }
    }
  } catch (error) {
    console.error('[DeliveryService] Email send error:', error)
    return {
      success: false,
      method: 'email',
      packageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// =============================================================================
// Messenger Delivery
// =============================================================================

async function sendViaMessenger(
  packageId: string,
  capsuleRef: string,
  config: NonNullable<DeliveryConfig['messenger']>,
  subject: string
): Promise<DeliveryResult> {
  try {
    // Create a shareable BEAP link
    const beapLink = `beap://${packageId}/${capsuleRef.slice(0, 16)}`
    const messageText = `📦 BEAP™ Package: ${subject}\n\n${beapLink}\n\n(Open with WRCode extension to decrypt)`
    
    if (config.insertMethod === 'copy') {
      // Copy to clipboard
      await navigator.clipboard.writeText(messageText)
      
      // Show notification
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon128.png',
          title: 'BEAP Package Ready',
          message: `Package link copied! Paste into ${config.platform} to share.`
        })
      }
      
      return {
        success: true,
        method: 'messenger',
        packageId,
        details: {
          clipboardCopied: true
        }
      }
    } else {
      // Direct inject - send message to content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs[0]?.id) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'BEAP_INJECT_MESSAGE',
          payload: {
            platform: config.platform,
            text: messageText
          }
        })
      }
      
      return {
        success: true,
        method: 'messenger',
        packageId
      }
    }
  } catch (error) {
    console.error('[DeliveryService] Messenger send error:', error)
    return {
      success: false,
      method: 'messenger',
      packageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// =============================================================================
// Download Delivery
// =============================================================================

async function sendViaDownload(
  packageId: string,
  capsuleRef: string,
  config: NonNullable<DeliveryConfig['download']>,
  subject: string,
  body: string
): Promise<DeliveryResult> {
  try {
    // Create package data blob
    const packageData = {
      version: '1.0',
      packageId,
      capsuleRef,
      subject,
      body,
      format: config.format,
      createdAt: Date.now()
    }
    
    const blob = new Blob([JSON.stringify(packageData, null, 2)], {
      type: 'application/json'
    })
    
    const filename = config.filename || `beap-package-${packageId.slice(0, 8)}.beap`
    
    // Create download URL
    const url = URL.createObjectURL(blob)
    
    // Trigger download
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    
    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    
    return {
      success: true,
      method: 'download',
      packageId,
      details: {
        downloadUrl: url
      }
    }
  } catch (error) {
    console.error('[DeliveryService] Download error:', error)
    return {
      success: false,
      method: 'download',
      packageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// =============================================================================
// Main Delivery Function
// =============================================================================

/**
 * Deliver a BEAP package via the specified method
 * 
 * @param buildResult - Result from BEAP Builder
 * @param config - Delivery configuration
 * @param subject - Package subject
 * @param body - Package body
 * @returns Delivery result
 */
export async function deliverPackage(
  buildResult: BeapBuildResult,
  config: DeliveryConfig,
  subject: string,
  body: string
): Promise<DeliveryResult> {
  if (!buildResult.success || !buildResult.packageId || !buildResult.capsuleRef) {
    return {
      success: false,
      method: config.method,
      packageId: buildResult.packageId || 'unknown',
      error: 'Invalid build result'
    }
  }
  
  const { packageId, capsuleRef } = buildResult
  
  // Update package status to outbox
  usePackageStore.getState().updatePackageStatus(packageId, 'outbox')
  
  let result: DeliveryResult
  
  switch (config.method) {
    case 'email':
      if (!config.email) {
        return {
          success: false,
          method: 'email',
          packageId,
          error: 'Email configuration missing'
        }
      }
      result = await sendViaEmail(packageId, capsuleRef, config.email, subject, body)
      break
      
    case 'messenger':
      if (!config.messenger) {
        return {
          success: false,
          method: 'messenger',
          packageId,
          error: 'Messenger configuration missing'
        }
      }
      result = await sendViaMessenger(packageId, capsuleRef, config.messenger, subject)
      break
      
    case 'download':
      if (!config.download) {
        return {
          success: false,
          method: 'download',
          packageId,
          error: 'Download configuration missing'
        }
      }
      result = await sendViaDownload(packageId, capsuleRef, config.download, subject, body)
      break
      
    default:
      return {
        success: false,
        method: config.method,
        packageId,
        error: 'Unknown delivery method'
      }
  }
  
  // Update package status based on result
  if (result.success) {
    // Keep in outbox until confirmation (for email) or mark executed (for download)
    if (config.method === 'download') {
      usePackageStore.getState().updatePackageStatus(packageId, 'executed')
    }
  } else {
    // Revert to draft on failure
    usePackageStore.getState().updatePackageStatus(packageId, 'draft')
  }
  
  return result
}

/**
 * Create delivery event for tracking
 */
export function createDeliveryEvent(
  packageId: string,
  method: DeliveryMethod,
  result: DeliveryResult
): void {
  // Log delivery event
  console.log('[DeliveryService] Delivery event:', {
    packageId,
    method,
    success: result.success,
    timestamp: Date.now()
  })
  
  // Could be extended to store in a delivery events log
}



