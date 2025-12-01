/**
 * SidebarManager
 * 
 * Manages the mini-app sidebar panel in the orchestrator.
 * Handles loading templates, rendering mini-apps, and communication
 * between the sidebar and the main orchestrator.
 */

import { EventBus } from './EventBus';

export interface MiniAppConfig {
  id: string;
  name: string;
  templatePath?: string;
  templateText?: string;
  position: 'sidebar' | 'overlay' | 'floating';
  width?: number;
  autoLoad?: boolean;
}

export interface LoadedMiniApp {
  id: string;
  name: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  loadedAt: number;
  config: MiniAppConfig;
}

export interface SidebarState {
  visible: boolean;
  position: 'left' | 'right';
  width: number;
  activeApp: string | null;
  loadedApps: Map<string, LoadedMiniApp>;
}

/**
 * SidebarManager - Coordinates mini-app loading and sidebar state
 */
export class SidebarManager {
  private eventBus: EventBus;
  private state: SidebarState;
  private ipcSender?: (channel: string, data: any) => void;
  
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.state = {
      visible: false,
      position: 'right',
      width: 380,
      activeApp: null,
      loadedApps: new Map()
    };
    
    this.setupEventListeners();
    console.log('[SidebarManager] Initialized');
  }
  
  /**
   * Set the IPC sender function for communicating with renderer
   */
  setIpcSender(sender: (channel: string, data: any) => void): void {
    this.ipcSender = sender;
  }
  
  /**
   * Register a mini-app configuration
   */
  registerMiniApp(config: MiniAppConfig): void {
    console.log(`[SidebarManager] Registering mini-app: ${config.id}`);
    
    const loadedApp: LoadedMiniApp = {
      id: config.id,
      name: config.name,
      status: 'loading',
      loadedAt: Date.now(),
      config
    };
    
    this.state.loadedApps.set(config.id, loadedApp);
    this.eventBus.emit('sidebar:app-registered', config);
    
    if (config.autoLoad) {
      this.loadMiniApp(config.id);
    }
  }
  
  /**
   * Load a mini-app by ID
   */
  async loadMiniApp(appId: string): Promise<void> {
    const app = this.state.loadedApps.get(appId);
    if (!app) {
      throw new Error(`Mini-app not found: ${appId}`);
    }
    
    console.log(`[SidebarManager] Loading mini-app: ${appId}`);
    
    try {
      app.status = 'loading';
      this.notifyRenderer('sidebar:app-loading', { appId });
      
      // Emit event for orchestrator to load template
      if (app.config.templatePath) {
        this.eventBus.emit('sidebar:load-template', app.config.templatePath, appId);
      } else if (app.config.templateText) {
        this.eventBus.emit('sidebar:load-template-text', app.config.templateText, appId);
      }
      
      app.status = 'ready';
      app.loadedAt = Date.now();
      
      this.notifyRenderer('sidebar:app-ready', { appId, app });
      this.eventBus.emit('sidebar:app-loaded', appId);
      
      console.log(`[SidebarManager] ✅ Mini-app loaded: ${appId}`);
      
    } catch (error) {
      app.status = 'error';
      app.error = error instanceof Error ? error.message : String(error);
      
      this.notifyRenderer('sidebar:app-error', { appId, error: app.error });
      this.eventBus.emit('sidebar:app-error', appId, app.error);
      
      console.error(`[SidebarManager] ❌ Failed to load mini-app: ${appId}`, error);
      throw error;
    }
  }
  
  /**
   * Show the sidebar with a specific app
   */
  showSidebar(appId?: string): void {
    console.log(`[SidebarManager] Showing sidebar${appId ? ` with app: ${appId}` : ''}`);
    
    this.state.visible = true;
    
    if (appId && this.state.loadedApps.has(appId)) {
      this.state.activeApp = appId;
    }
    
    this.notifyRenderer('sidebar:show', {
      visible: true,
      activeApp: this.state.activeApp,
      width: this.state.width,
      position: this.state.position
    });
    
    this.eventBus.emit('sidebar:shown', this.state.activeApp);
  }
  
  /**
   * Hide the sidebar
   */
  hideSidebar(): void {
    console.log('[SidebarManager] Hiding sidebar');
    
    this.state.visible = false;
    
    this.notifyRenderer('sidebar:hide', { visible: false });
    this.eventBus.emit('sidebar:hidden');
  }
  
  /**
   * Toggle sidebar visibility
   */
  toggleSidebar(appId?: string): void {
    if (this.state.visible) {
      // If showing same app, hide; otherwise switch apps
      if (!appId || appId === this.state.activeApp) {
        this.hideSidebar();
      } else {
        this.setActiveApp(appId);
      }
    } else {
      this.showSidebar(appId);
    }
  }
  
  /**
   * Set the active mini-app
   */
  setActiveApp(appId: string): void {
    if (!this.state.loadedApps.has(appId)) {
      console.warn(`[SidebarManager] App not found: ${appId}`);
      return;
    }
    
    console.log(`[SidebarManager] Setting active app: ${appId}`);
    this.state.activeApp = appId;
    
    this.notifyRenderer('sidebar:active-app', { appId });
    this.eventBus.emit('sidebar:active-changed', appId);
  }
  
  /**
   * Set sidebar position
   */
  setPosition(position: 'left' | 'right'): void {
    this.state.position = position;
    this.notifyRenderer('sidebar:position', { position });
  }
  
  /**
   * Set sidebar width
   */
  setWidth(width: number): void {
    this.state.width = Math.max(200, Math.min(800, width));
    this.notifyRenderer('sidebar:width', { width: this.state.width });
  }
  
  /**
   * Unload a mini-app
   */
  unloadMiniApp(appId: string): void {
    console.log(`[SidebarManager] Unloading mini-app: ${appId}`);
    
    this.state.loadedApps.delete(appId);
    
    if (this.state.activeApp === appId) {
      // Switch to another app or hide
      const remaining = Array.from(this.state.loadedApps.keys());
      this.state.activeApp = remaining.length > 0 ? remaining[0] : null;
      
      if (!this.state.activeApp) {
        this.hideSidebar();
      }
    }
    
    this.notifyRenderer('sidebar:app-unloaded', { appId });
    this.eventBus.emit('sidebar:app-unloaded', appId);
  }
  
  /**
   * Get current sidebar state
   */
  getState(): SidebarState {
    return { ...this.state };
  }
  
  /**
   * Get loaded mini-app by ID
   */
  getMiniApp(appId: string): LoadedMiniApp | undefined {
    return this.state.loadedApps.get(appId);
  }
  
  /**
   * Get all loaded mini-apps
   */
  getAllMiniApps(): LoadedMiniApp[] {
    return Array.from(this.state.loadedApps.values());
  }
  
  /**
   * Send message to a specific mini-app
   */
  sendToMiniApp(appId: string, message: any): void {
    this.notifyRenderer('sidebar:app-message', { appId, message });
    this.eventBus.emit('sidebar:message-sent', appId, message);
  }
  
  /**
   * Handle message from mini-app (called by IPC handler)
   */
  handleMiniAppMessage(appId: string, message: any): void {
    console.log(`[SidebarManager] Message from ${appId}:`, message);
    this.eventBus.emit('sidebar:message-received', appId, message);
    
    // Handle specific message types
    switch (message.type) {
      case 'ai:request':
        this.eventBus.emit('ai:request', message.prompt, message.context, appId);
        break;
      case 'file:open':
        this.eventBus.emit('file:open', message.path, message.line, appId);
        break;
      case 'action:execute':
        this.eventBus.emit('action:execute', message.action, message.data, appId);
        break;
    }
  }
  
  // Private methods
  
  private setupEventListeners(): void {
    // Listen for template build completion
    this.eventBus.on('template:built', (component, metadata) => {
      console.log('[SidebarManager] Template built, notifying renderer');
      this.notifyRenderer('sidebar:template-built', { metadata });
    });
    
    // Listen for cursor file changes (from file watcher)
    this.eventBus.on('cursor:files-changed', (files) => {
      console.log('[SidebarManager] Cursor files changed:', files);
      this.notifyRenderer('sidebar:cursor-files', { files });
    });
    
    // Listen for AI responses
    this.eventBus.on('ai:response', (response, appId) => {
      this.sendToMiniApp(appId, { type: 'ai:response', result: response });
    });
  }
  
  private notifyRenderer(channel: string, data: any): void {
    if (this.ipcSender) {
      this.ipcSender(channel, data);
    }
    // Also emit on event bus for non-Electron scenarios
    this.eventBus.emit(channel, data);
  }
}

/**
 * Create a pre-configured GlassView mini-app config
 */
export function createGlassViewConfig(): MiniAppConfig {
  return {
    id: 'glassview',
    name: 'GlassView',
    templatePath: 'templates/glassview.template.md',
    position: 'sidebar',
    width: 380,
    autoLoad: true
  };
}
