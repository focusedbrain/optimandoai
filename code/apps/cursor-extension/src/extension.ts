/**
 * OptimandoAI Cursor Extension
 * 
 * Connects Cursor IDE to the OptimandoAI Orchestrator for real-time
 * GlassView integration. Sends file changes, diffs, and editor events.
 * 
 * Uses HTTP API for reliability.
 */

import * as vscode from 'vscode';

// Configuration
const HTTP_URL = 'http://127.0.0.1:51248';
let statusBarItem: vscode.StatusBarItem;
let isConnected = false;
let lastProjectRoot: string | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[OptimandoAI] Cursor extension activating...');

  try {
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(sync~spin) OptimandoAI';
    statusBarItem.tooltip = 'Connecting to Orchestrator...';
    statusBarItem.command = 'optimandoai.showStatus';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Check connection on startup
    checkConnection();

    // ============================================================
    // FILE WATCHERS
    // ============================================================

    // Watch for document saves
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (shouldIgnoreFile(document.uri.fsPath)) return;
        
        console.log('[OptimandoAI] File saved:', document.fileName);
        sendEvent('cursor:file_saved', {
          filePath: document.uri.fsPath,
          languageId: document.languageId
        });
        
        // Update changed files list
        sendChangedFiles();
      })
    );

    // Watch for active editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && !shouldIgnoreFile(editor.document.uri.fsPath)) {
          sendEvent('cursor:active_file', {
            filePath: editor.document.uri.fsPath,
            languageId: editor.document.languageId
          });
        }
      })
    );

    // Watch for workspace folder changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        console.log('[OptimandoAI] Workspace folders changed');
        sendChangedFiles();
      })
    );

    // ============================================================
    // COMMANDS
    // ============================================================

    context.subscriptions.push(
      vscode.commands.registerCommand('optimandoai.sendChangedFiles', () => {
        sendChangedFiles();
        vscode.window.showInformationMessage('OptimandoAI: Sent changed files to GlassView');
      }),
      
      vscode.commands.registerCommand('optimandoai.sendCurrentFile', sendCurrentFile),
      
      vscode.commands.registerCommand('optimandoai.reconnect', () => {
        checkConnection();
        vscode.window.showInformationMessage('OptimandoAI: Reconnecting...');
      }),
      
      vscode.commands.registerCommand('optimandoai.showStatus', showStatusQuickPick)
    );

    // ============================================================
    // PERIODIC SYNC
    // ============================================================
    
    // Send changed files every 5 seconds
    const syncInterval = setInterval(() => {
      if (isConnected) {
        sendChangedFiles();
      }
    }, 5000);

    context.subscriptions.push({
      dispose: () => clearInterval(syncInterval)
    });

    // Initial sync after a short delay
    setTimeout(() => {
      sendChangedFiles();
    }, 2000);

    console.log('[OptimandoAI] Cursor extension activated successfully');
    
  } catch (err) {
    console.error('[OptimandoAI] Activation error:', err);
    if (err instanceof Error) {
      vscode.window.showErrorMessage(`OptimandoAI failed to activate: ${err.message}`);
    }
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function shouldIgnoreFile(filePath: string): boolean {
  const ignorePatterns = [
    'node_modules',
    '.git',
    'dist',
    'out',
    '.next',
    '__pycache__',
    '.vscode',
    '.cursor',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock'
  ];
  
  return ignorePatterns.some(pattern => filePath.includes(pattern));
}

async function checkConnection(): Promise<void> {
  try {
    const response = await fetch(`${HTTP_URL}/api/cursor/state`);
    if (response.ok) {
      isConnected = true;
      statusBarItem.text = '$(check) OptimandoAI';
      statusBarItem.tooltip = 'Connected to Orchestrator';
      statusBarItem.backgroundColor = undefined;
      console.log('[OptimandoAI] Connected to Orchestrator');
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    isConnected = false;
    statusBarItem.text = '$(x) OptimandoAI';
    statusBarItem.tooltip = 'Disconnected - Click for options';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    console.log('[OptimandoAI] Not connected to Orchestrator');
    
    // Retry in 10 seconds
    setTimeout(checkConnection, 10000);
  }
}

async function sendEvent(type: string, data: Record<string, unknown> = {}): Promise<void> {
  if (!isConnected) {
    console.log('[OptimandoAI] Not connected, skipping event:', type);
    return;
  }

  try {
    const response = await fetch(`${HTTP_URL}/api/cursor/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...data, timestamp: Date.now() })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    console.log('[OptimandoAI] Sent event:', type);
  } catch (err) {
    console.error('[OptimandoAI] Failed to send event:', err);
    isConnected = false;
    checkConnection();
  }
}

async function sendChangedFiles(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[OptimandoAI] No workspace folder open');
    return;
  }

  const projectRoot = workspaceFolders[0].uri.fsPath;
  
  // Notify if project changed
  if (projectRoot !== lastProjectRoot) {
    console.log('[OptimandoAI] Project root:', projectRoot);
    lastProjectRoot = projectRoot;
  }

  try {
    // Get changed files using VS Code Git extension
    const files = await getChangedFilesFromGit();
    
    console.log('[OptimandoAI] Sending', files.length, 'changed files');
    
    await sendEvent('cursor:files_changed', {
      files,
      projectRoot
    });
    
  } catch (err) {
    console.error('[OptimandoAI] Failed to get changed files:', err);
  }
}

async function getChangedFilesFromGit(): Promise<string[]> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      console.log('[OptimandoAI] Git extension not found');
      return [];
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git || git.repositories.length === 0) {
      console.log('[OptimandoAI] No Git repositories found');
      return [];
    }

    const repo = git.repositories[0];
    const rootPath = repo.rootUri.fsPath;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workingTreeChanges = repo.state.workingTreeChanges || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const indexChanges = repo.state.indexChanges || [];
    
    const files = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...workingTreeChanges.map((change: any) => {
        const fullPath = change.uri.fsPath;
        return fullPath.replace(rootPath + '\\', '').replace(rootPath + '/', '').replace(/\\/g, '/');
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...indexChanges.map((change: any) => {
        const fullPath = change.uri.fsPath;
        return fullPath.replace(rootPath + '\\', '').replace(rootPath + '/', '').replace(/\\/g, '/');
      })
    ];

    // Remove duplicates
    return [...new Set(files)];
  } catch (err) {
    console.error('[OptimandoAI] Git error:', err);
    return [];
  }
}

async function sendCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('OptimandoAI: No active file');
    return;
  }

  const document = editor.document;
  const content = document.getText();

  await sendEvent('cursor:current_file', {
    filePath: document.uri.fsPath,
    languageId: document.languageId,
    content: content.substring(0, 50000),
    lineCount: document.lineCount
  });

  vscode.window.setStatusBarMessage('OptimandoAI: Sent current file', 2000);
}

async function showStatusQuickPick(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const projectRoot = workspaceFolders?.[0]?.uri.fsPath || 'No project';
  
  const items: vscode.QuickPickItem[] = [
    {
      label: isConnected ? '$(check) Connected' : '$(x) Disconnected',
      description: isConnected ? 'HTTP connected to Orchestrator' : 'Click Reconnect to try again',
      detail: `Project: ${projectRoot}`
    },
    {
      label: '$(sync) Reconnect',
      description: 'Reconnect to the Orchestrator'
    },
    {
      label: '$(file-code) Send Changed Files',
      description: 'Manually send Git changed files to GlassView'
    },
    {
      label: '$(file) Send Current File',
      description: 'Send the current file content to GlassView'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: 'OptimandoAI Status',
    placeHolder: 'Select an action'
  });

  if (selected) {
    if (selected.label.includes('Reconnect')) {
      checkConnection();
    } else if (selected.label.includes('Send Changed Files')) {
      sendChangedFiles();
      vscode.window.showInformationMessage('OptimandoAI: Sent changed files');
    } else if (selected.label.includes('Send Current File')) {
      sendCurrentFile();
    }
  }
}

export function deactivate(): void {
  console.log('[OptimandoAI] Cursor extension deactivating...');
}
