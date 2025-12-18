# Code Executor Implementation

## Overview

The Code Executor feature allows users to generate and execute code through natural language queries. Users can request anything from simple scripts (e.g., "print odd numbers 1-10") to full mini-apps (e.g., "create a calculator").

---

## New Files Created

### 1. `electron/main/code-executor/index.ts`
**Location:** `d:\projects\Oscar\optimandoai\code\apps\electron-vite-project\electron\main\code-executor\index.ts`

**Purpose:** Core code execution service

**Key Functions:**

```typescript
// Default folder for generated code - uses system temp directory
const DEFAULT_CODE_FOLDER = path.join(os.tmpdir(), 'optimandoai-generated-code')
// Resolves to:
// - Windows: C:\Users\<username>\AppData\Local\Temp\optimandoai-generated-code
// - macOS: /var/folders/.../optimandoai-generated-code
// - Linux: /tmp/optimandoai-generated-code

// Get/Set the code folder
export function getCodeFolder(): string
export function setCodeFolder(folder: string): void

// System prompt for AI code generation
export function getCodeGenerationSystemPrompt(): string

// Extract code from AI response (parses markdown code blocks)
export function extractCodeFromResponse(response: string): { code: string; language: string } | null

// Execute code and return result
export async function executeCode(code: string, language: string): Promise<ExecutionResult>

// Full pipeline: AI generates code → save → execute → return result
export async function executeGeneratedCode(
  aiResponse: string,
  query: string
): Promise<ExecutionResult>
```

**Supported Languages:**
- Python (`.py`) - executed with `python`
- JavaScript (`.js`) - executed with `node`
- TypeScript (`.ts`) - executed with `npx ts-node`
- HTML (`.html`) - saved as mini-app, opened in browser
- Bash (`.sh`) - executed with `bash`
- PowerShell (`.ps1`) - executed with `powershell`

---

### 2. `electron/main/code-executor/ipc.ts`
**Location:** `d:\projects\Oscar\optimandoai\code\apps\electron-vite-project\electron\main\code-executor\ipc.ts`

**Purpose:** IPC handlers for Electron inter-process communication

**Key Functions:**

```typescript
export function registerCodeExecutorHandlers(): void
```

**IPC Channels:**
- `code-executor:get-folder` - Returns current code folder path
- `code-executor:set-folder` - Sets new code folder path
- `code-executor:execute` - Executes code with given language
- `code-executor:list-files` - Lists generated files
- `code-executor:cleanup` - Deletes old generated files

---

## Modified Files

### 1. `electron/main/llm/ollama-manager.ts`
**Location:** `d:\projects\Oscar\optimandoai\code\apps\electron-vite-project\electron\main\llm\ollama-manager.ts`

**Changes Made:**

Increased chat timeout from 2 minutes to 5 minutes (line ~368):
```typescript
// Before
signal: AbortSignal.timeout(120000) // 2 minute timeout

// After
signal: AbortSignal.timeout(300000) // 5 minute timeout for larger models
```

**Reason:** The `qwen2.5-coder:7b` model needs more time to generate complex code like calculator apps.

---

### 2. `electron/main.ts`
**Location:** `d:\projects\Oscar\optimandoai\code\apps\electron-vite-project\electron\main.ts`

**Changes Made:**

#### a) Added imports (around line 50)
```typescript
import { 
  getCodeFolder, 
  setCodeFolder, 
  getCodeGenerationSystemPrompt,
  extractCodeFromResponse,
  executeCode,
  cleanupOldFiles,
  listGeneratedFiles
} from './main/code-executor'
```

#### b) Added HTTP API endpoints (around lines 3200-3300)

```typescript
// GET /api/code-executor/folder - Get current code folder
httpApp.get('/api/code-executor/folder', (_req, res) => {
  res.json({ ok: true, data: getCodeFolder() })
})

// POST /api/code-executor/folder - Set code folder
httpApp.post('/api/code-executor/folder', (req, res) => {
  const { folder } = req.body
  setCodeFolder(folder)
  res.json({ ok: true })
})

// GET /api/code-executor/files - List generated files
httpApp.get('/api/code-executor/files', async (_req, res) => {
  const files = await listGeneratedFiles()
  res.json({ ok: true, data: files })
})

// POST /api/code-executor/run - Generate and execute code
httpApp.post('/api/code-executor/run', async (req, res) => {
  const { query } = req.body
  // 1. Call AI with system prompt
  // 2. Extract code from response
  // 3. Save to file
  // 4. Execute code
  // 5. Return result with output/error
})

// POST /api/code-executor/cleanup - Delete old files
httpApp.post('/api/code-executor/cleanup', async (req, res) => {
  const { maxAgeDays } = req.body
  await cleanupOldFiles(maxAgeDays || 7)
  res.json({ ok: true })
})

// GET /api/code-executor/system-prompt - Get system prompt
httpApp.get('/api/code-executor/system-prompt', (_req, res) => {
  res.json({ ok: true, data: getCodeGenerationSystemPrompt() })
})
```

#### c) Fixed syntax error (line 1216-1218)
Added missing closing brace for `if (msg.type === 'SAVE_TRIGGER')` block that was incorrectly nesting subsequent handlers.

#### d) Fixed type error (line 3253)
```typescript
// Before
const messages = [...]

// After  
const messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = [...]
```

#### e) Fixed unused parameter warning (line 3694)
```typescript
// Before
httpApp.get('/api/cursor/state', (req, res) => {

// After
httpApp.get('/api/cursor/state', (_req, res) => {
```

---

### 3. `extension-chromium/public/popup.html`
**Location:** `d:\projects\Oscar\optimandoai\code\apps\extension-chromium\public\popup.html`

**Changes Made:**

Added "Code Executor" mode option in the mode dropdown:
```html
<option value="code-executor">🚀 Code Executor</option>
```

Added Code Executor view container:
```html
<div id="code-executor-view" class="view" style="display: none;">
  <div class="code-executor-container">
    <h3>🚀 Code Executor</h3>
    <p class="helper-text">Describe what you want to create...</p>
    <textarea id="code-query" placeholder="e.g., print odd numbers from 1 to 10"></textarea>
    <button id="execute-code-btn" class="primary-btn">Generate & Run</button>
    <div id="code-result" class="code-result" style="display: none;">
      <h4>Result:</h4>
      <pre id="code-output"></pre>
      <button id="open-app-btn" style="display: none;">Open App</button>
    </div>
  </div>
</div>
```

Added CSS styles for the code executor UI.

---

### 4. `extension-chromium/public/popup.js`
**Location:** `d:\projects\Oscar\optimandoai\code\apps\extension-chromium\public\popup.js`

**Changes Made:**

Added mode switching logic:
```javascript
if (mode === 'code-executor') {
  document.getElementById('code-executor-view').style.display = 'block'
  // Hide other views
}
```

Added code execution function:
```javascript
async function executeCode() {
  const query = document.getElementById('code-query').value
  const response = await fetch('http://127.0.0.1:51248/api/code-executor/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  const result = await response.json()
  
  // Display output or show "Open App" button for HTML mini-apps
  if (result.data.isMiniApp) {
    document.getElementById('open-app-btn').style.display = 'block'
    document.getElementById('open-app-btn').onclick = () => window.open(result.data.appUrl)
  } else {
    document.getElementById('code-output').textContent = result.data.output
  }
}
```

---

## API Reference

### Base URL
```
http://127.0.0.1:51248
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/code-executor/folder` | Get current code folder path |
| POST | `/api/code-executor/folder` | Set code folder path |
| GET | `/api/code-executor/files` | List all generated files |
| POST | `/api/code-executor/run` | Generate and execute code |
| POST | `/api/code-executor/cleanup` | Delete old files |
| GET | `/api/code-executor/system-prompt` | Get AI system prompt |

### Example: Execute Code

**Request:**
```bash
curl -X POST http://127.0.0.1:51248/api/code-executor/run \
  -H "Content-Type: application/json" \
  -d '{"query": "print odd numbers from 1 to 10"}'
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "success": true,
    "output": "1\n3\n5\n7\n9\n",
    "filePath": "<system-temp>/optimandoai-generated-code/generated_123456.py",
    "language": "python",
    "executionTime": 222,
    "isMiniApp": false
  }
}
```

---

## Code Generation System Prompt

The AI uses this system prompt to generate properly formatted code:

```
You are an expert code generator. Your task is to generate executable code based on the user's request.

RULES:
1. Generate ONLY the code, no explanations before or after
2. The code must be complete and executable
3. Wrap your code in a code block with the language identifier
4. If the user doesn't specify a language, use Python by default
5. For simple outputs (print, calculations), use Python or JavaScript
6. For UI/visual apps, generate HTML with embedded CSS and JavaScript
7. Include all necessary imports/dependencies
8. Make the code self-contained and runnable

OUTPUT FORMAT:
```<language>
<your complete code here>
```
```

---

## File Storage

Generated code files are stored in the system temp directory:
```
<system-temp>/optimandoai-generated-code/
```

**Platform-specific locations:**
- **Windows:** `C:\Users\<username>\AppData\Local\Temp\optimandoai-generated-code\`
- **macOS:** `/var/folders/.../<random>/optimandoai-generated-code/`
- **Linux:** `/tmp/optimandoai-generated-code/`

Naming convention:
```
generated_<timestamp>.<extension>
```

Examples:
- `generated_1765011014170.py`
- `generated_1765011234567.html`
- `generated_1765011345678.js`

---

## Testing

### Test from PowerShell

```powershell
# Test simple Python code
$body = @{ query = "print odd numbers from 1 to 10" } | ConvertTo-Json
Invoke-WebRequest -Uri "http://127.0.0.1:51248/api/code-executor/run" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing

# Test HTML mini-app
$body = @{ query = "create a calculator app" } | ConvertTo-Json
Invoke-WebRequest -Uri "http://127.0.0.1:51248/api/code-executor/run" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
```

### Test from Chrome Extension

1. Open the extension popup
2. Select "🚀 Code Executor" from the mode dropdown
3. Enter a query like "print fibonacci sequence first 10 numbers"
4. Click "Generate & Run"
5. View the result in the output area

---

## Known Issues

1. **Ollama not in PATH**: The Ollama LLM must be installed and accessible from the command line. If you see "ollama not found" errors, add Ollama to your system PATH.

2. **AI response formatting**: Sometimes the AI may not return code in the expected markdown format (`\`\`\`language ... \`\`\``). The system will return an error asking to retry.

3. **Calculator mini-app quality**: The quality of generated mini-apps depends on the AI model. Consider using a more capable model for complex UI requests.

4. **Timeout with larger models**: Complex code generation (like HTML apps) can take longer with larger models. The system now has a **5-minute timeout** for both the frontend (popup.js) and backend (ollama-manager.ts) to accommodate larger models like `qwen2.5-coder:7b`.

---

## Recommended Models

| Model | Size | Quality | Speed | Install Command |
|-------|------|---------|-------|-----------------|
| `qwen2.5-coder:7b` | ~4.5GB | ⭐⭐⭐⭐ | Fast | `ollama pull qwen2.5-coder:7b` |
| `qwen2.5-coder:14b` | ~9GB | ⭐⭐⭐⭐⭐ | Medium | `ollama pull qwen2.5-coder:14b` |
| `codellama:7b` | ~4GB | ⭐⭐⭐ | Fast | `ollama pull codellama:7b` |
| `deepseek-coder-v2` | ~16GB | ⭐⭐⭐⭐⭐ | Slow | `ollama pull deepseek-coder-v2` |

**Note:** `phi3:mini` is not recommended for code generation as it's too small and often produces incorrect output.

---

## Recent Updates (December 2025)

### Timeout Fix (Updated to 5 minutes)
- **Files Modified:**
  1. `extension-chromium/public/popup.js` - Frontend fetch timeout
  2. `electron/main/llm/ollama-manager.ts` - Backend Ollama API timeout

- **Changes:**
  - Increased popup fetch timeout from 3 minutes → **5 minutes** (300000ms)
  - Increased Ollama manager chat timeout from 2 minutes → **5 minutes** (300000ms)

- **Reason:** The 120-second Ollama timeout was causing failures for complex code generation with `qwen2.5-coder:7b`. Both timeouts now match at 5 minutes.

**popup.js:**
```javascript
// Create AbortController with 5-minute timeout for larger models
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minute timeout

const response = await fetch(`${baseUrl}/api/code-executor/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, modelId: activeModel }),
  signal: controller.signal
})

clearTimeout(timeoutId) // Clear timeout on success
```

**ollama-manager.ts (line ~368):**
```typescript
// Before
signal: AbortSignal.timeout(120000) // 2 minute timeout

// After
signal: AbortSignal.timeout(300000) // 5 minute timeout for larger models
```

### Improved Code Extraction
- **File:** `electron/main/code-executor/index.ts`
- **Changes:**
  1. Added multiple regex patterns to match different code block formats
  2. Auto-detects language from content if not specified
  3. Cleans up backtick markers from truncated responses
  4. Validates responses to reject prompt echoes and conversation formats
  5. Better logging for debugging

```typescript
// Validation: Reject invalid responses (prompt echoes, conversation formats)
const invalidPatterns = [
  /^\d+\|user\|/,           // Conversation format like "01|user|..."
  /^I want to/i,            // User prompt echo
  /^Create a/i,             // User prompt echo
  /^Generate a/i,           // User prompt echo
  /^Please/i,               // Polite request echo
]

// Stricter code detection - must have actual syntax patterns
// HTML: Must have both opening and closing tags
if ((cleanedResponse.includes('<!DOCTYPE') || cleanedResponse.startsWith('<html')) 
    && cleanedResponse.includes('</html>')) {
  // Valid HTML
}

// Python: Must have actual Python syntax
if ((cleanedResponse.includes('def ') && cleanedResponse.includes(':')) 
    || (cleanedResponse.includes('print(') && cleanedResponse.includes(')'))) {
  // Valid Python
}
```

### Optimized System Prompt
- **File:** `electron/main/code-executor/index.ts`
- **Change:** Simplified system prompt with complete working examples (especially for calculator)
- **Reason:** Faster generation and better output from smaller models

```typescript
// New optimized prompt includes a complete minified calculator example
// so the AI can copy/adapt instead of generating from scratch
```

### Better Error Messages
- **File:** `extension-chromium/public/popup.js`
- **Change:** Timeout errors now show helpful suggestions
```javascript
if (err.name === 'AbortError') {
  codeRow('assistant', '❌ Request timed out. Try:\n• A simpler prompt\n• A faster model')
}
```

---

## Architecture Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Chrome Extension│────▶│ HTTP API Server  │────▶│ Ollama LLM      │
│ (popup.js)      │     │ (main.ts)        │     │ (phi3:mini)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Code Executor    │
                        │ (index.ts)       │
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ File System      │
                        │ (save code)      │
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Process Executor │
                        │ (python/node)    │
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Result returned  │
                        │ to extension     │
                        └──────────────────┘
```
