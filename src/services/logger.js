/**
 * Simple logging service with levels and optional file output
 */

import fs from 'fs';
import path from 'path';

// Check if we're running on server
const isServer = typeof window === 'undefined';

/**
 * Centralized logging service with different log levels and formatting
 */
class Logger {
    constructor() {
        this.logLevels = {
            'debug': 0,
            'info': 1,
            'warn': 2,
            'error': 3,
        };

        // Set default level from environment or default to info
        this.currentLevel = this.logLevels[process.env.LOG_LEVEL?.toLowerCase() || 'info'];

        // Error count tracking for diagnostics
        this.errorCounts = {
            total: 0,
            database: 0,
            connection: 0,
            schema: 0,
            other: 0
        };

        // Keep track of the last few errors for diagnostics
        this.recentErrors = [];
        this.maxRecentErrors = 10;

        // Setup log directory on server
        if (isServer) {
            try {
                this.logDir = path.resolve(process.cwd(), 'logs');
                if (!fs.existsSync(this.logDir)) {
                    fs.mkdirSync(this.logDir, { recursive: true });
                }

                // Create log streams
                this.errorStream = fs.createWriteStream(
                    path.join(this.logDir, 'error.log'),
                    { flags: 'a' }
                );

                this.combinedStream = fs.createWriteStream(
                    path.join(this.logDir, 'combined.log'),
                    { flags: 'a' }
                );
            } catch (error) {
                console.error('Failed to initialize logger:', error);
            }
        }
    }

    /**
     * Format a log message with timestamp and level
     * @param {string} level - Log level
     * @param {string} message - Message to log
     * @returns {string} - Formatted message
     */
    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }

    /**
     * Log a debug message
     * @param {string} message - Message to log
     */
    debug(message) {
        if (this.currentLevel <= this.logLevels.debug) {
            const formattedMessage = this.formatMessage('debug', message);
            console.debug(formattedMessage);
            this.writeToFile(formattedMessage);
        }
    }

    /**
     * Log an info message
     * @param {string} message - Message to log
     */
    info(message) {
        if (this.currentLevel <= this.logLevels.info) {
            const formattedMessage = this.formatMessage('info', message);
            console.info(formattedMessage);
            this.writeToFile(formattedMessage);
        }
    }

    /**
     * Log a warning message
     * @param {string} message - Message to log
     */
    warn(message) {
        if (this.currentLevel <= this.logLevels.warn) {
            const formattedMessage = this.formatMessage('warn', message);
            console.warn(formattedMessage);
            this.writeToFile(formattedMessage);
        }
    }

    /**
     * Log an error message
     * @param {string} message - Error message
     * @param {Error} [error] - Optional error object
     */
    error(message, error = null) {
        if (this.currentLevel <= this.logLevels.error) {
            const formattedMessage = this.formatMessage('error', message);
            console.error(formattedMessage);
            this.writeToFile(formattedMessage, true);

            if (error && error.stack) {
                console.error(error.stack);
            }
        }

        // Track error count for diagnostics
        this.errorCounts.total++;

        // Categorize errors
        if (message.includes('database') || message.includes('Database') ||
            message.includes('query') || message.includes('column') ||
            message.includes('table')) {
            this.errorCounts.database++;

            if (message.includes('connect') || message.includes('timeout')) {
                this.errorCounts.connection++;
            }

            if (message.includes('column') || message.includes('params') ||
                message.includes('does not exist')) {
                this.errorCounts.schema++;
            }
        } else {
            this.errorCounts.other++;
        }

        // Store recent errors
        this.recentErrors.unshift({
            timestamp: new Date().toISOString(),
            message,
            stack: error ? error.stack : null
        });

        // Trim array if needed
        if (this.recentErrors.length > this.maxRecentErrors) {
            this.recentErrors.pop();
        }
    }

    /**
     * Get diagnostics information
     * @returns {Object} - Diagnostics data
     */
    getDiagnostics() {
        return {
            errorCounts: this.errorCounts,
            recentErrors: this.recentErrors,
            logLevel: Object.keys(this.logLevels).find(key =>
                this.logLevels[key] === this.currentLevel
            )
        };
    }

    /**
     * Set the log level
     * @param {string} level - New log level
     */
    setLogLevel(level) {
        if (this.logLevels[level] !== undefined) {
            this.currentLevel = this.logLevels[level];
        }
    }

    writeToFile(message, isError = false) {
        if (!isServer) return;

        try {
            // Write to combined log
            this.combinedStream.write(message + '\n');

            // Also write to error log if it's an error
            if (isError) {
                this.errorStream.write(message + '\n');
            }
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    // Close log streams
    close() {
        if (isServer) {
            try {
                if (this.errorStream) this.errorStream.end();
                if (this.combinedStream) this.combinedStream.end();
            } catch (error) {
                console.error('Error closing log streams:', error);
            }
        }
    }
}

// Create singleton instance
const logger = new Logger();

// Export the service
export default logger;
