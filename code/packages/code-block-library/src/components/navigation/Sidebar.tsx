import React, { useState } from 'react';

export interface SidebarItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: (item: SidebarItem) => void;
  children?: SidebarItem[];
  badge?: string | number;
  disabled?: boolean;
}

export interface SidebarProps {
  items: SidebarItem[];
  isOpen?: boolean;
  onToggle?: () => void;
  onItemClick?: (item: SidebarItem) => void;
  activeItemId?: string;
  width?: string;
  collapsedWidth?: string;
  position?: 'left' | 'right';
  variant?: 'default' | 'dark' | 'glass';
  showToggle?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  onSearchChange?: (query: string) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  collapsible?: boolean;
  overlay?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items = [],
  isOpen = true,
  onToggle,
  onItemClick,
  activeItemId,
  width = '280px',
  collapsedWidth = '64px',
  position = 'left',
  variant = 'default',
  showToggle = true,
  showSearch = false,
  searchPlaceholder = 'Search...',
  onSearchChange,
  header,
  footer,
  collapsible = true,
  overlay = false,
  className,
  style,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Handle search
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (onSearchChange) {
      onSearchChange(query);
    }
  };

  // Toggle expanded state for items with children
  const toggleExpanded = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  // Handle item click
  const handleItemClick = (item: SidebarItem, e: React.MouseEvent) => {
    e.preventDefault();
    
    if (item.disabled) return;

    // If item has children, toggle expansion
    if (item.children && item.children.length > 0) {
      toggleExpanded(item.id);
    }

    // Call click handlers
    if (item.onClick) {
      item.onClick(item);
    }
    if (onItemClick) {
      onItemClick(item);
    }
  };

  // Filter items based on search
  const filterItems = (items: SidebarItem[]): SidebarItem[] => {
    if (!searchQuery) return items;

    return items.filter(item => {
      const matchesSearch = item.label.toLowerCase().includes(searchQuery.toLowerCase());
      const hasMatchingChildren = item.children?.some(child => 
        child.label.toLowerCase().includes(searchQuery.toLowerCase())
      );
      return matchesSearch || hasMatchingChildren;
    });
  };

  // Get theme styles
  const getThemeStyles = () => {
    switch (variant) {
      case 'dark':
        return {
          backgroundColor: '#1f2937',
          borderColor: '#374151',
          textColor: '#f9fafb',
          hoverColor: '#374151',
          activeColor: '#4f46e5',
        };
      case 'glass':
        return {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          borderColor: 'rgba(0, 0, 0, 0.1)',
          textColor: '#374151',
          hoverColor: 'rgba(0, 0, 0, 0.05)',
          activeColor: '#3b82f6',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          hoverColor: '#f3f4f6',
          activeColor: '#3b82f6',
        };
    }
  };

  const theme = getThemeStyles();
  const currentWidth = isOpen ? width : collapsedWidth;

  // Render sidebar item
  const renderItem = (item: SidebarItem, level: number = 0): React.ReactNode => {
    const isActive = item.id === activeItemId;
    const isExpanded = expandedItems.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    const paddingLeft = isOpen ? `${16 + level * 16}px` : '16px';

    return (
      <div key={item.id}>
        <div
          onClick={(e) => handleItemClick(item, e)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: `8px 16px`,
            paddingLeft,
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            backgroundColor: isActive ? theme.activeColor : 'transparent',
            color: isActive ? 'white' : theme.textColor,
            opacity: item.disabled ? 0.5 : 1,
            borderRadius: '6px',
            margin: '2px 8px',
            transition: 'all 0.2s ease',
            position: 'relative',
          }}
          onMouseEnter={(e) => {
            if (!item.disabled && !isActive) {
              e.currentTarget.style.backgroundColor = theme.hoverColor;
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
          title={!isOpen ? item.label : undefined}
        >
          {/* Icon */}
          {item.icon && (
            <div style={{ 
              marginRight: isOpen ? '12px' : '0',
              display: 'flex',
              alignItems: 'center',
              minWidth: '20px',
              justifyContent: isOpen ? 'flex-start' : 'center'
            }}>
              {item.icon}
            </div>
          )}

          {/* Label */}
          {isOpen && (
            <span style={{ 
              flex: 1,
              fontSize: '14px',
              fontWeight: isActive ? '600' : '400',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {item.label}
            </span>
          )}

          {/* Badge */}
          {isOpen && item.badge && (
            <span style={{
              backgroundColor: isActive ? 'rgba(255, 255, 255, 0.2)' : '#ef4444',
              color: isActive ? 'white' : 'white',
              fontSize: '11px',
              fontWeight: '600',
              padding: '2px 6px',
              borderRadius: '10px',
              marginLeft: '8px',
              minWidth: '18px',
              textAlign: 'center',
            }}>
              {item.badge}
            </span>
          )}

          {/* Expand/Collapse Arrow */}
          {isOpen && hasChildren && (
            <div style={{
              marginLeft: '8px',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              fontSize: '12px',
              opacity: 0.7,
            }}>
              ▼
            </div>
          )}
        </div>

        {/* Children */}
        {isOpen && hasChildren && isExpanded && (
          <div style={{ marginTop: '4px' }}>
            {item.children!.map(child => renderItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const filteredItems = filterItems(items);

  return (
    <>
      {/* Overlay */}
      {overlay && isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 998,
          }}
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={className}
        style={{
          position: overlay ? 'fixed' : 'relative',
          [position]: 0,
          top: 0,
          bottom: 0,
          width: currentWidth,
          backgroundColor: theme.backgroundColor,
          borderRight: position === 'left' ? `1px solid ${theme.borderColor}` : undefined,
          borderLeft: position === 'right' ? `1px solid ${theme.borderColor}` : undefined,
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.3s ease',
          zIndex: 999,
          overflow: 'hidden',
          ...style,
        }}
      >
        {/* Header */}
        {header && (
          <div style={{
            padding: '16px',
            borderBottom: `1px solid ${theme.borderColor}`,
            display: isOpen ? 'block' : 'none',
          }}>
            {header}
          </div>
        )}

        {/* Toggle Button */}
        {showToggle && collapsible && onToggle && (
          <button
            onClick={onToggle}
            style={{
              position: 'absolute',
              top: '16px',
              [position === 'left' ? 'right' : 'left']: '-12px',
              width: '24px',
              height: '24px',
              backgroundColor: theme.backgroundColor,
              border: `1px solid ${theme.borderColor}`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '12px',
              color: theme.textColor,
              zIndex: 1000,
            }}
          >
            {position === 'left' ? (isOpen ? '◀' : '▶') : (isOpen ? '▶' : '◀')}
          </button>
        )}

        {/* Search */}
        {showSearch && isOpen && (
          <div style={{ padding: '16px', borderBottom: `1px solid ${theme.borderColor}` }}>
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: variant === 'dark' ? '#374151' : 'white',
                color: theme.textColor,
              }}
            />
          </div>
        )}

        {/* Navigation Items */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
        }}>
          {filteredItems.map(item => renderItem(item))}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '16px',
            borderTop: `1px solid ${theme.borderColor}`,
            display: isOpen ? 'block' : 'none',
          }}>
            {footer}
          </div>
        )}
      </div>
    </>
  );
};