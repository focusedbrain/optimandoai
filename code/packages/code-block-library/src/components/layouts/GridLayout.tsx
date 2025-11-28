import React, { useState, useEffect, useRef } from 'react';

export interface GridItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  static?: boolean;
  resizable?: boolean;
  draggable?: boolean;
  children?: React.ReactNode;
}

export interface GridLayoutProps {
  items: GridItem[];
  onLayoutChange?: (items: GridItem[]) => void;
  cols?: number;
  rowHeight?: number;
  margin?: [number, number];
  containerPadding?: [number, number];
  isDraggable?: boolean;
  isResizable?: boolean;
  preventCollision?: boolean;
  compactType?: 'vertical' | 'horizontal' | null;
  verticalCompact?: boolean;
  autoSize?: boolean;
  width?: number;
  maxRows?: number;
  allowOverlap?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const GridLayout: React.FC<GridLayoutProps> = ({
  items,
  onLayoutChange,
  cols = 12,
  rowHeight = 150,
  margin = [10, 10],
  containerPadding = [10, 10],
  isDraggable = true,
  isResizable = true,
  preventCollision = false,
  compactType = 'vertical',
  verticalCompact = true,
  autoSize = true,
  width: containerWidth,
  maxRows = Infinity,
  allowOverlap = false,
  className,
  style,
}) => {
  const [layout, setLayout] = useState<GridItem[]>(items);
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Update layout when items prop changes
  useEffect(() => {
    setLayout(items);
  }, [items]);

  // Measure container
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerDimensions({
          width: containerWidth || rect.width,
          height: autoSize ? 'auto' : rect.height,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [containerWidth, autoSize]);

  // Calculate dimensions
  const colWidth = (containerDimensions.width - containerPadding[0] * 2 - margin[0] * (cols - 1)) / cols;
  const maxHeight = layout.reduce((max, item) => Math.max(max, item.y + item.height), 0);
  const calculatedHeight = maxHeight * rowHeight + maxHeight * margin[1] + containerPadding[1] * 2;

  // Convert grid coordinates to pixels
  const gridToPixels = (gridX: number, gridY: number, gridW: number, gridH: number) => ({
    left: containerPadding[0] + gridX * (colWidth + margin[0]),
    top: containerPadding[1] + gridY * (rowHeight + margin[1]),
    width: gridW * colWidth + (gridW - 1) * margin[0],
    height: gridH * rowHeight + (gridH - 1) * margin[1],
  });

  // Convert pixels to grid coordinates
  const pixelsToGrid = (pixelX: number, pixelY: number) => ({
    x: Math.round((pixelX - containerPadding[0]) / (colWidth + margin[0])),
    y: Math.round((pixelY - containerPadding[1]) / (rowHeight + margin[1])),
  });

  // Check for collisions
  const hasCollision = (item: GridItem, otherItems: GridItem[]) => {
    if (allowOverlap) return false;
    
    return otherItems.some(other => {
      if (other.id === item.id || other.static) return false;
      
      return !(
        item.x >= other.x + other.width ||
        item.x + item.width <= other.x ||
        item.y >= other.y + other.height ||
        item.y + item.height <= other.y
      );
    });
  };

  // Compact layout
  const compactLayout = (layoutToCompact: GridItem[]) => {
    if (!compactType && !verticalCompact) return layoutToCompact;

    const compacted = [...layoutToCompact];
    
    if (compactType === 'vertical' || verticalCompact) {
      // Sort by y position, then x
      compacted.sort((a, b) => a.y - b.y || a.x - b.x);
      
      compacted.forEach((item, index) => {
        if (item.static) return;
        
        // Find the highest position this item can move to
        let newY = 0;
        while (newY < item.y) {
          const testItem = { ...item, y: newY };
          const others = compacted.slice(0, index).concat(compacted.slice(index + 1));
          
          if (!hasCollision(testItem, others)) {
            break;
          }
          newY++;
        }
        
        item.y = newY;
      });
    }

    return compacted;
  };

  // Handle drag start
  const handleDragStart = (itemId: string, e: React.MouseEvent) => {
    if (!isDraggable) return;
    
    const item = layout.find(item => item.id === itemId);
    if (!item || item.static || !item.draggable) return;

    e.preventDefault();
    setIsDragging(itemId);
    
    const rect = e.currentTarget.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Handle drag move
  const handleDragMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const newPosition = pixelsToGrid(
      e.clientX - containerRect.left - dragOffset.x,
      e.clientY - containerRect.top - dragOffset.y
    );

    setLayout(prevLayout => {
      const newLayout = prevLayout.map(item => {
        if (item.id === isDragging) {
          const updatedItem = {
            ...item,
            x: Math.max(0, Math.min(newPosition.x, cols - item.width)),
            y: Math.max(0, newPosition.y),
          };

          // Check collision if enabled
          if (preventCollision) {
            const others = prevLayout.filter(other => other.id !== item.id);
            if (hasCollision(updatedItem, others)) {
              return item; // Keep original position
            }
          }

          return updatedItem;
        }
        return item;
      });

      return compactType ? compactLayout(newLayout) : newLayout;
    });
  };

  // Handle drag end
  const handleDragEnd = () => {
    if (isDragging && onLayoutChange) {
      onLayoutChange(layout);
    }
    setIsDragging(null);
  };

  // Handle resize start
  const handleResizeStart = (itemId: string, e: React.MouseEvent) => {
    if (!isResizable) return;
    
    const item = layout.find(item => item.id === itemId);
    if (!item || item.static || !item.resizable) return;

    e.preventDefault();
    e.stopPropagation();
    setIsResizing(itemId);
  };

  // Handle resize move
  const handleResizeMove = (e: MouseEvent) => {
    if (!isResizing) return;

    const container = containerRef.current;
    if (!container) return;

    const item = layout.find(item => item.id === isResizing);
    if (!item) return;

    const containerRect = container.getBoundingClientRect();
    const gridPos = pixelsToGrid(
      e.clientX - containerRect.left,
      e.clientY - containerRect.top
    );

    setLayout(prevLayout => {
      return prevLayout.map(layoutItem => {
        if (layoutItem.id === isResizing) {
          const newWidth = Math.max(
            layoutItem.minWidth || 1,
            Math.min(
              layoutItem.maxWidth || cols,
              gridPos.x - layoutItem.x + 1
            )
          );
          const newHeight = Math.max(
            layoutItem.minHeight || 1,
            Math.min(
              layoutItem.maxHeight || maxRows,
              gridPos.y - layoutItem.y + 1
            )
          );

          return {
            ...layoutItem,
            width: newWidth,
            height: newHeight,
          };
        }
        return layoutItem;
      });
    });
  };

  // Handle resize end
  const handleResizeEnd = () => {
    if (isResizing && onLayoutChange) {
      onLayoutChange(layout);
    }
    setIsResizing(null);
  };

  // Add event listeners for drag and resize
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, dragOffset]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: autoSize ? calculatedHeight : '100%',
        ...style,
      }}
    >
      {layout.map((item) => {
        const pixelPosition = gridToPixels(item.x, item.y, item.width, item.height);
        const isDraggingThis = isDragging === item.id;
        const isResizingThis = isResizing === item.id;

        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: pixelPosition.left,
              top: pixelPosition.top,
              width: pixelPosition.width,
              height: pixelPosition.height,
              cursor: isDraggingThis ? 'grabbing' : item.draggable !== false && isDraggable ? 'grab' : 'default',
              userSelect: 'none',
              transition: isDraggingThis || isResizingThis ? 'none' : 'all 0.2s ease',
              zIndex: isDraggingThis || isResizingThis ? 1000 : 1,
              border: isDraggingThis || isResizingThis ? '2px dashed #3b82f6' : '1px solid #e5e7eb',
              borderRadius: '8px',
              backgroundColor: 'white',
              boxShadow: isDraggingThis || isResizingThis 
                ? '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
                : '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
              overflow: 'hidden',
            }}
            onMouseDown={(e) => handleDragStart(item.id, e)}
          >
            {/* Content */}
            <div style={{
              width: '100%',
              height: '100%',
              padding: '12px',
              overflow: 'hidden',
            }}>
              {item.children}
            </div>

            {/* Resize Handle */}
            {isResizable && item.resizable !== false && !item.static && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '20px',
                  height: '20px',
                  cursor: 'se-resize',
                  background: 'linear-gradient(-45deg, transparent 0%, transparent 40%, #6b7280 40%, #6b7280 60%, transparent 60%)',
                }}
                onMouseDown={(e) => handleResizeStart(item.id, e)}
              />
            )}

            {/* Static indicator */}
            {item.static && (
              <div style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                opacity: 0.7,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
};