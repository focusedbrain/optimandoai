import React, { useState } from 'react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  totalItems?: number;
  onPageSizeChange?: (pageSize: number) => void;
  showPageSize?: boolean;
  showInfo?: boolean;
  showFirstLast?: boolean;
  showPrevNext?: boolean;
  maxVisiblePages?: number;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'default' | 'outline' | 'minimal';
  style?: React.CSSProperties;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  pageSize = 10,
  totalItems,
  onPageSizeChange,
  showPageSize = false,
  showInfo = false,
  showFirstLast = true,
  showPrevNext = true,
  maxVisiblePages = 7,
  disabled = false,
  size = 'medium',
  variant = 'default',
  style,
  className,
}) => {
  const [localPageSize, setLocalPageSize] = useState(pageSize);

  // Handle page change
  const handlePageChange = (page: number) => {
    if (disabled || page < 1 || page > totalPages || page === currentPage) {
      return;
    }
    onPageChange(page);
  };

  // Handle page size change
  const handlePageSizeChange = (newPageSize: number) => {
    setLocalPageSize(newPageSize);
    if (onPageSizeChange) {
      onPageSizeChange(newPageSize);
    }
  };

  // Get visible page numbers
  const getVisiblePages = (): number[] => {
    const delta = Math.floor(maxVisiblePages / 2);
    let start = Math.max(1, currentPage - delta);
    let end = Math.min(totalPages, start + maxVisiblePages - 1);

    // Adjust start if we're near the end
    if (end - start + 1 < maxVisiblePages) {
      start = Math.max(1, end - maxVisiblePages + 1);
    }

    const pages: number[] = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    return pages;
  };

  // Get size styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          padding: '6px 12px',
          fontSize: '12px',
          height: '32px',
        };
      case 'large':
        return {
          padding: '12px 16px',
          fontSize: '16px',
          height: '48px',
        };
      default:
        return {
          padding: '8px 12px',
          fontSize: '14px',
          height: '40px',
        };
    }
  };

  // Get button styles
  const getButtonStyles = (isActive: boolean = false, isDisabled: boolean = false) => {
    const sizeStyles = getSizeStyles();
    
    let baseStyle: React.CSSProperties = {
      minWidth: sizeStyles.height,
      height: sizeStyles.height,
      padding: sizeStyles.padding,
      fontSize: sizeStyles.fontSize,
      border: 'none',
      borderRadius: '6px',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: '500',
      opacity: isDisabled ? 0.5 : 1,
    };

    switch (variant) {
      case 'outline':
        return {
          ...baseStyle,
          border: '1px solid #d1d5db',
          backgroundColor: isActive ? '#3b82f6' : 'white',
          color: isActive ? 'white' : '#374151',
        };
      case 'minimal':
        return {
          ...baseStyle,
          backgroundColor: isActive ? '#eff6ff' : 'transparent',
          color: isActive ? '#3b82f6' : '#374151',
        };
      default:
        return {
          ...baseStyle,
          backgroundColor: isActive ? '#3b82f6' : '#f9fafb',
          color: isActive ? 'white' : '#374151',
          border: '1px solid #e5e7eb',
        };
    }
  };

  // Get hover styles
  const getHoverStyles = (isActive: boolean = false) => {
    if (isActive) return {};

    switch (variant) {
      case 'outline':
        return { backgroundColor: '#f9fafb', borderColor: '#9ca3af' };
      case 'minimal':
        return { backgroundColor: '#f3f4f6' };
      default:
        return { backgroundColor: '#f3f4f6' };
    }
  };

  const sizeStyles = getSizeStyles();
  const visiblePages = getVisiblePages();
  const startItem = totalItems ? (currentPage - 1) * localPageSize + 1 : 0;
  const endItem = totalItems ? Math.min(currentPage * localPageSize, totalItems) : 0;

  return (
    <div 
      className={className}
      style={{ 
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        alignItems: 'center',
        ...style 
      }}
    >
      {/* Pagination Info */}
      {showInfo && totalItems && (
        <div style={{ 
          fontSize: sizeStyles.fontSize,
          color: '#6b7280',
          textAlign: 'center'
        }}>
          Showing {startItem.toLocaleString()} to {endItem.toLocaleString()} of {totalItems.toLocaleString()} results
        </div>
      )}

      {/* Main Pagination */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '4px',
        flexWrap: 'wrap',
        justifyContent: 'center'
      }}>
        {/* First Page */}
        {showFirstLast && currentPage > 1 && visiblePages[0] > 1 && (
          <>
            <button
              type="button"
              onClick={() => handlePageChange(1)}
              disabled={disabled}
              style={getButtonStyles(false, disabled)}
              onMouseEnter={(e) => {
                if (!disabled) {
                  Object.assign(e.currentTarget.style, getHoverStyles());
                }
              }}
              onMouseLeave={(e) => {
                if (!disabled) {
                  Object.assign(e.currentTarget.style, getButtonStyles(false, disabled));
                }
              }}
              title="First page"
            >
              1
            </button>
            {visiblePages[0] > 2 && (
              <span style={{ 
                padding: '0 8px',
                color: '#9ca3af',
                fontSize: sizeStyles.fontSize 
              }}>
                ...
              </span>
            )}
          </>
        )}

        {/* Previous Page */}
        {showPrevNext && (
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={disabled || currentPage <= 1}
            style={getButtonStyles(false, disabled || currentPage <= 1)}
            onMouseEnter={(e) => {
              if (!disabled && currentPage > 1) {
                Object.assign(e.currentTarget.style, getHoverStyles());
              }
            }}
            onMouseLeave={(e) => {
              if (!disabled && currentPage > 1) {
                Object.assign(e.currentTarget.style, getButtonStyles(false, disabled || currentPage <= 1));
              }
            }}
            title="Previous page"
          >
            ←
          </button>
        )}

        {/* Page Numbers */}
        {visiblePages.map(page => (
          <button
            key={page}
            type="button"
            onClick={() => handlePageChange(page)}
            disabled={disabled}
            style={getButtonStyles(page === currentPage, disabled)}
            onMouseEnter={(e) => {
              if (!disabled && page !== currentPage) {
                Object.assign(e.currentTarget.style, getHoverStyles());
              }
            }}
            onMouseLeave={(e) => {
              if (!disabled) {
                Object.assign(e.currentTarget.style, getButtonStyles(page === currentPage, disabled));
              }
            }}
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        ))}

        {/* Next Page */}
        {showPrevNext && (
          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={disabled || currentPage >= totalPages}
            style={getButtonStyles(false, disabled || currentPage >= totalPages)}
            onMouseEnter={(e) => {
              if (!disabled && currentPage < totalPages) {
                Object.assign(e.currentTarget.style, getHoverStyles());
              }
            }}
            onMouseLeave={(e) => {
              if (!disabled && currentPage < totalPages) {
                Object.assign(e.currentTarget.style, getButtonStyles(false, disabled || currentPage >= totalPages));
              }
            }}
            title="Next page"
          >
            →
          </button>
        )}

        {/* Last Page */}
        {showFirstLast && currentPage < totalPages && visiblePages[visiblePages.length - 1] < totalPages && (
          <>
            {visiblePages[visiblePages.length - 1] < totalPages - 1 && (
              <span style={{ 
                padding: '0 8px',
                color: '#9ca3af',
                fontSize: sizeStyles.fontSize 
              }}>
                ...
              </span>
            )}
            <button
              type="button"
              onClick={() => handlePageChange(totalPages)}
              disabled={disabled}
              style={getButtonStyles(false, disabled)}
              onMouseEnter={(e) => {
                if (!disabled) {
                  Object.assign(e.currentTarget.style, getHoverStyles());
                }
              }}
              onMouseLeave={(e) => {
                if (!disabled) {
                  Object.assign(e.currentTarget.style, getButtonStyles(false, disabled));
                }
              }}
              title="Last page"
            >
              {totalPages}
            </button>
          </>
        )}
      </div>

      {/* Page Size Selector */}
      {showPageSize && onPageSizeChange && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          fontSize: sizeStyles.fontSize,
          color: '#374151'
        }}>
          <span>Show</span>
          <select
            value={localPageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            disabled={disabled}
            style={{
              padding: '4px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: sizeStyles.fontSize,
              backgroundColor: 'white',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {[5, 10, 20, 50, 100].map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>per page</span>
        </div>
      )}
    </div>
  );
};