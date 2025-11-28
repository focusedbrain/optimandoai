import React, { useState, useRef, useEffect } from 'react';

export interface TooltipProps {
  children: React.ReactElement;
  content: React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'left-start' | 'left-end' | 'right-start' | 'right-end';
  trigger?: 'hover' | 'click' | 'focus' | 'manual';
  delay?: number;
  hideDelay?: number;
  offset?: number;
  disabled?: boolean;
  arrow?: boolean;
  variant?: 'default' | 'dark' | 'light' | 'error' | 'warning' | 'success';
  size?: 'small' | 'medium' | 'large';
  maxWidth?: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  placement = 'top',
  trigger = 'hover',
  delay = 200,
  hideDelay = 0,
  offset = 8,
  disabled = false,
  arrow = true,
  variant = 'default',
  size = 'medium',
  maxWidth = '250px',
  isOpen: controlledOpen,
  onOpenChange,
  className,
  style,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const hideTimeoutRef = useRef<NodeJS.Timeout>();

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : isOpen;

  // Update position
  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = triggerRect.top + scrollY - tooltipRect.height - offset;
        left = triggerRect.left + scrollX + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'top-start':
        top = triggerRect.top + scrollY - tooltipRect.height - offset;
        left = triggerRect.left + scrollX;
        break;
      case 'top-end':
        top = triggerRect.top + scrollY - tooltipRect.height - offset;
        left = triggerRect.right + scrollX - tooltipRect.width;
        break;
      case 'bottom':
        top = triggerRect.bottom + scrollY + offset;
        left = triggerRect.left + scrollX + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom-start':
        top = triggerRect.bottom + scrollY + offset;
        left = triggerRect.left + scrollX;
        break;
      case 'bottom-end':
        top = triggerRect.bottom + scrollY + offset;
        left = triggerRect.right + scrollX - tooltipRect.width;
        break;
      case 'left':
        top = triggerRect.top + scrollY + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left + scrollX - tooltipRect.width - offset;
        break;
      case 'left-start':
        top = triggerRect.top + scrollY;
        left = triggerRect.left + scrollX - tooltipRect.width - offset;
        break;
      case 'left-end':
        top = triggerRect.bottom + scrollY - tooltipRect.height;
        left = triggerRect.left + scrollX - tooltipRect.width - offset;
        break;
      case 'right':
        top = triggerRect.top + scrollY + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + scrollX + offset;
        break;
      case 'right-start':
        top = triggerRect.top + scrollY;
        left = triggerRect.right + scrollX + offset;
        break;
      case 'right-end':
        top = triggerRect.bottom + scrollY - tooltipRect.height;
        left = triggerRect.right + scrollX + offset;
        break;
    }

    // Constrain to viewport
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    left = Math.max(8, Math.min(left, viewport.width - tooltipRect.width - 8));
    top = Math.max(8, Math.min(top, viewport.height - tooltipRect.height - 8));

    setPosition({ top, left });
  };

  // Handle open state change
  const handleOpenChange = (newOpen: boolean) => {
    if (isControlled && onOpenChange) {
      onOpenChange(newOpen);
    } else {
      setIsOpen(newOpen);
    }
  };

  // Show tooltip
  const showTooltip = () => {
    if (disabled) return;
    
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = undefined;
    }

    if (delay > 0) {
      timeoutRef.current = setTimeout(() => {
        handleOpenChange(true);
      }, delay);
    } else {
      handleOpenChange(true);
    }
  };

  // Hide tooltip
  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    if (hideDelay > 0) {
      hideTimeoutRef.current = setTimeout(() => {
        handleOpenChange(false);
      }, hideDelay);
    } else {
      handleOpenChange(false);
    }
  };

  // Event handlers
  const handleMouseEnter = () => {
    if (trigger === 'hover') {
      showTooltip();
    }
  };

  const handleMouseLeave = () => {
    if (trigger === 'hover') {
      hideTooltip();
    }
  };

  const handleClick = () => {
    if (trigger === 'click') {
      if (open) {
        hideTooltip();
      } else {
        showTooltip();
      }
    }
  };

  const handleFocus = () => {
    if (trigger === 'focus') {
      showTooltip();
    }
  };

  const handleBlur = () => {
    if (trigger === 'focus') {
      hideTooltip();
    }
  };

  // Update position when tooltip is shown
  useEffect(() => {
    if (open) {
      updatePosition();
      
      const handleScroll = () => updatePosition();
      const handleResize = () => updatePosition();
      
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [open, placement]);

  // Close on outside click for click trigger
  useEffect(() => {
    if (trigger === 'click' && open) {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          triggerRef.current &&
          !triggerRef.current.contains(event.target as Node) &&
          tooltipRef.current &&
          !tooltipRef.current.contains(event.target as Node)
        ) {
          hideTooltip();
        }
      };

      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [trigger, open]);

  // Get variant styles
  const getVariantStyles = () => {
    switch (variant) {
      case 'dark':
        return {
          backgroundColor: '#1f2937',
          color: '#f9fafb',
          borderColor: '#374151',
        };
      case 'light':
        return {
          backgroundColor: '#ffffff',
          color: '#374151',
          borderColor: '#e5e7eb',
        };
      case 'error':
        return {
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          borderColor: '#fecaca',
        };
      case 'warning':
        return {
          backgroundColor: '#fffbeb',
          color: '#92400e',
          borderColor: '#fde68a',
        };
      case 'success':
        return {
          backgroundColor: '#f0fdf4',
          color: '#166534',
          borderColor: '#bbf7d0',
        };
      default:
        return {
          backgroundColor: '#374151',
          color: '#ffffff',
          borderColor: '#4b5563',
        };
    }
  };

  // Get size styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          padding: '4px 8px',
          fontSize: '12px',
        };
      case 'large':
        return {
          padding: '12px 16px',
          fontSize: '16px',
        };
      default:
        return {
          padding: '8px 12px',
          fontSize: '14px',
        };
    }
  };

  // Get arrow styles
  const getArrowStyles = () => {
    const variantStyles = getVariantStyles();
    const arrowSize = 6;
    
    let arrowStyle: React.CSSProperties = {
      position: 'absolute',
      width: 0,
      height: 0,
    };

    if (placement.startsWith('top')) {
      arrowStyle = {
        ...arrowStyle,
        top: '100%',
        left: '50%',
        marginLeft: `-${arrowSize}px`,
        borderLeft: `${arrowSize}px solid transparent`,
        borderRight: `${arrowSize}px solid transparent`,
        borderTop: `${arrowSize}px solid ${variantStyles.backgroundColor}`,
      };
    } else if (placement.startsWith('bottom')) {
      arrowStyle = {
        ...arrowStyle,
        bottom: '100%',
        left: '50%',
        marginLeft: `-${arrowSize}px`,
        borderLeft: `${arrowSize}px solid transparent`,
        borderRight: `${arrowSize}px solid transparent`,
        borderBottom: `${arrowSize}px solid ${variantStyles.backgroundColor}`,
      };
    } else if (placement.startsWith('left')) {
      arrowStyle = {
        ...arrowStyle,
        left: '100%',
        top: '50%',
        marginTop: `-${arrowSize}px`,
        borderTop: `${arrowSize}px solid transparent`,
        borderBottom: `${arrowSize}px solid transparent`,
        borderLeft: `${arrowSize}px solid ${variantStyles.backgroundColor}`,
      };
    } else if (placement.startsWith('right')) {
      arrowStyle = {
        ...arrowStyle,
        right: '100%',
        top: '50%',
        marginTop: `-${arrowSize}px`,
        borderTop: `${arrowSize}px solid transparent`,
        borderBottom: `${arrowSize}px solid transparent`,
        borderRight: `${arrowSize}px solid ${variantStyles.backgroundColor}`,
      };
    }

    return arrowStyle;
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  // Clone children with event handlers
  const childElement = React.cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onClick: handleClick,
    onFocus: handleFocus,
    onBlur: handleBlur,
  });

  return (
    <>
      {childElement}
      
      {open && content && !disabled && (
        <div
          ref={tooltipRef}
          className={className}
          style={{
            position: 'absolute',
            top: position.top,
            left: position.left,
            zIndex: 1000,
            ...variantStyles,
            ...sizeStyles,
            maxWidth,
            borderRadius: '6px',
            border: variant === 'light' ? `1px solid ${variantStyles.borderColor}` : 'none',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            wordWrap: 'break-word',
            lineHeight: '1.4',
            fontWeight: '500',
            pointerEvents: trigger === 'hover' ? 'none' : 'auto',
            opacity: 0,
            animation: 'tooltipFadeIn 0.2s ease-out forwards',
            ...style,
          }}
        >
          {content}
          
          {arrow && (
            <div style={getArrowStyles()} />
          )}
        </div>
      )}

      <style>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
};