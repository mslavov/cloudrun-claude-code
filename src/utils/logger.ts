/**
 * Logger Utility with Log Levels
 *
 * Provides hierarchical logging based on LOG_LEVEL environment variable.
 *
 * Log Levels (hierarchical):
 * - debug: Shows all logs (debug, info, warn, error)
 * - info: Shows info, warn, error (NOT debug)
 *
 * Default: 'info' in production, 'debug' in development
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Determine log level from environment
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;

  // Validate and use LOG_LEVEL if set
  if (envLevel && LOG_LEVEL_PRIORITY[envLevel] !== undefined) {
    return envLevel;
  }

  // Default: debug in development, info in production
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
};

const currentLogLevel = getLogLevel();
const currentPriority = LOG_LEVEL_PRIORITY[currentLogLevel];

/**
 * Check if a log level should be output based on current log level
 */
const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVEL_PRIORITY[level] >= currentPriority;
};

export const logger = {
  /**
   * Debug-level logging (verbose, detailed diagnostics)
   * Only outputs when LOG_LEVEL=debug
   */
  debug(...args: any[]): void {
    if (shouldLog('debug')) {
      console.log(...args);
    }
  },

  /**
   * Info-level logging (informational messages)
   * Outputs when LOG_LEVEL=info or LOG_LEVEL=debug
   */
  info(...args: any[]): void {
    if (shouldLog('info')) {
      console.log(...args);
    }
  },

  /**
   * Warning-level logging (non-critical issues)
   * Outputs when LOG_LEVEL=info, LOG_LEVEL=debug, or LOG_LEVEL=warn
   */
  warn(...args: any[]): void {
    if (shouldLog('warn')) {
      console.warn(...args);
    }
  },

  /**
   * Error-level logging (errors and exceptions)
   * Always outputs (unless LOG_LEVEL explicitly set higher)
   */
  error(...args: any[]): void {
    if (shouldLog('error')) {
      console.error(...args);
    }
  }
};
