/**
 * Orchestrator Core
 * 
 * Central coordinator for the template-driven app creation system.
 * Manages template loading, parsing, building, and communication with Electron.
 */

import { readFile, watch, existsSync } from 'fs';
import { promisify } from 'util';
import { resolve, dirname } from 'path';
import * as chokidar from 'chokidar';
import { buildFromTemplate, validateTemplate, TemplateAST, BuildResult } from '@optimandoai/code-block-library';
import { EventBus } from './EventBus';

const readFileAsync = promisify(readFile);

export interface OrchestratorConfig {
  templateDir?: string;
  enableFileWatching?: boolean;
  enableHotReload?: boolean;
  cachingEnabled?: boolean;
  debugMode?: boolean;
  electronMain?: any; // Electron main process instance
}

export interface TemplateCache {
  filePath: string;
  content: string;
  ast: TemplateAST;
  lastModified: number;
  buildResult?: BuildResult;
}

export interface LoadedTemplate {
  id: string;
  name: string;
  filePath: string;
  ast: TemplateAST;
  buildResult: BuildResult;
  lastLoaded: number;
}

/**
 * Main Orchestrator class that coordinates template-based app creation
 */
export class Orchestrator {
  private config: Required<OrchestratorConfig>;
  private eventBus: EventBus;
  private templateCache: Map<string, TemplateCache> = new Map();
  private loadedTemplates: Map<string, LoadedTemplate> = new Map();
  private fileWatcher?: chokidar.FSWatcher;
  private ipcHandlers: Map<string, Function> = new Map();
  
  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      templateDir: config.templateDir || './templates',
      enableFileWatching: config.enableFileWatching ?? true,
      enableHotReload: config.enableHotReload ?? true,
      cachingEnabled: config.cachingEnabled ?? true,
      debugMode: config.debugMode ?? false,
      electronMain: config.electronMain || null
    };
    
    this.eventBus = new EventBus(this.config.debugMode);
    this.setupEventListeners();
    
    if (this.config.debugMode) {
      console.log('[Orchestrator] Initialized with config:', this.config);
    }
  }
  
  /**
   * Initialize the orchestrator and start watching templates
   */
  async initialize(): Promise<void> {
    console.log('[Orchestrator] Initializing...');
    
    try {
      // Set up IPC handlers if Electron is available
      if (this.config.electronMain) {
        this.setupElectronIPC();
      }
      
      // Start watching template files
      if (this.config.enableFileWatching) {
        await this.startFileWatching();
      }
      
      // Preload templates from template directory
      if (existsSync(this.config.templateDir)) {
        await this.preloadTemplates();
      }
      
      this.eventBus.emit('app:ready');
      console.log('[Orchestrator] ✅ Initialized successfully');
      
    } catch (error) {
      console.error('[Orchestrator] ❌ Initialization failed:', error);
      this.eventBus.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
  
  /**
   * Load a template from file path
   */
  async loadTemplate(filePath: string): Promise<BuildResult> {
    const absolutePath = resolve(filePath);
    console.log(`[Orchestrator] Loading template: ${absolutePath}`);
    
    try {
      // Check cache first
      if (this.config.cachingEnabled && this.templateCache.has(absolutePath)) {
        const cached = this.templateCache.get(absolutePath)!;
        const stats = await this.getFileStats(absolutePath);
        
        if (stats && cached.lastModified >= stats.mtime.getTime()) {
          console.log(`[Orchestrator] ✅ Using cached template: ${absolutePath}`);
          
          if (cached.buildResult) {
            return cached.buildResult;
          }
        }
      }
      
      // Load from file
      const content = await readFileAsync(absolutePath, 'utf-8');
      this.eventBus.emit('template:loaded', content, absolutePath);
      
      // Build template
      const buildResult = buildFromTemplate(content);
      
      if (buildResult.metadata.errors.length > 0) {
        const errorMsg = `Template build failed: ${buildResult.metadata.errors.join(', ')}`;
        this.eventBus.emit('template:error', errorMsg, absolutePath);
        throw new Error(errorMsg);
      }
      
      // Cache the result
      if (this.config.cachingEnabled) {
        const stats = await this.getFileStats(absolutePath);
        this.templateCache.set(absolutePath, {
          filePath: absolutePath,
          content,
          ast: buildResult.ast!,
          lastModified: stats ? stats.mtime.getTime() : Date.now(),
          buildResult
        });
      }
      
      // Store as loaded template
      const templateId = this.generateTemplateId(absolutePath);
      this.loadedTemplates.set(templateId, {
        id: templateId,
        name: buildResult.ast?.name || 'Unknown',
        filePath: absolutePath,
        ast: buildResult.ast!,
        buildResult,
        lastLoaded: Date.now()
      });
      
      this.eventBus.emit('template:built', buildResult.Component, buildResult.metadata);
      console.log(`[Orchestrator] ✅ Template loaded successfully: ${buildResult.ast?.name}`);
      
      return buildResult;
      
    } catch (error) {
      const errorMsg = `Failed to load template: ${error}`;
      console.error(`[Orchestrator] ❌ ${errorMsg}`);
      this.eventBus.emit('template:error', errorMsg, absolutePath);
      throw error;
    }
  }
  
  /**
   * Load template from text content (for testing/development)
   */
  loadTemplateFromText(content: string, source: string = 'text'): BuildResult {
    console.log(`[Orchestrator] Loading template from text: ${source}`);
    
    try {
      const buildResult = buildFromTemplate(content);
      
      if (buildResult.metadata.errors.length > 0) {
        const errorMsg = `Template build failed: ${buildResult.metadata.errors.join(', ')}`;
        this.eventBus.emit('template:error', errorMsg, source);
        throw new Error(errorMsg);
      }
      
      this.eventBus.emit('template:loaded', content, source);
      this.eventBus.emit('template:built', buildResult.Component, buildResult.metadata);
      
      console.log(`[Orchestrator] ✅ Template loaded from text: ${buildResult.ast?.name}`);
      return buildResult;
      
    } catch (error) {
      const errorMsg = `Failed to load template from text: ${error}`;
      console.error(`[Orchestrator] ❌ ${errorMsg}`);
      this.eventBus.emit('template:error', errorMsg, source);
      throw error;
    }
  }
  
  /**
   * Get a loaded template by ID or file path
   */
  getLoadedTemplate(idOrPath: string): LoadedTemplate | null {
    // Try by ID first
    if (this.loadedTemplates.has(idOrPath)) {
      return this.loadedTemplates.get(idOrPath)!;
    }
    
    // Try by file path
    const absolutePath = resolve(idOrPath);
    for (const template of this.loadedTemplates.values()) {
      if (template.filePath === absolutePath) {
        return template;
      }
    }
    
    return null;
  }
  
  /**
   * Get all loaded templates
   */
  getAllLoadedTemplates(): LoadedTemplate[] {
    return Array.from(this.loadedTemplates.values());
  }
  
  /**
   * Clear template cache
   */
  clearCache(): void {
    console.log('[Orchestrator] Clearing template cache');
    this.templateCache.clear();
    this.loadedTemplates.clear();
  }
  
  /**
   * Send template to renderer process (Electron IPC)
   */
  async sendTemplateToRenderer(templatePath: string, windowId?: string): Promise<void> {
    if (!this.config.electronMain) {
      throw new Error('Electron main process not available');
    }
    
    try {
      const buildResult = await this.loadTemplate(templatePath);
      
      // Send to specific window or all windows
      const message = {
        type: 'template:load',
        template: buildResult.ast,
        buildResult: {
          ...buildResult,
          Component: null // Can't serialize React component over IPC
        },
        source: templatePath
      };
      
      if (windowId) {
        // Send to specific window
        const window = this.config.electronMain.BrowserWindow.fromId(parseInt(windowId));
        if (window) {
          window.webContents.send('orchestrator:message', message);
        }
      } else {
        // Send to all windows
        for (const window of this.config.electronMain.BrowserWindow.getAllWindows()) {
          window.webContents.send('orchestrator:message', message);
        }
      }
      
      this.eventBus.emit('ipc:message', 'template:load', message);
      console.log(`[Orchestrator] ✅ Template sent to renderer: ${templatePath}`);
      
    } catch (error) {
      console.error(`[Orchestrator] ❌ Failed to send template to renderer:`, error);
      throw error;
    }
  }
  
  /**
   * Shutdown orchestrator and cleanup resources
   */
  async shutdown(): Promise<void> {
    console.log('[Orchestrator] Shutting down...');
    
    this.eventBus.emit('app:shutdown');
    
    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }
    
    this.clearCache();
    this.eventBus.destroy();
    
    console.log('[Orchestrator] ✅ Shutdown complete');
  }
  
  /**
   * Get orchestrator status and statistics
   */
  getStatus() {
    return {
      initialized: true,
      templateDir: this.config.templateDir,
      fileWatching: this.config.enableFileWatching,
      hotReload: this.config.enableHotReload,
      caching: this.config.cachingEnabled,
      
      // Statistics
      cachedTemplates: this.templateCache.size,
      loadedTemplates: this.loadedTemplates.size,
      eventListeners: this.eventBus.getListenerInfo(),
      
      // Recent activity
      recentTemplates: Array.from(this.loadedTemplates.values())
        .sort((a, b) => b.lastLoaded - a.lastLoaded)
        .slice(0, 5)
        .map(t => ({ id: t.id, name: t.name, lastLoaded: t.lastLoaded }))
    };
  }
  
  /**
   * Get event bus for external listeners
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }
  
  // Private methods
  
  private setupEventListeners(): void {
    this.eventBus.on('template:error', (error, source) => {
      console.error(`[Orchestrator] Template error in ${source}:`, error);
    });
    
    this.eventBus.on('error', (error, context) => {
      console.error('[Orchestrator] General error:', error, context);
    });
  }
  
  private async startFileWatching(): Promise<void> {
    if (!existsSync(this.config.templateDir)) {
      console.warn(`[Orchestrator] Template directory does not exist: ${this.config.templateDir}`);
      return;
    }
    
    console.log(`[Orchestrator] Starting file watcher: ${this.config.templateDir}`);
    
    this.fileWatcher = chokidar.watch(
      [
        `${this.config.templateDir}/**/*.template`,
        `${this.config.templateDir}/**/*.yaml`,
        `${this.config.templateDir}/**/*.yml`
      ],
      {
        persistent: true,
        ignoreInitial: false,
        followSymlinks: false
      }
    );
    
    this.fileWatcher.on('add', (filePath) => {
      console.log(`[Orchestrator] Template file added: ${filePath}`);
      this.eventBus.emit('file:added', filePath);
      
      if (this.config.enableHotReload) {
        this.handleFileChange(filePath);
      }
    });
    
    this.fileWatcher.on('change', (filePath) => {
      console.log(`[Orchestrator] Template file changed: ${filePath}`);
      this.eventBus.emit('file:changed', filePath);
      
      if (this.config.enableHotReload) {
        this.handleFileChange(filePath);
      }
    });
    
    this.fileWatcher.on('unlink', (filePath) => {
      console.log(`[Orchestrator] Template file removed: ${filePath}`);
      this.eventBus.emit('file:removed', filePath);
      
      // Remove from cache
      this.templateCache.delete(filePath);
    });
  }
  
  private async handleFileChange(filePath: string): Promise<void> {
    try {
      // Remove from cache to force reload
      if (this.templateCache.has(filePath)) {
        this.templateCache.delete(filePath);
      }
      
      // Reload template
      await this.loadTemplate(filePath);
      
      // Send to renderer if Electron is available
      if (this.config.electronMain) {
        await this.sendTemplateToRenderer(filePath);
      }
      
    } catch (error) {
      console.error(`[Orchestrator] ❌ Failed to handle file change: ${filePath}`, error);
    }
  }
  
  private async preloadTemplates(): Promise<void> {
    console.log(`[Orchestrator] Preloading templates from: ${this.config.templateDir}`);
    
    // This would use fs.readdir to scan for .template files
    // Implementation depends on your template file structure
  }
  
  private setupElectronIPC(): void {
    const { ipcMain } = this.config.electronMain;
    
    // Handle template load requests
    ipcMain.handle('orchestrator:loadTemplate', async (event, filePath: string) => {
      try {
        const result = await this.loadTemplate(filePath);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
    
    // Handle template validation
    ipcMain.handle('orchestrator:validateTemplate', async (event, content: string) => {
      try {
        const validation = validateTemplate(content);
        return { success: true, validation };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
    
    console.log('[Orchestrator] ✅ Electron IPC handlers set up');
  }
  
  private generateTemplateId(filePath: string): string {
    const name = filePath.split('/').pop()?.replace(/\.(template|yaml|yml)$/, '') || 'unknown';
    return `${name}-${Date.now()}`;
  }
  
  private async getFileStats(filePath: string): Promise<any> {
    try {
      const fs = await import('fs');
      const stats = await fs.promises.stat(filePath);
      return stats;
    } catch {
      return null;
    }
  }
}