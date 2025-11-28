/**
 * Template Builder
 * 
 * High-level API for building React applications from text templates.
 * This is the main entry point for the template-driven app creation system.
 * 
 * Usage:
 *   const template = loadTemplateFile('my-app.template');
 *   const result = templateBuilder.buildFromText(template);
 *   render(<result.Component />);
 */

import React from 'react';
import { templateParser } from '../parser/TemplateParser';
import { componentBuilder } from './ComponentBuilder';
import { TemplateAST, BuildResult } from '../types';

export interface TemplateBuildResult extends BuildResult {
  ast: TemplateAST | null;
  parseErrors: string[];
  buildErrors: string[];
  buildWarnings: string[];
}

export class TemplateBuilder {
  /**
   * Build a React application from template text
   * 
   * @param templateText - Plain text template content
   * @returns Build result with Component and metadata
   */
  buildFromText(templateText: string): TemplateBuildResult {
    console.log('[TemplateBuilder] Building from template text...');
    
    // Step 1: Parse template into AST
    const ast = templateParser.parse(templateText);
    const parseErrors = templateParser.getErrors();

    if (!ast) {
      console.error('[TemplateBuilder] Template parsing failed:', parseErrors);
      return {
        Component: this.createErrorComponent('Template parsing failed', parseErrors),
        metadata: {
          blocksUsed: [],
          warnings: [],
          errors: parseErrors
        },
        ast: null,
        parseErrors,
        buildErrors: [],
        buildWarnings: []
      };
    }

    console.log('[TemplateBuilder] Template parsed successfully:', ast.name);

    // Step 2: Build component from AST
    return this.buildFromAST(ast);
  }

  /**
   * Build a React application from parsed AST
   * 
   * @param ast - Parsed template AST
   * @returns Build result with Component and metadata
   */
  buildFromAST(ast: TemplateAST): TemplateBuildResult {
    console.log('[TemplateBuilder] Building from AST:', ast.name);

    const buildResult = componentBuilder.build(ast);
    const buildErrors = componentBuilder.getErrors();
    const buildWarnings = componentBuilder.getWarnings();

    if (!buildResult) {
      console.error('[TemplateBuilder] Component build failed:', buildErrors);
      return {
        Component: this.createErrorComponent('Component build failed', buildErrors),
        metadata: {
          blocksUsed: [],
          warnings: buildWarnings,
          errors: buildErrors
        },
        ast,
        parseErrors: [],
        buildErrors,
        buildWarnings
      };
    }

    console.log('[TemplateBuilder] Build successful! Blocks used:', buildResult.metadata.blocksUsed);

    return {
      ...buildResult,
      ast,
      parseErrors: [],
      buildErrors,
      buildWarnings
    };
  }

  /**
   * Validate a template without building
   * Useful for template authoring tools
   * 
   * @param templateText - Template text to validate
   * @returns Validation result with errors and warnings
   */
  validate(templateText: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    ast: TemplateAST | null;
  } {
    const ast = templateParser.parse(templateText);
    const parseErrors = templateParser.getErrors();

    if (!ast) {
      return {
        valid: false,
        errors: parseErrors,
        warnings: [],
        ast: null
      };
    }

    // Validate without actually building
    // This is faster and doesn't create React components
    const buildResult = componentBuilder.build(ast);
    const buildErrors = componentBuilder.getErrors();
    const buildWarnings = componentBuilder.getWarnings();

    return {
      valid: buildResult !== null && buildErrors.length === 0,
      errors: [...parseErrors, ...buildErrors],
      warnings: buildWarnings,
      ast
    };
  }

  /**
   * Get information about a template without building it
   * 
   * @param templateText - Template text to analyze
   * @returns Template metadata
   */
  analyze(templateText: string): {
    name: string;
    version: string;
    blocksUsed: string[];
    componentCount: number;
    actionCount: number;
    errors: string[];
  } {
    const ast = templateParser.parse(templateText);
    
    if (!ast) {
      return {
        name: 'Unknown',
        version: 'Unknown',
        blocksUsed: [],
        componentCount: 0,
        actionCount: 0,
        errors: templateParser.getErrors()
      };
    }

    const blocksUsed = this.collectBlocksFromAST(ast);
    const componentCount = this.countComponents(ast.components);

    return {
      name: ast.name,
      version: ast.version,
      blocksUsed,
      componentCount,
      actionCount: Object.keys(ast.actions).length,
      errors: []
    };
  }

  /**
   * Create an error component to display build failures
   */
  private createErrorComponent(title: string, errors: string[]): React.ComponentType<any> {
    return () => {
      return React.createElement('div', {
        style: {
          padding: '20px',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          border: '1px solid #fca5a5',
          borderRadius: '4px',
          fontFamily: 'monospace'
        }
      }, [
        React.createElement('h3', { key: 'title' }, title),
        React.createElement('ul', { key: 'errors' }, 
          errors.map((error, i) => 
            React.createElement('li', { key: i }, error)
          )
        )
      ]);
    };
  }

  /**
   * Collect all block IDs from AST
   */
  private collectBlocksFromAST(ast: TemplateAST): string[] {
    const blocks = new Set<string>();
    blocks.add(ast.bootstrap.blockId);

    const collectFromComponents = (components: any[]) => {
      for (const component of components) {
        if (component.blockId) {
          blocks.add(component.blockId);
        }
        if (component.children) {
          collectFromComponents(component.children);
        }
      }
    };

    collectFromComponents(ast.components);
    return Array.from(blocks);
  }

  /**
   * Count total components in tree
   */
  private countComponents(components: any[]): number {
    let count = components.length;
    for (const component of components) {
      if (component.children) {
        count += this.countComponents(component.children);
      }
    }
    return count;
  }
}

// Export singleton instance
export const templateBuilder = new TemplateBuilder();

/**
 * Convenience function: Build from template text
 */
export function buildFromTemplate(templateText: string): TemplateBuildResult {
  return templateBuilder.buildFromText(templateText);
}

/**
 * Convenience function: Validate template
 */
export function validateTemplate(templateText: string) {
  return templateBuilder.validate(templateText);
}

/**
 * Convenience function: Analyze template
 */
export function analyzeTemplate(templateText: string) {
  return templateBuilder.analyze(templateText);
}
