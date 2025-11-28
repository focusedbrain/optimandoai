import React, { useEffect, useRef } from 'react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title?: string;
  children?: React.ReactNode;
  size?: 'small' | 'medium' | 'large' | 'xlarge' | 'fullscreen';
  variant?: 'default' | 'danger' | 'warning' | 'success';
  showCloseButton?: boolean;
  showFooter?: boolean;
  confirmText?: string;
  cancelText?: string;
  disableOutsideClick?: boolean;
  disableEscape?: boolean;
  loading?: boolean;
  centered?: boolean;
  scrollable?: boolean;
  closeOnConfirm?: boolean;
  customFooter?: React.ReactNode;
  overlay?: boolean;
  animation?: 'fade' | 'slide' | 'zoom' | 'none';
  className?: string;
  style?: React.CSSProperties;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  size = 'medium',
  variant = 'default',
  showCloseButton = true,
  showFooter = true,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  disableOutsideClick = false,
  disableEscape = false,
  loading = false,
  centered = true,
  scrollable = true,
  closeOnConfirm = true,
  customFooter,
  overlay = true,
  animation = 'fade',
  className,
  style,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

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

  // Handle confirm action
  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    if (closeOnConfirm) {
      onClose();
    }
  };

  // Focus management
  useEffect(() => {
    if (!isOpen) return;

    const focusableElements = modalRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements && focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }
  }, [isOpen]);

  // Get size styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          maxWidth: '400px',
          width: '90vw',
        };
      case 'large':
        return {
          maxWidth: '800px',
          width: '90vw',
        };
      case 'xlarge':
        return {
          maxWidth: '1200px',
          width: '95vw',
        };
      case 'fullscreen':
        return {
          width: '100vw',
          height: '100vh',
          maxWidth: 'none',
          maxHeight: 'none',
          borderRadius: '0',
        };
      default: // medium
        return {
          maxWidth: '600px',
          width: '90vw',
        };
    }
  };

  // Get variant styles
  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          borderTopColor: '#ef4444',
          confirmButtonColor: '#ef4444',
          confirmButtonHover: '#dc2626',
        };
      case 'warning':
        return {
          borderTopColor: '#f59e0b',
          confirmButtonColor: '#f59e0b',
          confirmButtonHover: '#d97706',
        };
      case 'success':
        return {
          borderTopColor: '#10b981',
          confirmButtonColor: '#10b981',
          confirmButtonHover: '#059669',
        };
      default:
        return {
          borderTopColor: '#3b82f6',
          confirmButtonColor: '#3b82f6',
          confirmButtonHover: '#2563eb',
        };
    }
  };

  // Get animation styles
  const getAnimationStyles = () => {
    if (!isOpen) {
      switch (animation) {
        case 'slide':
          return {
            opacity: 0,
            transform: 'translateY(-50px)',
          };
        case 'zoom':
          return {
            opacity: 0,
            transform: 'scale(0.9)',
          };
        default:
          return {
            opacity: 0,
          };
      }
    }

    return {
      opacity: 1,
      transform: 'translateY(0) scale(1)',
    };
  };

  if (!isOpen) return null;

  const sizeStyles = getSizeStyles();
  const variantStyles = getVariantStyles();
  const animationStyles = getAnimationStyles();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: centered ? 'center' : 'flex-start',
        justifyContent: 'center',
        padding: centered ? '20px' : '50px 20px 20px',
        backgroundColor: overlay ? 'rgba(0, 0, 0, 0.5)' : 'transparent',
        backdropFilter: overlay ? 'blur(2px)' : 'none',
        animation: animation !== 'none' ? 'modalOverlayFadeIn 0.2s ease-out' : undefined,
      }}
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        className={className}
        style={{
          backgroundColor: 'white',
          borderRadius: size === 'fullscreen' ? '0' : '8px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: size === 'fullscreen' ? 'none' : '90vh',
          borderTop: `4px solid ${variantStyles.borderTopColor}`,
          transition: animation !== 'none' ? 'all 0.2s ease-out' : undefined,
          ...sizeStyles,
          ...animationStyles,
          ...style,
        }}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid #e5e7eb',
          }}>
            {title && (
              <h2 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#111827',
                flex: 1,
              }}>
                {title}
              </h2>
            )}

            {showCloseButton && (
              <button
                onClick={onClose}
                disabled={loading}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  color: '#6b7280',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: loading ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                    e.currentTarget.style.color = '#374151';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }}
                aria-label="Close modal"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          padding: '24px',
          overflowY: scrollable ? 'auto' : 'visible',
          fontSize: '14px',
          color: '#374151',
          lineHeight: '1.5',
        }}>
          {children}
        </div>

        {/* Footer */}
        {showFooter && (
          <div style={{
            padding: '16px 24px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
          }}>
            {customFooter || (
              <>
                <button
                  onClick={onClose}
                  disabled={loading}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    color: '#374151',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    opacity: loading ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) {
                      e.currentTarget.style.backgroundColor = '#f9fafb';
                      e.currentTarget.style.borderColor = '#9ca3af';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'white';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                >
                  {cancelText}
                </button>

                {onConfirm && (
                  <button
                    onClick={handleConfirm}
                    disabled={loading}
                    style={{
                      padding: '8px 16px',
                      border: 'none',
                      borderRadius: '6px',
                      backgroundColor: variantStyles.confirmButtonColor,
                      color: 'white',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      opacity: loading ? 0.5 : 1,
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.backgroundColor = variantStyles.confirmButtonHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = variantStyles.confirmButtonColor;
                    }}
                  >
                    {loading && (
                      <div style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderTop: '2px solid white',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }} />
                    )}
                    {confirmText}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes modalOverlayFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};