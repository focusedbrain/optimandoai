# How to Test TemplateBuilder in Your Development Environment

## Method 1: Command Line Tests ✅ **WORKING**

### Basic Test
```bash
cd code/packages/code-block-library
npm run build
node quick-test.js
```

**Expected Output:**
```
🧪 Testing TemplateBuilder...
✅ Validating template...
   Valid: true
✅ Building template...
   Build Success: true
   Blocks Used: react-app
   AST Name: Test App
🎉 All tests passed!
```

### Advanced Test
```bash
npx tsx advanced-test.ts
```

**Expected Output:**
```
🧪 ADVANCED TEMPLATE TESTS
==================================================
1. ANALYZING TEMPLATE...
   📋 Name: Advanced Test App
   🔧 Blocks Used: react-app, slider-navigation
   📊 Component Count: 6
   ⚡ Action Count: 3
2. VALIDATING TEMPLATE...
   ✅ Valid: true
3. BUILDING TEMPLATE...
   🏗️ Build Success: true
==================================================
🎉 ADVANCED TESTS COMPLETED SUCCESSFULLY!
==================================================
```

## Method 2: Direct Import Test

Create a test file anywhere in your project:

```typescript
// test-my-template.ts
import { buildFromTemplate } from './code/packages/code-block-library/src/index';

const myTemplate = `
\`\`\`yaml
GLASSVIEW_APP:
  name: "My Custom App"
  bootstrap:
    block: "react-app"
    config:
      appName: "My App"
  layout:
    - component: "container"
      props:
        title: "Hello World"
\`\`\`
`;

const result = buildFromTemplate(myTemplate);
console.log('Success:', result.metadata.errors.length === 0);
```

Run with: `npx tsx test-my-template.ts`

## Method 3: Electron Integration Test

### In Main Process (orchestrator):
```typescript
// electron/main/template-test.ts
import { readFile } from 'fs/promises';

async function testTemplateLoad() {
  const template = await readFile('my-app.template', 'utf-8');
  
  // Send to renderer for building
  mainWindow.webContents.send('load-template', { template });
}
```

### In Renderer Process (extension):
```typescript
// extension/src/template-handler.ts
import { buildFromTemplate } from '@optimandoai/code-block-library';
import { createRoot } from 'react-dom/client';

ipcRenderer.on('load-template', (event, { template }) => {
  console.log('📨 Received template from orchestrator');
  
  const result = buildFromTemplate(template);
  
  if (result.metadata.errors.length === 0) {
    console.log('✅ Template built successfully');
    console.log('📦 Blocks used:', result.metadata.blocksUsed);
    
    // Render in sidepanel
    const container = document.getElementById('sidepanel');
    const root = createRoot(container);
    root.render(<result.Component />);
  } else {
    console.error('❌ Template build failed:', result.metadata.errors);
  }
});
```

## Method 4: Create Your Own Template

### 1. Create a GlassView Template File
```yaml
# my-glassview.template
GLASSVIEW_APP:
  name: "My GlassView App"
  version: "1.0.0"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "My GlassView"
      initialState:
        isWatching: false
        files: []
        selectedFile: null
  
  layout:
    - component: "container"
      props:
        title: "File Watcher"
      children:
        - component: "status-indicator"
          condition: "!state.isWatching"
          props:
            message: "Not watching"
            color: "red"
        
        - component: "status-indicator"
          condition: "state.isWatching"
          props:
            message: "Watching {state.files.length} files"
            color: "green"
        
        - component: "button"
          props:
            label: "Start Watching"
            action: "START_WATCH"
  
  actions:
    START_WATCH:
      type: "IPC_MESSAGE"
      payload:
        type: "START_WATCHING"
        path: "."
      onSuccess:
        - updateState: { isWatching: true }
```

### 2. Test It
```typescript
// test-my-glassview.ts
import { buildFromTemplate } from './code/packages/code-block-library/src/index';
import { readFile } from 'fs/promises';

async function testMyTemplate() {
  const template = await readFile('my-glassview.template', 'utf-8');
  const result = buildFromTemplate(template);
  
  console.log('Template:', result.ast?.name);
  console.log('Valid:', result.metadata.errors.length === 0);
  console.log('Blocks:', result.metadata.blocksUsed);
  
  // This component is now ready to render!
  return result.Component;
}

testMyTemplate();
```

## Method 5: Browser Development

### Open the HTML Test File
```bash
cd code/packages/code-block-library
# Open browser-test.html in your browser
start browser-test.html  # Windows
open browser-test.html   # macOS
```

## Method 6: VS Code Debug Test

### 1. Set Breakpoints
- Open `src/builder/TemplateBuilder.ts`
- Set breakpoint in `buildFromText` method

### 2. Create Debug Configuration
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug TemplateBuilder",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/code/packages/code-block-library/quick-test.js",
      "cwd": "${workspaceFolder}/code/packages/code-block-library",
      "console": "integratedTerminal"
    }
  ]
}
```

### 3. Run Debug
- Press F5 to start debugging
- Step through the code as templates are parsed and built

## What Each Test Verifies

### ✅ Parser Tests
- YAML parsing works
- Template structure validation
- Error collection

### ✅ Builder Tests
- Component resolution from registry
- Props mapping (state binding)
- Conditional rendering
- Action handler creation
- React component tree building

### ✅ CSP Compliance Tests
- No eval() usage
- No new Function() calls
- Safe expression evaluation
- Pre-compiled component assembly

### ✅ Integration Tests
- Template → AST → Component pipeline
- Error handling graceful failures
- Memory management (no leaks)

## Troubleshooting

### Problem: Module not found
**Solution:** Make sure you've run `npm run build` first

### Problem: TypeScript errors
**Solution:** Check tsconfig.json has `"noEmit": false`

### Problem: React not rendering
**Solution:** Ensure React and ReactDOM are available in your environment

### Problem: Template parsing fails
**Solution:** Check YAML syntax with online YAML validator

## Quick Success Check

Run this one-liner to verify everything works:
```bash
cd code/packages/code-block-library && npm run build && node quick-test.js
```

If you see "🎉 All tests passed!" then TemplateBuilder is working correctly! 🎯