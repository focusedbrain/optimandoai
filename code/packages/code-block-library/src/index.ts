/**
 * Code Block Library - Main Entry Point
 * 
 * Enterprise-grade React component library with advanced UI components
 * for building modern web applications.
 */

// Export types
export * from './types';

// Export block registry
export * from './registry/BlockRegistry';

// Export builder components
export * from './builder/ComponentBuilder';
export * from './builder/ActionHandler';
export * from './builder/TemplateBuilder';

// Export parser
export * from './parser/TemplateParser';

// Export individual blocks (for direct use if needed)
export { ReactAppBootstrap, useApp } from './blocks/bootstrap/react-app.component';
export { SliderNavigation } from './blocks/ui/slider-navigation.component';
export { IconTrigger } from './blocks/ui/icon-trigger.component';
export { CodeHunkDisplay } from './blocks/diff-viewer/code-hunk-display.component';
export { OpenFileAction } from './blocks/integrations/open-file-action.component';

// Re-export for convenience
export { default as reactAppMetadata } from './blocks/bootstrap/react-app.block.json';
export { default as sliderNavigationMetadata } from './blocks/ui/slider-navigation.block.json';
export { default as iconTriggerMetadata } from './blocks/ui/icon-trigger.block.json';
export { default as codeHunkDisplayMetadata } from './blocks/diff-viewer/code-hunk-display.block.json';
export { default as openFileActionMetadata } from './blocks/integrations/open-file-action.block.json';

// Export all advanced UI components
export * from './components';
