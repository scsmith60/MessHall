// lib/logger.ts
// Centralized logging utility that respects production environment
// In production builds, debug logs are removed by the bundler when __DEV__ is false

/**
 * Logs debug information (only in development)
 * Use for debugging, tracing, and informational messages
 */
export const log = {
  debug: (...args: any[]) => {
    if (__DEV__) {
      console.log(...args);
    }
  },
  info: (...args: any[]) => {
    if (__DEV__) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    // Warnings are useful in production too, but we can still gate them
    if (__DEV__) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    // Errors should always be logged, even in production
    console.error(...args);
  },
};

// Convenience exports
export const logDebug = log.debug;
export const logInfo = log.info;
export const logWarn = log.warn;
export const logError = log.error;

