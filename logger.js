const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

// Default log level
let CURRENT_LOG_LEVEL = LOG_LEVELS.INFO;

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Write log to file and console
function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logFile = path.join(logsDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${typeof message === 'object' ? JSON.stringify(message) : message}\n`;

    // Log to file
    try {
        fs.appendFileSync(logFile, logMessage);
    } catch (err) {
        console.error(`Failed to write to log file: ${err.message}`);
    }

    // Only log to console if level is high enough
    const messageLevel = LOG_LEVELS[type.toUpperCase()] || 0;
    if (messageLevel >= CURRENT_LOG_LEVEL) {
        if (type.toUpperCase() === 'ERROR') {
            console.error(`[${type.toUpperCase()}] ${message}`);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Export logger functions
const logger = {
    debug: message => logToFile(message, 'debug'),
    info: message => logToFile(message, 'info'),
    warn: message => logToFile(message, 'warn'),
    error: message => logToFile(message, 'error'),
    setLogLevel: (level) => {
        if (LOG_LEVELS[level.toUpperCase()] !== undefined) {
            CURRENT_LOG_LEVEL = LOG_LEVELS[level.toUpperCase()];
        }
    }
};

module.exports = logger;
