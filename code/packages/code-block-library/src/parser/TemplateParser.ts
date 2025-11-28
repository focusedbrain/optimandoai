/**
 * Template Parser
 * 
 * Parses GlassView template text into an Abstract Syntax Tree (AST).
 * Validates block references and structure.
 * 
 * IMPORTANT: This parser must NOT use eval(), new Function(), or any
 * CSP-violating patterns. All code generation happens at build time.
 */

import * as yaml from 'js-yaml';
import { TemplateAST, ComponentNode, ActionNode } from '../types';
import { hasBlock } from '../registry/BlockRegistry';

export class TemplateParser {
  private errors: string[] = [];

  /**
   * Parse a template text into an AST
   */
  parse(templateText: string): TemplateAST | null {
    this.errors = [];

    try {
      // Extract YAML-like structure from template (handle both \n and \r\n line endings)
      const yamlMatch = templateText.match(/```yaml[\r\n]+([\s\S]+?)[\r\n]+```/);
      if (!yamlMatch) {
        this.errors.push('No YAML template block found');
        console.error('[TemplateParser] Failed to find YAML block in template');
        return null;
      }

      const yamlText = yamlMatch[1];
      
      // Parse YAML-like structure (simplified parser)
      const template = this.parseYAML(yamlText);
      
      if (!template || !template.GLASSVIEW_APP) {
        this.errors.push('Invalid template structure: missing GLASSVIEW_APP');
        return null;
      }

      const app = template.GLASSVIEW_APP;

      // Validate bootstrap block
      if (!app.bootstrap || !app.bootstrap.block) {
        this.errors.push('Bootstrap block is required');
        return null;
      }

      if (!hasBlock(app.bootstrap.block)) {
        this.errors.push(`Unknown bootstrap block: ${app.bootstrap.block}`);
        return null;
      }

      // Build AST
      const ast: TemplateAST = {
        name: app.name || 'Untitled',
        version: app.version || '1.0.0',
        bootstrap: {
          blockId: app.bootstrap.block,
          props: app.bootstrap.config || {}
        },
        components: this.parseComponents(app.layout || []),
        actions: this.parseActions(app.actions || {}),
        events: app.events || []
      };

      // Validate all block references
      this.validateBlockReferences(ast);

      if (this.errors.length > 0) {
        console.error('Template parsing errors:', this.errors);
        return null;
      }

      return ast;
    } catch (error) {
      this.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get parsing errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Simple YAML-like parser (handles basic structure only)
   */
  private parseYAML(text: string): any {
    try {
      // Use js-yaml to parse the YAML content
      const parsed = yaml.load(text);
      return parsed;
    } catch (error) {
      this.errors.push(`YAML parsing failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Parse component definitions
   */
  private parseComponents(layout: any[]): ComponentNode[] {
    const components: ComponentNode[] = [];

    for (const item of layout) {
      if (item.block) {
        // This is a code block component
        if (!hasBlock(item.block)) {
          this.errors.push(`Unknown block: ${item.block}`);
          continue;
        }
      }

      const node: ComponentNode = {
        type: item.component || item.block,
        blockId: item.block,
        props: item.props || {},
        condition: item.condition,
        children: item.children ? this.parseComponents(item.children) : undefined
      };

      components.push(node);
    }

    return components;
  }

  /**
   * Parse action definitions
   */
  private parseActions(actions: any): Record<string, ActionNode> {
    const parsed: Record<string, ActionNode> = {};

    for (const [name, action] of Object.entries(actions)) {
      parsed[name] = action as ActionNode;
    }

    return parsed;
  }

  /**
   * Validate all block references in the AST
   */
  private validateBlockReferences(ast: TemplateAST): void {
    // Check bootstrap
    if (!hasBlock(ast.bootstrap.blockId)) {
      this.errors.push(`Unknown bootstrap block: ${ast.bootstrap.blockId}`);
    }

    // Check components
    this.validateComponentBlocks(ast.components);
  }

  private validateComponentBlocks(components: ComponentNode[]): void {
    for (const component of components) {
      if (component.blockId && !hasBlock(component.blockId)) {
        this.errors.push(`Unknown block: ${component.blockId}`);
      }
      if (component.children) {
        this.validateComponentBlocks(component.children);
      }
    }
  }
}

// Export singleton instance
export const templateParser = new TemplateParser();
