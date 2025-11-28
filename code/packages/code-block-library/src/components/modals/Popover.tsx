import React, { useState, useRef, useEffect } from 'react';

export interface PopoverProps {
  children: React.ReactElement;
  content: React.ReactNode;
  title?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'left-start' | 'left-end' | 'right-start' | 'right-end';
  trigger?: 'hover' | 'click' | 'focus' | 'manual';
  offset?: number;
  disabled?: boolean;
  arrow?: boolean;
  variant?: 'default' | 'dark' | 'bordered';
  size?: 'small' | 'medium' | 'large';
  width?: string;
  maxWidth?: string;
  maxHeight?: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showCloseButton?: boolean;
  footer?: React.ReactNode;
  closeOnOutsideClick?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const Popover: React.FC<PopoverProps> = ({
  children,
  content,
  title,
  placement = 'bottom',
  trigger = 'click',
  offset = 8,
  disabled = false,
  arrow = true,
  variant = 'default',
  size = 'medium',
  width,
  maxWidth = '350px',
  maxHeight = '400px',
  isOpen: controlledOpen,
  onOpenChange,
  showCloseButton = false,
  footer,
  closeOnOutsideClick = true,
  className,
  style,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : isOpen;

  // Handle open state change
  const handleOpenChange = (newOpen: boolean) => {
    if (isControlled && onOpenChange) {
      onOpenChange(newOpen);
    } else {
      setIsOpen(newOpen);
    }
  };

  // Update position
  const updatePosition = () => {
    if (!triggerRef.current || !popoverRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = triggerRect.top + scrollY - popoverRect.height - offset;
        left = triggerRect.left + scrollX + (triggerRect.width - popoverRect.width) / 2;
        break;
      case 'top-start':
        top = triggerRect.top + scrollY - popoverRect.height - offset;
        left = triggerRect.left + scrollX;
        break;
      case 'top-end':
        top = triggerRect.top + scrollY - popoverRect.height - offset;
        left = triggerRect.right + scrollX - popoverRect.width;
        break;
      case 'bottom':
        top = triggerRect.bottom + scrollY + offset;
        left = triggerRect.left + scrollX + (triggerRect.width - popoverRect.width) / 2;
        break;
      case 'bottom-start':
        top = triggerRect.bottom + scrollY + offset;
        left = triggerRect.left + scrollX;
        break;
      case 'bottom-end':
        top = triggerRect.bottom + scrollY + offset;
        left = triggerRect.right + scrollX - popoverRect.width;
        break;
      case 'left':
        top = triggerRect.top + scrollY + (triggerRect.height - popoverRect.height) / 2;
        left = triggerRect.left + scrollX - popoverRect.width - offset;
        break;
      case 'left-start':
        top = triggerRect.top + scrollY;
        left = triggerRect.left + scrollX - popoverRect.width - offset;
        break;
      case 'left-end':
        top = triggerRect.bottom + scrollY - popoverRect.height;
        left = triggerRect.left + scrollX - popoverRect.width - offset;
        break;
      case 'right':
        top = triggerRect.top + scrollY + (triggerRect.height - popoverRect.height) / 2;
        left = triggerRect.right + scrollX + offset;
        break;
      case 'right-start':
        top = triggerRect.top + scrollY;
        left = triggerRect.right + scrollX + offset;
        break;
      case 'right-end':
        top = triggerRect.bottom + scrollY - popoverRect.height;
        left = triggerRect.right + scrollX + offset;
        break;
    }

    // Constrain to viewport
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    left = Math.max(8, Math.min(left, viewport.width - popoverRect.width - 8));
    top = Math.max(8, Math.min(top, viewport.height - popoverRect.height - 8));

    setPosition({ top, left });
  };

  // Event handlers
  const handleMouseEnter = () => {
    if (trigger === 'hover') {
      handleOpenChange(true);
    }
  };

  const handleMouseLeave = () => {
    if (trigger === 'hover') {
      handleOpenChange(false);
    }
  };

  const handleClick = () => {
    if (trigger === 'click') {
      handleOpenChange(!open);
    }
  };

  const handleFocus = () => {
    if (trigger === 'focus') {
      handleOpenChange(true);
    }
  };

  const handleBlur = () => {
    if (trigger === 'focus') {
      handleOpenChange(false);
    }
  };

  const handleClose = () => {
    handleOpenChange(false);
  };

  // Update position when popover is shown
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

  // Close on outside click
  useEffect(() => {
    if (open && closeOnOutsideClick) {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          triggerRef.current &&
          !triggerRef.current.contains(event.target as Node) &&
          popoverRef.current &&
          !popoverRef.current.contains(event.target as Node)
        ) {
          handleOpenChange(false);
        }
      };

      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [open, closeOnOutsideClick]);

  // Close on escape key
  useEffect(() => {
    if (open) {
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          handleOpenChange(false);
        }
      };

      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open]);

  // Get variant styles
  const getVariantStyles = () => {
    switch (variant) {
      case 'dark':
        return {
          backgroundColor: '#1f2937',
          color: '#f9fafb',
          borderColor: '#374151',
          headerBackground: '#111827',
        };
      case 'bordered':
        return {
          backgroundColor: '#ffffff',
          color: '#374151',
          borderColor: '#d1d5db',
          headerBackground: '#f9fafb',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          color: '#374151',
          borderColor: '#e5e7eb',
          headerBackground: '#f9fafb',
        };
    }
  };

  // Get size styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          padding: '8px',
          fontSize: '12px',
        };
      case 'large':
        return {
          padding: '20px',
          fontSize: '16px',
        };
      default:
        return {
          padding: '16px',
          fontSize: '14px',
        };
    }
  };

  // Get arrow styles
  const getArrowStyles = () => {
    const variantStyles = getVariantStyles();
    const arrowSize = 8;
    
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
        filter: variant === 'bordered' ? `drop-shadow(0 2px 1px ${variantStyles.borderColor})` : undefined,
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
        filter: variant === 'bordered' ? `drop-shadow(0 -2px 1px ${variantStyles.borderColor})` : undefined,
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
        filter: variant === 'bordered' ? `drop-shadow(2px 0 1px ${variantStyles.borderColor})` : undefined,
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
        filter: variant === 'bordered' ? `drop-shadow(-2px 0 1px ${variantStyles.borderColor})` : undefined,
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
          ref={popoverRef}
          className={className}
          style={{
            position: 'absolute',
            top: position.top,
            left: position.left,
            zIndex: 1000,
            ...variantStyles,
            width,
            maxWidth,
            maxHeight,
            borderRadius: '8px',
            border: `1px solid ${variantStyles.borderColor}`,
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            opacity: 0,
            animation: 'popoverFadeIn 0.2s ease-out forwards',
            ...style,
          }}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${sizeStyles.padding.replace('16px', '12px')} ${sizeStyles.padding}`,
              borderBottom: `1px solid ${variantStyles.borderColor}`,
              backgroundColor: variantStyles.headerBackground,
              fontSize: sizeStyles.fontSize,
              fontWeight: '600',
            }}>
              {title && (
                <h3 style={{
                  margin: 0,
                  color: variantStyles.color,
                  fontSize: sizeStyles.fontSize,
                }}>
                  {title}
                </h3>
              )}

              {showCloseButton && (
                <button
                  onClick={handleClose}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '18px',
                    cursor: 'pointer',
                    color: variantStyles.color,
                    padding: '2px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.7,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.backgroundColor = variant === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.7';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  aria-label="Close popover"
                >
                  ×
                </button>
              )}
            </div>
          )}

          {/* Content */}
          <div style={{
            flex: 1,
            padding: sizeStyles.padding,
            fontSize: sizeStyles.fontSize,
            lineHeight: '1.5',
            overflowY: 'auto',
          }}>
            {content}
          </div>

          {/* Footer */}
          {footer && (
            <div style={{
              padding: `${sizeStyles.padding.replace('16px', '12px')} ${sizeStyles.padding}`,
              borderTop: `1px solid ${variantStyles.borderColor}`,
              backgroundColor: variantStyles.headerBackground,
            }}>
              {footer}
            </div>
          )}

          {/* Arrow */}
          {arrow && (
            <div style={getArrowStyles()} />
          )}
        </div>
      )}

      <style>{`
        @keyframes popoverFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
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