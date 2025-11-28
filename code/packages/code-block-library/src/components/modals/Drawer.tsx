import React, { useEffect, useRef } from 'react';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  position?: 'left' | 'right' | 'top' | 'bottom';
  size?: 'small' | 'medium' | 'large' | 'full';
  title?: string;
  children?: React.ReactNode;
  showCloseButton?: boolean;
  disableOutsideClick?: boolean;
  disableEscape?: boolean;
  overlay?: boolean;
  resizable?: boolean;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  variant?: 'default' | 'dark' | 'glass';
  className?: string;
  style?: React.CSSProperties;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  position = 'right',
  size = 'medium',
  title,
  children,
  showCloseButton = true,
  disableOutsideClick = false,
  disableEscape = false,
  overlay = true,
  resizable = false,
  footer,
  headerActions,
  variant = 'default',
  className,
  style,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const [drawerSize, setDrawerSize] = React.useState<number | null>(null);

  // Handle escape key
  useEffect(() => {
    if (!isOpen || disableEscape) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, disableEscape, onClose]);

  // Handle outside click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (disableOutsideClick) return;
    
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Focus management
  useEffect(() => {
    if (!isOpen) return;

    const focusableElements = drawerRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements && focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }
  }, [isOpen]);

  // Resize functionality
  useEffect(() => {
    if (!resizable || !isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const startPos = position === 'left' || position === 'right' ? e.clientX : e.clientY;
      const startSize = drawerSize || getDefaultSize();

      const handleMouseMove = (e: MouseEvent) => {
        const currentPos = position === 'left' || position === 'right' ? e.clientX : e.clientY;
        let newSize: number;

        if (position === 'right') {
          newSize = startSize + (startPos - currentPos);
        } else if (position === 'left') {
          newSize = startSize + (currentPos - startPos);
        } else if (position === 'bottom') {
          newSize = startSize + (startPos - currentPos);
        } else { // top
          newSize = startSize + (currentPos - startPos);
        }

        newSize = Math.max(200, Math.min(newSize, window.innerWidth * 0.8));
        setDrawerSize(newSize);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const resizeElement = resizeRef.current;
    if (resizeElement) {
      resizeElement.addEventListener('mousedown', handleMouseDown);
      return () => resizeElement.removeEventListener('mousedown', handleMouseDown);
    }
  }, [resizable, isOpen, drawerSize, position]);

  // Get default size
  const getDefaultSize = (): number => {
    const isHorizontal = position === 'left' || position === 'right';
    const viewportSize = isHorizontal ? window.innerWidth : window.innerHeight;

    switch (size) {
      case 'small':
        return viewportSize * 0.25;
      case 'large':
        return viewportSize * 0.5;
      case 'full':
        return viewportSize * 0.9;
      default: // medium
        return viewportSize * 0.33;
    }
  };

  // Get size styles
  const getSizeStyles = () => {
    const currentSize = drawerSize || getDefaultSize();
    
    switch (position) {
      case 'left':
      case 'right':
        return {
          width: `${currentSize}px`,
          height: '100vh',
          maxWidth: '90vw',
        };
      case 'top':
      case 'bottom':
        return {
          width: '100vw',
          height: `${currentSize}px`,
          maxHeight: '90vh',
        };
      default:
        return {};
    }
  };

  // Get position styles
  const getPositionStyles = () => {
    const translateValue = isOpen ? '0' : getTranslateValue();
    
    switch (position) {
      case 'left':
        return {
          left: 0,
          top: 0,
          transform: `translateX(${translateValue})`,
        };
      case 'right':
        return {
          right: 0,
          top: 0,
          transform: `translateX(${translateValue})`,
        };
      case 'top':
        return {
          top: 0,
          left: 0,
          transform: `translateY(${translateValue})`,
        };
      case 'bottom':
        return {
          bottom: 0,
          left: 0,
          transform: `translateY(${translateValue})`,
        };
      default:
        return {};
    }
  };

  // Get translate value for animation
  const getTranslateValue = (): string => {
    switch (position) {
      case 'left':
        return '-100%';
      case 'right':
        return '100%';
      case 'top':
        return '-100%';
      case 'bottom':
        return '100%';
      default:
        return '0';
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
        };
      case 'glass':
        return {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          borderColor: 'rgba(0, 0, 0, 0.1)',
          textColor: '#374151',
          headerBackground: 'rgba(255, 255, 255, 0.9)',
        };
      default:
        return {
          backgroundColor: '#ffffff',
          borderColor: '#e5e7eb',
          textColor: '#374151',
          headerBackground: '#f9fafb',
        };
    }
  };

  // Get resize handle styles
  const getResizeHandleStyles = () => {
    const isHorizontal = position === 'left' || position === 'right';
    
    if (isHorizontal) {
      return {
        position: 'absolute' as const,
        [position === 'left' ? 'right' : 'left']: '-2px',
        top: 0,
        bottom: 0,
        width: '4px',
        cursor: 'ew-resize',
        backgroundColor: 'transparent',
        zIndex: 10,
      };
    } else {
      return {
        position: 'absolute' as const,
        [position === 'top' ? 'bottom' : 'top']: '-2px',
        left: 0,
        right: 0,
        height: '4px',
        cursor: 'ns-resize',
        backgroundColor: 'transparent',
        zIndex: 10,
      };
    }
  };

  if (!isOpen) return null;

  const sizeStyles = getSizeStyles();
  const positionStyles = getPositionStyles();
  const themeStyles = getThemeStyles();

  return (
    <>
      {/* Overlay */}
      {overlay && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 999,
            opacity: isOpen ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
          onClick={handleOverlayClick}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={className}
        style={{
          position: 'fixed',
          zIndex: 1000,
          backgroundColor: themeStyles.backgroundColor,
          borderColor: themeStyles.borderColor,
          color: themeStyles.textColor,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'transform 0.3s ease',
          ...sizeStyles,
          ...positionStyles,
          ...style,
        }}
      >
        {/* Header */}
        {(title || showCloseButton || headerActions) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${themeStyles.borderColor}`,
            backgroundColor: themeStyles.headerBackground,
            minHeight: '60px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              {title && (
                <h2 style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: '600',
                  color: themeStyles.textColor,
                }}>
                  {title}
                </h2>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {headerActions}
              
              {showCloseButton && (
                <button
                  onClick={onClose}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: themeStyles.textColor,
                    padding: '4px',
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
                  aria-label="Close drawer"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          padding: '20px',
          overflowY: 'auto',
          fontSize: '14px',
          lineHeight: '1.5',
        }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '16px 20px',
            borderTop: `1px solid ${themeStyles.borderColor}`,
            backgroundColor: themeStyles.headerBackground,
          }}>
            {footer}
          </div>
        )}

        {/* Resize Handle */}
        {resizable && (
          <div
            ref={resizeRef}
            style={getResizeHandleStyles()}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          />
        )}
      </div>
    </>
  );
};