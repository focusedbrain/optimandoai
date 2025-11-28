import React, { useState, useMemo } from 'react';

export interface TreeNode<T = any> {
  id: string | number;
  data: T;
  children?: TreeNode<T>[];
  expanded?: boolean;
  level?: number;
  parent?: TreeNode<T>;
}

export interface TreeTableColumn<T = any> {
  key: string;
  header: string;
  accessor?: keyof T | ((node: TreeNode<T>) => any);
  width?: string | number;
  sortable?: boolean;
  render?: (value: any, node: TreeNode<T>, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

export interface TreeTableProps<T = any> {
  data: TreeNode<T>[];
  columns: TreeTableColumn<T>[];
  treeColumn?: string;
  loading?: boolean;
  expandAll?: boolean;
  defaultExpanded?: boolean;
  showExpandButton?: boolean;
  expandButtonPosition?: 'left' | 'right';
  indentSize?: number;
  onNodeClick?: (node: TreeNode<T>, index: number) => void;
  onNodeExpand?: (node: TreeNode<T>, expanded: boolean) => void;
  selectable?: boolean;
  selectedNodes?: TreeNode<T>[];
  onSelectionChange?: (selectedNodes: TreeNode<T>[]) => void;
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

export const TreeTable = <T extends Record<string, any>>({
  data,
  columns,
  treeColumn,
  loading = false,
  expandAll = false,
  defaultExpanded = false,
  showExpandButton = true,
  expandButtonPosition = 'left',
  indentSize = 20,
  onNodeClick,
  onNodeExpand,
  selectable = false,
  selectedNodes = [],
  onSelectionChange,
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
}: TreeTableProps<T>) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string | number>>(new Set());

  // Process tree data with levels and expansion state
  const processedData = useMemo(() => {
    const processNode = (node: TreeNode<T>, level = 0, parent?: TreeNode<T>): TreeNode<T> => {
      const processed: TreeNode<T> = {
        ...node,
        level,
        parent,
        expanded: expandAll || defaultExpanded || expandedNodes.has(node.id),
      };

      if (node.children) {
        processed.children = node.children.map(child => processNode(child, level + 1, processed));
      }

      return processed;
    };

    return data.map(node => processNode(node));
  }, [data, expandedNodes, expandAll, defaultExpanded]);

  // Flatten tree into visible rows
  const flattenedData = useMemo(() => {
    const flatten = (nodes: TreeNode<T>[]): TreeNode<T>[] => {
      const result: TreeNode<T>[] = [];

      nodes.forEach(node => {
        result.push(node);
        if (node.expanded && node.children) {
          result.push(...flatten(node.children));
        }
      });

      return result;
    };

    return flatten(processedData);
  }, [processedData]);

  // Handle node expansion
  const handleNodeExpand = (node: TreeNode<T>) => {
    const newExpanded = new Set(expandedNodes);
    const isCurrentlyExpanded = expandedNodes.has(node.id);

    if (isCurrentlyExpanded) {
      newExpanded.delete(node.id);
    } else {
      newExpanded.add(node.id);
    }

    setExpandedNodes(newExpanded);

    if (onNodeExpand) {
      onNodeExpand(node, !isCurrentlyExpanded);
    }
  };

  // Handle node selection
  const handleNodeSelection = (node: TreeNode<T>) => {
    if (!selectable || !onSelectionChange) return;

    const isSelected = selectedNodes.some(selected => selected.id === node.id);
    const newSelection = isSelected
      ? selectedNodes.filter(selected => selected.id !== node.id)
      : [...selectedNodes, node];
    
    onSelectionChange(newSelection);
  };

  // Get cell value
  const getCellValue = (node: TreeNode<T>, column: TreeTableColumn<T>) => {
    if (column.accessor) {
      if (typeof column.accessor === 'function') {
        return column.accessor(node);
      }
      return node.data[column.accessor];
    }
    return node.data[column.key];
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
          expandButtonColor: '#9ca3af',
        };
      case 'minimal':
        return {
          backgroundColor: 'transparent',
          borderColor: '#f3f4f6',
          textColor: '#374151',
          headerBackground: '#f9fafb',
          rowHover: '#f9fafb',
          selectedBackground: '#eff6ff',
          expandButtonColor: '#6b7280',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          headerBackground: '#f9fafb',
          rowHover: '#f9fafb',
          selectedBackground: '#eff6ff',
          expandButtonColor: '#6b7280',
        };
    }
  };

  const theme = getThemeStyles();
  const treeColumnKey = treeColumn || columns[0]?.key;

  return (
    <div className={className} style={{ ...style }}>
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
              {selectable && (
                <th style={{
                  padding: compact ? '8px' : '12px',
                  textAlign: 'center',
                  borderBottom: `1px solid ${theme.borderColor}`,
                  width: '40px',
                  fontWeight: '600',
                  fontSize: '14px',
                }}>
                  <input
                    type="checkbox"
                    checked={flattenedData.length > 0 && flattenedData.every(node => selectedNodes.some(selected => selected.id === node.id))}
                    onChange={() => {
                      if (onSelectionChange) {
                        const allSelected = flattenedData.every(node => selectedNodes.some(selected => selected.id === node.id));
                        onSelectionChange(allSelected ? [] : [...flattenedData]);
                      }
                    }}
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
                    fontWeight: '600',
                    fontSize: '14px',
                  }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
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
            ) : flattenedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
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
              flattenedData.map((node, rowIndex) => {
                const isSelected = selectedNodes.some(selected => selected.id === node.id);
                const hasChildren = node.children && node.children.length > 0;
                const isExpanded = node.expanded;
                
                return (
                  <tr
                    key={`${node.id}-${rowIndex}`}
                    style={{
                      backgroundColor: isSelected 
                        ? theme.selectedBackground 
                        : striped && rowIndex % 2 === 1 
                        ? `${theme.rowHover}20`
                        : 'transparent',
                      cursor: onNodeClick ? 'pointer' : 'default',
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
                      if (onNodeClick) onNodeClick(node, rowIndex);
                      if (selectable) handleNodeSelection(node);
                    }}
                  >
                    {selectable && (
                      <td style={{
                        padding: compact ? '8px' : '12px',
                        textAlign: 'center',
                        borderBottom: `1px solid ${theme.borderColor}`,
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleNodeSelection(node)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    
                    {columns.map((column) => {
                      const value = getCellValue(node, column);
                      const isTreeColumn = column.key === treeColumnKey;
                      const indent = isTreeColumn ? (node.level || 0) * indentSize : 0;
                      
                      let content = column.render ? column.render(value, node, rowIndex) : String(value);
                      
                      return (
                        <td
                          key={column.key}
                          className={column.className}
                          style={{
                            padding: compact ? '8px' : '12px',
                            textAlign: column.align || 'left',
                            borderBottom: `1px solid ${theme.borderColor}`,
                            fontSize: '14px',
                          }}
                        >
                          {isTreeColumn && (
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: `${indent}px`,
                            }}>
                              {showExpandButton && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (hasChildren) {
                                      handleNodeExpand(node);
                                    }
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: hasChildren ? 'pointer' : 'default',
                                    color: theme.expandButtonColor,
                                    fontSize: '12px',
                                    padding: '2px 6px',
                                    marginRight: '4px',
                                    borderRadius: '2px',
                                    opacity: hasChildren ? 1 : 0.3,
                                    transform: hasChildren && isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                    order: expandButtonPosition === 'left' ? -1 : 1,
                                  }}
                                  disabled={!hasChildren}
                                >
                                  ▶
                                </button>
                              )}
                              
                              <span style={{ flex: 1 }}>
                                {content}
                              </span>
                            </div>
                          )}
                          
                          {!isTreeColumn && content}
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

      {/* Info */}
      {flattenedData.length > 0 && (
        <div style={{
          marginTop: '12px',
          fontSize: '14px',
          color: theme.textColor,
          opacity: 0.7,
        }}>
          Showing {flattenedData.length} rows
          {selectedNodes.length > 0 && ` (${selectedNodes.length} selected)`}
        </div>
      )}
    </div>
  );
};