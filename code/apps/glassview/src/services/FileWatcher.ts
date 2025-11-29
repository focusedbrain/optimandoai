import EventEmitter from 'eventemitter3';
// Minimal path helpers for browser
function basename(p: string): string {
  const idx = p.replace(/\\/g, '/').lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}
function extname(p: string): string {
  const b = basename(p);
  const dot = b.lastIndexOf('.');
  return dot >= 0 ? b.slice(dot) : '';
}
function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map(s => s.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/');
}

export interface ReviewFile {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  lastModified: Date;
  size: number;
  type: 'review' | 'cursorrules' | 'diff';
}

export interface CodeHunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  addedLines: string[];
  deletedLines: string[];
  contextLines: string[];
  changeType: 'added' | 'deleted' | 'modified';
  reviewId: string;
}

export interface FileWatcherEvents {
  'file-added': (file: ReviewFile) => void;
  'file-changed': (file: ReviewFile) => void;
  'file-deleted': (filePath: string) => void;
  'code-hunks-updated': (hunks: CodeHunk[]) => void;
  'error': (error: Error) => void;
}

declare interface FileWatcher {
  on<U extends keyof FileWatcherEvents>(event: U, listener: FileWatcherEvents[U]): this;
  emit<U extends keyof FileWatcherEvents>(event: U, ...args: Parameters<FileWatcherEvents[U]>): boolean;
}

class FileWatcher extends EventEmitter {
  private watchers: Map<string, any> = new Map();
  private watchedFiles: Map<string, ReviewFile> = new Map();
  private isWatching: boolean = false;

  constructor() {
    super();
  }

  /**
   * Start watching a directory for review files
   */
  async startWatching(directoryPath: string): Promise<void> {
    try {
      // Check if directory exists
      // Browser environment: we cannot access Node fs API.
      // Assume directory path is valid and simulate initial scan.

      this.isWatching = true;
      
      // Initial scan of existing files
      await this.scanDirectory(directoryPath);

      // Set up file system watcher
      // In browser, no native fs watcher; set up a simple polling simulation
      const pollInterval = setInterval(() => {
        this.refreshDirectory(directoryPath).catch(() => {});
      }, 1500);

      this.watchers.set(directoryPath, { interval: pollInterval });

      console.log(`FileWatcher: Started watching ${directoryPath}`);
      
    } catch (error) {
      this.emit('error', new Error(`Failed to start watching ${directoryPath}: ${error.message}`));
    }
  }

  /**
   * Stop watching a specific directory
   */
  stopWatching(directoryPath: string): void {
    const watcher = this.watchers.get(directoryPath);
    if (watcher) {
      if (watcher.interval) {
        clearInterval(watcher.interval);
      }
      this.watchers.delete(directoryPath);
      console.log(`FileWatcher: Stopped watching ${directoryPath}`);
    }
  }

  /**
   * Stop watching all directories
   */
  stopAll(): void {
    this.watchers.forEach((watcher, path) => {
      if (watcher.interval) {
        clearInterval(watcher.interval);
      }
      console.log(`FileWatcher: Stopped watching ${path}`);
    });
    this.watchers.clear();
    this.watchedFiles.clear();
    this.isWatching = false;
  }

  /**
   * Get all currently watched files
   */
  getWatchedFiles(): ReviewFile[] {
    return Array.from(this.watchedFiles.values());
  }

  /**
   * Get a specific file by path
   */
  getFile(filePath: string): ReviewFile | undefined {
    return this.watchedFiles.get(filePath);
  }

  /**
   * Manually refresh a directory
   */
  async refreshDirectory(directoryPath: string): Promise<void> {
    if (this.watchers.has(directoryPath)) {
      await this.scanDirectory(directoryPath);
    }
  }

  /**
   * Initial scan of directory to find existing files
   */
  private async scanDirectory(directoryPath: string): Promise<void> {
    try {
      // Browser: cannot read real filesystem; simulate reading known demo files
      const entries = [
        { name: 'live-demo.md', isFile: () => true, isDirectory: () => false },
        { name: 'performance-review.md', isFile: () => true, isDirectory: () => false },
        { name: 'refactor-suggestions.md', isFile: () => true, isDirectory: () => false },
        { name: 'security-review.md', isFile: () => true, isDirectory: () => false },
      ] as any[];
      
      for (const entry of entries) {
        const fullPath = join(directoryPath, entry.name);
        
        if (entry.isFile() && this.isReviewFile(entry.name)) {
          await this.processFile(fullPath);
        } else if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectory(fullPath);
        }
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to scan directory ${directoryPath}: ${error.message}`));
    }
  }

  /**
   * Handle file system events
   */
  private async handleFileEvent(eventType: string, filePath: string): Promise<void> {
    try {
      const fileName = basename(filePath);
      
      if (!this.isReviewFile(fileName)) {
        return; // Ignore non-review files
      }

      await this.processFile(filePath);
    } catch (error) {
      this.emit('error', new Error(`Failed to handle file event for ${filePath}: ${error.message}`));
    }
  }

  /**
   * Process a file (read and parse it)
   */
  private async processFile(filePath: string): Promise<void> {
    try {
      // Browser: synthesize content based on filename
      const now = new Date();
      const content = this.generateMockContentFor(filePath);
      
      const reviewFile: ReviewFile = {
        id: this.generateFileId(filePath),
        filePath,
        fileName: basename(filePath),
        content,
        lastModified: now,
        size: content.length,
        type: this.getFileType(basename(filePath)),
      };

      const isNewFile = !this.watchedFiles.has(filePath);
      const existingFile = this.watchedFiles.get(filePath);
      
      // Check if content actually changed
      if (existingFile && existingFile.content === content) {
        return; // No content change, skip processing
      }

      this.watchedFiles.set(filePath, reviewFile);

      if (isNewFile) {
        this.emit('file-added', reviewFile);
        console.log(`FileWatcher: New file detected: ${reviewFile.fileName}`);
      } else {
        this.emit('file-changed', reviewFile);
        console.log(`FileWatcher: File changed: ${reviewFile.fileName}`);
      }

      // Extract and emit code hunks if it's a diff/review file
      if (reviewFile.type === 'review' || reviewFile.type === 'diff') {
        const codeHunks = this.extractCodeHunks(reviewFile);
        if (codeHunks.length > 0) {
          this.emit('code-hunks-updated', codeHunks);
        }
      }

    } catch (error) {
      this.emit('error', new Error(`Failed to process file ${filePath}: ${error.message}`));
    }
  }

  private generateMockContentFor(filePath: string): string {
    const name = basename(filePath).toLowerCase();
    if (name.includes('live-demo')) {
      return '# Live Demo\n\nsecurity vulnerability: SQL injection risk\n@@ diff hunk\n- const query = "SELECT * FROM users WHERE id = " + userInput\n+ const query = "SELECT * FROM users WHERE id = ?"';
    }
    if (name.includes('performance')) {
      return '# Performance Review\n\noptimization: slow query detected\n@@ diff hunk\n- N+1 queries\n+ batched queries';
    }
    if (name.includes('refactor')) {
      return '# Refactor Suggestions\n\nrefactor: cleanup and restructure';
    }
    if (name.includes('security')) {
      return '# Security Review\n\nvulnerability: weak auth flow';
    }
    return '# General Review\n\nnotes: documentation update';
  }

  /**
   * Handle file deletion
   */
  private handleFileDeleted(filePath: string): void {
    if (this.watchedFiles.has(filePath)) {
      this.watchedFiles.delete(filePath);
      this.emit('file-deleted', filePath);
      console.log(`FileWatcher: File deleted: ${basename(filePath)}`);
    }
  }

  /**
   * Check if a file is a review file we care about
   */
  private isReviewFile(fileName: string): boolean {
    const ext = extname(fileName).toLowerCase();
    const name = basename(fileName, ext).toLowerCase();
    
    // Look for markdown files, cursorrules files, or diff files
    return (
      ext === '.md' ||
      ext === '.markdown' ||
      ext === '.diff' ||
      ext === '.patch' ||
      name.includes('review') ||
      name.includes('cursorrules') ||
      name.includes('diff')
    );
  }

  /**
   * Determine file type based on name and content
   */
  private getFileType(fileName: string): ReviewFile['type'] {
    const name = fileName.toLowerCase();
    
    if (name.includes('cursorrules')) {
      return 'cursorrules';
    } else if (name.includes('diff') || name.includes('.patch')) {
      return 'diff';
    } else {
      return 'review';
    }
  }

  /**
   * Generate a unique ID for a file
   */
  private generateFileId(filePath: string): string {
    try {
      return btoa(unescape(encodeURIComponent(filePath))).slice(0, 16);
    } catch {
      return `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }
  }

  /**
   * Extract code hunks from a review file (basic implementation)
   * This will be enhanced by the ReviewParser
   */
  private extractCodeHunks(reviewFile: ReviewFile): CodeHunk[] {
    const hunks: CodeHunk[] = [];
    const lines = reviewFile.content.split('\n');
    
    let currentHunk: Partial<CodeHunk> | null = null;
    let lineNumber = 0;
    
    for (const line of lines) {
      lineNumber++;
      
      // Look for diff headers
      if (line.startsWith('@@')) {
        if (currentHunk) {
          hunks.push(currentHunk as CodeHunk);
        }
        
        currentHunk = {
          id: `${reviewFile.id}-hunk-${hunks.length}`,
          filePath: reviewFile.filePath,
          startLine: lineNumber,
          addedLines: [],
          deletedLines: [],
          contextLines: [],
          changeType: 'modified',
          reviewId: reviewFile.id,
        };
      }
      
      if (currentHunk) {
        // Parse diff lines
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.addedLines!.push(line.substring(1));
          currentHunk.changeType = currentHunk.deletedLines!.length > 0 ? 'modified' : 'added';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentHunk.deletedLines!.push(line.substring(1));
          currentHunk.changeType = currentHunk.addedLines!.length > 0 ? 'modified' : 'deleted';
        } else if (line.startsWith(' ')) {
          currentHunk.contextLines!.push(line.substring(1));
        }
        
        currentHunk.endLine = lineNumber;
      }
    }
    
    // Add the last hunk
    if (currentHunk) {
      hunks.push(currentHunk as CodeHunk);
    }
    
    return hunks;
  }
}

export { FileWatcher };

// Default export for convenience
export default FileWatcher;