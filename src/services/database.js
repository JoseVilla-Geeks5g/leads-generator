import { Pool } from 'pg';
import logger from './logger';
import dotenv from 'dotenv';

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
    }

    getPool() {
        if (!this.pool && isServer) {
            try {
                // Log connection details (without password) for debugging
                logger.debug(`Creating database connection pool to: ${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE} as ${process.env.PGUSER}`);

                // Verify the password is available
                if (!process.env.PGPASSWORD) {
                    logger.error('Database password not found in environment variables');
                    throw new Error('Database password not found');
                }

                // FIXED: Improved pool configuration for large query support
                this.pool = new Pool({
                    user: process.env.PGUSER,
                    host: process.env.PGHOST,
                    database: process.env.PGDATABASE,
                    password: process.env.PGPASSWORD,
                    port: process.env.PGPORT,
                    max: 20, // Maximum number of clients
                    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
                    connectionTimeoutMillis: 30000, // Increased timeout for large queries
                    statement_timeout: 300000, // 5 minutes for long-running queries
                    query_timeout: 300000, // 5 minutes query timeout
                    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
                });

                // Set up error handler for unexpected pool errors
                this.pool.on('error', (err) => {
                    logger.error(`Unexpected error on idle client: ${err.message}`);
                });

                // Log connection stats periodically
                setInterval(() => {
                    if (this.pool) {
                        const idleCount = this.pool.idleCount;
                        const totalCount = this.pool.totalCount;
                        const waitingCount = this.pool.waitingCount;
                        logger.debug(`Database pool: ${idleCount} idle, ${totalCount} total, ${waitingCount} waiting`);
                    }
                }, 60000);

                logger.info('Database pool created successfully');
            } catch (error) {
                logger.error(`Failed to create database pool: ${error.message}`);
                throw error;
            }
        }
        return this.pool;
    }

    async init() {
        // If already initialized or in browser, return immediately
        if (isInitialized || !isServer) {
            return;
        }

        // If already initializing, wait for that process to complete
        if (isInitializing && initPromise) {
            return initPromise;
        }

        // Set initializing flag and create a promise for others to await
        isInitializing = true;
        initPromise = (async () => {
            try {
                logger.info('Initializing database...');

                // Test the connection before proceeding
                const pool = this.getPool();
                const client = await pool.connect();
                try {
                    const res = await client.query('SELECT NOW() as now');
                    logger.debug(`Database connection successful: ${res.rows[0].now}`);
                } finally {
                    client.release();
                }

                await this.initializeTables();
                isInitialized = true;
                logger.info('Database initialized successfully');
            } catch (error) {
                logger.error(`Error initializing database: ${error.message}`);
                // Reset flags to allow retry
                isInitializing = false;
                isInitialized = false;
                throw error;
            } finally {
                isInitializing = false;
            }
        })();

        return initPromise;
    }

    async initializeTables() {
        try {
            const pool = this.getPool();

            logger.info('Checking database constraints...');

            // Create business_listings table if not exists
            await pool.query(`
        CREATE TABLE IF NOT EXISTS business_listings (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT,
          city TEXT,
          state TEXT,
          country TEXT,
          postal_code TEXT,
          latitude NUMERIC,
          longitude NUMERIC,
          phone TEXT,
          email TEXT,
          website TEXT,
          domain TEXT,
          rating NUMERIC,
          search_term TEXT NOT NULL,
          search_date TIMESTAMP,
          task_id TEXT,
          batch_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP,
          CONSTRAINT business_unique_name_search UNIQUE(name, search_term)
        )
      `);

            // Add indexes if they don't exist
            await this.createIndexIfNotExists('idx_business_listings_search_term', 'business_listings', 'search_term');
            await this.createIndexIfNotExists('idx_business_listings_task_id', 'business_listings', 'task_id');
            await this.createIndexIfNotExists('idx_business_listings_state', 'business_listings', 'state');
            await this.createIndexIfNotExists('idx_business_listings_city', 'business_listings', 'city');
            await this.createIndexIfNotExists('idx_business_listings_email_exists', 'business_listings', '(CASE WHEN email IS NOT NULL AND email != \'\' THEN 1 ELSE 0 END)');
            await this.createIndexIfNotExists('idx_business_listings_website_exists', 'business_listings', '(CASE WHEN website IS NOT NULL AND website != \'\' THEN 1 ELSE 0 END)');

            // Create scraping_tasks table if not exists and ensure error_message column exists
            await pool.query(`
        CREATE TABLE IF NOT EXISTS scraping_tasks (
          id TEXT PRIMARY KEY,
          search_term TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          businesses_found INTEGER DEFAULT 0,
          error_message TEXT
        )
      `);

            // Check if error_message column exists, if not add it
            try {
                const columnCheck = await this.getOne(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'scraping_tasks' AND column_name = 'error_message'
        `);

                if (!columnCheck) {
                    logger.info('Adding missing error_message column to scraping_tasks table');
                    await pool.query(`ALTER TABLE scraping_tasks ADD COLUMN IF NOT EXISTS error_message TEXT`);
                }
            } catch (error) {
                logger.error(`Error checking for error_message column: ${error.message}`);
            }

            // Create batch operations table
            await pool.query(`
        CREATE TABLE IF NOT EXISTS batch_operations (
          id TEXT PRIMARY KEY,
          start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          end_time TIMESTAMP,
          status TEXT DEFAULT 'pending',
          total_tasks INTEGER DEFAULT 0,
          completed_tasks INTEGER DEFAULT 0,
          failed_tasks INTEGER DEFAULT 0,
          states JSONB
        )
      `);

            // Create batch task failures table
            await pool.query(`
        CREATE TABLE IF NOT EXISTS batch_task_failures (
          id SERIAL PRIMARY KEY,
          batch_id TEXT NOT NULL,
          state TEXT NOT NULL,
          error_message TEXT,
          failure_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

            // Create batch state progress table
            await pool.query(`
        CREATE TABLE IF NOT EXISTS batch_state_progress (
          id SERIAL PRIMARY KEY,
          batch_id TEXT NOT NULL,
          state TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          businesses_found INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

            // Create categories table if not exists
            await pool.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          parent_category TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          usage_count INTEGER DEFAULT 0
        )
      `);

            // Create index for faster category search
            await this.createIndexIfNotExists('idx_categories_name', 'categories', 'name');

            // Create index for case-insensitive search
            await this.createIndexIfNotExists('idx_categories_name_lower', 'categories', 'LOWER(name)');

            logger.info('Database tables initialized successfully with performance optimizations');

        } catch (error) {
            logger.error(`Error initializing tables: ${error.message}`);
            throw error;
        }
    }

    // Helper to create an index only if it doesn't exist
    async createIndexIfNotExists(indexName, tableName, columnExpression) {
        try {
            // Check if index already exists
            const indexExists = await this.getOne(`
        SELECT 1 FROM pg_indexes 
        WHERE indexname = $1
      `, [indexName]);

            if (!indexExists) {
                await this.pool.query(`CREATE INDEX ${indexName} ON ${tableName}(${columnExpression})`);
                logger.debug(`Created index ${indexName} on ${tableName}`);
            }
        } catch (error) {
            logger.error(`Error creating index ${indexName}: ${error.message}`);
        }
    }

    // Run a query with retry logic and proper connection handling
    async query(text, params = []) {
        if (!isServer) {
            logger.error('Database operations can only be performed on the server');
            throw new Error('Database operations can only be performed on the server');
        }

        let client;
        try {
            client = await this.getPool().connect();
            this.connectionCount++;

            let retries = 3;
            let lastError;

            // FIXED: Better handling for export queries
            const isExportQuery = text.toLowerCase().includes('select * from business_listings');
            if (isExportQuery) {
                logger.info('Setting longer timeout for export query');
                await client.query('SET statement_timeout = 300000'); // 5 minutes for export queries

                // For specific filter cases that might be problematic
                if (text.includes('email IS NOT NULL') || text.includes('website IS NOT NULL')) {
                    logger.info('Detected potentially expensive filter, optimizing query plan');
                    // Use indexes more effectively
                    await client.query('SET enable_seqscan = OFF');
                    await client.query('SET random_page_cost = 1.1');
                }
            }

            while (retries > 0) {
                try {
                    const result = await client.query(text, params);

                    // FIXED: Add validation for export queries to detect empty results
                    if (isExportQuery && result.rows.length === 0) {
                        logger.warn('Export query returned zero rows - this could indicate a filter issue');
                        // Log the exact query for debugging
                        logger.info(`Query returning zero rows: ${text}`);
                        logger.info(`Parameters: ${JSON.stringify(params)}`);
                    }

                    return result;
                } catch (error) {
                    lastError = error;
                    logger.error(`Database query error (retries left: ${retries - 1}): ${error.message}`);

                    // Only retry on connection errors
                    if (error.code === '08006' || error.code === '08001' || error.code === '57P01') {
                        retries--;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        throw error;
                    }
                }
            }
            throw lastError;
        } catch (error) {
            logger.error(`Database query failed: ${error.message}`);
            throw error;
        } finally {
            if (client) {
                // Reset any session parameters we changed
                try {
                    await client.query('RESET ALL');
                } catch (e) {
                    // Ignore reset errors
                }
                client.release();
                this.connectionCount--;
            }
        }
    }

    // FIXED: New optimized method for large result sets
    async queryStream(text, params = [], rowCallback) {
        if (!isServer) {
            throw new Error('Database operations can only be performed on the server');
        }

        let client;
        try {
            client = await this.getPool().connect();
            this.connectionCount++;

            // Set a longer timeout for large streaming queries
            await client.query('SET statement_timeout = 600000'); // 10 minutes

            const query = new QueryStream(text, params);
            const stream = client.query(query);

            let count = 0;

            stream.on('data', row => {
                count++;
                rowCallback(row);

                // Log progress periodically
                if (count % 1000 === 0) {
                    logger.debug(`Processed ${count} rows from stream`);
                }
            });

            return new Promise((resolve, reject) => {
                stream.on('end', () => {
                    logger.debug(`Stream completed, processed ${count} total rows`);
                    resolve(count);
                });

                stream.on('error', err => {
                    logger.error(`Stream error: ${err.message}`);
                    reject(err);
                });
            }).finally(() => {
                client.release();
                this.connectionCount--;
            });
        } catch (error) {
            if (client) {
                client.release();
                this.connectionCount--;
            }
            logger.error(`Database queryStream failed: ${error.message}`);
            throw error;
        }
    }

    // Get a single result from a query
    async getOne(text, params = []) {
        const result = await this.query(text, params);
        return result.rows[0];
    }

    // Get multiple results from a query
    async getMany(text, params = []) {
        const result = await this.query(text, params);

        // FIXED: Add safety check and logging for large result sets
        if (result.rows.length > 5000) {
            logger.warn(`Large result set returned: ${result.rows.length} rows. Consider using pagination.`);
        }

        return result.rows;
    }

    // Get count directly with optimization for COUNT queries
    async getCount(table, whereClause = '', params = []) {
        const query = `SELECT COUNT(*) as count FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ''}`;
        const result = await this.getOne(query, params);
        return result?.count || 0;
    }

    // Test the database connection
    async testConnection() {
        try {
            const pool = this.getPool();
            const client = await pool.connect();
            try {
                const result = await client.query('SELECT 1 as connection_test');
                return result.rows[0].connection_test === 1;
            } finally {
                client.release();
            }
        } catch (error) {
            logger.error(`Database connection test failed: ${error.message}`);
            return false;
        }
    }

    // Close the pool when the application shuts down
    async end() {
        if (this.pool) {
            logger.info('Closing database connection pool');
            await this.pool.end();
            this.pool = null;
        }
    }
}

// Create a singleton instance
const db = new Database();

// Export the service
export default db;