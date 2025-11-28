import React, { useState, useEffect } from 'react';

export interface TabItem {
  id: string;
  label: string;
  content?: React.ReactNode;
  icon?: string;
  disabled?: boolean;
  badge?: string | number;
  closeable?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTabId?: string;
  onTabChange?: (tabId: string, tab: TabItem) => void;
  onTabClose?: (tabId: string, tab: TabItem) => void;
  variant?: 'default' | 'pills' | 'underline' | 'card';
  size?: 'small' | 'medium' | 'large';
  orientation?: 'horizontal' | 'vertical';
  allowReorder?: boolean;
  scrollable?: boolean;
  addButton?: {
    show: boolean;
    onClick: () => void;
    icon?: string;
    label?: string;
  };
  style?: React.CSSProperties;
  className?: string;
  tabStyle?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  variant = 'default',
  size = 'medium',
  orientation = 'horizontal',
  allowReorder = false,
  scrollable = false,
  addButton,
  style,
  className,
  tabStyle,
  contentStyle,
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState<string>('');
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);

  // Initialize active tab
  useEffect(() => {
    if (activeTabId) {
      setInternalActiveTab(activeTabId);
    } else if (tabs.length > 0 && !internalActiveTab) {
      const firstEnabledTab = tabs.find(tab => !tab.disabled);
      if (firstEnabledTab) {
        setInternalActiveTab(firstEnabledTab.id);
      }
    }
  }, [activeTabId, tabs, internalActiveTab]);

  // Handle tab change
  const handleTabChange = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || tab.disabled) return;

    setInternalActiveTab(tabId);
    if (onTabChange) {
      onTabChange(tabId, tab);
    }
  };

  // Handle tab close
  const handleTabClose = (tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (onTabClose) {
      onTabClose(tabId, tab);
    }

    // If closed tab was active, switch to another tab
    if (internalActiveTab === tabId) {
      const remainingTabs = tabs.filter(t => t.id !== tabId && !t.disabled);
      if (remainingTabs.length > 0) {
        setInternalActiveTab(remainingTabs[0].id);
      }
    }
  };

  // Drag and drop handlers
  const handleDragStart = (tabId: string) => {
    if (!allowReorder) return;
    setDraggedTab(tabId);
  };

  const handleDragOver = (tabId: string, event: React.DragEvent) => {
    if (!allowReorder || !draggedTab) return;
    event.preventDefault();
    setDragOverTab(tabId);
  };

  const handleDragEnd = () => {
    setDraggedTab(null);
    setDragOverTab(null);
  };

  const handleDrop = (targetTabId: string, event: React.DragEvent) => {
    if (!allowReorder || !draggedTab) return;
    event.preventDefault();
    
    // Implement reorder logic here if needed
    // This would require tabs to be managed as state in parent component
    
    setDraggedTab(null);
    setDragOverTab(null);
  };

  // Get size styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          padding: '8px 12px',
          fontSize: '12px',
          iconSize: '14px',
        };
      case 'large':
        return {
          padding: '16px 24px',
          fontSize: '16px',
          iconSize: '20px',
        };
      default:
        return {
          padding: '12px 16px',
          fontSize: '14px',
          iconSize: '16px',
        };
    }
  };

  // Get variant styles
  const getVariantStyles = (isActive: boolean, isDisabled: boolean) => {
    const sizeStyles = getSizeStyles();
    const baseStyle = {
      padding: sizeStyles.padding,
      fontSize: sizeStyles.fontSize,
      border: 'none',
      background: 'transparent',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.5 : 1,
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap' as const,
      ...tabStyle,
    };

    switch (variant) {
      case 'pills':
        return {
          ...baseStyle,
          borderRadius: '20px',
          backgroundColor: isActive ? '#3b82f6' : 'transparent',
          color: isActive ? 'white' : '#6b7280',
          fontWeight: isActive ? '600' : '500',
        };
      case 'underline':
        return {
          ...baseStyle,
          borderBottom: `2px solid ${isActive ? '#3b82f6' : 'transparent'}`,
          color: isActive ? '#3b82f6' : '#6b7280',
          fontWeight: isActive ? '600' : '500',
          paddingBottom: '10px',
        };
      case 'card':
        return {
          ...baseStyle,
          border: '1px solid #e5e7eb',
          borderBottom: isActive ? '1px solid white' : '1px solid #e5e7eb',
          borderTopLeftRadius: '6px',
          borderTopRightRadius: '6px',
          backgroundColor: isActive ? 'white' : '#f9fafb',
          color: isActive ? '#1f2937' : '#6b7280',
          fontWeight: isActive ? '600' : '500',
          marginBottom: isActive ? '-1px' : '0',
          zIndex: isActive ? 10 : 1,
          position: 'relative' as const,
        };
      default:
        return {
          ...baseStyle,
          borderBottom: `2px solid ${isActive ? '#3b82f6' : '#e5e7eb'}`,
          color: isActive ? '#1f2937' : '#6b7280',
          fontWeight: isActive ? '600' : '500',
        };
    }
  };

  // Get hover styles
  const getHoverStyles = (isActive: boolean, isDisabled: boolean) => {
    if (isActive || isDisabled) return {};

    switch (variant) {
      case 'pills':
        return { backgroundColor: '#f3f4f6' };
      case 'underline':
        return { color: '#374151' };
      case 'card':
        return { backgroundColor: '#f3f4f6' };
      default:
        return { color: '#374151' };
    }
  };

  const sizeStyles = getSizeStyles();
  const activeTab = tabs.find(tab => tab.id === internalActiveTab);

  return (
    <div 
      className={className}
      style={{ 
        width: '100%',
        ...style 
      }}
    >
      {/* Tab List */}
      <div
        style={{
          display: 'flex',
          flexDirection: orientation === 'vertical' ? 'column' : 'row',
          borderBottom: variant === 'card' ? '1px solid #e5e7eb' : (variant === 'underline' ? '1px solid #e5e7eb' : 'none'),
          overflowX: scrollable && orientation === 'horizontal' ? 'auto' : 'visible',
          overflowY: scrollable && orientation === 'vertical' ? 'auto' : 'visible',
          gap: variant === 'pills' ? '4px' : '0',
          padding: variant === 'pills' ? '4px' : '0',
          backgroundColor: variant === 'pills' ? '#f9fafb' : 'transparent',
          borderRadius: variant === 'pills' ? '24px' : '0',
        }}
        role="tablist"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === internalActiveTab;
          const isDragging = draggedTab === tab.id;
          const isDragOver = dragOverTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              disabled={tab.disabled}
              draggable={allowReorder && !tab.disabled}
              onDragStart={() => handleDragStart(tab.id)}
              onDragOver={(e) => handleDragOver(tab.id, e)}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(tab.id, e)}
              style={{
                ...getVariantStyles(isActive, !!tab.disabled),
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                position: 'relative',
                opacity: isDragging ? 0.5 : (tab.disabled ? 0.5 : 1),
                transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
              }}
              onClick={() => handleTabChange(tab.id)}
              onMouseEnter={(e) => {
                const hoverStyles = getHoverStyles(isActive, !!tab.disabled);
                Object.assign(e.currentTarget.style, hoverStyles);
              }}
              onMouseLeave={(e) => {
                const variantStyles = getVariantStyles(isActive, !!tab.disabled);
                Object.assign(e.currentTarget.style, variantStyles);
              }}
            >
              {/* Icon */}
              {tab.icon && (
                <span style={{ fontSize: sizeStyles.iconSize }}>
                  {tab.icon}
                </span>
              )}

              {/* Label */}
              <span>{tab.label}</span>

              {/* Badge */}
              {tab.badge && (
                <span style={{
                  backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : '#ef4444',
                  color: isActive && variant === 'pills' ? 'white' : 'white',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  minWidth: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {tab.badge}
                </span>
              )}

              {/* Close button */}
              {tab.closeable && (
                <button
                  type="button"
                  onClick={(e) => handleTabClose(tab.id, e)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '2px',
                    fontSize: '12px',
                    opacity: 0.7,
                    transition: 'opacity 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.7';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  title={`Close ${tab.label}`}
                >
                  ✕
                </button>
              )}
            </button>
          );
        })}

        {/* Add Button */}
        {addButton?.show && (
          <button
            type="button"
            onClick={addButton.onClick}
            style={{
              ...getSizeStyles(),
              border: '1px dashed #d1d5db',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: '#6b7280',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3b82f6';
              e.currentTarget.style.color = '#3b82f6';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#d1d5db';
              e.currentTarget.style.color = '#6b7280';
            }}
            title={addButton.label || 'Add tab'}
          >
            {addButton.icon && (
              <span style={{ fontSize: sizeStyles.iconSize }}>
                {addButton.icon}
              </span>
            )}
            {addButton.label && <span>{addButton.label}</span>}
          </button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab && activeTab.content && (
        <div
          id={`tabpanel-${activeTab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab.id}`}
          style={{
            padding: '20px 0',
            ...contentStyle,
          }}
        >
          {activeTab.content}
        </div>
      )}
    </div>
  );
};