/**
 * Logger Utility with Per-Module Log Levels (Pino-based)
 *
 * Provides hierarchical logging with support for per-module log level control.
 *
 * Log Levels (hierarchical):
 * - debug: Shows all logs (debug, info, warn, error)
 * - info: Shows info, warn, error (NOT debug)
 * - warn: Shows warn, error
 * - error: Shows only errors
 *
 * Environment Variables:
 * - LOG_LEVEL: Global default log level (default: 'info' in production, 'debug' in development)
 * - LOG_LEVEL_[MODULE]: Per-module log level override (e.g., LOG_LEVEL_CLAUDE_RUNNER=debug)
 *
 * Usage:
 * ```typescript
 * // Default logger (for backward compatibility)
 * import { logger } from './logger.js';
 * logger.info('message');
 *
 * // Module-specific logger
 * import { createModuleLogger } from './logger.js';
 * const logger = createModuleLogger('claude-runner');
 * logger.debug('detailed message'); // Respects LOG_LEVEL_CLAUDE_RUNNER
 * ```
 */

import pino from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface that matches our old console.log-style API
 * Provides backward compatibility while using Pino under the hood
 */
interface Logger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

/**
 * Get the configured log level from environment
 * Supports both global LOG_LEVEL and per-module LOG_LEVEL_[MODULE] overrides
 */
const getLogLevel = (moduleName?: string): LogLevel => {
  // Check for module-specific log level first
  if (moduleName) {
    const moduleEnvVar = `LOG_LEVEL_${moduleName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const moduleLevel = process.env[moduleEnvVar]?.toLowerCase() as LogLevel;
    if (moduleLevel && ['debug', 'info', 'warn', 'error'].includes(moduleLevel)) {
      return moduleLevel;
    }
  }

  // Fall back to global LOG_LEVEL
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
    return envLevel;
  }

  // Default: debug in development, info in production
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
};

/**
 * Configure Pino transport based on environment
 * - Development: Pretty-printed colored output
 * - Production: Structured JSON output for Cloud Logging
 */
const getTransport = () => {
  if (process.env.NODE_ENV === 'development') {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      }
    };
  }
  // Production: JSON output (no transport)
  return undefined;
};

/**
 * Create base Pino logger instance
 */
const basePinoLogger = pino({
  level: getLogLevel(),
  transport: getTransport(),
});

/**
 * Format arguments for Pino logging
 * Converts variadic args into a message string and optional data object
 */
const formatArgs = (args: any[]): { msg: string; data?: any } => {
  if (args.length === 0) {
    return { msg: '' };
  }

  // If first arg is a string, use it as the message
  if (typeof args[0] === 'string') {
    const msg = args[0];

    // If there's only one arg, just return the message
    if (args.length === 1) {
      return { msg };
    }

    // If there are more args, combine them into the message
    // This maintains backward compatibility with console.log-style usage
    const restArgs = args.slice(1);
    const formattedRest = restArgs.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    return { msg: `${msg} ${formattedRest}` };
  }

  // If first arg is not a string, stringify everything
  const formattedArgs = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');

  return { msg: formattedArgs };
};

/**
 * Create a module-specific logger with its own log level
 * Wraps Pino with a backward-compatible console.log-style API
 *
 * @param moduleName - Name of the module (e.g., 'claude-runner', 'proxy', 'task', 'gcs')
 * @returns Logger instance with module-specific log level
 *
 * @example
 * ```typescript
 * const logger = createModuleLogger('claude-runner');
 * logger.debug('Starting Claude with args:', args); // Respects LOG_LEVEL_CLAUDE_RUNNER
 * ```
 */
export const createModuleLogger = (moduleName: string): Logger => {
  const moduleLevel = getLogLevel(moduleName);
  const childLogger = basePinoLogger.child({ module: moduleName });

  // Set module-specific log level
  childLogger.level = moduleLevel;

  // Wrap Pino with backward-compatible API
  return {
    debug(...args: any[]): void {
      const { msg } = formatArgs(args);
      childLogger.debug(msg);
    },

    info(...args: any[]): void {
      const { msg } = formatArgs(args);
      childLogger.info(msg);
    },

    warn(...args: any[]): void {
      const { msg } = formatArgs(args);
      childLogger.warn(msg);
    },

    error(...args: any[]): void {
      const { msg } = formatArgs(args);
      childLogger.error(msg);
    }
  };
};

/**
 * Default logger for backward compatibility
 * Use createModuleLogger() for module-specific log level control
 */
export const logger = createModuleLogger('default');
