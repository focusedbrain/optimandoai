# Code Block Library - Block Catalog

## Overview
This catalog lists all available blocks in the code block library with their plain English descriptions, inputs, outputs, and usage examples.

---

## Bootstrap Blocks

### react-app
**Category:** Bootstrap  
**ID:** `react-app`  
**Purpose:** Foundation for all GlassView applications

**Plain English:**
> This is the foundation block that every GlassView app needs to start with. It sets up the basic React application structure that all other blocks build upon. Think of it as the skeleton or framework that holds everything together. It creates a central place to store data (called 'state') that all parts of the app can access and update. For example, if you're building a code review app, the state might include which files are being watched, which file is currently selected, and what code changes have been detected. It also provides an 'event bus' - a messaging system that lets different parts of the app talk to each other. Without this bootstrap block, no other blocks can function because they need this foundation to exist on. Every GlassView template must start with this block.

**Inputs:**
- `appName` (string, required) - Name of the application
- `initialState` (object, optional) - Initial application state
- `theme` (object, optional) - Theme configuration (colors, fonts, spacing)

**Outputs:**
- `stateContext` (context) - React context providing state and setState to all child components
- `eventBus` (object) - Event bus for inter-component communication

**Usage Example:**
```yaml
bootstrap:
  block: "react-app"
  config:
    appName: "File Watcher"
    initialState:
      selectedFile: null
      isWatching: false
    theme:
      primaryColor: "#3b82f6"
```

---

## UI Blocks

### slider-navigation
**Category:** UI  
**ID:** `slider-navigation`  
**Purpose:** Navigate between multiple items with visual controls

**Plain English:**
> This block creates a slider that lets users navigate between multiple items. Think of it like a photo carousel - you can click arrows to go forward/backward, or click dots at the bottom to jump to a specific item. It's useful for showing code changes one at a time, where each slide represents a different file or code hunk. The slider tracks which item you're currently viewing and calls a function whenever you switch to a different item.

**Inputs:**
- `items` (array, required) - Array of items to display in the slider
- `currentIndex` (number, required, default: 0) - Currently active slide index (0-based)
- `showDots` (boolean, optional, default: true) - Show navigation dots below slider
- `showArrows` (boolean, optional, default: true) - Show prev/next arrow buttons

**Outputs:**
- `onChange` (function) - Callback fired when slide changes. Receives new index as parameter.

**Usage Example:**
```yaml
- component: "slider-navigation"
  block: "slider-navigation"
  props:
    items: "{state.changedFiles}"
    currentIndex: "{state.selectedFileIndex}"
    showDots: true
    showArrows: true
    onChange: "handleFileSelection"
```

---

### icon-trigger
**Category:** UI  
**ID:** `icon-trigger`  
**Purpose:** Color-coded clickable icons for triggering actions

**Plain English:**
> This block creates small colored icons that users can click to trigger actions. Think of them as smart buttons that are color-coded by purpose. For example, a blue icon might mean 'explain this code', a red icon might mean 'check for security issues', and a green icon might mean 'suggest improvements'. The icons can be attached to specific lines of code or code hunks. When clicked, they send a message telling the system what action to perform and what code to analyze. This is the key mechanism for users to interact with code analysis features - instead of typing commands, they just click the appropriately colored icon.

**Inputs:**
- `color` (string, required) - The color of the icon
  - Options: `blue`, `green`, `red`, `yellow`, `purple`, `orange`
- `icon` (string, required) - Icon identifier (emoji or name)
- `label` (string, optional) - Tooltip text shown on hover
- `position` (object, optional) - Position relative to parent (line number or offset)

**Outputs:**
- `onTrigger` (function) - Callback fired when icon is clicked. Receives color and context data.

**Color Meanings:**
- 🔵 **Blue** - Explain code / Documentation
- 🟢 **Green** - Suggest improvements
- 🔴 **Red** - Security scan / Check vulnerabilities
- 🟡 **Yellow** - Performance analysis
- 🟣 **Purple** - Generate tests
- 🟠 **Orange** - Refactor suggestions

**Usage Example:**
```yaml
- component: "icon-trigger"
  block: "icon-trigger"
  props:
    color: "blue"
    icon: "💡"
    label: "Explain this code"
    onTrigger: "handleIconTrigger"
```

---

## Diff Viewer Blocks

### code-hunk-display
**Category:** Diff Viewer  
**ID:** `code-hunk-display`  
**Purpose:** Visual display of git diffs with syntax highlighting

**Plain English:**
> This block displays code changes in a visual format, like what you see in GitHub pull requests. It shows what was deleted (in red with a minus sign) and what was added (in green with a plus sign). Each chunk of changes is called a 'hunk'. The block maintains the original code formatting and indentation. If enabled, it can also show icon-triggers next to each hunk, allowing users to click colored icons to analyze that specific code change. For example, clicking a blue icon next to a hunk could ask AI to explain why that change was made. This is useful for code review workflows where you want to examine changes piece by piece.

**Inputs:**
- `diff` (string, required) - Git diff text to display
- `filename` (string, required) - Name of the file being displayed
- `language` (string, optional) - Programming language for syntax highlighting
- `showLineNumbers` (boolean, optional, default: true) - Show line numbers in diff
- `enableIconTriggers` (boolean, optional, default: false) - Show icon triggers on each hunk

**Outputs:**
- `onHunkClick` (function) - Callback fired when a diff hunk is clicked
- `onIconTrigger` (function) - Callback fired when icon trigger is clicked on a hunk

**Visual Format:**
- 🟢 Green background = Added lines (+)
- 🔴 Red background = Deleted lines (-)
- ⚪ White background = Context lines (unchanged)
- 🔵 Gray background = Hunk headers (@@)

**Usage Example:**
```yaml
- component: "code-hunk-display"
  block: "code-hunk-display"
  condition: "state.currentDiff"
  props:
    diff: "{state.currentDiff}"
    filename: "{state.changedFiles[state.selectedFileIndex]}"
    language: "typescript"
    showLineNumbers: true
    enableIconTriggers: true
    onHunkClick: "handleHunkClick"
    onIconTrigger: "handleIconTrigger"
```

---

## Integration Blocks

### open-file-action
**Category:** Integrations  
**ID:** `open-file-action`  
**Purpose:** Open files in code editor with navigation

**Plain English:**
> This block provides the ability to open files in your code editor (like VS Code or Cursor) from within a GlassView app. When you click on a file or code change in the app, this block sends a message to the orchestrator (the desktop application) asking it to open that file in your editor. You can specify which line to jump to, so clicking on a specific code change takes you right to that exact line in your editor. It can also highlight a range of lines. Think of it as a bridge between the browser-based GlassView app and your desktop editor. This is essential for workflows where you review code changes in the app and want to quickly navigate to the actual file to make edits.

**Inputs:**
- `filePath` (string, required) - Absolute or relative path to the file
- `lineNumber` (number, optional) - Line number to navigate to
- `columnNumber` (number, optional) - Column number for precise cursor positioning
- `highlightRange` (object, optional) - Range to highlight { start: number, end: number }

**Outputs:**
- `onSuccess` (function) - Callback fired when file is successfully opened
- `onError` (function) - Callback fired if opening fails with error message

**Supported Editors:**
- VS Code
- Cursor
- (Other editors configurable in orchestrator)

**Usage Example:**
```yaml
- component: "open-file-action"
  block: "open-file-action"
  props:
    filePath: "{state.selectedFile}"
    lineNumber: "{state.selectedLine}"
    onSuccess: "handleFileOpened"
    onError: "handleOpenError"
```

**As Button:**
```typescript
<OpenFileAction 
  filePath="/path/to/file.ts"
  lineNumber={42}
  asButton={true}
>
  Open in Editor 📝
</OpenFileAction>
```

---

## Template Syntax Reference

### Basic Structure
```yaml
GLASSVIEW_APP:
  name: "App Name"
  version: "1.0.0"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "My App"
      initialState: {}
      theme: {}
  
  layout:
    - component: "block-name"
      block: "block-id"
      props: {}
      condition: "expression"
      children: []
  
  actions:
    ACTION_NAME:
      type: "IPC_MESSAGE|STATE_UPDATE|CONDITIONAL|AI_REQUEST"
      payload: {}
  
  events:
    - listen: "EVENT_NAME"
      action: "ACTION_NAME"
```

### State Binding
Use curly braces to reference state values:
```yaml
props:
  items: "{state.changedFiles}"
  currentIndex: "{state.selectedFileIndex}"
  filename: "{state.changedFiles[state.selectedFileIndex]}"
```

### Conditional Rendering
```yaml
condition: "state.isWatching"
condition: "state.changedFiles.length > 0"
condition: "!state.error"
```

### Action Types

#### IPC_MESSAGE
Send message to Electron orchestrator:
```yaml
START_WATCHING:
  type: "IPC_MESSAGE"
  payload:
    type: "START_WATCHING"
    path: "{state.projectPath}"
  onSuccess:
    - updateState: { isWatching: true }
```

#### STATE_UPDATE
Update application state:
```yaml
handleFileSelection:
  type: "STATE_UPDATE"
  updates:
    selectedFileIndex: "{payload}"
  then:
    - action: "FETCH_DIFF"
```

#### CONDITIONAL
Execute actions based on conditions:
```yaml
handleIconTrigger:
  type: "CONDITIONAL"
  conditions:
    - when: "payload.color === 'blue'"
      action: "EXPLAIN_CODE"
    - when: "payload.color === 'red'"
      action: "SECURITY_SCAN"
```

#### AI_REQUEST
Send prompt to AI:
```yaml
EXPLAIN_CODE:
  type: "AI_REQUEST"
  prompt: "Explain this code change: {payload.hunk}"
```

---

## Block Development Guide

### Adding a New Block

1. **Create block metadata** (`blockname.block.json`):
```json
{
  "id": "my-block",
  "name": "My Block",
  "description": "Short description",
  "category": "ui",
  "version": "1.0.0",
  "inputs": {},
  "outputs": {},
  "dependencies": ["react"],
  "cspCompliant": true,
  "securityHash": "sha256-placeholder",
  "plainEnglishDescription": "Detailed explanation..."
}
```

2. **Create React component** (`blockname.component.tsx`):
```typescript
import React from 'react';

interface MyBlockProps {
  // Define props
}

export const MyBlock: React.FC<MyBlockProps> = (props) => {
  return <div>Block content</div>;
};
```

3. **Register the block** in `BlockRegistry.ts`:
```typescript
import myBlockMeta from '../blocks/category/my-block.block.json';
import { MyBlock } from '../blocks/category/my-block.component';

registry.register(myBlockMeta as BlockMetadata, MyBlock);
```

4. **Export from index.ts**:
```typescript
export { MyBlock } from './blocks/category/my-block.component';
export { default as myBlockMetadata } from './blocks/category/my-block.block.json';
```

### Plain English Description Guidelines

Write as if explaining to someone who doesn't know programming:
- Use analogies ("Think of it like...")
- Describe the problem it solves
- Give concrete examples
- Explain when to use it
- Avoid jargon where possible
- If using technical terms, explain them

**Good Example:**
> "This block creates a slider that lets users navigate between multiple items. Think of it like a photo carousel - you can click arrows to go forward/backward, or click dots at the bottom to jump to a specific item."

**Bad Example:**
> "Implements a React component with controlled state for index management and event handlers for navigation."

---

## CSP Compliance Checklist

All blocks must be CSP-compliant:

✅ No inline styles in JSX (use style objects)
✅ No eval() or new Function()
✅ No inline event handlers in HTML strings
✅ No dynamic script loading
✅ All code pre-compiled at build time
✅ Security hash generated for each block

---

## Future Blocks (Roadmap)

### Planned UI Blocks
- `file-list` - Display array of files with icons
- `input-group` - Text input with label
- `button` - Action trigger button
- `status-indicator` - Connection/status display
- `notification` - Toast message system
- `progress-bar` - Progress visualization
- `tabs` - Tabbed interface

### Planned Integration Blocks
- `git-commit-action` - Commit changes from app
- `ai-chat-action` - Interactive AI conversation
- `file-upload-action` - Upload files to orchestrator
- `settings-panel` - App configuration UI

### Planned Diff Viewer Blocks
- `side-by-side-diff` - Split view diff display
- `inline-diff` - Inline diff with expand/collapse
- `diff-stats` - Visual statistics (additions/deletions)

---

## Version History

- **v1.0.0** (2025-01-XX) - Initial release
  - 5 core blocks (react-app, slider-navigation, icon-trigger, code-hunk-display, open-file-action)
  - Block registry system
  - Template parser foundation
  - Type system
  - Sample template (file-watcher)
