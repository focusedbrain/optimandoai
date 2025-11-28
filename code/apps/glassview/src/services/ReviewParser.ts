import { ReviewFile, CodeHunk } from './FileWatcher';

export interface ParsedReview {
  id: string;
  title: string;
  description: string;
  filePath: string;
  reviewType: 'code-review' | 'security-check' | 'documentation' | 'refactor' | 'unknown';
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  codeHunks: CodeHunk[];
  metadata: ReviewMetadata;
}

export interface ReviewMetadata {
  author?: string;
  timestamp?: Date;
  reviewerId?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'rejected';
  estimatedTime?: number; // in minutes
  complexity?: 'simple' | 'moderate' | 'complex' | 'expert';
  category?: string;
  relatedFiles?: string[];
}

export interface DiffBlock {
  filePath: string;
  startLine: number;
  endLine: number;
  originalContent: string[];
  modifiedContent: string[];
  changeType: 'addition' | 'deletion' | 'modification';
  context: string[];
}

export interface FileChange {
  filePath: string;
  changeType: 'added' | 'deleted' | 'modified' | 'renamed';
  oldPath?: string; // for renamed files
  hunks: DiffBlock[];
  summary: string;
}

class ReviewParser {
  private static readonly REVIEW_TYPE_PATTERNS = {
    'code-review': /\b(review|code\s*review|cr|pull\s*request|pr)\b/i,
    'security-check': /\b(security|sec|vulnerability|vuln|audit|secure)\b/i,
    'documentation': /\b(doc|documentation|readme|comment|javadoc)\b/i,
    'refactor': /\b(refactor|refactoring|cleanup|restructure|optimize)\b/i,
  };

  private static readonly PRIORITY_PATTERNS = {
    'critical': /\b(critical|urgent|blocker|high\s*priority|p0)\b/i,
    'high': /\b(high|important|major|p1)\b/i,
    'medium': /\b(medium|normal|moderate|p2)\b/i,
    'low': /\b(low|minor|trivial|p3|p4)\b/i,
  };

  private static readonly COMPLEXITY_PATTERNS = {
    'expert': /\b(expert|complex|advanced|difficult|hard)\b/i,
    'complex': /\b(complex|complicated|involved|intricate)\b/i,
    'moderate': /\b(moderate|medium|intermediate|standard)\b/i,
    'simple': /\b(simple|easy|trivial|basic|straightforward)\b/i,
  };

  /**
   * Parse a review file into structured data
   */
  static parseReviewFile(reviewFile: ReviewFile): ParsedReview {
    const lines = reviewFile.content.split('\n');
    const metadata = this.extractMetadata(lines);
    const { title, description } = this.extractTitleAndDescription(lines);
    const codeHunks = this.extractCodeHunks(reviewFile);
    const tags = this.extractTags(reviewFile.content);
    
    return {
      id: reviewFile.id,
      title: title || reviewFile.fileName,
      description,
      filePath: reviewFile.filePath,
      reviewType: this.determineReviewType(reviewFile.content),
      priority: this.determinePriority(reviewFile.content),
      tags,
      codeHunks,
      metadata,
    };
  }

  /**
   * Extract all file changes from a diff-style review
   */
  static parseFileChanges(content: string): FileChange[] {
    const changes: FileChange[] = [];
    const lines = content.split('\n');
    
    let currentFile: Partial<FileChange> | null = null;
    let currentHunk: Partial<DiffBlock> | null = null;
    let lineIndex = 0;
    
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      
      // Look for file headers
      if (line.startsWith('diff --git') || line.startsWith('--- a/') || line.startsWith('+++ b/')) {
        // Process previous file if exists
        if (currentFile && currentFile.filePath) {
          changes.push(this.finalizeFileChange(currentFile));
        }
        
        const filePath = this.extractFilePathFromDiffHeader(line, lines[lineIndex + 1], lines[lineIndex + 2]);
        currentFile = {
          filePath,
          hunks: [],
          summary: '',
          changeType: 'modified',
        };
        
        // Determine change type from headers
        currentFile.changeType = this.determineChangeType(lines.slice(lineIndex, lineIndex + 5));
        
      } else if (line.startsWith('@@')) {
        // Process previous hunk if exists
        if (currentHunk && currentFile) {
          currentFile.hunks!.push(this.finalizeHunk(currentHunk));
        }
        
        // Start new hunk
        const hunkHeader = this.parseHunkHeader(line);
        currentHunk = {
          ...hunkHeader,
          originalContent: [],
          modifiedContent: [],
          context: [],
        };
        
      } else if (currentHunk) {
        // Process hunk content
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.modifiedContent!.push(line.substring(1));
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentHunk.originalContent!.push(line.substring(1));
        } else if (line.startsWith(' ')) {
          currentHunk.context!.push(line.substring(1));
        }
      }
      
      lineIndex++;
    }
    
    // Finalize last file and hunk
    if (currentHunk && currentFile) {
      currentFile.hunks!.push(this.finalizeHunk(currentHunk));
    }
    if (currentFile && currentFile.filePath) {
      changes.push(this.finalizeFileChange(currentFile));
    }
    
    return changes;
  }

  /**
   * Extract metadata from markdown frontmatter or comments
   */
  private static extractMetadata(lines: string[]): ReviewMetadata {
    const metadata: ReviewMetadata = {
      status: 'pending',
    };
    
    // Look for YAML frontmatter
    if (lines[0] === '---') {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line === '---') break;
        
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        
        switch (key.trim().toLowerCase()) {
          case 'author':
            metadata.author = value;
            break;
          case 'reviewer':
            metadata.reviewerId = value;
            break;
          case 'status':
            metadata.status = value as ReviewMetadata['status'];
            break;
          case 'complexity':
            metadata.complexity = value as ReviewMetadata['complexity'];
            break;
          case 'category':
            metadata.category = value;
            break;
          case 'estimated-time':
          case 'time':
            metadata.estimatedTime = parseInt(value);
            break;
        }
      }
    }
    
    // Look for inline metadata in comments
    for (const line of lines) {
      if (line.includes('Author:') || line.includes('@author')) {
        const match = line.match(/(?:Author:|@author)\s*(.+)/i);
        if (match) metadata.author = match[1].trim();
      }
      
      if (line.includes('Reviewer:') || line.includes('@reviewer')) {
        const match = line.match(/(?:Reviewer:|@reviewer)\s*(.+)/i);
        if (match) metadata.reviewerId = match[1].trim();
      }
      
      if (line.includes('Time:') || line.includes('Duration:')) {
        const match = line.match(/(?:Time:|Duration:)\s*(\d+)/i);
        if (match) metadata.estimatedTime = parseInt(match[1]);
      }
    }
    
    return metadata;
  }

  /**
   * Extract title and description from markdown content
   */
  private static extractTitleAndDescription(lines: string[]): { title: string; description: string } {
    let title = '';
    let description = '';
    let startIndex = 0;
    
    // Skip frontmatter
    if (lines[0] === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
          startIndex = i + 1;
          break;
        }
      }
    }
    
    // Find first heading for title
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#')) {
        title = line.replace(/^#+\s*/, '');
        startIndex = i + 1;
        break;
      }
    }
    
    // Collect description until first code block or diff
    const descriptionLines: string[] = [];
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('```') || line.startsWith('diff --git') || line.startsWith('@@')) {
        break;
      }
      
      if (line.trim() || descriptionLines.length > 0) {
        descriptionLines.push(line);
      }
    }
    
    description = descriptionLines.join('\n').trim();
    
    return { title, description };
  }

  /**
   * Extract code hunks with enhanced diff parsing
   */
  private static extractCodeHunks(reviewFile: ReviewFile): CodeHunk[] {
    const hunks: CodeHunk[] = [];
    const lines = reviewFile.content.split('\n');
    
    let currentFilePath = '';
    let currentHunk: Partial<CodeHunk> | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Extract file path from diff headers
      if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
        const match = line.match(/^[+-]{3}\s+[ab]\/(.+)/);
        if (match) {
          currentFilePath = match[1];
        }
      }
      
      // Process hunk headers
      if (line.startsWith('@@')) {
        if (currentHunk) {
          hunks.push(this.finalizeCodeHunk(currentHunk, reviewFile.id));
        }
        
        const hunkInfo = this.parseHunkHeader(line);
        currentHunk = {
          id: `${reviewFile.id}-hunk-${hunks.length}`,
          filePath: currentFilePath || reviewFile.filePath,
          startLine: hunkInfo.startLine,
          endLine: hunkInfo.endLine,
          addedLines: [],
          deletedLines: [],
          contextLines: [],
          changeType: 'modified',
          reviewId: reviewFile.id,
        };
      }
      
      if (currentHunk) {
        // Process hunk content
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.addedLines!.push(line.substring(1));
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentHunk.deletedLines!.push(line.substring(1));
        } else if (line.startsWith(' ')) {
          currentHunk.contextLines!.push(line.substring(1));
        }
        
        // Update change type
        if (currentHunk.addedLines!.length > 0 && currentHunk.deletedLines!.length === 0) {
          currentHunk.changeType = 'added';
        } else if (currentHunk.addedLines!.length === 0 && currentHunk.deletedLines!.length > 0) {
          currentHunk.changeType = 'deleted';
        } else if (currentHunk.addedLines!.length > 0 && currentHunk.deletedLines!.length > 0) {
          currentHunk.changeType = 'modified';
        }
      }
    }
    
    // Finalize last hunk
    if (currentHunk) {
      hunks.push(this.finalizeCodeHunk(currentHunk, reviewFile.id));
    }
    
    return hunks;
  }

  /**
   * Extract tags from content
   */
  private static extractTags(content: string): string[] {
    const tags: string[] = [];
    
    // Look for hashtags
    const hashtagMatches = content.match(/#\w+/g);
    if (hashtagMatches) {
      tags.push(...hashtagMatches.map(tag => tag.substring(1)));
    }
    
    // Look for @labels
    const labelMatches = content.match(/@\w+/g);
    if (labelMatches) {
      tags.push(...labelMatches.map(label => label.substring(1)));
    }
    
    // Look for common keywords
    const keywordPatterns = [
      /\b(bug|fix|feature|enhancement|improvement)\b/gi,
      /\b(todo|fixme|hack|note|warning)\b/gi,
      /\b(typescript|javascript|react|vue|angular|node)\b/gi,
    ];
    
    for (const pattern of keywordPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        tags.push(...matches.map(tag => tag.toLowerCase()));
      }
    }
    
    // Remove duplicates and return
    return [...new Set(tags)];
  }

  /**
   * Determine review type from content
   */
  private static determineReviewType(content: string): ParsedReview['reviewType'] {
    for (const [type, pattern] of Object.entries(this.REVIEW_TYPE_PATTERNS)) {
      if (pattern.test(content)) {
        return type as ParsedReview['reviewType'];
      }
    }
    return 'unknown';
  }

  /**
   * Determine priority from content
   */
  private static determinePriority(content: string): ParsedReview['priority'] {
    for (const [priority, pattern] of Object.entries(this.PRIORITY_PATTERNS)) {
      if (pattern.test(content)) {
        return priority as ParsedReview['priority'];
      }
    }
    return 'medium';
  }

  /**
   * Parse hunk header line (@@)
   */
  private static parseHunkHeader(line: string): { filePath: string; startLine: number; endLine: number } {
    // Parse @@ -old_start,old_count +new_start,new_count @@ optional_context
    const match = line.match(/@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
    
    if (match) {
      const oldStart = parseInt(match[1]);
      const oldCount = parseInt(match[2] || '1');
      const newStart = parseInt(match[3]);
      const newCount = parseInt(match[4] || '1');
      
      return {
        filePath: '',
        startLine: newStart,
        endLine: newStart + newCount - 1,
      };
    }
    
    return { filePath: '', startLine: 0, endLine: 0 };
  }

  /**
   * Extract file path from diff headers
   */
  private static extractFilePathFromDiffHeader(line1: string, line2?: string, line3?: string): string {
    // Try different diff header formats
    let match = line1.match(/diff --git a\/(.+) b\/(.+)/);
    if (match) return match[1];
    
    if (line2) {
      match = line2.match(/^---\s+a\/(.+)/);
      if (match) return match[1];
    }
    
    if (line3) {
      match = line3.match(/^\+\+\+\s+b\/(.+)/);
      if (match) return match[1];
    }
    
    return 'unknown';
  }

  /**
   * Determine change type from diff headers
   */
  private static determineChangeType(headerLines: string[]): FileChange['changeType'] {
    const content = headerLines.join('\n');
    
    if (content.includes('new file mode')) return 'added';
    if (content.includes('deleted file mode')) return 'deleted';
    if (content.includes('rename from') || content.includes('rename to')) return 'renamed';
    
    return 'modified';
  }

  /**
   * Finalize a file change object
   */
  private static finalizeFileChange(fileChange: Partial<FileChange>): FileChange {
    const hunks = fileChange.hunks || [];
    const addedLines = hunks.reduce((sum, hunk) => sum + hunk.modifiedContent.length, 0);
    const deletedLines = hunks.reduce((sum, hunk) => sum + hunk.originalContent.length, 0);
    
    let summary = '';
    if (addedLines > 0 && deletedLines > 0) {
      summary = `${addedLines} additions, ${deletedLines} deletions`;
    } else if (addedLines > 0) {
      summary = `${addedLines} additions`;
    } else if (deletedLines > 0) {
      summary = `${deletedLines} deletions`;
    }
    
    return {
      filePath: fileChange.filePath!,
      changeType: fileChange.changeType!,
      hunks,
      summary,
      oldPath: fileChange.oldPath,
    };
  }

  /**
   * Finalize a diff block object
   */
  private static finalizeHunk(hunk: Partial<DiffBlock>): DiffBlock {
    const originalCount = hunk.originalContent?.length || 0;
    const modifiedCount = hunk.modifiedContent?.length || 0;
    
    let changeType: DiffBlock['changeType'] = 'modification';
    if (originalCount === 0 && modifiedCount > 0) {
      changeType = 'addition';
    } else if (originalCount > 0 && modifiedCount === 0) {
      changeType = 'deletion';
    }
    
    return {
      filePath: hunk.filePath!,
      startLine: hunk.startLine!,
      endLine: hunk.endLine!,
      originalContent: hunk.originalContent || [],
      modifiedContent: hunk.modifiedContent || [],
      changeType,
      context: hunk.context || [],
    };
  }

  /**
   * Finalize a code hunk object
   */
  private static finalizeCodeHunk(hunk: Partial<CodeHunk>, reviewId: string): CodeHunk {
    return {
      id: hunk.id || `${reviewId}-hunk-${Date.now()}`,
      filePath: hunk.filePath || '',
      startLine: hunk.startLine || 0,
      endLine: hunk.endLine || 0,
      addedLines: hunk.addedLines || [],
      deletedLines: hunk.deletedLines || [],
      contextLines: hunk.contextLines || [],
      changeType: hunk.changeType || 'modified',
      reviewId,
    };
  }
}

export { ReviewParser };
export default ReviewParser;