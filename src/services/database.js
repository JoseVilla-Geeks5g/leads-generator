import { Pool } from 'pg';
import dotenv from 'dotenv';
import logger from './logger';

// Check if we're running on server
const isServer = typeof window === 'undefined';

// Load environment variables
if (isServer) {
    dotenv.config();
}

// Track initialization state
let isInitialized = false;
let isInitializing = false;
let initPromise = null;

class Database {
    constructor() {
        this.pool = null;
        this.connectionCount = 0;
        this.lastActivity = Date.now();
        this.maxConnectionIdleTime = 20 * 60 * 1000; // 20 minutes
        this.connectionMonitorInterval = null;
    }

    getPool() {
        if (!this.pool && isServer) {
            // Configure database connection with proper SSL settings for Render
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                // Always use SSL for Render databases
                ssl: {
                    rejectUnauthorized: false
                },
                user: process.env.PGUSER || 'leads_db_rc6a_user',
                host: process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.oregon-postgres.render.com',
                database: process.env.PGDATABASE || 'leads_db_rc6a',
                password: process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT',
                port: process.env.PGPORT || 5432,
                max: 10, // Maximum number of clients
                idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
                connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
                maxUses: 7500, // Close and replace connections after 7500 queries
            });

            // Set up event handlers
            this.pool.on('error', (err, client) => {
                logger.error(`Unexpected error on idle client: ${err.message}`);
            });

            // Set up connection monitor
            this.startConnectionMonitor();

            logger.info('Database pool created with SSL enabled');
        }
        return this.pool;
    }

    startConnectionMonitor() {
        if (isServer && !this.connectionMonitorInterval) {
            this.connectionMonitorInterval = setInterval(() => {
                const now = Date.now();
                if (now - this.lastActivity > this.maxConnectionIdleTime) {
                    logger.info('Closing idle database connections');
                    this.closeConnections();
                }
            }, 5 * 60 * 1000); // Check every 5 minutes
        }
    }

    closeConnections() {
        if (this.pool) {
            this.pool.end();
            this.pool = null;
        }
    }

    async init() {
        // Don't initialize on the client side
        if (!isServer) {
            return;
        }

        if (isInitialized) {
            return;
        }

        if (isInitializing) {
            // If initialization is already in progress, wait for it to complete
            return initPromise;
        }

        isInitializing = true;
        initPromise = this._init();

        try {
            await initPromise;
            isInitialized = true;

            // Force check and add missing columns
            await this.ensureRequiredColumns();
        } finally {
            isInitializing = false;
        }

        return initPromise;
    }

    /**
     * Ensure all required columns exist in the database
     */
    async ensureRequiredColumns() {
        try {
            // Check for params column in scraping_tasks
            const paramsExists = await this.getOne(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='scraping_tasks' AND column_name='params'
                ) as exists
            `);

            if (!paramsExists || !paramsExists.exists) {
                logger.info('Adding params column to scraping_tasks table');
                await this.query(`ALTER TABLE scraping_tasks ADD COLUMN params TEXT`);
            }

            // Check for limit column in scraping_tasks (using double quotes to handle reserved keyword)
            const limitExists = await this.getOne(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='scraping_tasks' AND column_name='limit'
                ) as exists
            `);

            if (!limitExists || !limitExists.exists) {
                logger.info('Adding "limit" column to scraping_tasks table');
                await this.query(`ALTER TABLE scraping_tasks ADD COLUMN "limit" INTEGER DEFAULT 100`);
            }
        } catch (error) {
            logger.error(`Error ensuring required columns: ${error.message}`);
        }
    }

    async _init() {
        try {
            logger.info('Initializing database...');
            await this.testConnection();
            await this.initTables();
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error(`Failed to initialize database: ${error.message}`);
            throw error;
        }
    }

    async testConnection() {
        const pool = this.getPool();
        try {
            await pool.query('SELECT NOW()');
            logger.info('Database connection successful');
            return true;
        } catch (error) {
            logger.error(`Database connection error: ${error.message}`);
            throw error; // Re-throw to be handled by caller
        }
    }

    async initTables() {
        try {
            const pool = this.getPool();
            // Initialize tables here if needed
            // Example:
            await pool.query(`
                CREATE TABLE IF NOT EXISTS categories (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    description TEXT,
                    usage_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Initialize other tables as needed

        } catch (error) {
            logger.error(`Error initializing tables: ${error.message}`);
            throw error;
        }
    }

    async query(text, params, retries = 3) {
        this.lastActivity = Date.now();
        const pool = this.getPool();

        try {
            const result = await pool.query(text, params);
            return result;
        } catch (error) {
            // If we get a connection error and have retries left, retry
            if (retries > 0 && (
                error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT' ||
                error.message.includes('connect ETIMEDOUT') ||
                error.message.includes('Connection terminated') ||
                error.message.includes('Connection reset by peer')
            )) {
                logger.error(`Database query error (retries left: ${retries}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.query(text, params, retries - 1);
            }

            logger.error(`Database query error: ${error.message}`);
            throw error;
        }
    }

    async getOne(text, params) {
        const result = await this.query(text, params);
        return result.rows[0];
    }

    async getMany(text, params) {
        const result = await this.query(text, params);
        return result.rows;
    }

    async getCount(table, whereClause = '', params = []) {
        try {
            // Build a proper count query
            const countQuery = `
                SELECT COUNT(*) as count 
                FROM ${table}
                ${whereClause ? `WHERE ${whereClause}` : ''}
            `;

            const result = await this.query(countQuery, params);
            return parseInt(result.rows[0]?.count || '0');
        } catch (error) {
            logger.error(`Error getting count: ${error.message}`);
            return 0;
        }
    }
}

// Create a singleton instance
const db = new Database();

// Export the service
export default db;