import pino from 'pino';
import type { LogLevel } from '../types/index.js';

/**
 * Logger singleton. Configured once at startup via `initLogger()`.
 * Uses pino for structured JSON logging with human-readable default.
 */
let loggerInstance: pino.Logger | null = null;

/**
 * Initialize the logger with the specified options.
 * Should be called once at CLI startup.
 */
export function initLogger(options: {
    level?: LogLevel;
    jsonLogs?: boolean;
}): pino.Logger {
    const { level = 'info', jsonLogs = false } = options;

    if (jsonLogs) {
        loggerInstance = pino({ level });
    } else {
        loggerInstance = pino({
            level,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss',
                    ignore: 'pid,hostname',
                },
            },
        });
    }

    return loggerInstance;
}

/**
 * Get the logger instance.
 * If not initialized, creates a default info-level logger.
 */
export function getLogger(): pino.Logger {
    if (!loggerInstance) {
        loggerInstance = initLogger({ level: 'info' });
    }
    return loggerInstance;
}
