/**
 * Logger service for application-wide logging
 */

// Check if we're running on server
const isServer = typeof window === 'undefined';

// Only import fs and path if on server
let fs, path;
if (isServer) {
  fs = require('fs');
  path = require('path');
}

/**
 * Simple logger that outputs to console and file
 */
class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logDir = isServer ? path.join(process.cwd(), 'logs') : null;
    this.logFile = isServer ? path.join(this.logDir, 'app.log') : null;
    
    // Create logs directory if on server
    if (isServer && this.logDir) {
      try {
        if (!fs.existsSync(this.logDir)) {
          fs.mkdirSync(this.logDir, { recursive: true });
        }
      } catch (error) {
        console.error('Error creating log directory:', error);
      }
    }
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }
  
  /**
   * Log a message at a specified level
   * @param {string} level - Log level (error, warn, info, debug)
   * @param {string} message - Message to log
   * @param {Object} data - Additional data to log
   */
  log(level, message, data = null) {
    // Check if we should log this level
    if (this.levels[level] > this.levels[this.logLevel]) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    // Always log to console
    switch (level) {
      case 'error':
        console.error(logEntry, data || '');
        break;
      case 'warn':
        console.warn(logEntry, data || '');
        break;
      case 'info':
        console.info(logEntry, data || '');
        break;
      case 'debug':
        console.debug(logEntry, data || '');
        break;
      default:
        console.log(logEntry, data || '');
    }
    
    // If on server, also log to file
    if (isServer && this.logFile) {
      try {
        const logLineWithData = data 
          ? `${logEntry} ${JSON.stringify(data)}\n` 
          : `${logEntry}\n`;
          
        fs.appendFileSync(this.logFile, logLineWithData);
      } catch (error) {
        console.error('Error writing to log file:', error);
      }
    }
  }
  
  // Helper methods for different log levels
  error(message, data = null) {
    this.log('error', message, data);
  }
  
  warn(message, data = null) {
    this.log('warn', message, data);
  }
  
  info(message, data = null) {
    this.log('info', message, data);
  }
  
  debug(message, data = null) {
    this.log('debug', message, data);
  }
}

// Create and export singleton instance
const logger = new Logger();
export default logger;
