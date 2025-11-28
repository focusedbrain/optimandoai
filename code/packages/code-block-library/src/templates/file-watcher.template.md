# GlassView Template: File Watcher

## Description
A GlassView application that watches a directory for file changes, displays them in a slider, and allows viewing diffs with icon-triggered actions.

## Template Structure

```yaml
GLASSVIEW_APP:
  name: "File Watcher"
  version: "1.0.0"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "File Watcher"
      initialState:
        projectPath: ""
        isWatching: false
        changedFiles: []
        selectedFileIndex: 0
        currentDiff: ""
      theme:
        primaryColor: "#3b82f6"
        backgroundColor: "#ffffff"
        fontFamily: "system-ui, sans-serif"
  
  layout:
    - component: "container"
      props:
        title: "File Watcher"
        padding: "20px"
      
      children:
        - component: "input-group"
          props:
            label: "Project Path"
            placeholder: "Enter directory path to watch..."
            stateKey: "projectPath"
        
        - component: "button"
          condition: "!state.isWatching"
          props:
            label: "Start Watching"
            action: "START_WATCHING"
        
        - component: "button"
          condition: "state.isWatching"
          props:
            label: "Stop Watching"
            action: "STOP_WATCHING"
        
        - component: "status-indicator"
          condition: "state.isWatching"
          props:
            message: "Watching: {state.projectPath}"
            color: "green"
        
        - component: "slider-navigation"
          block: "slider-navigation"
          condition: "state.changedFiles.length > 0"
          props:
            items: "{state.changedFiles}"
            currentIndex: "{state.selectedFileIndex}"
            showDots: true
            showArrows: true
            onChange: "handleFileSelection"
        
        - component: "code-hunk-display"
          block: "code-hunk-display"
          condition: "state.currentDiff"
          props:
            diff: "{state.currentDiff}"
            filename: "{state.changedFiles[state.selectedFileIndex]}"
            showLineNumbers: true
            enableIconTriggers: true
            onHunkClick: "handleHunkClick"
            onIconTrigger: "handleIconTrigger"
  
  actions:
    START_WATCHING:
      type: "IPC_MESSAGE"
      payload:
        type: "START_WATCHING"
        path: "{state.projectPath}"
      onSuccess: 
        - updateState: { isWatching: true }
    
    STOP_WATCHING:
      type: "IPC_MESSAGE"
      payload:
        type: "STOP_WATCHING"
      onSuccess:
        - updateState: { isWatching: false, changedFiles: [] }
    
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
        filePath: "{state.changedFiles[state.selectedFileIndex]}"
      onSuccess:
        - updateState: { currentDiff: "{response.diff}" }
    
    handleHunkClick:
      blocks:
        - block: "open-file-action"
          props:
            filePath: "{state.changedFiles[state.selectedFileIndex]}"
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
    
    EXPLAIN_CODE:
      type: "AI_REQUEST"
      prompt: "Explain this code change: {payload.hunk}"
    
    SECURITY_SCAN:
      type: "AI_REQUEST"
      prompt: "Analyze this code for security issues: {payload.hunk}"
    
    SUGGEST_IMPROVEMENTS:
      type: "AI_REQUEST"
      prompt: "Suggest improvements for: {payload.hunk}"

  events:
    - listen: "FILE_CHANGED"
      action: "handleFileChanged"
    
    - listen: "WATCHING_ERROR"
      action: "handleError"

  handlers:
    handleFileChanged:
      - updateState: 
          changedFiles: "addUniqueFile(state.changedFiles, payload.filePath)"
    
    handleError:
      - showNotification:
          message: "{payload.error}"
          type: "error"
```

## Plain English Explanation

**What this app does:**
This GlassView app helps you monitor a folder for file changes and review those changes visually. It's like having a smart file watcher that shows you exactly what changed in each file.

**How it works:**
1. You enter a folder path and click "Start Watching"
2. The app monitors that folder and detects when files are modified
3. Changed files appear in a slider - you can navigate between them using arrows or dots
4. For each file, the app shows the code differences (what was added in green, what was removed in red)
5. You can click colored icons next to code changes to trigger AI analysis:
   - Blue icon = "Explain what this code does"
   - Red icon = "Check for security problems"
   - Green icon = "Suggest improvements"
6. Clicking on a file opens it in your editor at the exact line that changed

**Template-based construction:**
Instead of hardcoding React components, this app is defined as a plain text template. The orchestrator reads this template and assembles the app from pre-built, pre-hashed code blocks (slider-navigation, code-hunk-display, open-file-action, etc.). This approach:
- Complies with Chrome's strict Content Security Policy (no runtime code generation)
- Allows AI to generate apps by writing templates (no complex React knowledge needed)
- Enables publishers to share apps as simple text files
- Maintains security through pre-validated, hashed code blocks
