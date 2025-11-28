/**
 * Basic UI Components
 * 
 * Simple, reusable UI components for template-based apps
 */

import React from 'react';
import { useApp } from '../bootstrap/react-app.component';

interface ContainerProps {
  title?: string;
  padding?: string;
  children?: React.ReactNode;
}

export const Container: React.FC<ContainerProps> = ({ title, padding = '20px', children }) => {
  return (
    <div style={{ padding }}>
      {title && <h2 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>{title}</h2>}
      {children}
    </div>
  );
};

interface InputGroupProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  stateKey?: string;
}

export const InputGroup: React.FC<InputGroupProps> = ({ label, placeholder, value = '', onChange, stateKey }) => {
  const { state, updateState } = useApp();
  
  const handleChange = (newValue: string) => {
    // If stateKey is provided, update state automatically
    if (stateKey) {
      updateState(stateKey, newValue);
    }
    // Also call onChange callback if provided
    onChange?.(newValue);
  };
  
  // Use state value if stateKey is provided
  const inputValue = stateKey ? (state[stateKey] as string || '') : value;
  
  return (
    <div style={{ marginBottom: '16px' }}>
      {label && (
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          {label}
        </label>
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          fontSize: '14px'
        }}
      />
    </div>
  );
};

interface ButtonProps {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  action?: string;
  children?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ 
  label, 
  onClick, 
  disabled = false,
  variant = 'primary',
  action,
  children 
}) => {
  const { eventBus } = useApp();
  
  const handleClick = () => {
    // If action is provided, emit it via eventBus
    if (action) {
      console.log('[Button] Emitting action:', action);
      eventBus.emit('action', { type: action });
    }
    // Also call onClick callback if provided
    onClick?.();
  };
  
  const baseStyle = {
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    marginRight: '8px',
    marginBottom: '8px'
  };

  const variantStyle = variant === 'primary' 
    ? { backgroundColor: '#3b82f6', color: 'white' }
    : { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      style={{ ...baseStyle, ...variantStyle }}
    >
      {label || children}
    </button>
  );
};

interface StatusIndicatorProps {
  message?: string;
  color?: 'green' | 'red' | 'yellow' | 'blue';
  children?: React.ReactNode;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ 
  message, 
  color = 'blue',
  children 
}) => {
  const { state } = useApp();
  
  // Interpolate state values in message (e.g., "Watching: {state.projectPath}")
  const interpolatedMessage = message ? message.replace(/\{state\.([^}]+)\}/g, (match, path) => {
    const keys = path.split('.');
    let value: any = state;
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) return match; // Keep original if not found
    }
    return String(value);
  }) : message;
  
  const colorMap = {
    green: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
    red: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
    yellow: { bg: '#fef3c7', text: '#92400e', border: '#fde047' },
    blue: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' }
  };

  const colors = colorMap[color];

  return (
    <div style={{
      padding: '12px 16px',
      backgroundColor: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: '4px',
      marginBottom: '16px',
      fontSize: '14px'
    }}>
      {interpolatedMessage || children}
    </div>
  );
};
