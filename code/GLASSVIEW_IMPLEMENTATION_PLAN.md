# GlassView Mini-App Implementation Plan

## Client Requirements (Nov 26, 2025)

### Core Concept
Build a **template-based mini-app system** where apps are assembled from a code block library, not hardcoded React components.

### The Problem
- Chrome CSP blocks inline scripts
- Can't generate real-time UI dynamically in orchestrator
- Need to prepare for fast local AI (600-1000 tokens/sec)

### The Solution
1. **Code Block Library** - Pre-hashed, CSP-compliant components
2. **Text Templates** - Describe apps in plain text
3. **Dynamic Assembly** - Orchestrator reads template, builds from library
4. **Template Sources**:
   - Publisher-created templates
   - User-modified templates
   - AI-generated on-the-fly templates

---

## GlassView App Specifications

### Purpose
Display Cursor/AI session review documents in sidebar with interactive code hunks.

### Features

#### 1. Slider Navigation
- Navigate through code hunks/files
- Previous/Next controls
- Jump to specific hunk

#### 2. Color-Coded Diff Display
- **Red (-)**: Deleted lines
- **Green (+)**: Added lines
- **Yellow**: Critical issues (future)
- **Orange**: Warnings (future)
- Syntax highlighting maintained

#### 3. Icon-Trigger System
- Small color-coded icons attached to each hunk
- **Matching colors = trigger action**
- Example actions:
  - 🔒 **Security Analysis**: "Is this hunk secure?"
  - 💡 **Explain**: "What does this code do?"
  - 📂 **Open in Editor**: Jump to file at this location
  - ⚠️ **Flag Issue**: Mark as potential problem
  - ✅ **Approve**: Mark as reviewed/safe
  
#### 4. Data Source
- Read from Cursor/AI session logs
- Parse git diffs or file change history
- Track AI-specific changes vs manual changes

---

## Phase 1: Build Code Block Library Foundation

### Step 1.1: Create Library Structure
```
packages/code-block-library/
├── blocks/
│   ├── bootstrap/
│   │   ├── react-app.block.json
│   │   └── react-app.component.tsx
│   ├── ui/
│   │   ├── slider.block.json
│   │   ├── slider.component.tsx
│   │   ├── icon-trigger.block.json
│   │   └── icon-trigger.component.tsx
│   ├── integrations/
│   │   ├── open-file-in-editor.block.json
│   │   └── open-file-in-editor.component.tsx
│   └── diff-viewer/
│       ├── code-hunk.block.json
│       └── code-hunk.component.tsx
├── templates/
│   ├── glassview-app.template.txt
│   └── template-schema.json
└── index.ts
```

### Step 1.2: Define Block Schema
Each block has:
```json
{
  "id": "slider-navigation",
  "name": "Slider Navigation Component",
  "description": "A horizontal slider for navigating between items. Supports touch/mouse gestures, prev/next buttons, and direct item selection.",
  "category": "ui",
  "inputs": {
    "items": {
      "type": "array",
      "description": "Array of items to display in slider"
    },
    "currentIndex": {
      "type": "number",
      "description": "Currently active slide index"
    }
  },
  "outputs": {
    "onChange": {
      "type": "function",
      "description": "Callback when slide changes"
    }
  },
  "dependencies": ["react"],
  "cspCompliant": true,
  "securityHash": "sha256-abc123..."
}
```

### Step 1.3: Create Template Format
```
GLASSVIEW_APP {
  bootstrap: react-app
  layout: sidebar-panel
  
  components: [
    {
      block: slider-navigation
      props: {
        items: @session.codeHunks
        currentIndex: @state.currentHunk
      }
      on: {
        change: @actions.navigateToHunk
      }
    },
    {
      block: code-hunk-display
      props: {
        hunk: @state.currentHunk
        colorScheme: diff-standard
      }
      icons: [
        {
          block: icon-trigger
          color: blue
          action: analyze-security
          matchColor: blue
        },
        {
          block: icon-trigger
          color: green
          action: explain-code
          matchColor: green
        }
      ]
    }
  ]
}
```

---

## Phase 2: Template Parser & Builder

### Step 2.1: Template Parser
- Parse text template into AST
- Validate block references
- Resolve dependencies

### Step 2.2: Component Builder
- Load blocks from library
- Inject props and event handlers
- Generate CSP-compliant code
- Return React component tree

### Step 2.3: Security Layer
- Verify block hashes
- Validate CSP compliance
- Sandbox execution context

---

## Phase 3: GlassView Specific Implementation

### Step 3.1: Session Data Provider
- Hook into AI/Cursor session tracking
- Parse code changes
- Build hunk data structure

### Step 3.2: Diff Parser
- Parse git diffs
- Identify added/deleted/modified lines
- Extract context for each hunk

### Step 3.3: Icon-Trigger Actions
- Define action handlers:
  - Security analysis → Send to LLM
  - Explain code → Generate explanation
  - Open in editor → IPC to open file
- Implement color-matching logic

---

## Phase 4: Integration

### Step 4.1: Orchestrator Integration
- Add template loader
- Hook into WebSocket for commands
- Serve built components

### Step 4.2: Extension Integration
- Update sidepanel to load GlassView
- Handle template requests
- Display dynamically built UI

### Step 4.3: Testing
- Test with real Cursor session data
- Verify CSP compliance
- Performance testing with fast AI

---

## Immediate Next Steps

1. ✅ Rename "Mini-App" → "GlassView" throughout codebase
2. ✅ Create code block library package structure
3. ✅ Define first 5 core blocks:
   - react-app (bootstrap)
   - slider-navigation
   - icon-trigger
   - code-hunk-display
   - open-file-action
4. ✅ Build template parser (basic version)
5. ✅ Create example GlassView template
6. 🔄 Test with mock session data

---

## Technical Considerations

### CSP Compliance
- No `eval()` or `new Function()`
- No inline scripts
- All code pre-hashed and loaded via trusted sources
- Use React refs and props for dynamic behavior

### Performance
- Lazy load blocks
- Cache parsed templates
- Optimize for 600-1000 tokens/sec AI output

### Extensibility
- Publishers can add blocks to library
- Users can modify templates
- AI can generate templates on-the-fly

---

## Success Criteria

1. ✅ Code block library established with clear schema
2. ✅ Template format defined and documented
3. ✅ Can build GlassView from text template
4. ✅ CSP-compliant execution
5. ✅ Icon-trigger system working
6. ✅ Can display real Cursor session diffs

