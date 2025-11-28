import React from 'react';

type IconColor = 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'orange';

interface IconTriggerProps {
  color: IconColor;
  icon: string;
  label?: string;
  position?: { line?: number; offset?: { x: number; y: number } };
  onTrigger: (color: IconColor, context: any) => void;
}

const colorMap: Record<IconColor, string> = {
  blue: '#3b82f6',
  green: '#10b981',
  red: '#ef4444',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316'
};

/**
 * Icon Trigger Component
 * 
 * Renders a clickable colored icon that triggers actions.
 * Used for code analysis features like:
 * - Blue: Explain code
 * - Green: Suggest improvements
 * - Red: Security scan
 * - Yellow: Performance analysis
 * - Purple: Generate tests
 * - Orange: Refactor suggestions
 */
export const IconTrigger: React.FC<IconTriggerProps> = ({
  color,
  icon,
  label,
  position,
  onTrigger
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTrigger(color, { position, timestamp: Date.now() });
  };

  const bgColor = colorMap[color];
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: bgColor,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
    border: 'none',
    padding: 0,
    transition: 'all 0.2s',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    ...(position?.offset && {
      position: 'absolute',
      left: position.offset.x,
      top: position.offset.y
    })
  };

  return (
    <button
      style={style}
      onClick={handleClick}
      title={label || `Trigger ${color} action`}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.1)';
        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      }}
    >
      {icon}
    </button>
  );
};
