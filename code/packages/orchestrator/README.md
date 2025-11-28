# Orchestrator Package

Central coordinator for the template-driven app creation system.

## Overview

The Orchestrator is the brain of the template system. It manages template loading, parsing, building, and communication with Electron processes. It handles file watching for hot reload and provides caching for performance.

## Core Features

- **Template Loading**: Load templates from files or text content
- **Intelligent Caching**: Cache parsed templates and ASTs for performance
- **File Watching**: Monitor template files for changes and auto-reload
- **Electron Integration**: IPC handlers for main/renderer communication
- **Event System**: EventBus for coordinated messaging
- **Hot Reload**: Live updates when template files change

## Usage

### Basic Setup

```typescript
import { Orchestrator } from '@optimandoai/orchestrator';

const orchestrator = new Orchestrator({
  templateDir: './templates',
  enableFileWatching: true,
  enableHotReload: true,
  cachingEnabled: true,
  debugMode: false
});

await orchestrator.initialize();
```

### Loading Templates

```typescript
// From file
const result = await orchestrator.loadTemplate('./templates/my-app.yaml');
console.log('Built app:', result.Component);

// From text content
const template = `
name: Simple App
description: Basic template test
components:
  - type: display
    text: "Hello World"
`;

const result = orchestrator.loadTemplateFromText(template);
```

### Electron Integration

```typescript
// In Electron main process
import { app, ipcMain } from 'electron';

const orchestrator = new Orchestrator({
  templateDir: './templates',
  electronMain: { ipcMain, BrowserWindow: require('electron').BrowserWindow }
});

// Now IPC handlers are automatically set up:
// - orchestrator:loadTemplate
// - orchestrator:validateTemplate
```

### Event Handling

```typescript
const eventBus = orchestrator.getEventBus();

eventBus.on('template:loaded', (content, source) => {
  console.log(`Template loaded from ${source}`);
});

eventBus.on('template:built', (Component, metadata) => {
  console.log('Template built successfully:', metadata);
});

eventBus.on('template:error', (error, source) => {
  console.error(`Template error in ${source}:`, error);
});
```

### Status and Management

```typescript
// Get orchestrator status
const status = orchestrator.getStatus();
console.log('Loaded templates:', status.loadedTemplates);
console.log('Cached templates:', status.cachedTemplates);

// Get specific template
const template = orchestrator.getLoadedTemplate('./templates/app.yaml');
if (template) {
  console.log('Template AST:', template.ast);
}

// Clear cache
orchestrator.clearCache();

// Shutdown
await orchestrator.shutdown();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `templateDir` | string | `'./templates'` | Directory to watch for template files |
| `enableFileWatching` | boolean | `true` | Watch template files for changes |
| `enableHotReload` | boolean | `true` | Auto-reload templates when files change |
| `cachingEnabled` | boolean | `true` | Cache parsed templates for performance |
| `debugMode` | boolean | `false` | Enable verbose logging |
| `electronMain` | object | `null` | Electron main process for IPC setup |

## Template File Types

The orchestrator watches for these file extensions:
- `.template` - Template files
- `.yaml` - YAML template files  
- `.yml` - YAML template files

## Events

The orchestrator emits these events through its EventBus:

### Template Events
- `template:loaded` - Template content loaded from file
- `template:built` - Template successfully built to React component
- `template:error` - Error during template loading/building

### File Events
- `file:added` - New template file detected
- `file:changed` - Template file modified
- `file:removed` - Template file deleted

### Application Events
- `app:ready` - Orchestrator initialized successfully
- `app:shutdown` - Orchestrator shutting down

### IPC Events
- `ipc:message` - Message sent to Electron renderer

## Architecture

```
Orchestrator
├── Template Loading
│   ├── File System → Template Content
│   ├── Cache Check → Cached AST
│   └── Parser → Template AST
├── Building
│   ├── AST → ComponentBuilder
│   ├── Validation → Errors/Warnings
│   └── Component → React Element
├── File Watching
│   ├── Chokidar → File Events
│   ├── Hot Reload → Auto Update
│   └── Cache Invalidation
└── IPC Integration
    ├── Main Process → IPC Handlers
    ├── Renderer → Messages
    └── Event Coordination
```

## Error Handling

The orchestrator provides comprehensive error handling:

```typescript
try {
  const result = await orchestrator.loadTemplate('./bad-template.yaml');
} catch (error) {
  console.error('Template loading failed:', error.message);
  
  // Errors are also emitted as events
  orchestrator.getEventBus().on('template:error', (err, source) => {
    console.log(`Error in ${source}: ${err}`);
  });
}
```

## Performance

- **Intelligent Caching**: Only reloads templates when files change
- **Lazy Loading**: Templates loaded on-demand
- **Event-Driven**: Minimal polling, file system events trigger updates
- **Memory Management**: Cache cleanup and resource management

## Dependencies

- `@optimandoai/code-block-library` - Core template building
- `chokidar` - File system watching
- `eventemitter3` - Event handling

## Development

```bash
# Build
npm run build

# Test
npm test

# Development mode
npm run dev
```