import React, { useState, useRef, useEffect } from 'react';

export interface NavbarItem {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: string;
  children?: NavbarItem[];
  disabled?: boolean;
}

export interface NavbarProps {
  items: NavbarItem[];
  brand?: {
    text?: string;
    icon?: string;
    href?: string;
    onClick?: () => void;
  };
  activeItemId?: string;
  onItemClick?: (item: NavbarItem) => void;
  variant?: 'horizontal' | 'vertical';
  theme?: 'light' | 'dark';
  sticky?: boolean;
  mobile?: boolean;
  style?: React.CSSProperties;
  className?: string;
  brandStyle?: React.CSSProperties;
  itemStyle?: React.CSSProperties;
}

export const Navbar: React.FC<NavbarProps> = ({
  items,
  brand,
  activeItemId,
  onItemClick,
  variant = 'horizontal',
  theme = 'light',
  sticky = true,
  mobile = true,
  style,
  className,
  brandStyle,
  itemStyle,
}) => {
  const [openDropdowns, setOpenDropdowns] = useState<Set<string>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenDropdowns(new Set());
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Toggle dropdown
  const toggleDropdown = (itemId: string) => {
    setOpenDropdowns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  // Handle item click
  const handleItemClick = (item: NavbarItem, event: React.MouseEvent) => {
    if (item.disabled) return;

    // If item has children, toggle dropdown
    if (item.children && item.children.length > 0) {
      event.preventDefault();
      toggleDropdown(item.id);
      return;
    }

    // Execute click handlers
    if (item.onClick) {
      item.onClick();
    }
    
    if (onItemClick) {
      onItemClick(item);
    }

    // Close mobile menu
    setMobileMenuOpen(false);
    setOpenDropdowns(new Set());
  };

  // Get theme colors
  const getThemeColors = () => {
    if (theme === 'dark') {
      return {
        background: '#1f2937',
        text: '#f9fafb',
        textSecondary: '#d1d5db',
        hover: '#374151',
        border: '#374151',
        active: '#3b82f6',
      };
    } else {
      return {
        background: '#ffffff',
        text: '#1f2937',
        textSecondary: '#6b7280',
        hover: '#f3f4f6',
        border: '#e5e7eb',
        active: '#3b82f6',
      };
    }
  };

  const colors = getThemeColors();

  // Render navigation item
  const renderItem = (item: NavbarItem, isChild = false, depth = 0) => {
    const isActive = activeItemId === item.id;
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = openDropdowns.has(item.id);

    const itemBaseStyle: React.CSSProperties = {
      position: 'relative',
      display: variant === 'horizontal' && !isChild ? 'inline-block' : 'block',
      ...itemStyle,
    };

    const linkStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: variant === 'horizontal' ? '12px 16px' : '12px 16px',
      paddingLeft: isChild ? `${16 + depth * 16}px` : '16px',
      color: isActive ? colors.active : colors.text,
      backgroundColor: isActive ? (theme === 'dark' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)') : 'transparent',
      textDecoration: 'none',
      fontSize: '14px',
      fontWeight: isActive ? '600' : '500',
      cursor: item.disabled ? 'not-allowed' : 'pointer',
      opacity: item.disabled ? 0.5 : 1,
      transition: 'all 0.2s ease',
      borderRadius: variant === 'vertical' ? '6px' : '0',
      margin: variant === 'vertical' ? '2px 8px' : '0',
      whiteSpace: 'nowrap',
    };

    const hoverStyle: React.CSSProperties = {
      backgroundColor: colors.hover,
    };

    return (
      <li key={item.id} style={itemBaseStyle}>
        {item.href && !hasChildren ? (
          <a
            href={item.href}
            style={linkStyle}
            onClick={(e) => handleItemClick(item, e)}
            onMouseEnter={(e) => {
              if (!item.disabled && !isActive) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              if (!item.disabled && !isActive) {
                e.currentTarget.style.backgroundColor = isActive ? linkStyle.backgroundColor as string : 'transparent';
              }
            }}
          >
            {item.icon && <span style={{ fontSize: '16px' }}>{item.icon}</span>}
            <span>{item.label}</span>
            {hasChildren && (
              <span style={{ 
                marginLeft: 'auto',
                fontSize: '12px',
                transition: 'transform 0.2s ease',
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
              }}>
                ▼
              </span>
            )}
          </a>
        ) : (
          <button
            type="button"
            style={{
              ...linkStyle,
              border: 'none',
              background: 'transparent',
              width: '100%',
              textAlign: 'left',
            }}
            onClick={(e) => handleItemClick(item, e)}
            onMouseEnter={(e) => {
              if (!item.disabled && !isActive) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              if (!item.disabled && !isActive) {
                e.currentTarget.style.backgroundColor = isActive ? linkStyle.backgroundColor as string : 'transparent';
              }
            }}
          >
            {item.icon && <span style={{ fontSize: '16px' }}>{item.icon}</span>}
            <span>{item.label}</span>
            {hasChildren && (
              <span style={{ 
                marginLeft: 'auto',
                fontSize: '12px',
                transition: 'transform 0.2s ease',
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
              }}>
                ▼
              </span>
            )}
          </button>
        )}

        {/* Dropdown menu */}
        {hasChildren && isOpen && (
          <ul style={{
            position: variant === 'horizontal' ? 'absolute' : 'static',
            top: variant === 'horizontal' ? '100%' : 'auto',
            left: variant === 'horizontal' ? '0' : 'auto',
            zIndex: 1000,
            backgroundColor: colors.background,
            border: variant === 'horizontal' ? `1px solid ${colors.border}` : 'none',
            borderRadius: '6px',
            boxShadow: variant === 'horizontal' ? '0 4px 6px rgba(0, 0, 0, 0.1)' : 'none',
            minWidth: variant === 'horizontal' ? '200px' : 'auto',
            padding: variant === 'horizontal' ? '8px 0' : '4px 0',
            margin: 0,
            listStyle: 'none',
            animation: 'fadeIn 0.2s ease',
          }}>
            {item.children!.map(child => renderItem(child, true, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  // Mobile menu toggle
  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
    setOpenDropdowns(new Set());
  };

  return (
    <nav
      ref={navRef}
      className={className}
      style={{
        backgroundColor: colors.background,
        borderBottom: `1px solid ${colors.border}`,
        position: sticky ? 'sticky' : 'static',
        top: sticky ? 0 : 'auto',
        zIndex: sticky ? 1000 : 'auto',
        boxShadow: sticky ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
        ...style,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        maxWidth: variant === 'horizontal' ? '1200px' : 'none',
        margin: variant === 'horizontal' ? '0 auto' : '0',
        minHeight: '64px',
      }}>
        {/* Brand */}
        {brand && (
          <div style={{ display: 'flex', alignItems: 'center', ...brandStyle }}>
            {brand.href ? (
              <a
                href={brand.href}
                onClick={brand.onClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textDecoration: 'none',
                  color: colors.text,
                  fontSize: '20px',
                  fontWeight: 'bold',
                }}
              >
                {brand.icon && <span style={{ fontSize: '24px' }}>{brand.icon}</span>}
                {brand.text && <span>{brand.text}</span>}
              </a>
            ) : (
              <button
                type="button"
                onClick={brand.onClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: 'none',
                  background: 'transparent',
                  color: colors.text,
                  fontSize: '20px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                {brand.icon && <span style={{ fontSize: '24px' }}>{brand.icon}</span>}
                {brand.text && <span>{brand.text}</span>}
              </button>
            )}
          </div>
        )}

        {/* Desktop Navigation */}
        {variant === 'horizontal' && (
          <ul style={{
            display: mobile ? 'none' : 'flex',
            alignItems: 'center',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            gap: '8px',
          }}>
            {items.map(item => renderItem(item))}
          </ul>
        )}

        {/* Mobile Menu Toggle */}
        {mobile && variant === 'horizontal' && (
          <button
            type="button"
            onClick={toggleMobileMenu}
            style={{
              display: 'block',
              padding: '8px',
              border: 'none',
              background: 'transparent',
              color: colors.text,
              fontSize: '20px',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = colors.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            ☰
          </button>
        )}
      </div>

      {/* Mobile Navigation */}
      {mobile && variant === 'horizontal' && mobileMenuOpen && (
        <div style={{
          borderTop: `1px solid ${colors.border}`,
          backgroundColor: colors.background,
          padding: '8px 0',
        }}>
          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}>
            {items.map(item => renderItem(item))}
          </ul>
        </div>
      )}

      {/* Vertical Navigation (Sidebar) */}
      {variant === 'vertical' && (
        <div style={{ padding: '16px 0' }}>
          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}>
            {items.map(item => renderItem(item))}
          </ul>
        </div>
      )}

      {/* Animation styles */}
      <style>
        {`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
    </nav>
  );
};