import React from 'react';

export interface FlexLayoutProps {
  children: React.ReactNode;
  direction?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justify?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  align?: 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
  alignContent?: 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
  gap?: number | string;
  rowGap?: number | string;
  columnGap?: number | string;
  responsive?: {
    xs?: Partial<FlexLayoutProps>;
    sm?: Partial<FlexLayoutProps>;
    md?: Partial<FlexLayoutProps>;
    lg?: Partial<FlexLayoutProps>;
    xl?: Partial<FlexLayoutProps>;
    xxl?: Partial<FlexLayoutProps>;
  };
  className?: string;
  style?: React.CSSProperties;
}

export const FlexLayout: React.FC<FlexLayoutProps> = ({
  children,
  direction = 'row',
  wrap = 'nowrap',
  justify = 'flex-start',
  align = 'stretch',
  alignContent = 'stretch',
  gap = 0,
  rowGap,
  columnGap,
  responsive,
  className,
  style,
}) => {
  // Generate responsive CSS
  const getResponsiveStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      display: 'flex',
      flexDirection: direction,
      flexWrap: wrap,
      justifyContent: justify,
      alignItems: align,
      alignContent: alignContent,
      gap: gap,
      rowGap: rowGap || gap,
      columnGap: columnGap || gap,
    };

    return {
      ...baseStyles,
      ...style,
    };
  };

  // Generate responsive CSS classes/styles for media queries
  const generateResponsiveCSS = () => {
    if (!responsive) return '';

    const breakpoints = {
      xs: '0px',
      sm: '576px',
      md: '768px',
      lg: '992px',
      xl: '1200px',
      xxl: '1400px',
    };

    return Object.entries(responsive)
      .map(([breakpoint, props]) => {
        if (!props) return '';
        
        const mediaQuery = breakpoint === 'xs' 
          ? '' 
          : `@media (min-width: ${breakpoints[breakpoint as keyof typeof breakpoints]})`;
        
        const styles = Object.entries(props)
          .filter(([key]) => ['direction', 'wrap', 'justify', 'align', 'alignContent', 'gap'].includes(key))
          .map(([key, value]) => {
            switch (key) {
              case 'direction':
                return `flex-direction: ${value};`;
              case 'wrap':
                return `flex-wrap: ${value};`;
              case 'justify':
                return `justify-content: ${value};`;
              case 'align':
                return `align-items: ${value};`;
              case 'alignContent':
                return `align-content: ${value};`;
              case 'gap':
                return `gap: ${value};`;
              default:
                return '';
            }
          })
          .join(' ');

        return mediaQuery ? `${mediaQuery} { ${styles} }` : styles;
      })
      .join(' ');
  };

  return (
    <>
      {responsive && (
        <style>
          {generateResponsiveCSS()}
        </style>
      )}
      <div 
        className={className}
        style={getResponsiveStyles()}
      >
        {children}
      </div>
    </>
  );
};

// Flex Item component
export interface FlexItemProps {
  children: React.ReactNode;
  flex?: string | number;
  grow?: number;
  shrink?: number;
  basis?: string | number;
  align?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
  order?: number;
  responsive?: {
    xs?: Partial<FlexItemProps>;
    sm?: Partial<FlexItemProps>;
    md?: Partial<FlexItemProps>;
    lg?: Partial<FlexItemProps>;
    xl?: Partial<FlexItemProps>;
    xxl?: Partial<FlexItemProps>;
  };
  className?: string;
  style?: React.CSSProperties;
}

export const FlexItem: React.FC<FlexItemProps> = ({
  children,
  flex,
  grow,
  shrink,
  basis,
  align = 'auto',
  order = 0,
  responsive,
  className,
  style,
}) => {
  const getItemStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      flex: flex,
      flexGrow: grow,
      flexShrink: shrink,
      flexBasis: basis,
      alignSelf: align,
      order: order,
    };

    // Remove undefined values
    const cleanStyles = Object.entries(baseStyles)
      .reduce((acc, [key, value]) => {
        if (value !== undefined) {
          acc[key as keyof React.CSSProperties] = value as any;
        }
        return acc;
      }, {} as React.CSSProperties);

    return {
      ...cleanStyles,
      ...style,
    };
  };

  const generateResponsiveCSS = () => {
    if (!responsive) return '';

    const breakpoints = {
      xs: '0px',
      sm: '576px',
      md: '768px',
      lg: '992px',
      xl: '1200px',
      xxl: '1400px',
    };

    return Object.entries(responsive)
      .map(([breakpoint, props]) => {
        if (!props) return '';
        
        const mediaQuery = breakpoint === 'xs' 
          ? '' 
          : `@media (min-width: ${breakpoints[breakpoint as keyof typeof breakpoints]})`;
        
        const styles = Object.entries(props)
          .filter(([key]) => ['flex', 'grow', 'shrink', 'basis', 'align', 'order'].includes(key))
          .map(([key, value]) => {
            switch (key) {
              case 'flex':
                return `flex: ${value};`;
              case 'grow':
                return `flex-grow: ${value};`;
              case 'shrink':
                return `flex-shrink: ${value};`;
              case 'basis':
                return `flex-basis: ${value};`;
              case 'align':
                return `align-self: ${value};`;
              case 'order':
                return `order: ${value};`;
              default:
                return '';
            }
          })
          .join(' ');

        return mediaQuery ? `${mediaQuery} { ${styles} }` : styles;
      })
      .join(' ');
  };

  return (
    <>
      {responsive && (
        <style>
          {generateResponsiveCSS()}
        </style>
      )}
      <div 
        className={className}
        style={getItemStyles()}
      >
        {children}
      </div>
    </>
  );
};