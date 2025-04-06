/**
 * Simple logging service with levels and optional file output
 */

import fs from 'fs';
import path from 'path';

// Check if we're running on server
const isServer = typeof window === 'undefined';

class Logger {
    constructor() {
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };

        // Default level based on environment
        this.level = isServer && process.env.LOG_LEVEL
            ? this.levels[process.env.LOG_LEVEL.toLowerCase()] || this.levels.info
            : this.levels.info;

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

    setLogLevel(level) {
        if (this.levels[level.toLowerCase()] !== undefined) {
            this.level = this.levels[level.toLowerCase()];
        }
    }

    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
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

    debug(message) {
        if (this.level <= this.levels.debug) {
            const formattedMessage = this.formatMessage('DEBUG', message);
            console.log(formattedMessage);
            this.writeToFile(formattedMessage);
        }
    }

    info(message) {
        if (this.level <= this.levels.info) {
            const formattedMessage = this.formatMessage('INFO', message);
            console.log(formattedMessage);
            this.writeToFile(formattedMessage);
        }
    }

    warn(message) {
        if (this.level <= this.levels.warn) {
            const formattedMessage = this.formatMessage('WARN', message);
            console.warn(formattedMessage);
            this.writeToFile(formattedMessage);
        }
    }

    error(message) {
        if (this.level <= this.levels.error) {
            const formattedMessage = this.formatMessage('ERROR', message);
            console.error(formattedMessage);
            this.writeToFile(formattedMessage, true);
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

// Create a singleton instance
const logger = new Logger();

// Export the logger service
export default logger;
