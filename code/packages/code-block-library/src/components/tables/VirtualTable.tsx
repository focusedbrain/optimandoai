import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

export interface VirtualTableColumn<T = any> {
  key: string;
  header: string;
  accessor?: keyof T | ((row: T) => any);
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  sticky?: boolean;
  resizable?: boolean;
  className?: string;
}

export interface VirtualTableProps<T = any> {
  data: T[];
  columns: VirtualTableColumn<T>[];
  rowHeight?: number;
  headerHeight?: number;
  overscan?: number;
  loading?: boolean;
  sortable?: boolean;
  resizable?: boolean;
  onRowClick?: (row: T, index: number) => void;
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  height?: number;
  width?: number;
  striped?: boolean;
  hover?: boolean;
  variant?: 'default' | 'dark' | 'minimal';
  emptyMessage?: string;
  loadingMessage?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const VirtualTable = <T extends Record<string, any>>({
  data,
  columns,
  rowHeight = 48,
  headerHeight = 56,
  overscan = 5,
  loading = false,
  sortable = true,
  resizable = true,
  onRowClick,
  onSort,
  height = 400,
  width,
  striped = true,
  hover = true,
  variant = 'default',
  emptyMessage = 'No data available',
  loadingMessage = 'Loading...',
  className,
  style,
}: VirtualTableProps<T>) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig) return data;

    return [...data].sort((a, b) => {
      const column = columns.find(col => col.key === sortConfig.key);
      if (!column) return 0;

      const aValue = getCellValue(a, column);
      const bValue = getCellValue(b, column);

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig, columns]);

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const containerHeight = height - headerHeight;
    const startIndex = Math.floor(scrollTop / rowHeight);
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / rowHeight) + overscan,
      sortedData.length
    );

    return {
      start: Math.max(0, startIndex - overscan),
      end: endIndex,
    };
  }, [scrollTop, height, headerHeight, rowHeight, overscan, sortedData.length]);

  // Get visible items
  const visibleItems = useMemo(() => {
    return sortedData.slice(visibleRange.start, visibleRange.end);
  }, [sortedData, visibleRange]);

  // Calculate total height
  const totalHeight = sortedData.length * rowHeight;

  // Get cell value
  const getCellValue = (row: T, column: VirtualTableColumn<T>) => {
    if (column.accessor) {
      if (typeof column.accessor === 'function') {
        return column.accessor(row);
      }
      return row[column.accessor];
    }
    return row[column.key];
  };

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Handle sort
  const handleSort = (columnKey: string) => {
    const column = columns.find(col => col.key === columnKey);
    if (!column || (column.sortable === false && !sortable)) return;

    const newDirection = 
      sortConfig?.key === columnKey && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    
    setSortConfig({ key: columnKey, direction: newDirection });
    
    if (onSort) {
      onSort(columnKey, newDirection);
    }
  };

  // Handle column resize
  const handleResizeStart = (columnKey: string, e: React.MouseEvent) => {
    if (!resizable) return;

    e.preventDefault();
    setResizingColumn(columnKey);
    setResizeStartX(e.clientX);
    setResizeStartWidth(getColumnWidth(columnKey));
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingColumn) return;

    const deltaX = e.clientX - resizeStartX;
    const newWidth = Math.max(50, resizeStartWidth + deltaX);
    
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn]: newWidth,
    }));
  }, [resizingColumn, resizeStartX, resizeStartWidth]);

  const handleResizeEnd = useCallback(() => {
    setResizingColumn(null);
  }, []);

  // Add resize event listeners
  useEffect(() => {
    if (resizingColumn) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizingColumn, handleResizeMove, handleResizeEnd]);

  // Get column width
  const getColumnWidth = (columnKey: string): number => {
    const column = columns.find(col => col.key === columnKey);
    const customWidth = columnWidths[columnKey];
    
    if (customWidth) return customWidth;
    if (column?.width) return column.width;
    if (column?.minWidth) return column.minWidth;
    
    return 150; // default width
  };

  // Calculate total width
  const totalWidth = columns.reduce((sum, column) => sum + getColumnWidth(column.key), 0);

  // Get theme styles
  const getThemeStyles = () => {
    switch (variant) {
      case 'dark':
        return {
          backgroundColor: '#1f2937',
          borderColor: '#374151',
          textColor: '#f9fafb',
          headerBackground: '#111827',
          rowHover: '#374151',
        };
      case 'minimal':
        return {
          backgroundColor: 'transparent',
          borderColor: '#f3f4f6',
          textColor: '#374151',
          headerBackground: '#f9fafb',
          rowHover: '#f9fafb',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          headerBackground: '#f9fafb',
          rowHover: '#f9fafb',
        };
    }
  };

  const theme = getThemeStyles();

  return (
    <div 
      ref={containerRef}
      className={className}
      style={{ 
        height, 
        width: width || '100%',
        border: `1px solid ${theme.borderColor}`,
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: theme.backgroundColor,
        ...style 
      }}
    >
      {/* Header */}
      <div style={{
        height: headerHeight,
        backgroundColor: theme.headerBackground,
        borderBottom: `1px solid ${theme.borderColor}`,
        display: 'flex',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        width: totalWidth,
        minWidth: '100%',
      }}>
        {columns.map((column, columnIndex) => {
          const columnWidth = getColumnWidth(column.key);
          
          return (
            <div
              key={column.key}
              className={column.className}
              style={{
                width: columnWidth,
                minWidth: column.minWidth || 50,
                maxWidth: column.maxWidth,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: column.align === 'center' ? 'center' : column.align === 'right' ? 'flex-end' : 'flex-start',
                fontWeight: '600',
                fontSize: '14px',
                color: theme.textColor,
                borderRight: columnIndex < columns.length - 1 ? `1px solid ${theme.borderColor}` : 'none',
                cursor: (column.sortable !== false && sortable) ? 'pointer' : 'default',
                position: 'relative',
                overflow: 'hidden',
              }}
              onClick={() => handleSort(column.key)}
            >
              <span style={{ 
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {column.header}
              </span>
              
              {(column.sortable !== false && sortable) && (
                <div style={{ 
                  marginLeft: '8px',
                  display: 'flex', 
                  flexDirection: 'column', 
                  fontSize: '10px' 
                }}>
                  <span style={{ 
                    opacity: sortConfig?.key === column.key && sortConfig.direction === 'asc' ? 1 : 0.3 
                  }}>▲</span>
                  <span style={{ 
                    opacity: sortConfig?.key === column.key && sortConfig.direction === 'desc' ? 1 : 0.3 
                  }}>▼</span>
                </div>
              )}

              {/* Resize Handle */}
              {resizable && column.resizable !== false && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: '4px',
                    cursor: 'col-resize',
                    backgroundColor: resizingColumn === column.key ? theme.borderColor : 'transparent',
                  }}
                  onMouseDown={(e) => handleResizeStart(column.key, e)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div
        ref={scrollElementRef}
        style={{
          height: height - headerHeight,
          overflow: 'auto',
        }}
        onScroll={handleScroll}
      >
        {loading ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.textColor,
            fontSize: '14px',
          }}>
            {loadingMessage}
          </div>
        ) : sortedData.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.textColor,
            fontSize: '14px',
          }}>
            {emptyMessage}
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {/* Virtual Rows */}
            <div
              style={{
                transform: `translateY(${visibleRange.start * rowHeight}px)`,
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
              }}
            >
              {visibleItems.map((row, index) => {
                const actualIndex = visibleRange.start + index;
                const isEven = actualIndex % 2 === 0;
                
                return (
                  <div
                    key={actualIndex}
                    style={{
                      height: rowHeight,
                      display: 'flex',
                      backgroundColor: striped && !isEven ? `${theme.rowHover}20` : 'transparent',
                      cursor: onRowClick ? 'pointer' : 'default',
                      width: totalWidth,
                      minWidth: '100%',
                    }}
                    onMouseEnter={(e) => {
                      if (hover) {
                        e.currentTarget.style.backgroundColor = theme.rowHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = striped && !isEven ? `${theme.rowHover}20` : 'transparent';
                    }}
                    onClick={() => onRowClick && onRowClick(row, actualIndex)}
                  >
                    {columns.map((column, columnIndex) => {
                      const value = getCellValue(row, column);
                      const content = column.render ? column.render(value, row, actualIndex) : String(value);
                      const columnWidth = getColumnWidth(column.key);
                      
                      return (
                        <div
                          key={column.key}
                          className={column.className}
                          style={{
                            width: columnWidth,
                            minWidth: column.minWidth || 50,
                            maxWidth: column.maxWidth,
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: column.align === 'center' ? 'center' : column.align === 'right' ? 'flex-end' : 'flex-start',
                            fontSize: '14px',
                            color: theme.textColor,
                            borderRight: columnIndex < columns.length - 1 ? `1px solid ${theme.borderColor}` : 'none',
                            borderBottom: `1px solid ${theme.borderColor}`,
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            width: '100%',
                          }}>
                            {content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      {sortedData.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderTop: `1px solid ${theme.borderColor}`,
          backgroundColor: theme.headerBackground,
          fontSize: '12px',
          color: theme.textColor,
          opacity: 0.8,
        }}>
          Showing {visibleRange.start + 1} - {Math.min(visibleRange.end, sortedData.length)} of {sortedData.length} rows
          {visibleItems.length < sortedData.length && ' (virtualized)'}
        </div>
      )}
    </div>
  );
};