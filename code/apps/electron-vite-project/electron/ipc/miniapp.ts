/**
 * Mini-App IPC Handlers
 * 
 * Handles IPC communication between the Electron main process
 * and the renderer for mini-app/sidebar functionality.
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Sidebar state
let sidebarVisible = false
let activeAppId: string | null = null
const loadedTemplates = new Map<string, string>()

/**
 * Register all mini-app related IPC handlers
 */
export function registerMiniAppHandlers() {
  console.log('[MiniApp] Registering IPC handlers...')
  
  // ========================================
  // Sidebar Control
  // ========================================
  
  ipcMain.on('sidebar:toggle', (event, appId?: string) => {
    console.log('[MiniApp] Toggle sidebar:', appId)
    sidebarVisible = !sidebarVisible
    if (appId) activeAppId = appId
    
    broadcastToRenderers(sidebarVisible ? 'sidebar:show' : 'sidebar:hide', {
      visible: sidebarVisible,
      activeApp: activeAppId
    })
  })
  
  ipcMain.on('sidebar:show', (event, appId?: string) => {
    console.log('[MiniApp] Show sidebar:', appId)
    sidebarVisible = true
    if (appId) activeAppId = appId
    
    broadcastToRenderers('sidebar:show', {
      visible: true,
      activeApp: activeAppId
    })
  })
  
  ipcMain.on('sidebar:hide', () => {
    console.log('[MiniApp] Hide sidebar')
    sidebarVisible = false
    
    broadcastToRenderers('sidebar:hide', { visible: false })
  })
  
  // ========================================
  // Template Loading
  // ========================================
  
  ipcMain.handle('miniapp:loadTemplate', async (event, templatePath: string) => {
    console.log('[MiniApp] Loading template from path:', templatePath)
    
    try {
      // Try multiple locations
      const searchPaths = [
        templatePath,
        path.join(process.cwd(), templatePath),
        path.join(__dirname, '..', 'templates', path.basename(templatePath)),
        path.join(__dirname, '..', 'public', 'templates', path.basename(templatePath)),
      ]
      
      let templateContent: string | null = null
      let foundPath: string | null = null
      
      for (const searchPath of searchPaths) {
        try {
          if (fs.existsSync(searchPath)) {
            templateContent = fs.readFileSync(searchPath, 'utf-8')
            foundPath = searchPath
            break
          }
        } catch { }
      }
      
      if (!templateContent) {
        throw new Error(`Template not found: ${templatePath}`)
      }
      
      console.log('[MiniApp] Template loaded from:', foundPath)
      loadedTemplates.set(templatePath, templateContent)
      
      // Broadcast to renderers
      broadcastToRenderers('sidebar:template-loaded', {
        template: templateContent,
        path: foundPath
      })
      
      return { success: true, template: templateContent, path: foundPath }
      
    } catch (error) {
      console.error('[MiniApp] Failed to load template:', error)
      return { success: false, error: String(error) }
    }
  })
  
  ipcMain.handle('miniapp:loadTemplateText', async (event, templateText: string) => {
    console.log('[MiniApp] Loading template from text')
    
    try {
      // Broadcast to renderers
      broadcastToRenderers('sidebar:template-loaded', {
        template: templateText,
        path: 'inline'
      })
      
      return { success: true, template: templateText }
      
    } catch (error) {
      console.error('[MiniApp] Failed to load template text:', error)
      return { success: false, error: String(error) }
    }
  })
  
  // ========================================
  // AI Integration (placeholder)
  // ========================================
  
  ipcMain.handle('ai:request', async (event, { prompt, context }) => {
    console.log('[MiniApp] AI request:', prompt?.substring(0, 50))
    
    // TODO: Integrate with actual AI service
    // For now, return a mock response
    return {
      success: true,
      result: `AI analysis for: ${prompt?.substring(0, 100)}...\n\nThis is a placeholder response. Connect to your AI service for real responses.`
    }
  })
  
  // ========================================
  // File Operations
  // ========================================
  
  ipcMain.on('file:open', (event, { path: filePath, line }) => {
    console.log('[MiniApp] Open file:', filePath, 'at line:', line)
    
    try {
      // Try to open in VS Code/Cursor first
      const { exec } = require('child_process')
      const lineArg = line ? `:${line}` : ''
      
      // Try cursor first, then code
      exec(`cursor "${filePath}${lineArg}"`, (err: any) => {
        if (err) {
          exec(`code "${filePath}${lineArg}"`, (err2: any) => {
            if (err2) {
              // Fallback to system default
              shell.openPath(filePath)
            }
          })
        }
      })
    } catch (error) {
      console.error('[MiniApp] Failed to open file:', error)
      // Fallback to system default
      shell.openPath(filePath)
    }
  })
  
  // ========================================
  // Message Routing
  // ========================================
  
  ipcMain.on('sidebar:message', (event, { type, data }) => {
    console.log('[MiniApp] Message from sidebar:', type)
    
    // Route messages based on type
    switch (type) {
      case 'ai:request':
        // Handle AI request (already handled above via invoke)
        break
      case 'file:open':
        // Emit file open event
        ipcMain.emit('file:open', event, data)
        break
      default:
        // Broadcast to other renderers
        broadcastToRenderers('sidebar:app-message', { type, data })
    }
  })
  
  console.log('[MiniApp] ✅ IPC handlers registered')
}

/**
 * Broadcast a message to all renderer windows
 */
function broadcastToRenderers(channel: string, data: any) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    try {
      win.webContents.send(channel, data)
    } catch (err) {
      console.error('[MiniApp] Failed to send to window:', err)
    }
  }
}

/**
 * Get sidebar state
 */
export function getSidebarState() {
  return {
    visible: sidebarVisible,
    activeApp: activeAppId
  }
}

/**
 * Notify sidebar of cursor file changes
 */
export function notifyCursorFilesChanged(files: string[]) {
  console.log('[MiniApp] Cursor files changed:', files.length, 'files')
  broadcastToRenderers('sidebar:cursor-files', { files })
}
