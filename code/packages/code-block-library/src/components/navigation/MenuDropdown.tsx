import React, { useState, useRef } from 'react';

export interface MenuDropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: (item: MenuDropdownItem) => void;
  href?: string;
  disabled?: boolean;
  divider?: boolean;
  children?: MenuDropdownItem[];
  shortcut?: string;
  danger?: boolean;
}

export interface MenuDropdownProps {
  trigger: React.ReactNode;
  items: MenuDropdownItem[];
  onItemClick?: (item: MenuDropdownItem) => void;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'left-start' | 'right-start';
  offset?: number;
  disabled?: boolean;
  closeOnItemClick?: boolean;
  showIcons?: boolean;
  showShortcuts?: boolean;
  maxHeight?: string;
  minWidth?: string;
  variant?: 'default' | 'dark' | 'bordered';
  className?: string;
  style?: React.CSSProperties;
}

export const MenuDropdown: React.FC<MenuDropdownProps> = ({
  trigger,
  items = [],
  onItemClick,
  placement = 'bottom-start',
  offset = 4,
  disabled = false,
  closeOnItemClick = true,
  showIcons = true,
  showShortcuts = true,
  maxHeight = '300px',
  minWidth = '200px',
  variant = 'default',
  className,
  style,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle trigger click
  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  // Handle item click
  const handleItemClick = (item: MenuDropdownItem, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (item.disabled) return;

    // Handle item with children (submenu)
    if (item.children && item.children.length > 0) {
      // Don't close menu for submenu items
      return;
    }

    // Call click handlers
    if (item.onClick) {
      item.onClick(item);
    }
    if (onItemClick) {
      onItemClick(item);
    }

    // Close menu if configured to do so
    if (closeOnItemClick) {
      setIsOpen(false);
      setHoveredItem(null);
    }
  };

  // Handle item hover for submenus
  const handleItemHover = (item: MenuDropdownItem, e: React.MouseEvent) => {
    if (item.children && item.children.length > 0) {
      setHoveredItem(item.id);
      
      // Calculate submenu position
      const rect = e.currentTarget.getBoundingClientRect();
      setSubmenuPosition({
        x: rect.right,
        y: rect.top,
      });
    } else {
      setHoveredItem(null);
    }
  };

  // Get menu position
  const getMenuPosition = () => {
    if (!triggerRef.current) return {};

    const rect = triggerRef.current.getBoundingClientRect();
    
    switch (placement) {
      case 'bottom-end':
        return { top: rect.bottom + offset, right: window.innerWidth - rect.right };
      case 'top-start':
        return { bottom: window.innerHeight - rect.top + offset, left: rect.left };
      case 'top-end':
        return { bottom: window.innerHeight - rect.top + offset, right: window.innerWidth - rect.right };
      case 'left-start':
        return { top: rect.top, right: window.innerWidth - rect.left + offset };
      case 'right-start':
        return { top: rect.top, left: rect.right + offset };
      default: // bottom-start
        return { top: rect.bottom + offset, left: rect.left };
    }
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
          dangerColor: '#ef4444',
          shortcutColor: '#9ca3af',
        };
      case 'bordered':
        return {
          backgroundColor: '#ffffff',
          borderColor: '#d1d5db',
          textColor: '#374151',
          hoverColor: '#f3f4f6',
          dangerColor: '#ef4444',
          shortcutColor: '#6b7280',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          hoverColor: '#f9fafb',
          dangerColor: '#ef4444',
          shortcutColor: '#6b7280',
        };
    }
  };

  const theme = getThemeStyles();

  // Render menu item
  const renderItem = (item: MenuDropdownItem): React.ReactNode => {
    if (item.divider) {
      return (
        <div
          key={item.id}
          style={{
            height: '1px',
            backgroundColor: theme.borderColor,
            margin: '4px 0',
          }}
        />
      );
    }

    const hasSubmenu = item.children && item.children.length > 0;
    const isHovered = hoveredItem === item.id;

    return (
      <div
        key={item.id}
        onClick={(e) => handleItemClick(item, e)}
        onMouseEnter={(e) => handleItemHover(item, e)}
        onMouseLeave={() => {
          if (!hasSubmenu) {
            setHoveredItem(null);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          cursor: item.disabled ? 'not-allowed' : 'pointer',
          backgroundColor: isHovered && !item.disabled ? theme.hoverColor : 'transparent',
          color: item.danger ? theme.dangerColor : theme.textColor,
          opacity: item.disabled ? 0.5 : 1,
          fontSize: '14px',
          transition: 'all 0.15s ease',
          position: 'relative',
        }}
      >
        {/* Icon */}
        {showIcons && (
          <div style={{ 
            marginRight: item.icon ? '8px' : '0',
            width: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {item.icon}
          </div>
        )}

        {/* Label */}
        <span style={{ 
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {item.label}
        </span>

        {/* Shortcut */}
        {showShortcuts && item.shortcut && (
          <span style={{
            fontSize: '12px',
            color: theme.shortcutColor,
            marginLeft: '16px',
          }}>
            {item.shortcut}
          </span>
        )}

        {/* Submenu Arrow */}
        {hasSubmenu && (
          <div style={{
            marginLeft: '8px',
            fontSize: '12px',
            opacity: 0.7,
          }}>
            ▶
          </div>
        )}

        {/* Submenu */}
        {hasSubmenu && isHovered && submenuPosition && (
          <div
            style={{
              position: 'fixed',
              top: submenuPosition.y,
              left: submenuPosition.x,
              backgroundColor: theme.backgroundColor,
              border: `1px solid ${theme.borderColor}`,
              borderRadius: '6px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              zIndex: 1001,
              minWidth: minWidth,
              maxHeight: maxHeight,
              overflowY: 'auto',
              padding: '4px 0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {item.children!.map(subItem => renderItem(subItem))}
          </div>
        )}
      </div>
    );
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setHoveredItem(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Handle keyboard navigation
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          setIsOpen(false);
          setHoveredItem(null);
          break;
        // Add more keyboard navigation here if needed
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const menuPosition = getMenuPosition();

  return (
    <div className={className} style={{ position: 'relative', display: 'inline-block', ...style }}>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={handleTriggerClick}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {trigger}
      </div>

      {/* Menu */}
      {isOpen && !disabled && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            ...menuPosition,
            backgroundColor: theme.backgroundColor,
            border: `1px solid ${theme.borderColor}`,
            borderRadius: '6px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            zIndex: 1000,
            minWidth: minWidth,
            maxHeight: maxHeight,
            overflowY: 'auto',
            padding: '4px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map(item => renderItem(item))}
        </div>
      )}
    </div>
  );
};