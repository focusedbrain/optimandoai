# Code Block Library - Usage Guide

## Quick Start

### 1. Building an App from a Template

```typescript
import { buildFromTemplate } from '@optimandoai/code-block-library';
import { createRoot } from 'react-dom/client';

// Load template text (from file, network, etc.)
const templateText = `
\`\`\`yaml
GLASSVIEW_APP:
  name: "My App"
  version: "1.0.0"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "My App"
      initialState:
        message: "Hello World"
  
  layout:
    - component: "container"
      props:
        title: "Welcome"
      children:
        - component: "status-indicator"
          props:
            message: "{state.message}"
            color: "blue"
\`\`\`
`;

// Build the app
const result = buildFromTemplate(templateText);

// Check for errors
if (result.metadata.errors.length > 0) {
  console.error('Build failed:', result.metadata.errors);
}

// Render the app
const root = createRoot(document.getElementById('root')!);
root.render(<result.Component />);
```

### 2. Validating a Template

```typescript
import { validateTemplate } from '@optimandoai/code-block-library';

const validation = validateTemplate(templateText);

if (!validation.valid) {
  console.error('Template is invalid:', validation.errors);
} else {
  console.log('Template is valid!');
  if (validation.warnings.length > 0) {
    console.warn('Warnings:', validation.warnings);
  }
}
```

### 3. Analyzing a Template

```typescript
import { analyzeTemplate } from '@optimandoai/code-block-library';

const info = analyzeTemplate(templateText);

console.log(`Template: ${info.name} v${info.version}`);
console.log(`Uses ${info.componentCount} components`);
console.log(`Blocks: ${info.blocksUsed.join(', ')}`);
console.log(`Actions: ${info.actionCount}`);
```

## Template Format

### Basic Structure

```yaml
GLASSVIEW_APP:
  name: "App Name"
  version: "1.0.0"
  
  # Required: Bootstrap configuration
  bootstrap:
    block: "react-app"
    config:
      appName: "My App"
      initialState: {}
      theme: {}
  
  # Component tree
  layout:
    - component: "component-name"
      block: "block-id"
      props: {}
      condition: "state.someCondition"
      children: []
  
  # Action handlers
  actions:
    ACTION_NAME:
      type: "IPC_MESSAGE | STATE_UPDATE | CONDITIONAL | AI_REQUEST"
      payload: {}
  
  # Event listeners
  events:
    - listen: "EVENT_NAME"
      action: "ACTION_NAME"
```

### State Binding

Use `{state.property}` to bind component props to application state:

```yaml
layout:
  - component: "slider-navigation"
    props:
      items: "{state.changedFiles}"
      currentIndex: "{state.selectedIndex}"
```

### Conditional Rendering

Use the `condition` property to conditionally render components:

```yaml
layout:
  - component: "status-indicator"
    condition: "state.isWatching"
    props:
      message: "Watching for changes..."
      color: "green"
  
  - component: "button"
    condition: "!state.isWatching"
    props:
      label: "Start Watching"
      action: "START_WATCHING"
```

Supported conditions:
- `state.property` - Truthy check
- `!state.property` - Falsy check
- `state.array.length > 0` - Comparisons
- `state.value === 'text'` - Equality

### Actions

#### IPC_MESSAGE - Send message to orchestrator

```yaml
actions:
  START_WATCHING:
    type: "IPC_MESSAGE"
    payload:
      type: "START_WATCHING"
      path: "{state.projectPath}"
    onSuccess:
      - updateState: { isWatching: true }
```

#### STATE_UPDATE - Update application state

```yaml
actions:
  SELECT_FILE:
    type: "STATE_UPDATE"
    updates:
      selectedIndex: "{payload}"
      selectedFile: "{state.files[payload]}"
```

#### CONDITIONAL - Route based on conditions

```yaml
actions:
  HANDLE_ICON_CLICK:
    type: "CONDITIONAL"
    conditions:
      - when: "payload.color === 'blue'"
        action: "EXPLAIN_CODE"
      - when: "payload.color === 'red'"
        action: "SECURITY_SCAN"
```

#### AI_REQUEST - Send prompt to AI

```yaml
actions:
  EXPLAIN_CODE:
    type: "AI_REQUEST"
    prompt: "Explain this code: {payload.code}"
```

## Available Blocks

### Bootstrap

- **react-app** - App foundation with state management

### UI Components

- **slider-navigation** - Horizontal slider with navigation
- **icon-trigger** - Color-coded action triggers
- **container** - Layout container
- **button** - Action button
- **input-group** - Text input with label
- **status-indicator** - Status message display

### Diff Viewer

- **code-hunk-display** - Git diff visualization

### Integrations

- **open-file-action** - Open files in editor

## Using Blocks Directly

You can also use blocks directly in React code:

```typescript
import { 
  ReactAppBootstrap, 
  SliderNavigation,
  CodeHunkDisplay 
} from '@optimandoai/code-block-library';

function MyApp() {
  return (
    <ReactAppBootstrap appName="My App">
      <SliderNavigation
        items={files}
        currentIndex={0}
        onChange={(index) => console.log('Selected:', index)}
      />
    </ReactAppBootstrap>
  );
}
```

## Getting Block Metadata

```typescript
import { getBlock, getAllBlocks } from '@optimandoai/code-block-library';

// Get specific block
const block = getBlock('slider-navigation');
console.log(block?.metadata.plainEnglishDescription);

// List all blocks
const allBlocks = getAllBlocks();
allBlocks.forEach(block => {
  console.log(`${block.metadata.id}: ${block.metadata.description}`);
});
```

## Error Handling

The builder always returns a component, even if there are errors:

```typescript
const result = buildFromTemplate(templateText);

// Check for errors
if (result.metadata.errors.length > 0) {
  // Build failed, but result.Component will render an error display
  console.error('Errors:', result.metadata.errors);
}

// Check for warnings
if (result.metadata.warnings.length > 0) {
  // Build succeeded but with warnings
  console.warn('Warnings:', result.metadata.warnings);
}

// Safe to render in any case
root.render(<result.Component />);
```

## Integration with Orchestrator

The typical flow in an Electron app:

```typescript
// In main process (orchestrator)
import { readFile } from 'fs/promises';

async function loadAndBuildApp(templatePath: string) {
  // Load template
  const templateText = await readFile(templatePath, 'utf-8');
  
  // Send to renderer
  mainWindow.webContents.send('load-app', { templateText });
}

// In renderer process
import { buildFromTemplate } from '@optimandoai/code-block-library';

ipcRenderer.on('load-app', (event, { templateText }) => {
  const result = buildFromTemplate(templateText);
  
  // Render in sidepanel
  const root = createRoot(document.getElementById('sidepanel')!);
  root.render(<result.Component />);
});
```

## Security Notes

- All components are CSP-compliant
- No `eval()` or `new Function()` used
- State bindings are safely parsed
- Actions are validated before execution
- Templates cannot execute arbitrary code

## Performance Tips

1. **Cache AST**: Parse once, build multiple times
   ```typescript
   const ast = templateParser.parse(templateText);
   const result1 = templateBuilder.buildFromAST(ast);
   const result2 = templateBuilder.buildFromAST(ast); // Reuse AST
   ```

2. **Validate before building**: Use `validateTemplate()` for faster checks

3. **Lazy load templates**: Only build when needed

4. **Memoize components**: React's memo can help with re-renders
