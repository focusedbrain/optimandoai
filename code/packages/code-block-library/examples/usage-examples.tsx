/**
 * Example: Using TemplateBuilder in Electron App
 * 
 * This demonstrates how to load a template file and build a GlassView app
 */

import { buildFromTemplate, validateTemplate } from '../src/index';
import React from 'react';
import { createRoot } from 'react-dom/client';

// Example 1: Load and render a template
export async function loadTemplateApp(templatePath: string, containerId: string) {
  try {
    // In a real app, you'd load this from the file system via Electron IPC
    const templateText = await fetch(templatePath).then(r => r.text());
    
    // Validate first (optional but recommended)
    const validation = validateTemplate(templateText);
    
    if (!validation.valid) {
      console.error('Template validation failed:', validation.errors);
      throw new Error(`Invalid template: ${validation.errors.join(', ')}`);
    }
    
    if (validation.warnings.length > 0) {
      console.warn('Template warnings:', validation.warnings);
    }
    
    // Build the app
    console.log('Building app from template...');
    const result = buildFromTemplate(templateText);
    
    console.log('App built successfully!');
    console.log('- Name:', result.ast?.name);
    console.log('- Blocks used:', result.metadata.blocksUsed);
    console.log('- Components:', result.metadata.blocksUsed.length);
    
    // Render the app
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container #${containerId} not found`);
    }
    
    const root = createRoot(container);
    root.render(React.createElement(result.Component));
    
    console.log('App rendered successfully!');
    
    return result;
  } catch (error) {
    console.error('Failed to load template app:', error);
    throw error;
  }
}

// Example 2: Build with error handling
export function buildWithErrorHandling(templateText: string) {
  const result = buildFromTemplate(templateText);
  
  // Check for errors
  if (result.parseErrors.length > 0) {
    console.error('Parse errors:');
    result.parseErrors.forEach((err: string) => console.error('  -', err));
  }
  
  if (result.buildErrors.length > 0) {
    console.error('Build errors:');
    result.buildErrors.forEach((err: string) => console.error('  -', err));
  }
  
  if (result.buildWarnings.length > 0) {
    console.warn('Build warnings:');
    result.buildWarnings.forEach((warn: string) => console.warn('  -', warn));
  }
  
  // The component is always safe to render (shows errors if build failed)
  return result.Component;
}

// Example 3: Hot reload templates
export class TemplateHotReloader {
  private container: HTMLElement;
  private root: any;
  private currentTemplate: string = '';
  
  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container #${containerId} not found`);
    }
    this.container = container;
    this.root = createRoot(container);
  }
  
  reload(templateText: string) {
    if (templateText === this.currentTemplate) {
      console.log('Template unchanged, skipping reload');
      return;
    }
    
    console.log('Reloading template...');
    this.currentTemplate = templateText;
    
    const result = buildFromTemplate(templateText);
    
    if (result.metadata.errors.length > 0) {
      console.error('Template reload failed:', result.metadata.errors);
    } else {
      console.log('Template reloaded successfully');
    }
    
    // Always render (will show errors if build failed)
    this.root.render(React.createElement(result.Component));
  }
  
  destroy() {
    this.root.unmount();
  }
}

// Example 4: Template development helper
export class TemplateDevelopmentHelper {
  static checkTemplate(templateText: string) {
    const validation = validateTemplate(templateText);
    
    console.group('Template Validation');
    console.log('Valid:', validation.valid);
    
    if (validation.errors.length > 0) {
      console.group('Errors');
      validation.errors.forEach((err: string) => console.error(err));
      console.groupEnd();
    }
    
    if (validation.warnings.length > 0) {
      console.group('Warnings');
      validation.warnings.forEach((warn: string) => console.warn(warn));
      console.groupEnd();
    }
    
    if (validation.ast) {
      console.group('Template Info');
      console.log('Name:', validation.ast.name);
      console.log('Version:', validation.ast.version);
      console.log('Bootstrap:', validation.ast.bootstrap.blockId);
      console.log('Components:', validation.ast.components.length);
      console.log('Actions:', Object.keys(validation.ast.actions).length);
      console.groupEnd();
    }
    
    console.groupEnd();
    
    return validation;
  }
  
  static async watchTemplateFile(filePath: string, onReload: (templateText: string) => void) {
    // This would use fs.watch in Node.js / Electron
    console.log('Watching template file:', filePath);
    
    // Placeholder - implement with your file watching mechanism
    // When file changes, call: onReload(newContent)
  }
}

// Example 5: Usage in React component
export function TemplateAppContainer({ templateText }: { templateText: string }) {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  
  React.useEffect(() => {
    try {
      const result = buildFromTemplate(templateText);
      setComponent(() => result.Component);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [templateText]);
  
  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        <h3>Template Error</h3>
        <p>{error}</p>
      </div>
    );
  }
  
  if (!Component) {
    return <div style={{ padding: '20px' }}>Loading...</div>;
  }
  
  return <Component />;
}
