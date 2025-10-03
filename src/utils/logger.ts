/**
 * Debug Logger Utility
 *
 * Provides conditional logging based on DEBUG environment variable.
 * - debug/info: Only logged when DEBUG=true or NODE_ENV=development
 * - warn/error: Always logged (production-safe)
 */

const isDebugMode = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

export const logger = {
  /**
   * Debug-level logging (verbose, development only)
   * Only outputs when DEBUG=true or NODE_ENV=development
   */
  debug(...args: any[]): void {
    if (isDebugMode) {
      console.log(...args);
    }
  },

  /**
   * Info-level logging (informational, development only)
   * Only outputs when DEBUG=true or NODE_ENV=development
   */
  info(...args: any[]): void {
    if (isDebugMode) {
      console.log(...args);
    }
  },

  /**
   * Warning-level logging (always logged, production-safe)
   * Used for non-critical issues that should be monitored
   */
  warn(...args: any[]): void {
    console.warn(...args);
  },

  /**
   * Error-level logging (always logged, production-safe)
   * Used for errors and exceptions that need attention
   */
  error(...args: any[]): void {
    console.error(...args);
  }
};
