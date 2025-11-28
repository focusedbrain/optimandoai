import React, { useState, useEffect } from 'react';

export interface ResponsiveGridProps {
  children: React.ReactNode;
  breakpoints?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    xxl?: number;
  };
  cols?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    xxl?: number;
  };
  gap?: number | string;
  rowGap?: number | string;
  columnGap?: number | string;
  align?: 'start' | 'end' | 'center' | 'stretch';
  justify?: 'start' | 'end' | 'center' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly';
  autoFit?: boolean;
  minColumnWidth?: number | string;
  maxColumnWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  breakpoints = {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
    xxl: 1400,
  },
  cols = {
    xs: 1,
    sm: 2,
    md: 3,
    lg: 4,
    xl: 5,
    xxl: 6,
  },
  gap = '1rem',
  rowGap,
  columnGap,
  align = 'stretch',
  justify = 'start',
  autoFit = false,
  minColumnWidth = '250px',
  maxColumnWidth = '1fr',
  className,
  style,
}) => {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('xs');
  const [windowWidth, setWindowWidth] = useState<number>(0);

  // Update window width and breakpoint
  useEffect(() => {
    const updateDimensions = () => {
      const width = window.innerWidth;
      setWindowWidth(width);

      // Determine current breakpoint
      const sortedBreakpoints = Object.entries(breakpoints)
        .sort(([, a], [, b]) => b - a); // Sort descending

      const activeBreakpoint = sortedBreakpoints.find(([, value]) => width >= value);
      setCurrentBreakpoint(activeBreakpoint ? activeBreakpoint[0] : 'xs');
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [breakpoints]);

  // Get current number of columns
  const getCurrentColumns = (): number => {
    return cols[currentBreakpoint as keyof typeof cols] || cols.xs || 1;
  };

  // Get grid template columns
  const getGridTemplateColumns = (): string => {
    if (autoFit) {
      return `repeat(auto-fit, minmax(${minColumnWidth}, ${maxColumnWidth}))`;
    }
    
    const columnCount = getCurrentColumns();
    return `repeat(${columnCount}, 1fr)`;
  };

  // Get grid styles
  const getGridStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: getGridTemplateColumns(),
      gap: gap,
      gridRowGap: rowGap || gap,
      gridColumnGap: columnGap || gap,
      alignItems: align,
      justifyContent: justify,
      width: '100%',
    };

    return {
      ...baseStyles,
      ...style,
    };
  };

  return (
    <div 
      className={className}
      style={getGridStyles()}
      data-breakpoint={currentBreakpoint}
      data-columns={getCurrentColumns()}
    >
      {children}
    </div>
  );
};

// Grid Item component for more control
export interface GridItemProps {
  children: React.ReactNode;
  span?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    xxl?: number;
  } | number;
  offset?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    xxl?: number;
  } | number;
  order?: {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    xxl?: number;
  } | number;
  className?: string;
  style?: React.CSSProperties;
}

export const GridItem: React.FC<GridItemProps> = ({
  children,
  span = 1,
  offset = 0,
  order = 0,
  className,
  style,
}) => {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('xs');

  // Update current breakpoint
  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      
      if (width >= 1400) setCurrentBreakpoint('xxl');
      else if (width >= 1200) setCurrentBreakpoint('xl');
      else if (width >= 992) setCurrentBreakpoint('lg');
      else if (width >= 768) setCurrentBreakpoint('md');
      else if (width >= 576) setCurrentBreakpoint('sm');
      else setCurrentBreakpoint('xs');
    };

    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);

  // Get responsive value
  const getResponsiveValue = (value: any): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null) {
      return value[currentBreakpoint as keyof typeof value] || value.xs || 1;
    }
    return 1;
  };

  const currentSpan = getResponsiveValue(span);
  const currentOffset = getResponsiveValue(offset);
  const currentOrder = getResponsiveValue(order);

  const itemStyles: React.CSSProperties = {
    gridColumn: currentOffset > 0 
      ? `${currentOffset + 1} / span ${currentSpan}`
      : `span ${currentSpan}`,
    order: currentOrder,
    ...style,
  };

  return (
    <div 
      className={className}
      style={itemStyles}
      data-breakpoint={currentBreakpoint}
      data-span={currentSpan}
      data-offset={currentOffset}
    >
      {children}
    </div>
  );
};