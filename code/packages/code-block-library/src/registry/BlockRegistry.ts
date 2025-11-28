/**
 * Block Registry
 * 
 * Central registry for all code blocks in the library.
 * Each block consists of:
 * - Metadata (JSON descriptor)
 * - React component implementation
 * - CSP-compliant security hash
 */

import { BlockMetadata } from '../types';

// Import block metadata
import reactAppMeta from '../blocks/bootstrap/react-app.block.json';
import sliderNavMeta from '../blocks/ui/slider-navigation.block.json';
import iconTriggerMeta from '../blocks/ui/icon-trigger.block.json';
import codeHunkMeta from '../blocks/diff-viewer/code-hunk-display.block.json';
import openFileMeta from '../blocks/integrations/open-file-action.block.json';

// Import block components
import { ReactAppBootstrap } from '../blocks/bootstrap/react-app.component';
import { SliderNavigation } from '../blocks/ui/slider-navigation.component';
import { IconTrigger } from '../blocks/ui/icon-trigger.component';
import { CodeHunkDisplay } from '../blocks/diff-viewer/code-hunk-display.component';
import { OpenFileAction } from '../blocks/integrations/open-file-action.component';

export interface BlockRegistryEntry {
  metadata: BlockMetadata;
  component: React.ComponentType<any>;
}

class BlockRegistry {
  private blocks: Map<string, BlockRegistryEntry> = new Map();

  register(metadata: BlockMetadata, component: React.ComponentType<any>) {
    this.blocks.set(metadata.id, { metadata, component });
  }

  get(id: string): BlockRegistryEntry | undefined {
    return this.blocks.get(id);
  }

  getAll(): BlockRegistryEntry[] {
    return Array.from(this.blocks.values());
  }

  getByCategory(category: string): BlockRegistryEntry[] {
    return this.getAll().filter(entry => entry.metadata.category === category);
  }

  has(id: string): boolean {
    return this.blocks.has(id);
  }

  listIds(): string[] {
    return Array.from(this.blocks.keys());
  }
}

// Create singleton registry instance
export const registry = new BlockRegistry();

// Register all blocks
registry.register(reactAppMeta as BlockMetadata, ReactAppBootstrap);
registry.register(sliderNavMeta as BlockMetadata, SliderNavigation);
registry.register(iconTriggerMeta as BlockMetadata, IconTrigger);
registry.register(codeHunkMeta as BlockMetadata, CodeHunkDisplay);
registry.register(openFileMeta as BlockMetadata, OpenFileAction);

// Export convenience functions
export const getBlock = (id: string) => registry.get(id);
export const getAllBlocks = () => registry.getAll();
export const getBlocksByCategory = (category: string) => registry.getByCategory(category);
export const hasBlock = (id: string) => registry.has(id);
export const listBlockIds = () => registry.listIds();
