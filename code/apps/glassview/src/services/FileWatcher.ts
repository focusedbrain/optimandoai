import { EventEmitter } from 'events';
import { watch, FSWatcher, Stats } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, basename } from 'path';

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
  private watchers: Map<string, FSWatcher> = new Map();
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
      const stats = await stat(directoryPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path ${directoryPath} is not a directory`);
      }

      this.isWatching = true;
      
      // Initial scan of existing files
      await this.scanDirectory(directoryPath);

      // Set up file system watcher
      const watcher = watch(directoryPath, { recursive: true }, (eventType, filename) => {
        if (filename) {
          this.handleFileEvent(eventType, join(directoryPath, filename));
        }
      });

      this.watchers.set(directoryPath, watcher);

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
      watcher.close();
      this.watchers.delete(directoryPath);
      console.log(`FileWatcher: Stopped watching ${directoryPath}`);
    }
  }

  /**
   * Stop watching all directories
   */
  stopAll(): void {
    this.watchers.forEach((watcher, path) => {
      watcher.close();
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
      const entries = await readdir(directoryPath, { withFileTypes: true });
      
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

      switch (eventType) {
        case 'rename':
          // Handle both file creation and deletion
          try {
            await stat(filePath);
            // File exists, so it was created or moved here
            await this.processFile(filePath);
          } catch {
            // File doesn't exist, so it was deleted
            this.handleFileDeleted(filePath);
          }
          break;
          
        case 'change':
          await this.processFile(filePath);
          break;
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to handle file event for ${filePath}: ${error.message}`));
    }
  }

  /**
   * Process a file (read and parse it)
   */
  private async processFile(filePath: string): Promise<void> {
    try {
      const stats = await stat(filePath);
      const content = await readFile(filePath, 'utf-8');
      
      const reviewFile: ReviewFile = {
        id: this.generateFileId(filePath),
        filePath,
        fileName: basename(filePath),
        content,
        lastModified: stats.mtime,
        size: stats.size,
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
    return Buffer.from(filePath).toString('base64').slice(0, 16);
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