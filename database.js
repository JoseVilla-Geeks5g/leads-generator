const { Pool } = require('pg');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Singleton database connection
let pool;

function getPool() {
    if (!pool) {
        // Configure database connection with proper SSL settings for Render
        pool = new Pool({
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
            connectionTimeoutMillis: 10000,
            idle_in_transaction_session_timeout: 30000,
            max: 20
        });

        // Add error handler for the pool
        pool.on('error', (err) => {
            console.error('Unexpected database pool error', err);
        });

        console.log('Database pool created with SSL enabled');
    }
    return pool;
}

// Helper functions for schema operations
async function checkTableExists(tableName) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = $1
    )
  `, [tableName]);

    return result.rows[0].exists;
}

async function checkColumnExists(tableName, columnName) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = $2
    )
  `, [tableName, columnName]);

    return result.rows[0].exists;
}

async function checkConstraintExists(constraintName) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM pg_constraint 
      WHERE conname = $1
    )
  `, [constraintName]);

    return result.rows[0].exists;
}

async function checkIndexExists(indexName) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = $1
    )
  `, [indexName]);

    return result.rows[0].exists;
}

/**
 * Initialize database tables and ensure schema is correct
 */
async function initializeTables() {
    try {
        const pool = getPool();
        console.log('Starting database initialization...');

        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                description TEXT,
                usage_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS scraping_tasks (
                id VARCHAR(36) PRIMARY KEY,
                search_term VARCHAR(255) NOT NULL,
                status VARCHAR(50) NOT NULL,
                businesses_found INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP,
                location VARCHAR(255) DEFAULT '',
                "limit" INTEGER DEFAULT 100,
                keywords TEXT DEFAULT '',
                params TEXT
            );
            
            CREATE TABLE IF NOT EXISTS business_listings (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                country VARCHAR(100),
                postal_code VARCHAR(20),
                phone VARCHAR(50),
                email VARCHAR(255),
                website VARCHAR(255),
                domain VARCHAR(255),
                rating NUMERIC(3,1),
                search_term VARCHAR(255) NOT NULL,
                search_date TIMESTAMP,
                task_id VARCHAR(36) REFERENCES scraping_tasks(id),
                business_type VARCHAR(100),
                owner_name VARCHAR(255),
                verified BOOLEAN DEFAULT FALSE,
                contacted BOOLEAN DEFAULT FALSE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(name, search_term)
            );
            
            CREATE TABLE IF NOT EXISTS batch_operations (
                id VARCHAR(36) PRIMARY KEY,
                start_time TIMESTAMP DEFAULT NOW(),
                end_time TIMESTAMP,
                status VARCHAR(50),
                total_tasks INTEGER,
                completed_tasks INTEGER DEFAULT 0,
                failed_tasks INTEGER DEFAULT 0,
                states TEXT
            );
            
            CREATE TABLE IF NOT EXISTS batch_task_failures (
                id SERIAL PRIMARY KEY,
                batch_id VARCHAR(36) REFERENCES batch_operations(id),
                state VARCHAR(100),
                error_message TEXT,
                failure_time TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS batch_transactions (
                id SERIAL PRIMARY KEY,
                batch_id TEXT NOT NULL,
                data JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS batch_state_progress (
                batch_id TEXT REFERENCES batch_operations(id),
                state TEXT,
                total_cities INTEGER,
                completed_cities INTEGER DEFAULT 0,
                failed_cities INTEGER DEFAULT 0,
                last_updated TIMESTAMP,
                PRIMARY KEY (batch_id, state)
            );
        `);

        // Check for location column in scraping_tasks and add it if it doesn't exist
        const locationColumnExists = await checkColumnExists('scraping_tasks', 'location');
        if (!locationColumnExists) {
            console.log('Adding location column to scraping_tasks table');
            await pool.query(`ALTER TABLE scraping_tasks ADD COLUMN location VARCHAR(255) DEFAULT ''`);
        }

        // Check for params column in scraping_tasks
        const paramsColumnExists = await checkColumnExists('scraping_tasks', 'params');
        if (!paramsColumnExists) {
            console.log('Adding params column to scraping_tasks table');
            await pool.query(`ALTER TABLE scraping_tasks ADD COLUMN params TEXT`);
        }

        // Ensure limit column exists and is properly quoted
        const limitColumnExists = await checkColumnExists('scraping_tasks', 'limit');
        if (!limitColumnExists) {
            console.log('Adding limit column to scraping_tasks table');
            await pool.query(`ALTER TABLE scraping_tasks ADD COLUMN "limit" INTEGER DEFAULT 100`);
        }

        // Check for keywords column in scraping_tasks
        const keywordsColumnExists = await checkColumnExists('scraping_tasks', 'keywords');
        if (!keywordsColumnExists) {
            console.log('Adding keywords column to scraping_tasks table');
            await pool.query(`ALTER TABLE scraping_tasks ADD COLUMN keywords TEXT DEFAULT ''`);
        }

        // Create indexes for better performance
        const indexes = [
            { name: 'idx_task_id', table: 'business_listings', column: 'task_id' },
            { name: 'idx_search_term', table: 'business_listings', column: 'search_term' },
            { name: 'idx_email', table: 'business_listings', column: 'email' },
            { name: 'idx_state_city', table: 'business_listings', column: '(state, city)' },
            { name: 'idx_business_listings_email_exists', table: 'business_listings', column: '(case when email IS NOT NULL AND email != \'\' then true else false end)' },
            { name: 'idx_business_listings_website_exists', table: 'business_listings', column: '(case when website IS NOT NULL AND website != \'\' then true else false end)' },
            { name: 'idx_business_listings_name', table: 'business_listings', column: 'name' },
            { name: 'idx_business_listings_domain', table: 'business_listings', column: 'domain' },
            { name: 'idx_business_listings_city', table: 'business_listings', column: 'city' },
            { name: 'idx_business_listings_state', table: 'business_listings', column: 'state' }
        ];

        for (const index of indexes) {
            const indexExists = await checkIndexExists(index.name);
            if (!indexExists) {
                console.log(`Creating index ${index.name} on ${index.table}`);
                await pool.query(`CREATE INDEX ${index.name} ON ${index.table} ${index.column}`);
            }
        }

        // Check for businesses table (legacy)
        const businessesTableExists = await checkTableExists('businesses');

        if (businessesTableExists) {
            console.log('Legacy businesses table found, ensuring proper constraints');

            // Drop constraints that might cause issues
            await pool.query(`
                ALTER TABLE businesses 
                DROP CONSTRAINT IF EXISTS unique_business_search;
            `).catch(e => console.log('No unique_business_search constraint to drop'));

            await pool.query(`
                ALTER TABLE businesses 
                DROP CONSTRAINT IF EXISTS unique_domain_search;
            `).catch(e => console.log('No unique_domain_search constraint to drop'));

            // Check if constraint exists
            const constraintExists = await pool.query(`
                SELECT 1 FROM pg_constraint 
                WHERE conname = 'businesses_dedup_check'
            `);

            // Add better constraint if it doesn't exist
            if (constraintExists.rows.length === 0) {
                await pool.query(`
                    ALTER TABLE businesses 
                    ADD CONSTRAINT businesses_dedup_check UNIQUE (name, search_term)
                `).catch(e => console.log('Could not add businesses_dedup_check constraint:', e.message));
            }

            // Check if domain column exists
            const domainColumnExists = await checkColumnExists('businesses', 'domain');

            if (!domainColumnExists) {
                console.log('Adding domain column to businesses table');
                await pool.query(`ALTER TABLE businesses ADD COLUMN domain TEXT;`);

                // Populate domain from website
                console.log('Populating domain values from website URLs');
                await pool.query(`
                    UPDATE businesses 
                    SET domain = substring(website from '.*://([^/]*)') 
                    WHERE website IS NOT NULL AND website != '';
                `);
            }
        }

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing tables:', error);
        throw error;
    }
}

// Main database interface
const db = {
    // Test the database connection
    testConnection: async () => {
        try {
            const pool = getPool();
            await pool.query('SELECT NOW()');
            console.log('Database connection successful');
            return true;
        } catch (err) {
            console.error('Database connection error:', err.message);
            return false;
        }
    },

    // Initialize tables
    init: async () => {
        await initializeTables();
    },

    query: async (text, params) => {
        const pool = getPool();
        try {
            console.log(`Executing query: ${text.slice(0, 100)}...`);
            console.log('With params:', JSON.stringify(params).slice(0, 100));

            const result = await pool.query(text, params);
            console.log(`Query completed. Affected rows: ${result.rowCount}`);
            return result;
        } catch (err) {
            console.error('Database query error:', err);
            console.error('Failed query:', text.slice(0, 200));
            console.error('Failed params:', JSON.stringify(params).slice(0, 200));
            throw err;
        }
    },

    getOne: async (text, params) => {
        const pool = getPool();
        try {
            const result = await pool.query(text, params);
            return result.rows[0];
        } catch (err) {
            console.error('Database getOne error:', err);
            throw err;
        }
    },

    getMany: async (text, params) => {
        const pool = getPool();
        try {
            const result = await pool.query(text, params);
            return result.rows;
        } catch (err) {
            console.error('Database getMany error:', err);
            throw err;
        }
    },

    insert: async (text, params) => {
        const pool = getPool();
        try {
            const result = await pool.query(text, params);
            return result.rows[0];
        } catch (err) {
            console.error('Database insert error:', err);
            throw err;
        }
    },

    batchInsert: async (tableName, columns, valuesList) => {
        if (!valuesList || valuesList.length === 0) return { count: 0 };

        const pool = getPool();

        // For small batches, use single query
        if (valuesList.length <= 10) {
            try {
                const placeholders = [];
                const values = [];
                let paramIndex = 1;

                valuesList.forEach(record => {
                    const rowPlaceholders = [];
                    columns.forEach(column => {
                        values.push(record[column]);
                        rowPlaceholders.push(`$${paramIndex++}`);
                    });
                    placeholders.push(`(${rowPlaceholders.join(', ')})`);
                });

                const query = `
                    INSERT INTO ${tableName} (${columns.join(', ')})
                    VALUES ${placeholders.join(', ')}
                    ON CONFLICT DO NOTHING
                    RETURNING id
                `;

                const result = await pool.query(query, values);
                return { count: result.rowCount };
            } catch (err) {
                console.error('Database single insert error:', err);
                throw err;
            }
        }

        // For larger batches, use a transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let insertedCount = 0;

            // Process in chunks of 50
            const chunkSize = 50;
            for (let i = 0; i < valuesList.length; i += chunkSize) {
                const chunk = valuesList.slice(i, i + chunkSize);

                const placeholders = [];
                const values = [];
                let paramIndex = 1;

                chunk.forEach(record => {
                    const rowPlaceholders = [];
                    columns.forEach(column => {
                        values.push(record[column]);
                        rowPlaceholders.push(`$${paramIndex++}`);
                    });
                    placeholders.push(`(${rowPlaceholders.join(', ')})`);
                });

                const query = `
                    INSERT INTO ${tableName} (${columns.join(', ')})
                    VALUES ${placeholders.join(', ')}
                    ON CONFLICT DO NOTHING
                `;

                const result = await client.query(query, values);
                insertedCount += result.rowCount;
            }

            await client.query('COMMIT');
            return { count: insertedCount };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    // Get count from table with optional where clause
    getCount: async (table, whereClause = '', params = []) => {
        try {
            const pool = getPool();
            // Build a proper count query
            const countQuery = `
                SELECT COUNT(*) as count 
                FROM ${table}
                ${whereClause ? `WHERE ${whereClause}` : ''}
            `;

            const result = await pool.query(countQuery, params);
            return parseInt(result.rows[0]?.count || '0');
        } catch (error) {
            console.error(`Error getting count: ${error.message}`);
            return 0;
        }
    },

    // Add a specific method for email updates to help debug issues
    updateEmail: async (businessId, email, notes) => {
        const pool = getPool();
        try {
            console.log(`Updating email for business ID ${businessId} to ${email}`);

            // Use a transaction for greater reliability
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                const result = await client.query(
                    `UPDATE business_listings 
                     SET email = $1, 
                         notes = CASE 
                            WHEN notes IS NULL OR notes = '' THEN $2
                            ELSE notes || ' | ' || $2
                         END,
                         updated_at = NOW() 
                     WHERE id = $3
                     RETURNING id, name, email`,
                    [email, notes || `Email updated to ${email}`, businessId]
                );

                if (result.rowCount === 0) {
                    // Try with numeric conversion if businessId is string
                    if (typeof businessId === 'string' && !isNaN(businessId)) {
                        const numericId = parseInt(businessId, 10);
                        console.log(`No rows updated with string ID "${businessId}", trying with numeric ID ${numericId}`);

                        const retryResult = await client.query(
                            `UPDATE business_listings 
                             SET email = $1, 
                                 notes = CASE 
                                    WHEN notes IS NULL OR notes = '' THEN $2
                                    ELSE notes || ' | ' || $2
                                 END,
                                 updated_at = NOW() 
                             WHERE id = $3
                             RETURNING id, name, email`,
                            [email, notes || `Email updated to ${email}`, numericId]
                        );

                        if (retryResult.rowCount > 0) {
                            await client.query('COMMIT');
                            console.log(`Successfully updated business ${numericId} with email ${email}`);
                            return {
                                success: true,
                                data: retryResult.rows[0],
                                message: `Updated business ID ${numericId} with email ${email}`
                            };
                        } else {
                            await client.query('ROLLBACK');
                            console.error(`Business ID ${businessId} or ${numericId} not found`);
                            return {
                                success: false,
                                error: `Business ID ${businessId} not found in database`
                            };
                        }
                    } else {
                        await client.query('ROLLBACK');
                        console.error(`Business ID ${businessId} not found`);
                        return {
                            success: false,
                            error: `Business ID ${businessId} not found in database`
                        };
                    }
                } else {
                    await client.query('COMMIT');
                    console.log(`Successfully updated business ${businessId} with email ${email}`);
                    return {
                        success: true,
                        data: result.rows[0],
                        message: `Updated business ID ${businessId} with email ${email}`
                    };
                }
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error(`Error updating email: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
};

// Run initialization if this file is executed directly
if (require.main === module) {
    (async () => {
        try {
            await db.init();
            console.log("Database initialized successfully");
            process.exit(0);
        } catch (error) {
            console.error("Failed to initialize database:", error);
            process.exit(1);
        }
    })();
}

module.exports = db;
