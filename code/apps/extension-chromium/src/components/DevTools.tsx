import { useState, useEffect } from 'react';

interface DevToolsProps {
  theme?: 'default' | 'dark' | 'professional';
}

export function DevTools({ theme = 'default' }: DevToolsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [windowStatus, setWindowStatus] = useState<{ visible: boolean; exists: boolean } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Theme colors
  const bgColor = theme === 'professional' ? 'rgba(15,23,42,0.08)' : 
                  theme === 'dark' ? 'rgba(255,255,255,0.08)' : 
                  'rgba(118,75,162,0.35)';
  const borderColor = theme === 'professional' ? 'rgba(15,23,42,0.15)' : 
                      theme === 'dark' ? 'rgba(255,255,255,0.15)' : 
                      'rgba(255,255,255,0.3)';
  const textColor = theme === 'default' ? '#fff' : theme === 'dark' ? '#fff' : '#0f172a';

  // Check connection and window status
  const checkStatus = async () => {
    try {
      const response = await fetch('http://127.0.0.1:51248/api/window/status', {
        method: 'GET',
      });
      
      if (response.ok) {
        const result = await response.json();
        setWindowStatus({ visible: result.visible, exists: result.exists });
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('disconnected');
        setWindowStatus(null);
      }
    } catch (error) {
      setConnectionStatus('disconnected');
      setWindowStatus(null);
    }
  };

  // Check status on mount and periodically
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleShowWindow = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://127.0.0.1:51248/api/window/show', {
        method: 'POST',
      });
      const result = await response.json();
      
      if (result.ok) {
        showNotification('Window shown successfully', 'success');
        await checkStatus();
      } else {
        showNotification(result.message || 'Failed to show window', 'error');
      }
    } catch (error: any) {
      showNotification('Failed to connect to Electron app', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleHideWindow = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://127.0.0.1:51248/api/window/hide', {
        method: 'POST',
      });
      const result = await response.json();
      
      if (result.ok) {
        showNotification('Window hidden successfully', 'success');
        await checkStatus();
      } else {
        showNotification(result.message || 'Failed to hide window', 'error');
      }
    } catch (error: any) {
      showNotification('Failed to connect to Electron app', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestartService = () => {
    showNotification('Restart Electron app manually from terminal', 'info');
  };

  return (
    <>
      <div style={{
        background: bgColor,
        padding: '16px',
        borderRadius: '10px',
        marginBottom: '28px',
        border: `1px solid ${borderColor}`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isExpanded ? '14px' : '0',
          cursor: 'pointer',
        }} onClick={() => setIsExpanded(!isExpanded)}>
          <h3 style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            opacity: 0.95,
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            🛠️ Dev Tools
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Connection status indicator */}
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: connectionStatus === 'connected' ? 'rgba(76, 175, 80, 0.3)' : 
                         connectionStatus === 'disconnected' ? 'rgba(244, 67, 54, 0.3)' : 
                         'rgba(255, 152, 0, 0.3)',
              color: textColor,
              opacity: 0.9,
            }}>
              {connectionStatus === 'connected' ? '● Connected' : 
               connectionStatus === 'disconnected' ? '● Disconnected' : 
               '● Checking'}
            </span>
            <span style={{
              fontSize: '12px',
              color: textColor,
              opacity: 0.7,
              transition: 'transform 0.2s',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}>
              ▼
            </span>
          </div>
        </div>

        {/* Content */}
        {isExpanded && (
          <>
            {/* Window Status */}
            <div style={{ 
              marginBottom: '12px',
              padding: '10px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '6px',
            }}>
              <div style={{
                fontSize: '11px',
                color: textColor,
                opacity: 0.8,
                marginBottom: '6px',
              }}>
                Window Status
              </div>
              <div style={{
                fontSize: '13px',
                color: textColor,
                fontWeight: '600',
              }}>
                {windowStatus ? (
                  <>
                    {windowStatus.visible ? '👁️ Visible' : '👻 Hidden'}
                    {!windowStatus.exists && ' (Not Created)'}
                  </>
                ) : (
                  '❓ Unknown'
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: '8px',
              marginBottom: '8px',
            }}>
              <button
                onClick={handleShowWindow}
                disabled={isLoading || connectionStatus === 'disconnected' || windowStatus?.visible}
                style={{
                  padding: '10px',
                  background: windowStatus?.visible ? 'rgba(255,255,255,0.05)' : 'rgba(76, 175, 80, 0.3)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: (isLoading || connectionStatus === 'disconnected' || windowStatus?.visible) ? 'not-allowed' : 'pointer',
                  opacity: (isLoading || connectionStatus === 'disconnected' || windowStatus?.visible) ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                👁️ Show
              </button>
              <button
                onClick={handleHideWindow}
                disabled={isLoading || connectionStatus === 'disconnected' || !windowStatus?.visible}
                style={{
                  padding: '10px',
                  background: !windowStatus?.visible ? 'rgba(255,255,255,0.05)' : 'rgba(255, 152, 0, 0.3)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: (isLoading || connectionStatus === 'disconnected' || !windowStatus?.visible) ? 'not-allowed' : 'pointer',
                  opacity: (isLoading || connectionStatus === 'disconnected' || !windowStatus?.visible) ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                👻 Hide
              </button>
            </div>

            {/* Restart Button */}
            <button
              onClick={handleRestartService}
              style={{
                width: '100%',
                padding: '10px',
                background: 'rgba(33, 150, 243, 0.3)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                color: textColor,
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              🔄 Restart Service
            </button>

            {/* Connection Info */}
            <div style={{
              marginTop: '12px',
              padding: '8px',
              background: 'rgba(0,0,0,0.15)',
              borderRadius: '6px',
              fontSize: '10px',
              color: textColor,
              opacity: 0.7,
            }}>
              Electron API: http://127.0.0.1:51248
            </div>
          </>
        )}
      </div>

      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          left: '20px',
          background: notification.type === 'success' ? 'rgba(76, 175, 80, 0.95)' : 
                      notification.type === 'error' ? 'rgba(244, 67, 54, 0.95)' : 
                      'rgba(33, 150, 243, 0.95)',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: '600',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          animation: 'slideInDown 0.3s ease',
        }}>
          {notification.message}
        </div>
      )}
    </>
  );
}





