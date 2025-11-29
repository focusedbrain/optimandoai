import React from 'react';
import GlassView from './components/GlassView';
import './index.css';

/**
 * GlassView Mini-App Entry Point
 * 
 * This is the main entry point for the GlassView code review monitoring application.
 * It integrates all Phase 2 features:
 * - File Watcher Integration for .cursorrules monitoring
 * - Review File Parser for markdown diff format
 * - Icon Trigger System with color-coded schema
 * - Backend Automation Stubs for AI analysis
 * - Advanced Component Library UI
 */

function App() {
  return (
    <div className="App">
      <GlassView
        watchDirectory=".cursorrules"  // Default Cursor review directory
        autoStart={true}               // Start monitoring automatically
        theme="light"                  // UI theme
        enableMockMode={true}          // Use mock AI responses for demo
      />
    </div>
  );
}

export default App;