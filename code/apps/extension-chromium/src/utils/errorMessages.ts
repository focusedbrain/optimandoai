/**
 * User-Friendly Error Messages
 * 
 * Maps error codes and technical errors to clear, actionable messages for users.
 */

// Error code to user-friendly message mapping
const ERROR_MESSAGES: Record<string, { title: string; message: string; action?: string }> = {
  // Connection errors
  'ELECTRON_NOT_RUNNING': {
    title: 'Desktop App Not Running',
    message: 'The OpenGiraffe desktop app is not running.',
    action: 'Please start the desktop app and try again.'
  },
  'ELECTRON_STOPPED': {
    title: 'Desktop App Stopped',
    message: 'The desktop app stopped unexpectedly.',
    action: 'Please restart OpenGiraffe and try again.'
  },
  'NETWORK_ERROR': {
    title: 'Connection Error',
    message: 'Cannot connect to the desktop app.',
    action: 'Make sure OpenGiraffe is running and try again.'
  },
  'TIMEOUT': {
    title: 'Request Timed Out',
    message: 'The operation took too long to complete.',
    action: 'Please try again. If the problem persists, restart the app.'
  },
  
  // OAuth errors
  'OAUTH_IN_PROGRESS': {
    title: 'Authentication In Progress',
    message: 'Another login is already in progress.',
    action: 'Please complete or cancel the current login first.'
  },
  'OAUTH_TIMEOUT': {
    title: 'Login Timed Out',
    message: 'The authentication process took too long.',
    action: 'Please try again and complete the login within 5 minutes.'
  },
  'OAUTH_CANCELLED': {
    title: 'Login Cancelled',
    message: 'The authentication was cancelled.',
    action: 'Click "Connect" to try again.'
  },
  'OAUTH_FAILED': {
    title: 'Login Failed',
    message: 'Could not complete the authentication.',
    action: 'Check your credentials and try again.'
  },
  
  // HTTP errors
  'HTTP_400': {
    title: 'Invalid Request',
    message: 'The request was invalid.',
    action: 'Please check your input and try again.'
  },
  'HTTP_401': {
    title: 'Not Authorized',
    message: 'Your session has expired.',
    action: 'Please reconnect your account.'
  },
  'HTTP_403': {
    title: 'Access Denied',
    message: 'You don\'t have permission for this action.',
    action: 'Check your account permissions.'
  },
  'HTTP_404': {
    title: 'Not Found',
    message: 'The requested resource was not found.',
    action: 'The item may have been deleted.'
  },
  'HTTP_500': {
    title: 'Server Error',
    message: 'Something went wrong on the server.',
    action: 'Please try again later.'
  },
  
  // Email-specific errors
  'EMAIL_CREDENTIALS_MISSING': {
    title: 'Credentials Required',
    message: 'OAuth credentials are not configured.',
    action: 'Please enter your API credentials to connect.'
  },
  'EMAIL_ACCOUNT_EXISTS': {
    title: 'Account Already Connected',
    message: 'This email account is already connected.',
    action: 'Remove the existing account first if you want to reconnect.'
  },
  
  // Generic errors
  'UNKNOWN': {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred.',
    action: 'Please try again. If the problem persists, restart OpenGiraffe.'
  },
  'INVALID_RESPONSE': {
    title: 'Invalid Response',
    message: 'Received an unexpected response from the server.',
    action: 'Please try again.'
  },
  'REQUEST_ERROR': {
    title: 'Request Failed',
    message: 'Could not complete the request.',
    action: 'Please try again.'
  }
};

// Common error message patterns to detect and map
const ERROR_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /OAuth.*credentials.*not configured/i, code: 'EMAIL_CREDENTIALS_MISSING' },
  { pattern: /OAuth.*timed out/i, code: 'OAUTH_TIMEOUT' },
  { pattern: /OAuth.*cancelled/i, code: 'OAUTH_CANCELLED' },
  { pattern: /OAuth.*in progress/i, code: 'OAUTH_IN_PROGRESS' },
  { pattern: /Electron.*not running/i, code: 'ELECTRON_NOT_RUNNING' },
  { pattern: /Cannot connect/i, code: 'NETWORK_ERROR' },
  { pattern: /Failed to fetch/i, code: 'NETWORK_ERROR' },
  { pattern: /NetworkError/i, code: 'NETWORK_ERROR' },
  { pattern: /timeout/i, code: 'TIMEOUT' },
  { pattern: /already connected/i, code: 'EMAIL_ACCOUNT_EXISTS' },
];

/**
 * Get user-friendly error message from error code or raw error message
 */
export function getErrorMessage(
  errorOrCode: string | undefined,
  errorCode?: string
): { title: string; message: string; action?: string } {
  // If we have an error code, use it directly
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    return ERROR_MESSAGES[errorCode];
  }
  
  // If we have a raw error message, try to match patterns
  if (errorOrCode) {
    // Check if it's an error code
    if (ERROR_MESSAGES[errorOrCode]) {
      return ERROR_MESSAGES[errorOrCode];
    }
    
    // Try to match patterns
    for (const { pattern, code } of ERROR_PATTERNS) {
      if (pattern.test(errorOrCode)) {
        return ERROR_MESSAGES[code];
      }
    }
    
    // Return the raw message with a generic wrapper
    return {
      title: 'Error',
      message: errorOrCode,
      action: 'Please try again.'
    };
  }
  
  // Fallback
  return ERROR_MESSAGES['UNKNOWN'];
}

/**
 * Format error for display (single line)
 */
export function formatError(errorOrCode: string | undefined, errorCode?: string): string {
  const { title, message, action } = getErrorMessage(errorOrCode, errorCode);
  
  if (action) {
    return `${title}: ${message} ${action}`;
  }
  return `${title}: ${message}`;
}

/**
 * Format error for notification (shorter)
 */
export function formatErrorForNotification(errorOrCode: string | undefined, errorCode?: string): string {
  const { message, action } = getErrorMessage(errorOrCode, errorCode);
  
  if (action) {
    return `${message} ${action}`;
  }
  return message;
}

/**
 * Check if error is a connection error (might resolve by waiting)
 */
export function isConnectionError(errorCode?: string): boolean {
  return ['ELECTRON_NOT_RUNNING', 'ELECTRON_STOPPED', 'NETWORK_ERROR', 'TIMEOUT'].includes(errorCode || '');
}

/**
 * Check if error requires user action (like re-entering credentials)
 */
export function requiresUserAction(errorCode?: string): boolean {
  return ['EMAIL_CREDENTIALS_MISSING', 'OAUTH_CANCELLED', 'HTTP_401'].includes(errorCode || '');
}





