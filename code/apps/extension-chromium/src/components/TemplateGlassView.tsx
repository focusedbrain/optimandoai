import React, { useState, useEffect } from 'react';
import { templateParser, componentBuilder, createActionHandler } from '@optimandoai/code-block-library';
import { GlassViewContainer } from '@shared/components';

interface TemplateGlassViewProps {
  templateName: string;
}

/**
 * Template-based GlassView Component
 * 
 * Loads and renders GlassView apps from templates dynamically.
 * This replaces hardcoded React components with template-driven assembly.
 */
export const TemplateGlassView: React.FC<TemplateGlassViewProps> = ({ templateName }) => {
  const [BuiltComponent, setBuiltComponent] = useState<React.ComponentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateContent, setTemplateContent] = useState<string>('');

  useEffect(() => {
    loadAndBuildTemplate();
  }, [templateName]);

  const loadAndBuildTemplate = async () => {
    try {
      setLoading(true);
      setError(null);

      // Request template from orchestrator
      console.log('[TemplateGlassView] Requesting template:', templateName);
      
      // Send message without callback (response comes via onMessage listener)
      chrome.runtime.sendMessage({ type: 'GET_TEMPLATE', name: templateName });
      
    } catch (err) {
      setError(`Error loading template: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  };

  const buildComponentFromTemplate = (templateText: string) => {
    try {
      // Parse template
      const ast = templateParser.parse(templateText);

      if (!ast) {
        const errors = templateParser.getErrors();
        console.error('[TemplateGlassView] Parse failed:', errors.join(', '));
        setError(`Failed to parse template: ${errors.join(', ')}`);
        setLoading(false);
        return;
      }

      console.log(`[TemplateGlassView] Parsed! ${ast.name} - ${ast.components.length} components`);

      // Build component from AST
      const result = componentBuilder.build(ast);

      if (!result) {
        const errors = componentBuilder.getErrors();
        console.error('[TemplateGlassView] Build failed:', errors.join(', '));
        setError(`Failed to build component: ${errors.join(', ')}`);
        setLoading(false);
        return;
      }

      console.log(`[TemplateGlassView] Built! Blocks: ${result.metadata.blocksUsed.join(', ')}, Warnings: ${result.metadata.warnings.length}`);
      
      if (result.metadata.warnings.length > 0) {
        console.warn('[TemplateGlassView] Build warnings:', result.metadata.warnings);
      }
      
      setBuiltComponent(() => result.Component);
      setLoading(false);
    } catch (err) {
      console.error('[TemplateGlassView] Error:', err instanceof Error ? err.message : String(err));
      setError(`Build error: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  };

  // Listen for template changes (hot reload) and responses
  useEffect(() => {
    const handleMessage = (message: any) => {
      console.log('[TemplateGlassView] Message received:', message.type);
      
      if (message.type === 'TEMPLATE_RESULT' && message.name === templateName) {
        console.log('[TemplateGlassView] Template loaded:', message.name);
        setTemplateContent(message.content);
        buildComponentFromTemplate(message.content);
      } else if (message.type === 'TEMPLATE_ERROR' && message.name === templateName) {
        console.error('[TemplateGlassView] Template error:', message.error);
        setError(`Template error: ${message.error}`);
        setLoading(false);
      } else if (message.type === 'TEMPLATE_CHANGED' && message.payload?.name === templateName) {
        console.log('[TemplateGlassView] Template changed, reloading...');
        buildComponentFromTemplate(message.payload.content);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [templateName]);

  if (loading) {
    return (
      <GlassViewContainer title={`Loading ${templateName}...`}>
        <div className="flex items-center justify-center p-8">
          <div className="text-sm text-slate-500">Loading template...</div>
        </div>
      </GlassViewContainer>
    );
  }

  if (error) {
    return (
      <GlassViewContainer title="Template Error">
        <div className="p-4 space-y-4">
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
            <div className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
              Failed to load template
            </div>
            <div className="text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          </div>
          <button
            onClick={loadAndBuildTemplate}
            className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </GlassViewContainer>
    );
  }

  if (!BuiltComponent) {
    return (
      <GlassViewContainer title="No Component">
        <div className="p-4 text-sm text-slate-500">
          No component built from template
        </div>
      </GlassViewContainer>
    );
  }

  // Render the dynamically built component
  return <BuiltComponent />;
};
