import React from 'react';

interface CodeHunkDisplayProps {
  diff: string;
  filename: string;
  language?: string;
  showLineNumbers?: boolean;
  enableIconTriggers?: boolean;
  onHunkClick?: (hunk: string, lineNumber: number) => void;
  onIconTrigger?: (color: string, hunk: string) => void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  lineNumber?: number;
}

/**
 * Code Hunk Display Component
 * 
 * Renders git diff output with visual formatting:
 * - Green background for additions (+)
 * - Red background for deletions (-)
 * - Gray for unchanged context lines
 * - Line numbers on the left
 * - Optional icon triggers for AI analysis
 */
export const CodeHunkDisplay: React.FC<CodeHunkDisplayProps> = ({
  diff,
  filename,
  language,
  showLineNumbers = true,
  enableIconTriggers = false,
  onHunkClick,
  onIconTrigger
}) => {
  const parseDiff = (diffText: string): DiffLine[] => {
    const lines = diffText.split('\n');
    const parsed: DiffLine[] = [];
    let currentLine = 1;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Hunk header
        parsed.push({ type: 'header', content: line });
        const match = line.match(/\+(\d+)/);
        if (match) currentLine = parseInt(match[1]);
      } else if (line.startsWith('+')) {
        parsed.push({ type: 'add', content: line.substring(1), lineNumber: currentLine++ });
      } else if (line.startsWith('-')) {
        parsed.push({ type: 'remove', content: line.substring(1) });
      } else if (line.startsWith(' ')) {
        parsed.push({ type: 'context', content: line.substring(1), lineNumber: currentLine++ });
      }
    }

    return parsed;
  };

  const diffLines = parseDiff(diff);

  const getLineStyle = (type: DiffLine['type']): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      padding: '2px 8px',
      fontFamily: 'monospace',
      fontSize: '13px',
      whiteSpace: 'pre',
      margin: 0,
      display: 'flex',
      alignItems: 'center'
    };

    switch (type) {
      case 'add':
        return { ...baseStyle, background: '#dcfce7', color: '#166534' };
      case 'remove':
        return { ...baseStyle, background: '#fee2e2', color: '#991b1b', textDecoration: 'line-through' };
      case 'header':
        return { ...baseStyle, background: '#f1f5f9', color: '#475569', fontWeight: 'bold' };
      default:
        return { ...baseStyle, background: '#fff', color: '#374151' };
    }
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
      {/* File header */}
      <div style={{
        background: '#f8fafc',
        padding: '12px 16px',
        borderBottom: '1px solid #e2e8f0',
        fontFamily: 'monospace',
        fontSize: '14px',
        fontWeight: 600,
        color: '#1e293b'
      }}>
        {filename} {language && <span style={{ color: '#64748b', fontWeight: 'normal' }}>({language})</span>}
      </div>

      {/* Diff content */}
      <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
        {diffLines.map((line, index) => (
          <div
            key={index}
            style={{
              ...getLineStyle(line.type),
              cursor: onHunkClick && line.type !== 'header' ? 'pointer' : 'default'
            }}
            onClick={() => {
              if (onHunkClick && line.lineNumber) {
                onHunkClick(line.content, line.lineNumber);
              }
            }}
          >
            {showLineNumbers && line.lineNumber && (
              <span style={{
                width: '40px',
                display: 'inline-block',
                color: '#9ca3af',
                marginRight: '12px',
                textAlign: 'right',
                userSelect: 'none'
              }}>
                {line.lineNumber}
              </span>
            )}
            
            <span style={{ flex: 1 }}>{line.content || ' '}</span>

            {enableIconTriggers && line.type !== 'header' && (
              <div style={{ marginLeft: '8px', display: 'flex', gap: '4px' }}>
                {/* Icon triggers would be rendered here */}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
