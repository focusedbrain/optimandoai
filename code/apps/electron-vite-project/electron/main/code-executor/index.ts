/**
 * Code Executor Service
 * 
 * Flow:
 * 1. User provides a query (e.g., "print odd numbers 1 to 10")
 * 2. AI generates code using the system template
 * 3. Code is saved to a specified temp folder
 * 4. Code is executed using appropriate runtime
 * 5. Output is captured and returned to user
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Default temp folder for generated code - uses system temp directory
const DEFAULT_CODE_FOLDER = path.join(os.tmpdir(), 'optimandoai-generated-code')

// Configurable code folder path
let codeFolderPath = DEFAULT_CODE_FOLDER

export interface CodeExecutionRequest {
  query: string
  language?: string  // Optional: python, javascript, html, etc. AI will auto-detect if not provided
  outputFolder?: string  // Optional: custom folder path
}

export interface CodeExecutionResult {
  success: boolean
  output: string
  error?: string
  filePath: string
  language: string
  executionTime: number
  isMiniApp?: boolean
  miniAppUrl?: string
}

export interface GeneratedCode {
  code: string
  language: string
  filename: string
  isMiniApp: boolean
}

/**
 * System prompt template for code generation
 */
export function getCodeGenerationSystemPrompt(): string {
  return `You are a code generator. Output ONLY a code block, no explanations.

RULES:
1. Output ONLY the code block with language identifier
2. Use Python by default unless specified otherwise
3. For UI apps, use minimal HTML with inline styles
4. Keep code short and simple

FORMAT:
\`\`\`<language>
<code>
\`\`\`

EXAMPLES:

User: "print odd numbers 1 to 10"
\`\`\`python
for i in range(1,11,2): print(i)
\`\`\`

User: "calculator app"
\`\`\`html
<!DOCTYPE html><html><head><title>Calc</title><style>body{font-family:sans-serif;display:flex;justify-content:center;padding:20px}#calc{background:#333;padding:20px;border-radius:10px}#display{width:200px;height:40px;font-size:24px;text-align:right;margin-bottom:10px}button{width:50px;height:50px;font-size:20px;margin:2px;cursor:pointer}</style></head><body><div id="calc"><input id="display" readonly><br><button onclick="c('7')">7</button><button onclick="c('8')">8</button><button onclick="c('9')">9</button><button onclick="c('/')">/</button><br><button onclick="c('4')">4</button><button onclick="c('5')">5</button><button onclick="c('6')">6</button><button onclick="c('*')">*</button><br><button onclick="c('1')">1</button><button onclick="c('2')">2</button><button onclick="c('3')">3</button><button onclick="c('-')">-</button><br><button onclick="c('0')">0</button><button onclick="c('.')">.</button><button onclick="calc()">=</button><button onclick="c('+')">+</button><br><button onclick="clr()" style="width:106px">C</button></div><script>let d=document.getElementById('display');function c(v){d.value+=v}function clr(){d.value=''}function calc(){try{d.value=eval(d.value)}catch{d.value='Error'}}</script></body></html>
\`\`\`

User: "fibonacci 10 numbers"
\`\`\`python
a,b=0,1
for _ in range(10):print(a);a,b=b,a+b
\`\`\`

Generate code now. ONLY the code block.`
}

/**
 * Extract code from AI response
 */
export function extractCodeFromResponse(response: string): GeneratedCode | null {
  console.log('[CodeExecutor] Extracting code from AI response...')
  console.log('[CodeExecutor] Response length:', response.length)
  console.log('[CodeExecutor] Response preview:', response.substring(0, 500))
  
  // Try multiple regex patterns to match code blocks
  const patterns = [
    /```(\w+)\s*\n([\s\S]*?)```/,           // Standard: ```python\ncode```
    /```(\w+)\s*\r?\n([\s\S]*?)```/,         // With optional \r
    /```(\w+)([\s\S]*?)```/,                 // No newline after language
    /```\s*(\w+)\s*\n([\s\S]*?)```/,         // Spaces around language
  ]
  
  for (const regex of patterns) {
    const match = response.match(regex)
    if (match && match[1] && match[2]) {
      const language = match[1].toLowerCase().trim()
      const code = match[2].trim()
      
      if (code.length > 0) {
        console.log('[CodeExecutor] Found code block with language:', language)
        console.log('[CodeExecutor] Code length:', code.length)
        
        const langConfig = getLanguageConfig(language)
        return {
          code,
          language,
          filename: `generated_${Date.now()}${langConfig.extension}`,
          isMiniApp: langConfig.isMiniApp
        }
      }
    }
  }
  
  // Try without language identifier
  const simplePatterns = [
    /```\n?([\s\S]*?)```/,
    /```([\s\S]*?)```/,
  ]
  
  for (const regex of simplePatterns) {
    const match = response.match(regex)
    if (match && match[1] && match[1].trim().length > 0) {
      const code = match[1].trim()
      console.log('[CodeExecutor] Found code block without language, defaulting to Python')
      
      // Try to detect language from content
      let language = 'python'
      if (code.includes('<!DOCTYPE') || code.includes('<html')) {
        language = 'html'
      } else if (code.includes('console.log') || code.includes('function ') || code.includes('=>')) {
        language = 'javascript'
      }
      
      const langConfig = getLanguageConfig(language)
      return {
        code,
        language,
        filename: `generated_${Date.now()}${langConfig.extension}`,
        isMiniApp: langConfig.isMiniApp
      }
    }
  }
  
  // Clean up any backticks from the response before fallback detection
  let cleanedResponse = response.trim()
  // Remove opening code block markers like ```html, ```python, etc.
  cleanedResponse = cleanedResponse.replace(/^```\w*\s*\n?/gm, '')
  // Remove closing code block markers
  cleanedResponse = cleanedResponse.replace(/\n?```\s*$/gm, '')
  cleanedResponse = cleanedResponse.trim()
  
  // VALIDATION: Check if this looks like an error/echo response, not actual code
  const invalidPatterns = [
    /^\d+\|user\|/,           // Conversation format like "01|user|..."
    /^I want to/i,            // User prompt echo
    /^Create a/i,             // User prompt echo
    /^Generate a/i,           // User prompt echo
    /^Please/i,               // Polite request echo
    /^Make a/i,               // User prompt echo
    /^I need/i,               // User prompt echo
    /^Can you/i,              // Question echo
  ]
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(cleanedResponse)) {
      console.log('[CodeExecutor] Detected invalid response (prompt echo or conversation format)')
      console.log('[CodeExecutor] Response starts with:', cleanedResponse.substring(0, 100))
      return null
    }
  }
  
  // Last resort: if response looks like ACTUAL code without backticks
  // Must contain actual HTML structure, not just text mentioning HTML
  if ((cleanedResponse.includes('<!DOCTYPE') || cleanedResponse.startsWith('<html') || cleanedResponse.startsWith('<HTML')) 
      && cleanedResponse.includes('</html>')) {
    console.log('[CodeExecutor] Detected raw HTML (cleaned backticks)')
    return {
      code: cleanedResponse,
      language: 'html',
      filename: `generated_${Date.now()}.html`,
      isMiniApp: true
    }
  }
  
  // Python detection - must have actual Python syntax patterns
  if ((cleanedResponse.includes('def ') && cleanedResponse.includes(':')) 
      || (cleanedResponse.includes('print(') && cleanedResponse.includes(')'))
      || (cleanedResponse.includes('for ') && cleanedResponse.includes(' in ') && cleanedResponse.includes(':'))) {
    console.log('[CodeExecutor] Detected raw Python (cleaned backticks)')
    return {
      code: cleanedResponse,
      language: 'python',
      filename: `generated_${Date.now()}.py`,
      isMiniApp: false
    }
  }
  
  // JavaScript detection - must have actual JS syntax
  if ((cleanedResponse.includes('function ') && cleanedResponse.includes('{'))
      || (cleanedResponse.includes('const ') && cleanedResponse.includes('='))
      || (cleanedResponse.includes('console.log(') && cleanedResponse.includes(')'))) {
    console.log('[CodeExecutor] Detected JavaScript code')
    return {
      code: cleanedResponse,
      language: 'javascript',
      filename: `generated_${Date.now()}.js`,
      isMiniApp: false
    }
  }
  
  console.log('[CodeExecutor] Could not extract valid code from response')
  console.log('[CodeExecutor] Full response:', response)
  return null
}

interface LanguageConfig {
  extension: string
  executor: string
  args: string[]
  isMiniApp: boolean
}

/**
 * Get language configuration for execution
 */
function getLanguageConfig(language: string): LanguageConfig {
  const configs: Record<string, LanguageConfig> = {
    python: { extension: '.py', executor: 'python', args: [], isMiniApp: false },
    py: { extension: '.py', executor: 'python', args: [], isMiniApp: false },
    javascript: { extension: '.js', executor: 'node', args: [], isMiniApp: false },
    js: { extension: '.js', executor: 'node', args: [], isMiniApp: false },
    typescript: { extension: '.ts', executor: 'npx', args: ['ts-node'], isMiniApp: false },
    ts: { extension: '.ts', executor: 'npx', args: ['ts-node'], isMiniApp: false },
    html: { extension: '.html', executor: 'browser', args: [], isMiniApp: true },
    bash: { extension: '.sh', executor: 'bash', args: [], isMiniApp: false },
    sh: { extension: '.sh', executor: 'bash', args: [], isMiniApp: false },
    powershell: { extension: '.ps1', executor: 'powershell', args: ['-File'], isMiniApp: false },
    ps1: { extension: '.ps1', executor: 'powershell', args: ['-File'], isMiniApp: false },
  }
  
  return configs[language] || { extension: '.txt', executor: 'cat', args: [], isMiniApp: false }
}

/**
 * Ensure code folder exists
 */
export function ensureCodeFolder(folderPath?: string): string {
  const folder = folderPath || codeFolderPath
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  return folder
}

/**
 * Save generated code to file
 */
export function saveCodeToFile(generatedCode: GeneratedCode, folderPath?: string): string {
  const folder = ensureCodeFolder(folderPath)
  const filePath = path.join(folder, generatedCode.filename)
  fs.writeFileSync(filePath, generatedCode.code, 'utf-8')
  console.log(`[CodeExecutor] Saved code to: ${filePath}`)
  return filePath
}

/**
 * Execute code file and capture output
 */
export async function executeCode(filePath: string, language: string): Promise<{ output: string; error?: string; executionTime: number }> {
  const startTime = Date.now()
  const config = getLanguageConfig(language)
  
  // For HTML/mini apps, don't execute - just return the file path
  if (config.isMiniApp) {
    return {
      output: `Mini app saved. Open in browser: file://${filePath}`,
      executionTime: Date.now() - startTime
    }
  }
  
  return new Promise((resolve) => {
    const args = [...config.args, filePath]
    const isWindows = os.platform() === 'win32'
    
    // Use appropriate shell for Windows
    let executor = config.executor
    if (isWindows && executor === 'bash') {
      executor = 'wsl'
      args.unshift('bash')
    }
    
    console.log(`[CodeExecutor] Executing: ${executor} ${args.join(' ')}`)
    
    const child = spawn(executor, args, {
      shell: isWindows,
      timeout: 30000,  // 30 second timeout
      cwd: path.dirname(filePath)
    })
    
    let stdout = ''
    let stderr = ''
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })
    
    child.on('error', (err) => {
      resolve({
        output: stdout,
        error: `Execution error: ${err.message}`,
        executionTime: Date.now() - startTime
      })
    })
    
    child.on('close', (code) => {
      const executionTime = Date.now() - startTime
      if (code !== 0 && stderr) {
        resolve({
          output: stdout,
          error: stderr,
          executionTime
        })
      } else {
        resolve({
          output: stdout || stderr,  // Some programs write to stderr even on success
          executionTime
        })
      }
    })
    
    // Timeout handler
    setTimeout(() => {
      child.kill()
      resolve({
        output: stdout,
        error: 'Execution timed out (30 seconds)',
        executionTime: 30000
      })
    }, 30000)
  })
}

/**
 * Set custom code folder path
 */
export function setCodeFolderPath(folderPath: string): void {
  codeFolderPath = folderPath
  ensureCodeFolder(folderPath)
  console.log(`[CodeExecutor] Code folder set to: ${folderPath}`)
}

/**
 * Get current code folder path
 */
export function getCodeFolderPath(): string {
  return codeFolderPath
}

/**
 * Full code execution pipeline
 * This is called by the orchestrator after AI generates the code
 */
export async function executeGeneratedCode(
  aiResponse: string,
  outputFolder?: string
): Promise<CodeExecutionResult> {
  // Step 1: Extract code from AI response
  const generatedCode = extractCodeFromResponse(aiResponse)
  
  if (!generatedCode) {
    return {
      success: false,
      output: '',
      error: 'Could not extract code from AI response. Make sure AI returns code in a code block.',
      filePath: '',
      language: 'unknown',
      executionTime: 0
    }
  }
  
  // Step 2: Save code to file
  const filePath = saveCodeToFile(generatedCode, outputFolder)
  
  // Step 3: Execute code
  const result = await executeCode(filePath, generatedCode.language)
  
  // Step 4: Return result
  return {
    success: !result.error,
    output: result.output,
    error: result.error,
    filePath,
    language: generatedCode.language,
    executionTime: result.executionTime,
    isMiniApp: generatedCode.isMiniApp,
    miniAppUrl: generatedCode.isMiniApp ? `file://${filePath}` : undefined
  }
}

/**
 * List all generated code files
 */
export function listGeneratedFiles(): { filename: string; path: string; created: Date }[] {
  const folder = ensureCodeFolder()
  const files = fs.readdirSync(folder)
  
  return files.map(filename => {
    const filePath = path.join(folder, filename)
    const stats = fs.statSync(filePath)
    return {
      filename,
      path: filePath,
      created: stats.birthtime
    }
  }).sort((a, b) => b.created.getTime() - a.created.getTime())
}

/**
 * Clean up old generated files (older than specified days)
 */
export function cleanupOldFiles(olderThanDays: number = 7): number {
  const folder = ensureCodeFolder()
  const files = fs.readdirSync(folder)
  const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)
  let deletedCount = 0
  
  files.forEach(filename => {
    const filePath = path.join(folder, filename)
    const stats = fs.statSync(filePath)
    if (stats.birthtime.getTime() < cutoffTime) {
      fs.unlinkSync(filePath)
      deletedCount++
    }
  })
  
  console.log(`[CodeExecutor] Cleaned up ${deletedCount} old files`)
  return deletedCount
}
