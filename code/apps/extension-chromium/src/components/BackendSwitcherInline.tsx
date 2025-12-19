import { useState, useEffect } from 'react';
import { migrateToSQLite, checkSQLiteAvailability, getMigrationStatus, setMigrationStatus } from '../storage/migration';

interface BackendSwitcherInlineProps {
  theme?: 'default' | 'dark' | 'professional';
}

export function BackendSwitcherInline({ theme = 'default' }: BackendSwitcherInlineProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [sqliteEnabled, setSqliteEnabled] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Load config on mount
  useEffect(() => {
    loadConfig();
    checkBackendAvailability();
  }, []);

  const loadConfig = async () => {
    const status = await getMigrationStatus();
    setSqliteEnabled(status.sqliteEnabled);
  };

  const checkBackendAvailability = async () => {
    const available = await checkSQLiteAvailability();
    setBackendAvailable(available);
  };

  const handleToggle = async () => {
    if (isMigrating) {
      return;
    }

    if (!backendAvailable) {
      showNotification('Electron app not running. Please start the desktop application.', 'error');
      return;
    }

    const newValue = !sqliteEnabled;
    
    if (newValue) {
      // Enabling SQLite - need to migrate
      showNotification('Starting migration to encrypted SQLite...', 'info');
      setIsMigrating(true);
      
      try {
        const result = await migrateToSQLite();
        
        if (result.success) {
          // Update config
          await setMigrationStatus(true, true);
          setSqliteEnabled(true);
          showNotification(result.message, 'success');
          
          // Reload the page to use new backend
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          showNotification(result.message, 'error');
        }
      } catch (error: any) {
        showNotification(`Migration failed: ${error?.message || error}`, 'error');
      } finally {
        setIsMigrating(false);
      }
    } else {
      // Disabling SQLite - switch back to Chrome storage
      await setMigrationStatus(false, false);
      setSqliteEnabled(false);
      showNotification('Switched back to Chrome Storage', 'info');
      
      // Reload the page to use Chrome storage
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const bgColor = theme === 'default' ? 'rgba(118,75,162,0.5)' : 'rgba(0,0,0,0.05)';
  const textColor = theme === 'default' ? '#fff' : theme === 'dark' ? '#fff' : '#0f172a';

  return (
    <>
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        background: bgColor
      }}>
        <div 
          style={{
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {/* Log in and Create account buttons - subtle/understate */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: theme === 'professional' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)',
                borderRadius: '4px',
                color: textColor,
                fontSize: '11px',
                fontWeight: '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                opacity: 0.8
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme === 'professional' ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.opacity = '0.8';
              }}
            >
              Log in
            </button>
            <button
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: theme === 'professional' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)',
                borderRadius: '4px',
                color: textColor,
                fontSize: '11px',
                fontWeight: '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                opacity: 0.8
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme === 'professional' ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.opacity = '0.8';
              }}
            >
              Create account
            </button>
          </div>
          {/* Expand/collapse toggle */}
          <div 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{ 
              fontSize: '12px', 
              opacity: 0.5,
              transition: 'transform 0.2s ease',
              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              cursor: 'pointer',
              padding: '4px',
              userSelect: 'none'
            }}
          >
            ▼
          </div>
        </div>

        {!isCollapsed && (
          <div style={{
            padding: '16px 20px 24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            {/* Status Indicator */}
            <div style={{
              padding: '12px',
              background: sqliteEnabled ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 193, 7, 0.1)',
              border: sqliteEnabled ? '1px solid rgba(76, 175, 80, 0.3)' : '1px solid rgba(255, 193, 7, 0.3)',
              borderRadius: '8px',
              fontSize: '12px',
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '16px' }}>{sqliteEnabled ? '🔒' : '💾'}</span>
              <div>
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {sqliteEnabled ? 'Encrypted SQLite' : 'Chrome Storage'}
                </div>
                <div style={{ fontSize: '10px', opacity: 0.8 }}>
                  {sqliteEnabled ? 'All data encrypted at rest (Auto-connected)' : 'Using browser storage (unencrypted)'}
                </div>
              </div>
            </div>

            {/* Backend Toggle */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: textColor }}>
                Use Encrypted SQLite
              </div>
              <label style={{
                position: 'relative',
                display: 'inline-block',
                width: '50px',
                height: '24px',
                cursor: isMigrating ? 'not-allowed' : 'pointer',
                opacity: isMigrating ? 0.6 : 1
              }}>
                <input
                  type="checkbox"
                  checked={sqliteEnabled}
                  onChange={handleToggle}
                  disabled={isMigrating}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: sqliteEnabled ? '#4CAF50' : '#ccc',
                  borderRadius: '24px',
                  transition: '0.3s',
                  cursor: isMigrating ? 'not-allowed' : 'pointer'
                }}>
                  <span style={{
                    position: 'absolute',
                    content: '',
                    height: '18px',
                    width: '18px',
                    left: sqliteEnabled ? '29px' : '3px',
                    bottom: '3px',
                    background: 'white',
                    borderRadius: '50%',
                    transition: '0.3s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}></span>
                </span>
              </label>
            </div>

            {/* Info Text */}
            {!sqliteEnabled && (
              <div style={{
                fontSize: '11px',
                color: textColor,
                opacity: 0.7,
                lineHeight: '1.5',
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '6px'
              }}>
                Enable encrypted SQLite backend for better security and performance. All existing data will be automatically migrated.
              </div>
            )}

            {!backendAvailable && (
              <div style={{
                fontSize: '11px',
                color: '#ff9800',
                padding: '8px 12px',
                background: 'rgba(255, 152, 0, 0.1)',
                border: '1px solid rgba(255, 152, 0, 0.3)',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span>⚠️</span>
                <span>Electron app not detected. Start the desktop app to enable encrypted backend.</span>
              </div>
            )}

            {isMigrating && (
              <div style={{
                fontSize: '12px',
                color: textColor,
                padding: '12px',
                background: 'rgba(33, 150, 243, 0.1)',
                border: '1px solid rgba(33, 150, 243, 0.3)',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span className="spinner" style={{
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTop: '2px solid #2196F3',
                  borderRadius: '50%',
                  width: '14px',
                  height: '14px',
                  animation: 'spin 1s linear infinite'
                }}></span>
                <span>Migrating data to encrypted SQLite...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 16px',
          background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 
                     notification.type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 
                     'rgba(33, 150, 243, 0.9)',
          border: `1px solid ${notification.type === 'success' ? '#22c55e' : 
                                notification.type === 'error' ? '#ef4444' : 
                                '#2196F3'}`,
          borderRadius: '6px',
          color: '#fff',
          fontSize: '12px',
          fontWeight: '500',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          maxWidth: '300px'
        }}>
          {notification.message}
        </div>
      )}

      {/* Add spinner animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}

