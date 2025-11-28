/**
 * Template Loader Service
 * 
 * Loads and manages GlassView templates in the Electron orchestrator.
 * Watches template files for changes and hot-reloads.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as chokidar from 'chokidar';

export interface TemplateInfo {
  name: string;
  path: string;
  content: string;
  lastModified: Date;
}

export class TemplateLoader {
  private templatesDir: string;
  private templates: Map<string, TemplateInfo> = new Map();
  private watcher: chokidar.FSWatcher | null = null;
  private onTemplateChange?: (templateInfo: TemplateInfo) => void;

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
  }

  /**
   * Initialize template loader and start watching
   */
  async initialize(): Promise<void> {
    try {
      console.log('[TemplateLoader] Initializing with directory:', this.templatesDir);
      
      // Ensure templates directory exists
      await fs.mkdir(this.templatesDir, { recursive: true });

      // Load all existing templates
      await this.loadAllTemplates();

      // Start watching for changes
      this.startWatching();

      console.log(`[TemplateLoader] Initialized with ${this.templates.size} templates`);
      console.log('[TemplateLoader] Template names:', Array.from(this.templates.keys()));
    } catch (error) {
      console.error('[TemplateLoader] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Load all templates from directory
   */
  private async loadAllTemplates(): Promise<void> {
    try {
      const files = await fs.readdir(this.templatesDir);
      
      for (const file of files) {
        if (file.endsWith('.template.md') || file.endsWith('.template.yaml')) {
          await this.loadTemplate(file);
        }
      }
    } catch (error) {
      console.error('[TemplateLoader] Failed to load templates:', error);
    }
  }

  /**
   * Load a single template file
   */
  private async loadTemplate(filename: string): Promise<TemplateInfo | null> {
    const templatePath = path.join(this.templatesDir, filename);

    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      const stats = await fs.stat(templatePath);

      const templateInfo: TemplateInfo = {
        name: filename.replace(/\.template\.(md|yaml)$/, ''),
        path: templatePath,
        content,
        lastModified: stats.mtime
      };

      this.templates.set(templateInfo.name, templateInfo);
      console.log(`[TemplateLoader] Loaded template: ${templateInfo.name}`);

      return templateInfo;
    } catch (error) {
      console.error(`[TemplateLoader] Failed to load template ${filename}:`, error);
      return null;
    }
  }

  /**
   * Start watching templates directory for changes
   */
  private startWatching(): void {
    this.watcher = chokidar.watch(
      [
        path.join(this.templatesDir, '*.template.md'),
        path.join(this.templatesDir, '*.template.yaml')
      ],
      {
        ignoreInitial: true,
        persistent: true
      }
    );

    this.watcher.on('add', async (filePath) => {
      const filename = path.basename(filePath);
      console.log(`[TemplateLoader] New template detected: ${filename}`);
      
      const templateInfo = await this.loadTemplate(filename);
      if (templateInfo && this.onTemplateChange) {
        this.onTemplateChange(templateInfo);
      }
    });

    this.watcher.on('change', async (filePath) => {
      const filename = path.basename(filePath);
      console.log(`[TemplateLoader] Template changed: ${filename}`);
      
      const templateInfo = await this.loadTemplate(filename);
      if (templateInfo && this.onTemplateChange) {
        this.onTemplateChange(templateInfo);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      const filename = path.basename(filePath);
      const templateName = filename.replace(/\.template\.(md|yaml)$/, '');
      
      console.log(`[TemplateLoader] Template removed: ${templateName}`);
      this.templates.delete(templateName);
    });

    console.log('[TemplateLoader] File watching started');
  }

  /**
   * Get a template by name
   */
  getTemplate(name: string): TemplateInfo | undefined {
    return this.templates.get(name);
  }

  /**
   * Get all loaded templates
   */
  getAllTemplates(): TemplateInfo[] {
    return Array.from(this.templates.values());
  }

  /**
   * Set callback for template changes
   */
  onTemplateChanged(callback: (templateInfo: TemplateInfo) => void): void {
    this.onTemplateChange = callback;
  }

  /**
   * Stop watching and cleanup
   */
  async cleanup(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.templates.clear();
    console.log('[TemplateLoader] Cleaned up');
  }
}

/**
 * Create template loader instance
 */
export function createTemplateLoader(templatesDir: string): TemplateLoader {
  return new TemplateLoader(templatesDir);
}
