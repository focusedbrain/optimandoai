/**
 * GlassView Demo - Template-Driven Mini-App
 * 
 * This demo shows the complete end-to-end flow:
 * 1. Load template text from glassview.template.md
 * 2. Parse with TemplateParser
 * 3. Build with TemplateBuilder/ComponentBuilder
 * 4. Render in MiniAppPanel sidebar wrapper
 * 5. Connect to orchestrator bridge for IPC
 * 
 * Run with: pnpm dev (in apps/glassview)
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  MiniAppPanel, 
  createMockOrchestratorBridge,
  OrchestratorBridge 
} from '@lib-root';

// Import the GlassView template as raw text
// Vite handles this with ?raw suffix
import glassviewTemplateText from '@lib-root/templates/glassview.template.md?raw';

/**
 * Demo Application
 */
function GlassViewDemo() {
  const [bridge] = useState<OrchestratorBridge>(() => createMockOrchestratorBridge());
  const [showPanel, setShowPanel] = useState(true);
  const [simulatedFiles, setSimulatedFiles] = useState<string[]>([]);
  
  // Simulate cursor file changes (what the orchestrator would send)
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate a file change event
      const mockFiles = [
        '/src/components/Button.tsx',
        '/src/hooks/useAuth.ts',
        '/src/services/api.ts',
        '/tests/Button.test.tsx'
      ];
      const randomFile = mockFiles[Math.floor(Math.random() * mockFiles.length)];
      setSimulatedFiles(prev => {
        if (prev.includes(randomFile)) return prev;
        return [...prev.slice(-4), randomFile];
      });
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Simulate sending file changes to the bridge
  useEffect(() => {
    if (simulatedFiles.length > 0) {
      // This would come from the orchestrator in production
      console.log('[Demo] Simulating cursor files changed:', simulatedFiles);
    }
  }, [simulatedFiles]);

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      backgroundColor: '#1e1e1e',
      color: '#cccccc',
      fontFamily: "'Segoe UI', Tahoma, sans-serif"
    }}>
      {/* Main Editor Area (simulated) */}
      <div style={{ 
        flex: 1, 
        padding: '20px',
        borderRight: '1px solid #3c3c3c'
      }}>
        <h1 style={{ color: '#e0e0e0', marginBottom: '20px' }}>
          GlassView Template Demo
        </h1>
        
        <div style={{ 
          backgroundColor: '#252526', 
          padding: '16px', 
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          <h3 style={{ color: '#4ec9b0', marginBottom: '12px' }}>
            Template-Driven Mini-App Architecture
          </h3>
          <p style={{ marginBottom: '8px' }}>
            This demo shows the complete flow:
          </p>
          <ol style={{ paddingLeft: '20px', lineHeight: 1.6 }}>
            <li>📄 Load <code>glassview.template.md</code> as raw text</li>
            <li>🔧 Parse YAML front matter with TemplateParser</li>
            <li>🏗️ Build React component tree with ComponentBuilder</li>
            <li>📦 Wrap in MiniAppPanel with sidebar chrome</li>
            <li>🔌 Connect to orchestrator bridge for IPC</li>
          </ol>
        </div>
        
        <div style={{ 
          backgroundColor: '#252526', 
          padding: '16px', 
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          <h3 style={{ color: '#dcdcaa', marginBottom: '12px' }}>
            Simulated File Changes
          </h3>
          <p style={{ marginBottom: '8px', fontSize: '12px', color: '#808080' }}>
            In production, these come from Cursor via the orchestrator:
          </p>
          {simulatedFiles.length === 0 ? (
            <p style={{ color: '#808080' }}>Waiting for file changes...</p>
          ) : (
            <ul style={{ paddingLeft: '20px' }}>
              {simulatedFiles.map((file, i) => (
                <li key={i} style={{ fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
                  {file}
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowPanel(!showPanel)}
            style={{
              backgroundColor: showPanel ? '#f44747' : '#4ec9b0',
              color: '#1e1e1e',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            {showPanel ? 'Hide Panel' : 'Show Panel'}
          </button>
        </div>
      </div>
      
      {/* Sidebar - MiniAppPanel */}
      {showPanel && (
        <div style={{ 
          width: '380px', 
          height: '100%',
          flexShrink: 0
        }}>
          <MiniAppPanel
            template={glassviewTemplateText}
            bridge={bridge}
            position="sidebar"
            showHeader={true}
            showFooter={true}
            onClose={() => setShowPanel(false)}
            onMinimize={() => console.log('Minimize clicked')}
            onReady={() => console.log('[Demo] GlassView mini-app ready!')}
            onError={(err) => console.error('[Demo] Error:', err)}
          />
        </div>
      )}
    </div>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<GlassViewDemo />);
}

export default GlassViewDemo;
