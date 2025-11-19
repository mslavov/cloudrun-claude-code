/**
 * Logger Utility with Per-Module Log Levels
 *
 * Simple console-based logger with hierarchical log level support.
 *
 * Log Levels (hierarchical):
 * - debug: Shows all logs (debug, info, warn, error)
 * - info: Shows info, warn, error (NOT debug)
 * - warn: Shows warn, error
 * - error: Shows only errors
 *
 * Environment Variables:
 * - LOG_LEVEL: Global default log level (default: 'info')
 * - LOG_LEVEL_[MODULE]: Per-module log level override (e.g., LOG_LEVEL_PROXY=debug)
 *
 * Usage:
 * ```typescript
 * import { createModuleLogger } from './logger.js';
 * const logger = createModuleLogger('proxy');
 * logger.debug('detailed message'); // Respects LOG_LEVEL_PROXY
 * logger.info('info message');      // Output: [proxy] info message
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the configured log level from environment
 */
const getLogLevel = (moduleName?: string): LogLevel => {
  // Check for module-specific log level first
  if (moduleName) {
    const moduleEnvVar = `LOG_LEVEL_${moduleName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const moduleLevel = process.env[moduleEnvVar]?.toLowerCase() as LogLevel;
    if (moduleLevel && LOG_LEVEL_VALUES[moduleLevel] !== undefined) {
      return moduleLevel;
    }
  }

  // Fall back to global LOG_LEVEL
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVEL_VALUES[envLevel] !== undefined) {
    return envLevel;
  }

  return 'info';
};

/**
 * Format arguments into a single string
 */
const formatArgs = (args: any[]): string => {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
};

/**
 * Create a module-specific logger
 */
export const createModuleLogger = (moduleName: string): Logger => {
  const moduleLevel = getLogLevel(moduleName);
  const levelValue = LOG_LEVEL_VALUES[moduleLevel];
  const prefix = `[${moduleName}]`;

  return {
    debug(...args: any[]): void {
      if (levelValue <= LOG_LEVEL_VALUES.debug) {
        console.log(prefix, formatArgs(args));
      }
    },

    info(...args: any[]): void {
      if (levelValue <= LOG_LEVEL_VALUES.info) {
        console.log(prefix, formatArgs(args));
      }
    },

    warn(...args: any[]): void {
      if (levelValue <= LOG_LEVEL_VALUES.warn) {
        console.warn(prefix, formatArgs(args));
      }
    },

    error(...args: any[]): void {
      if (levelValue <= LOG_LEVEL_VALUES.error) {
        console.error(prefix, formatArgs(args));
      }
    }
  };
};

/**
 * Default logger for backward compatibility
 */
export const logger = createModuleLogger('default');
