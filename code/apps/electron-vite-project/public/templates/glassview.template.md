# GlassView - Cursor Code Review Enhancer

A template-driven mini-app that displays Cursor IDE review documents in a slider with AI-powered icon triggers.

## Template Definition

```yaml
GLASSVIEW_APP:
  name: "GlassView"
  version: "1.0.0"
  description: "Cursor code review enhancer with AI-powered triggers"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "GlassView"
      initialState:
        cursorChangedFiles: []
        selectedFileIndex: 0
        selectedFileDiff: ""
        selectedLine: 0
        isConnected: false
        aiResponse: null
        triggerHistory: []
      theme:
        primaryColor: "#3b82f6"
        backgroundColor: "#ffffff"
        fontFamily: "system-ui, -apple-system, sans-serif"
  
  layout:
    - component: "container"
      props:
        title: "GlassView"
        padding: "16px"
        className: "glassview-container"
      
      children:
        # Connection Status
        - component: "status-indicator"
          props:
            message: "Connected to Cursor"
            color: "green"
          condition: "state.isConnected"
        
        - component: "status-indicator"
          props:
            message: "Waiting for Cursor..."
            color: "yellow"
          condition: "!state.isConnected"
        
        # File Slider Navigation
        - component: "slider-navigation"
          block: "slider-navigation"
          condition: "state.cursorChangedFiles.length > 0"
          props:
            items: "{state.cursorChangedFiles}"
            currentIndex: "{state.selectedFileIndex}"
            showDots: true
            showArrows: true
            onChange: "handleFileSelection"
        
        # Empty State
        - component: "container"
          condition: "state.cursorChangedFiles.length === 0"
          props:
            className: "empty-state"
            style:
              textAlign: "center"
              padding: "40px 20px"
              color: "#64748b"
          children:
            - component: "text"
              props:
                content: "No changed files detected. Open a project in Cursor to see code reviews here."
        
        # Code Hunk Display with Icon Triggers
        - component: "code-hunk-display"
          block: "code-hunk-display"
          condition: "state.selectedFileDiff"
          props:
            diff: "{state.selectedFileDiff}"
            filename: "{state.cursorChangedFiles[state.selectedFileIndex]}"
            showLineNumbers: true
            enableIconTriggers: true
            onHunkClick: "handleHunkClick"
            onIconTrigger: "handleIconTrigger"
        
        # Icon Trigger Row
        - component: "container"
          condition: "state.selectedFileDiff"
          props:
            className: "trigger-row"
            style:
              display: "flex"
              gap: "12px"
              marginTop: "16px"
              justifyContent: "center"
          children:
            - component: "icon-trigger"
              block: "icon-trigger"
              props:
                color: "blue"
                icon: "ℹ️"
                label: "Explain this code"
                onTrigger: "handleIconTrigger"
            
            - component: "icon-trigger"
              block: "icon-trigger"
              props:
                color: "red"
                icon: "🛡️"
                label: "Check security"
                onTrigger: "handleIconTrigger"
            
            - component: "icon-trigger"
              block: "icon-trigger"
              props:
                color: "green"
                icon: "✨"
                label: "Suggest improvements"
                onTrigger: "handleIconTrigger"
            
            - component: "icon-trigger"
              block: "icon-trigger"
              props:
                color: "orange"
                icon: "⚡"
                label: "Performance check"
                onTrigger: "handleIconTrigger"
            
            - component: "icon-trigger"
              block: "icon-trigger"
              props:
                color: "purple"
                icon: "🔧"
                label: "Refactor"
                onTrigger: "handleIconTrigger"
        
        # AI Response Display
        - component: "container"
          condition: "state.aiResponse"
          props:
            className: "ai-response"
            style:
              marginTop: "16px"
              padding: "16px"
              background: "#f8fafc"
              borderRadius: "8px"
              border: "1px solid #e2e8f0"
          children:
            - component: "text"
              props:
                content: "{state.aiResponse}"
        
        # Open in Editor Button
        - component: "open-file-action"
          block: "open-file-action"
          condition: "state.selectedFileDiff"
          props:
            filePath: "{state.cursorChangedFiles[state.selectedFileIndex]}"
            lineNumber: "{state.selectedLine}"
            asButton: true
          children:
            - component: "text"
              props:
                content: "📂 Open in Cursor"
  
  actions:
    handleFileSelection:
      type: "STATE_UPDATE"
      updates:
        selectedFileIndex: "{payload}"
      then:
        - action: "FETCH_DIFF"
    
    FETCH_DIFF:
      type: "IPC_MESSAGE"
      payload:
        type: "GET_DIFF"
        filePath: "{state.cursorChangedFiles[state.selectedFileIndex]}"
      onSuccess:
        - updateState:
            selectedFileDiff: "{response.diff}"
    
    handleHunkClick:
      type: "STATE_UPDATE"
      updates:
        selectedLine: "{payload.lineNumber}"
      then:
        - blocks:
          - block: "open-file-action"
            props:
              filePath: "{state.cursorChangedFiles[state.selectedFileIndex]}"
              lineNumber: "{payload.lineNumber}"
    
    handleIconTrigger:
      type: "CONDITIONAL"
      conditions:
        - when: "payload.color === 'blue'"
          action: "EXPLAIN_CODE"
        - when: "payload.color === 'red'"
          action: "SECURITY_SCAN"
        - when: "payload.color === 'green'"
          action: "SUGGEST_IMPROVEMENTS"
        - when: "payload.color === 'orange'"
          action: "PERFORMANCE_CHECK"
        - when: "payload.color === 'purple'"
          action: "REFACTOR_SUGGEST"
    
    EXPLAIN_CODE:
      type: "AI_REQUEST"
      prompt: "Explain what this code change does and why it's important: {state.selectedFileDiff}"
      onSuccess:
        - updateState:
            aiResponse: "{response.result}"
    
    SECURITY_SCAN:
      type: "AI_REQUEST"
      prompt: "Analyze this code change for security vulnerabilities or concerns: {state.selectedFileDiff}"
      onSuccess:
        - updateState:
            aiResponse: "{response.result}"
    
    SUGGEST_IMPROVEMENTS:
      type: "AI_REQUEST"
      prompt: "Suggest improvements and best practices for this code change: {state.selectedFileDiff}"
      onSuccess:
        - updateState:
            aiResponse: "{response.result}"
    
    PERFORMANCE_CHECK:
      type: "AI_REQUEST"
      prompt: "Analyze this code change for performance implications and optimizations: {state.selectedFileDiff}"
      onSuccess:
        - updateState:
            aiResponse: "{response.result}"
    
    REFACTOR_SUGGEST:
      type: "AI_REQUEST"
      prompt: "Suggest refactoring opportunities for this code to improve readability and maintainability: {state.selectedFileDiff}"
      onSuccess:
        - updateState:
            aiResponse: "{response.result}"

  events:
    - listen: "CURSOR_FILES_CHANGED"
      action: "handleCursorFilesChanged"
    
    - listen: "AI_RESPONSE_READY"
      action: "handleAiResponse"
    
    - listen: "CONNECTION_STATUS"
      action: "handleConnectionStatus"

  handlers:
    handleCursorFilesChanged:
      - updateState:
          cursorChangedFiles: "{payload.files}"
          isConnected: true
      - action: "FETCH_DIFF"
    
    handleAiResponse:
      - updateState:
          aiResponse: "{payload.result}"
    
    handleConnectionStatus:
      - updateState:
          isConnected: "{payload.connected}"

  integrations:
    orchestrator:
      panel: "mini-app-sidebar"
      position: "right"
      minWidth: "320px"
      maxWidth: "480px"
      resizable: true
      events:
        subscribe:
          - "cursor:files_changed"
          - "ai:response_ready"
          - "orchestrator:connection_status"
        emit:
          - "glassview:trigger_activated"
          - "glassview:file_opened"
          - "glassview:ai_request"
```

## Plain English Description

**What GlassView Does:**

GlassView is a mini-app that enhances your Cursor IDE workflow by providing a visual interface for reviewing code changes with AI-powered analysis.

**How It Works:**

1. **File Slider**: When you have changed files in Cursor, they appear as slides you can swipe through using arrows or dots. This gives you a quick overview of all changes in your session.

2. **Code Diff Display**: For the currently selected file, you see the actual code changes - added lines in green, removed lines in red, with line numbers for reference.

3. **AI-Powered Icon Triggers**: Small colored buttons let you trigger AI analysis on the current code:
   - 🔵 **Blue (Explain)**: "What does this code change do?"
   - 🔴 **Red (Security)**: "Are there any security issues?"
   - 🟢 **Green (Improve)**: "How can this code be better?"
   - 🟠 **Orange (Performance)**: "Any performance concerns?"
   - 🟣 **Purple (Refactor)**: "How should this be restructured?"

4. **Quick Navigation**: Click any line to open that exact location in Cursor editor.

5. **Live Updates**: The app automatically updates when you make changes in Cursor.

**Template-Driven Innovation:**

This app is built entirely from a plain text template - not hardcoded React. The orchestrator:
1. Reads this template file
2. Parses the YAML configuration
3. Assembles the app from pre-built, pre-hashed code blocks
4. Renders it in the sidebar panel

This approach:
- Complies with Chrome's strict Content Security Policy
- Allows AI to generate apps by writing templates
- Enables sharing apps as simple text files
- Maintains security through pre-validated code blocks
