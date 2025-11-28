import React, { useState, useEffect } from 'react';

export interface NotificationItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
  persistent?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface NotificationProps {
  notifications: NotificationItem[];
  onRemove: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  maxVisible?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Notification: React.FC<NotificationProps> = ({
  notifications,
  onRemove,
  position = 'top-right',
  maxVisible = 5,
  className,
  style,
}) => {
  const [visibleNotifications, setVisibleNotifications] = useState<NotificationItem[]>([]);

  // Update visible notifications
  useEffect(() => {
    const visible = notifications.slice(-maxVisible);
    setVisibleNotifications(visible);
  }, [notifications, maxVisible]);

  // Auto-remove notifications after duration
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    visibleNotifications.forEach(notification => {
      if (!notification.persistent && notification.duration !== 0) {
        const duration = notification.duration || 5000;
        const timer = setTimeout(() => {
          onRemove(notification.id);
        }, duration);
        timers.push(timer);
      }
    });

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [visibleNotifications, onRemove]);

  // Get position styles
  const getPositionStyles = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: 'fixed',
      zIndex: 1000,
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      pointerEvents: 'none',
    };

    switch (position) {
      case 'top-right':
        return {
          ...baseStyle,
          top: 0,
          right: 0,
        };
      case 'top-left':
        return {
          ...baseStyle,
          top: 0,
          left: 0,
        };
      case 'bottom-right':
        return {
          ...baseStyle,
          bottom: 0,
          right: 0,
          flexDirection: 'column-reverse',
        };
      case 'bottom-left':
        return {
          ...baseStyle,
          bottom: 0,
          left: 0,
          flexDirection: 'column-reverse',
        };
      case 'top-center':
        return {
          ...baseStyle,
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
        };
      case 'bottom-center':
        return {
          ...baseStyle,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          flexDirection: 'column-reverse',
        };
      default:
        return baseStyle;
    }
  };

  // Get notification type styles
  const getTypeStyles = (type: NotificationItem['type']) => {
    switch (type) {
      case 'success':
        return {
          backgroundColor: '#f0fdf4',
          borderColor: '#bbf7d0',
          iconColor: '#16a34a',
          textColor: '#166534',
          icon: '✓',
        };
      case 'error':
        return {
          backgroundColor: '#fef2f2',
          borderColor: '#fecaca',
          iconColor: '#ef4444',
          textColor: '#991b1b',
          icon: '✕',
        };
      case 'warning':
        return {
          backgroundColor: '#fffbeb',
          borderColor: '#fde68a',
          iconColor: '#f59e0b',
          textColor: '#92400e',
          icon: '⚠',
        };
      case 'info':
        return {
          backgroundColor: '#eff6ff',
          borderColor: '#bfdbfe',
          iconColor: '#3b82f6',
          textColor: '#1e40af',
          icon: 'ℹ',
        };
      default:
        return {
          backgroundColor: '#f9fafb',
          borderColor: '#e5e7eb',
          iconColor: '#6b7280',
          textColor: '#374151',
          icon: '•',
        };
    }
  };

  if (visibleNotifications.length === 0) return null;

  return (
    <div className={className} style={{ ...getPositionStyles(), ...style }}>
      {visibleNotifications.map((notification) => {
        const typeStyles = getTypeStyles(notification.type);

        return (
          <NotificationItem
            key={notification.id}
            notification={notification}
            typeStyles={typeStyles}
            onRemove={onRemove}
          />
        );
      })}
    </div>
  );
};

// Individual notification item component
interface NotificationItemProps {
  notification: NotificationItem;
  typeStyles: {
    backgroundColor: string;
    borderColor: string;
    iconColor: string;
    textColor: string;
    icon: string;
  };
  onRemove: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  typeStyles,
  onRemove,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Animate in
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Handle remove with animation
  const handleRemove = () => {
    setIsRemoving(true);
    setTimeout(() => {
      onRemove(notification.id);
    }, 300);
  };

  return (
    <div
      style={{
        backgroundColor: typeStyles.backgroundColor,
        border: `1px solid ${typeStyles.borderColor}`,
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        maxWidth: '400px',
        minWidth: '300px',
        pointerEvents: 'auto',
        transform: isRemoving
          ? 'translateX(100%) scale(0.9)'
          : isVisible
          ? 'translateX(0) scale(1)'
          : 'translateX(100%) scale(0.9)',
        opacity: isRemoving ? 0 : isVisible ? 1 : 0,
        transition: 'all 0.3s ease',
        position: 'relative',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
      }}>
        {/* Icon */}
        <div style={{
          color: typeStyles.iconColor,
          fontSize: '18px',
          fontWeight: 'bold',
          marginTop: '1px',
          flexShrink: 0,
        }}>
          {typeStyles.icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {notification.title && (
            <div style={{
              color: typeStyles.textColor,
              fontSize: '14px',
              fontWeight: '600',
              marginBottom: '4px',
              lineHeight: '1.4',
            }}>
              {notification.title}
            </div>
          )}

          <div style={{
            color: typeStyles.textColor,
            fontSize: '14px',
            lineHeight: '1.5',
            opacity: 0.9,
          }}>
            {notification.message}
          </div>

          {notification.action && (
            <button
              onClick={notification.action.onClick}
              style={{
                marginTop: '8px',
                padding: '4px 8px',
                backgroundColor: 'transparent',
                border: `1px solid ${typeStyles.iconColor}`,
                borderRadius: '4px',
                color: typeStyles.iconColor,
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = typeStyles.iconColor;
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = typeStyles.iconColor;
              }}
            >
              {notification.action.label}
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={handleRemove}
          style={{
            background: 'none',
            border: 'none',
            color: typeStyles.textColor,
            fontSize: '18px',
            cursor: 'pointer',
            opacity: 0.5,
            padding: '2px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.5';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          aria-label="Close notification"
        >
          ×
        </button>
      </div>

      {/* Progress bar for timed notifications */}
      {!notification.persistent && notification.duration !== 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '2px',
            backgroundColor: typeStyles.iconColor,
            opacity: 0.3,
            animation: `notificationProgress ${notification.duration || 5000}ms linear`,
            transformOrigin: 'left',
          }}
        />
      )}

      <style>{`
        @keyframes notificationProgress {
          from {
            transform: scaleX(1);
          }
          to {
            transform: scaleX(0);
          }
        }
      `}</style>
    </div>
  );
};