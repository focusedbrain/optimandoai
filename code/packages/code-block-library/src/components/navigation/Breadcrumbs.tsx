import React, { useState } from 'react';

export interface BreadcrumbItem {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: string;
  disabled?: boolean;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: string | React.ReactNode;
  showHome?: boolean;
  homeIcon?: string;
  maxItems?: number;
  onItemClick?: (item: BreadcrumbItem) => void;
  style?: React.CSSProperties;
  className?: string;
  itemStyle?: React.CSSProperties;
  separatorStyle?: React.CSSProperties;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  separator = '/',
  showHome = true,
  homeIcon = '🏠',
  maxItems,
  onItemClick,
  style,
  className,
  itemStyle,
  separatorStyle,
}) => {
  const [expandedItems, setExpandedItems] = useState(false);

  // Handle item click
  const handleItemClick = (item: BreadcrumbItem, event: React.MouseEvent) => {
    if (item.disabled) {
      event.preventDefault();
      return;
    }

    if (item.onClick) {
      event.preventDefault();
      item.onClick();
    }

    if (onItemClick) {
      onItemClick(item);
    }
  };

  // Create home item
  const homeItem: BreadcrumbItem = {
    id: 'home',
    label: 'Home',
    href: '/',
    icon: homeIcon,
  };

  // Prepare items list
  let allItems = showHome ? [homeItem, ...items] : items;
  let displayItems = allItems;
  let hasCollapsed = false;

  // Handle max items with collapse
  if (maxItems && allItems.length > maxItems && !expandedItems) {
    if (maxItems <= 2) {
      // Show first and last only
      displayItems = [allItems[0], allItems[allItems.length - 1]];
      hasCollapsed = true;
    } else {
      // Show first item, ellipsis, and last few items
      const keepFirst = 1;
      const keepLast = maxItems - 2; // Account for first item and ellipsis
      displayItems = [
        ...allItems.slice(0, keepFirst),
        { id: 'ellipsis', label: '...', disabled: true },
        ...allItems.slice(-keepLast),
      ];
      hasCollapsed = true;
    }
  }

  // Render breadcrumb item
  const renderItem = (item: BreadcrumbItem, index: number, isLast: boolean) => {
    if (item.id === 'ellipsis') {
      return (
        <React.Fragment key={item.id}>
          <button
            type="button"
            onClick={() => setExpandedItems(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '14px',
              transition: 'background-color 0.2s ease',
              ...itemStyle,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Show all items"
          >
            {item.label}
          </button>
          {!isLast && (
            <span
              style={{
                margin: '0 8px',
                color: '#d1d5db',
                fontSize: '14px',
                ...separatorStyle,
              }}
            >
              {separator}
            </span>
          )}
        </React.Fragment>
      );
    }

    const itemContent = (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {item.icon && (
          <span style={{ fontSize: '14px' }}>{item.icon}</span>
        )}
        <span>{item.label}</span>
      </span>
    );

    const commonStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '14px',
      textDecoration: 'none',
      transition: 'all 0.2s ease',
      ...itemStyle,
    };

    const linkStyle: React.CSSProperties = {
      ...commonStyle,
      color: isLast ? '#1f2937' : '#3b82f6',
      fontWeight: isLast ? '600' : '500',
      cursor: item.disabled ? 'not-allowed' : (isLast ? 'default' : 'pointer'),
      opacity: item.disabled ? 0.5 : 1,
    };

    const hoverStyle: React.CSSProperties = {
      backgroundColor: '#f3f4f6',
      color: '#2563eb',
    };

    return (
      <React.Fragment key={item.id}>
        {item.href && !isLast && !item.disabled ? (
          <a
            href={item.href}
            style={linkStyle}
            onClick={(e) => handleItemClick(item, e)}
            onMouseEnter={(e) => {
              if (!item.disabled && !isLast) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              if (!item.disabled && !isLast) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#3b82f6';
              }
            }}
          >
            {itemContent}
          </a>
        ) : (
          <span
            style={{
              ...commonStyle,
              color: isLast ? '#1f2937' : '#6b7280',
              fontWeight: isLast ? '600' : '500',
              cursor: item.disabled ? 'not-allowed' : (isLast ? 'default' : 'pointer'),
              opacity: item.disabled ? 0.5 : 1,
            }}
            onClick={(e) => {
              if (!isLast && !item.disabled) {
                handleItemClick(item, e as any);
              }
            }}
            onMouseEnter={(e) => {
              if (!item.disabled && !isLast) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              if (!item.disabled && !isLast) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#6b7280';
              }
            }}
          >
            {itemContent}
          </span>
        )}
        
        {!isLast && (
          <span
            style={{
              margin: '0 8px',
              color: '#d1d5db',
              fontSize: '14px',
              userSelect: 'none',
              ...separatorStyle,
            }}
          >
            {separator}
          </span>
        )}
      </React.Fragment>
    );
  };

  return (
    <nav
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '12px 0',
        ...style,
      }}
      aria-label="Breadcrumb"
    >
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '4px',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {displayItems.map((item, index) => (
          <li key={item.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {renderItem(item, index, index === displayItems.length - 1)}
          </li>
        ))}
      </ol>
      
      {hasCollapsed && expandedItems && (
        <button
          type="button"
          onClick={() => setExpandedItems(false)}
          style={{
            marginLeft: '8px',
            padding: '4px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            backgroundColor: 'white',
            color: '#6b7280',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f9fafb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'white';
          }}
          title="Collapse breadcrumbs"
        >
          Collapse
        </button>
      )}
    </nav>
  );
};