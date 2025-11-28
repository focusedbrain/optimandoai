import React, { useState, useMemo } from 'react';

export interface DataTableColumn<T = any> {
  key: string;
  header: string;
  accessor?: keyof T | ((row: T) => any);
  width?: string | number;
  minWidth?: string | number;
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  filterType?: 'text' | 'select' | 'number' | 'date' | 'range';
  filterOptions?: Array<{ label: string; value: any }>;
  align?: 'left' | 'center' | 'right';
  sticky?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<T = any> {
  data: T[];
  columns: DataTableColumn<T>[];
  loading?: boolean;
  pageSize?: number;
  showPagination?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  sortable?: boolean;
  filterable?: boolean;
  selectable?: boolean;
  multiSelect?: boolean;
  selectedRows?: T[];
  onSelectionChange?: (selectedRows: T[]) => void;
  onRowClick?: (row: T, index: number) => void;
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  onFilter?: (filters: Record<string, any>) => void;
  height?: string;
  maxHeight?: string;
  striped?: boolean;
  bordered?: boolean;
  hover?: boolean;
  compact?: boolean;
  variant?: 'default' | 'dark' | 'minimal';
  emptyMessage?: string;
  loadingMessage?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const DataTable = <T extends Record<string, any>>({
  data,
  columns,
  loading = false,
  pageSize = 10,
  showPagination = true,
  showSearch = true,
  searchPlaceholder = 'Search...',
  sortable = true,
  filterable = true,
  selectable = false,
  multiSelect = false,
  selectedRows = [],
  onSelectionChange,
  onRowClick,
  onSort,
  onFilter,
  height,
  maxHeight = '600px',
  striped = true,
  bordered = true,
  hover = true,
  compact = false,
  variant = 'default',
  emptyMessage = 'No data available',
  loadingMessage = 'Loading...',
  className,
  style,
}: DataTableProps<T>) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Get cell value
  const getCellValue = (row: T, column: DataTableColumn<T>) => {
    if (column.accessor) {
      if (typeof column.accessor === 'function') {
        return column.accessor(row);
      }
      return row[column.accessor];
    }
    return row[column.key];
  };

  // Filter data
  const filteredData = useMemo(() => {
    let filtered = [...data];

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(row =>
        columns.some(column => {
          const value = getCellValue(row, column);
          return String(value).toLowerCase().includes(searchQuery.toLowerCase());
        })
      );
    }

    // Apply column filters
    Object.entries(columnFilters).forEach(([key, filterValue]) => {
      if (filterValue) {
        filtered = filtered.filter(row => {
          const column = columns.find(col => col.key === key);
          if (column) {
            const value = getCellValue(row, column);
            return String(value).toLowerCase().includes(filterValue.toLowerCase());
          }
          return true;
        });
      }
    });

    return filtered;
  }, [data, searchQuery, columnFilters, columns]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig) return filteredData;

    return [...filteredData].sort((a, b) => {
      const column = columns.find(col => col.key === sortConfig.key);
      if (!column) return 0;

      const aValue = getCellValue(a, column);
      const bValue = getCellValue(b, column);

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig, columns]);

  // Paginate data
  const paginatedData = useMemo(() => {
    if (!showPagination) return sortedData;

    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize, showPagination]);

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

  // Handle row selection
  const handleRowSelection = (row: T) => {
    if (!selectable || !onSelectionChange) return;

    if (multiSelect) {
      const isSelected = selectedRows.some(selected => selected === row);
      const newSelection = isSelected
        ? selectedRows.filter(selected => selected !== row)
        : [...selectedRows, row];
      onSelectionChange(newSelection);
    } else {
      onSelectionChange([row]);
    }
  };

  // Handle select all
  const handleSelectAll = () => {
    if (!selectable || !multiSelect || !onSelectionChange) return;

    const allSelected = paginatedData.every(row => selectedRows.includes(row));
    const newSelection = allSelected ? [] : [...paginatedData];
    onSelectionChange(newSelection);
  };

  // Handle column filter
  const handleColumnFilter = (columnKey: string, value: string) => {
    const newFilters = { ...columnFilters, [columnKey]: value };
    setColumnFilters(newFilters);
    setCurrentPage(1);

    if (onFilter) {
      onFilter(newFilters);
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
          headerBackground: '#111827',
          rowHover: '#374151',
          selectedBackground: '#1e40af',
        };
      case 'minimal':
        return {
          backgroundColor: 'transparent',
          borderColor: '#f3f4f6',
          textColor: '#374151',
          headerBackground: '#f9fafb',
          rowHover: '#f9fafb',
          selectedBackground: '#eff6ff',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          headerBackground: '#f9fafb',
          rowHover: '#f9fafb',
          selectedBackground: '#eff6ff',
        };
    }
  };

  const theme = getThemeStyles();
  const totalPages = showPagination ? Math.ceil(sortedData.length / pageSize) : 1;

  return (
    <div className={className} style={{ ...style }}>
      {/* Search */}
      {showSearch && (
        <div style={{ marginBottom: '16px' }}>
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '8px 12px',
              border: `1px solid ${theme.borderColor}`,
              borderRadius: '6px',
              fontSize: '14px',
              backgroundColor: theme.backgroundColor,
              color: theme.textColor,
            }}
          />
        </div>
      )}

      {/* Table Container */}
      <div style={{
        border: bordered ? `1px solid ${theme.borderColor}` : 'none',
        borderRadius: bordered ? '8px' : '0',
        overflow: 'hidden',
        backgroundColor: theme.backgroundColor,
        height,
        maxHeight,
        overflowY: 'auto',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          backgroundColor: theme.backgroundColor,
          color: theme.textColor,
        }}>
          {/* Header */}
          <thead style={{
            backgroundColor: theme.headerBackground,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}>
            <tr>
              {selectable && multiSelect && (
                <th style={{
                  padding: compact ? '8px' : '12px',
                  textAlign: 'center',
                  borderBottom: `1px solid ${theme.borderColor}`,
                  width: '40px',
                }}>
                  <input
                    type="checkbox"
                    checked={paginatedData.length > 0 && paginatedData.every(row => selectedRows.includes(row))}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.className}
                  style={{
                    padding: compact ? '8px' : '12px',
                    textAlign: column.align || 'left',
                    borderBottom: `1px solid ${theme.borderColor}`,
                    width: column.width,
                    minWidth: column.minWidth,
                    cursor: (column.sortable !== false && sortable) ? 'pointer' : 'default',
                    fontWeight: '600',
                    fontSize: '14px',
                    position: column.sticky ? 'sticky' : 'static',
                    [column.sticky || 'left']: column.sticky ? 0 : 'auto',
                    backgroundColor: theme.headerBackground,
                    zIndex: column.sticky ? 11 : 'auto',
                  }}
                  onClick={() => handleSort(column.key)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {column.header}
                    
                    {(column.sortable !== false && sortable) && (
                      <div style={{ display: 'flex', flexDirection: 'column', fontSize: '10px' }}>
                        <span style={{ 
                          opacity: sortConfig?.key === column.key && sortConfig.direction === 'asc' ? 1 : 0.3 
                        }}>▲</span>
                        <span style={{ 
                          opacity: sortConfig?.key === column.key && sortConfig.direction === 'desc' ? 1 : 0.3 
                        }}>▼</span>
                      </div>
                    )}
                  </div>

                  {/* Column Filter */}
                  {(column.filterable !== false && filterable) && (
                    <input
                      type="text"
                      placeholder={`Filter ${column.header}`}
                      value={columnFilters[column.key] || ''}
                      onChange={(e) => handleColumnFilter(column.key, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        marginTop: '4px',
                        border: `1px solid ${theme.borderColor}`,
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: theme.backgroundColor,
                        color: theme.textColor,
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable && multiSelect ? 1 : 0)}
                  style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: theme.textColor,
                    opacity: 0.7,
                  }}
                >
                  {loadingMessage}
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable && multiSelect ? 1 : 0)}
                  style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: theme.textColor,
                    opacity: 0.7,
                  }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIndex) => {
                const isSelected = selectedRows.includes(row);
                
                return (
                  <tr
                    key={rowIndex}
                    style={{
                      backgroundColor: isSelected 
                        ? theme.selectedBackground 
                        : striped && rowIndex % 2 === 1 
                        ? `${theme.rowHover}20`
                        : 'transparent',
                      cursor: onRowClick ? 'pointer' : 'default',
                    }}
                    onMouseEnter={(e) => {
                      if (hover && !isSelected) {
                        e.currentTarget.style.backgroundColor = theme.rowHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = striped && rowIndex % 2 === 1 
                          ? `${theme.rowHover}20` 
                          : 'transparent';
                      }
                    }}
                    onClick={() => {
                      if (onRowClick) onRowClick(row, rowIndex);
                      if (selectable) handleRowSelection(row);
                    }}
                  >
                    {selectable && multiSelect && (
                      <td style={{
                        padding: compact ? '8px' : '12px',
                        textAlign: 'center',
                        borderBottom: `1px solid ${theme.borderColor}`,
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleRowSelection(row)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    
                    {columns.map((column) => {
                      const value = getCellValue(row, column);
                      const content = column.render ? column.render(value, row, rowIndex) : String(value);
                      
                      return (
                        <td
                          key={column.key}
                          className={column.className}
                          style={{
                            padding: compact ? '8px' : '12px',
                            textAlign: column.align || 'left',
                            borderBottom: `1px solid ${theme.borderColor}`,
                            fontSize: '14px',
                            position: column.sticky ? 'sticky' : 'static',
                            [column.sticky || 'left']: column.sticky ? 0 : 'auto',
                            backgroundColor: column.sticky ? (isSelected ? theme.selectedBackground : theme.backgroundColor) : 'transparent',
                            zIndex: column.sticky ? 5 : 'auto',
                          }}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {showPagination && totalPages > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '16px',
          fontSize: '14px',
          color: theme.textColor,
        }}>
          <div>
            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length} entries
          </div>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage <= 1}
              style={{
                padding: '6px 12px',
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '4px',
                backgroundColor: theme.backgroundColor,
                color: theme.textColor,
                cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                opacity: currentPage <= 1 ? 0.5 : 1,
              }}
            >
              Previous
            </button>
            
            <span style={{ padding: '6px 12px', color: theme.textColor }}>
              Page {currentPage} of {totalPages}
            </span>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage >= totalPages}
              style={{
                padding: '6px 12px',
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '4px',
                backgroundColor: theme.backgroundColor,
                color: theme.textColor,
                cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                opacity: currentPage >= totalPages ? 0.5 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};