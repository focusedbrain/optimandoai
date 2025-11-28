import React, { useState, useRef } from 'react';

export interface DashboardWidget {
  id: string;
  title: string;
  content: React.ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
  draggable?: boolean;
  closable?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  headerActions?: React.ReactNode[];
}

export interface DashboardLayoutProps {
  widgets: DashboardWidget[];
  onWidgetChange?: (widgets: DashboardWidget[]) => void;
  onWidgetClose?: (widgetId: string) => void;
  onWidgetCollapse?: (widgetId: string, collapsed: boolean) => void;
  cols?: number;
  rowHeight?: number;
  margin?: [number, number];
  containerPadding?: [number, number];
  isDraggable?: boolean;
  isResizable?: boolean;
  showGrid?: boolean;
  gridColor?: string;
  variant?: 'default' | 'dark' | 'minimal';
  className?: string;
  style?: React.CSSProperties;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  widgets,
  onWidgetChange,
  onWidgetClose,
  onWidgetCollapse,
  cols = 12,
  rowHeight = 100,
  margin = [10, 10],
  containerPadding = [20, 20],
  isDraggable = true,
  isResizable = true,
  showGrid = false,
  gridColor = '#f0f0f0',
  variant = 'default',
  className,
  style,
}) => {
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [resizedWidget, setResizedWidget] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate dimensions
  const getPixelPosition = (gridX: number, gridY: number, gridW: number, gridH: number) => {
    const container = containerRef.current;
    if (!container) return { left: 0, top: 0, width: 0, height: 0 };

    const containerWidth = container.clientWidth - containerPadding[0] * 2;
    const colWidth = (containerWidth - margin[0] * (cols - 1)) / cols;

    return {
      left: containerPadding[0] + gridX * (colWidth + margin[0]),
      top: containerPadding[1] + gridY * (rowHeight + margin[1]),
      width: gridW * colWidth + (gridW - 1) * margin[0],
      height: gridH * rowHeight + (gridH - 1) * margin[1],
    };
  };

  // Convert pixel position to grid position
  const getGridPosition = (pixelX: number, pixelY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };

    const containerWidth = container.clientWidth - containerPadding[0] * 2;
    const colWidth = (containerWidth - margin[0] * (cols - 1)) / cols;

    return {
      x: Math.round((pixelX - containerPadding[0]) / (colWidth + margin[0])),
      y: Math.round((pixelY - containerPadding[1]) / (rowHeight + margin[1])),
    };
  };

  // Handle widget drag start
  const handleDragStart = (widgetId: string, e: React.MouseEvent) => {
    if (!isDraggable) return;

    const widget = widgets.find(w => w.id === widgetId);
    if (!widget || widget.draggable === false) return;

    e.preventDefault();
    setDraggedWidget(widgetId);

    const rect = e.currentTarget.getBoundingClientRect();
    const container = containerRef.current?.getBoundingClientRect();
    
    if (container) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  // Handle widget drag
  const handleDragMove = (e: MouseEvent) => {
    if (!draggedWidget || !containerRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const newPos = getGridPosition(
      e.clientX - container.left - dragOffset.x,
      e.clientY - container.top - dragOffset.y
    );

    const updatedWidgets = widgets.map(widget => {
      if (widget.id === draggedWidget) {
        return {
          ...widget,
          x: Math.max(0, Math.min(newPos.x, cols - widget.width)),
          y: Math.max(0, newPos.y),
        };
      }
      return widget;
    });

    if (onWidgetChange) {
      onWidgetChange(updatedWidgets);
    }
  };

  // Handle widget drag end
  const handleDragEnd = () => {
    setDraggedWidget(null);
  };

  // Handle widget resize start
  const handleResizeStart = (widgetId: string, e: React.MouseEvent) => {
    if (!isResizable) return;

    const widget = widgets.find(w => w.id === widgetId);
    if (!widget || widget.resizable === false) return;

    e.preventDefault();
    e.stopPropagation();
    setResizedWidget(widgetId);
  };

  // Handle widget resize
  const handleResizeMove = (e: MouseEvent) => {
    if (!resizedWidget || !containerRef.current) return;

    const widget = widgets.find(w => w.id === resizedWidget);
    if (!widget) return;

    const container = containerRef.current.getBoundingClientRect();
    const gridPos = getGridPosition(
      e.clientX - container.left,
      e.clientY - container.top
    );

    const newWidth = Math.max(
      widget.minWidth || 1,
      Math.min(
        widget.maxWidth || cols,
        gridPos.x - widget.x + 1
      )
    );

    const newHeight = Math.max(
      widget.minHeight || 1,
      gridPos.y - widget.y + 1
    );

    const updatedWidgets = widgets.map(w => {
      if (w.id === resizedWidget) {
        return { ...w, width: newWidth, height: newHeight };
      }
      return w;
    });

    if (onWidgetChange) {
      onWidgetChange(updatedWidgets);
    }
  };

  // Handle widget resize end
  const handleResizeEnd = () => {
    setResizedWidget(null);
  };

  // Add event listeners
  React.useEffect(() => {
    if (draggedWidget) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [draggedWidget, dragOffset]);

  React.useEffect(() => {
    if (resizedWidget) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizedWidget]);

  // Get theme styles
  const getThemeStyles = () => {
    switch (variant) {
      case 'dark':
        return {
          backgroundColor: '#111827',
          widgetBackground: '#1f2937',
          borderColor: '#374151',
          textColor: '#f9fafb',
          headerBackground: '#374151',
        };
      case 'minimal':
        return {
          backgroundColor: '#fafafa',
          widgetBackground: 'transparent',
          borderColor: '#e0e0e0',
          textColor: '#333333',
          headerBackground: 'transparent',
        };
      default:
        return {
          backgroundColor: '#f5f5f5',
          widgetBackground: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          headerBackground: '#f9fafb',
        };
    }
  };

  const theme = getThemeStyles();

  // Calculate container height
  const maxHeight = widgets.reduce(
    (max, widget) => Math.max(max, widget.y + widget.height),
    0
  );
  const containerHeight = maxHeight * rowHeight + maxHeight * margin[1] + containerPadding[1] * 2;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: containerHeight,
        backgroundColor: theme.backgroundColor,
        backgroundImage: showGrid 
          ? `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`
          : 'none',
        backgroundSize: showGrid 
          ? `${(100 / cols)}% ${rowHeight + margin[1]}px`
          : 'auto',
        ...style,
      }}
    >
      {widgets.map((widget) => {
        const position = getPixelPosition(widget.x, widget.y, widget.width, widget.height);
        const isDragging = draggedWidget === widget.id;
        const isResizing = resizedWidget === widget.id;

        return (
          <div
            key={widget.id}
            style={{
              position: 'absolute',
              left: position.left,
              top: position.top,
              width: position.width,
              height: widget.collapsed ? 'auto' : position.height,
              backgroundColor: theme.widgetBackground,
              border: `1px solid ${theme.borderColor}`,
              borderRadius: '8px',
              boxShadow: isDragging || isResizing 
                ? '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
                : '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
              zIndex: isDragging || isResizing ? 1000 : 1,
              transition: isDragging || isResizing ? 'none' : 'all 0.2s ease',
              overflow: 'hidden',
            }}
          >
            {/* Widget Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                backgroundColor: theme.headerBackground,
                borderBottom: `1px solid ${theme.borderColor}`,
                cursor: widget.draggable !== false && isDraggable ? 'move' : 'default',
                minHeight: '48px',
              }}
              onMouseDown={(e) => handleDragStart(widget.id, e)}
            >
              <h3 style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: '600',
                color: theme.textColor,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {widget.title}
              </h3>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Custom header actions */}
                {widget.headerActions?.map((action, index) => (
                  <div key={index} onClick={(e) => e.stopPropagation()}>
                    {action}
                  </div>
                ))}

                {/* Collapse button */}
                {widget.collapsible && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onWidgetCollapse) {
                        onWidgetCollapse(widget.id, !widget.collapsed);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.textColor,
                      fontSize: '14px',
                      padding: '4px',
                      borderRadius: '4px',
                    }}
                  >
                    {widget.collapsed ? '▼' : '▲'}
                  </button>
                )}

                {/* Close button */}
                {widget.closable && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onWidgetClose) {
                        onWidgetClose(widget.id);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.textColor,
                      fontSize: '16px',
                      padding: '4px',
                      borderRadius: '4px',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Widget Content */}
            {!widget.collapsed && (
              <div style={{
                padding: '16px',
                height: 'calc(100% - 48px)',
                overflow: 'auto',
                color: theme.textColor,
              }}>
                {widget.content}
              </div>
            )}

            {/* Resize handle */}
            {isResizable && widget.resizable !== false && !widget.collapsed && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '20px',
                  height: '20px',
                  cursor: 'se-resize',
                  background: 'linear-gradient(-45deg, transparent 0%, transparent 40%, #9ca3af 40%, #9ca3af 60%, transparent 60%)',
                }}
                onMouseDown={(e) => handleResizeStart(widget.id, e)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};