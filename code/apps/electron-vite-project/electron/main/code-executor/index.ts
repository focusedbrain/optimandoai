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

// Default temp folder for generated code
const DEFAULT_CODE_FOLDER = 'C:\\Users\\sushovanwin\\Documents\\test_code_generate'

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
  return `You are an expert code generator. Your task is to generate executable code based on the user's request.

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
\`\`\`<language>
<your complete code here>
\`\`\`

EXAMPLES:

User: "print odd numbers between 1 to 10"
\`\`\`python
for i in range(1, 11):
    if i % 2 != 0:
        print(i)
\`\`\`

User: "create a calculator app"
\`\`\`html
<!DOCTYPE html>
<html>
<head>
    <title>Calculator</title>
    <style>
        /* styles here */
    </style>
</head>
<body>
    <!-- calculator UI here -->
    <script>
        // calculator logic here
    </script>
</body>
</html>
\`\`\`

User: "fibonacci sequence first 10 numbers in javascript"
\`\`\`javascript
function fibonacci(n) {
    const seq = [0, 1];
    for (let i = 2; i < n; i++) {
        seq.push(seq[i-1] + seq[i-2]);
    }
    return seq.slice(0, n);
}
console.log(fibonacci(10).join(', '));
\`\`\`

Now generate code for the user's request. Remember: ONLY output the code block, nothing else.`
}

/**
 * Extract code from AI response
 */
export function extractCodeFromResponse(response: string): GeneratedCode | null {
  // Match code blocks with language identifier
  const codeBlockRegex = /```(\w+)\n([\s\S]*?)```/
  const match = response.match(codeBlockRegex)
  
  if (!match) {
    // Try without language identifier
    const simpleMatch = response.match(/```\n?([\s\S]*?)```/)
    if (simpleMatch) {
      return {
        code: simpleMatch[1].trim(),
        language: 'python',  // Default to Python
        filename: `generated_${Date.now()}.py`,
        isMiniApp: false
      }
    }
    return null
  }
  
  const language = match[1].toLowerCase()
  const code = match[2].trim()
  
  // Determine file extension and if it's a mini app
  const langConfig = getLanguageConfig(language)
  
  return {
    code,
    language,
    filename: `generated_${Date.now()}${langConfig.extension}`,
    isMiniApp: langConfig.isMiniApp
  }
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
