const { Pool } = require('pg');
require('dotenv').config();

// Singleton database connection
let pool;

function getPool() {
    if (!pool) {
        pool = new Pool({
            user: process.env.PGUSER || 'leads_db_rc6a_user',
            host: process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.oregon-postgres.render.com',
            database: process.env.PGDATABASE || 'leads_db_rc6a',
            password: process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT',
            port: process.env.PGPORT || 5432,
            connectionTimeoutMillis: 10000,
            idle_in_transaction_session_timeout: 30000,
            ssl: {
                rejectUnauthorized: false
            },
            max: 20
        });
    }
    return pool;
}

// Initialize database tables
async function initializeTables() {
    try {
        const pool = getPool();
        // Check if the businesses table already exists
        const businessesTableExists = await checkTableExists('businesses');

        if (businessesTableExists) {
            // Check for problematic constraints
            console.log('Checking database constraints...');

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
        } else {
            // Create businesses table
            await pool.query(`
        CREATE TABLE IF NOT EXISTS businesses (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          address TEXT,
          city TEXT,
          country TEXT,
          website TEXT,
          domain TEXT,
          rating REAL,
          phone TEXT,
          owner_name TEXT,
          search_term TEXT NOT NULL,
          search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT businesses_dedup_check UNIQUE (name, search_term)
        )
      `);
            console.log('Created businesses table with proper constraints');
        }

        // Create scraping_tasks table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_tasks (
        id TEXT PRIMARY KEY,
        search_term TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        businesses_found INTEGER DEFAULT 0,
        emails_found INTEGER DEFAULT 0
      )
    `);

        // Add domain index if needed
        if (await checkColumnExists('businesses', 'domain')) {
            const indexExists = await checkIndexExists('idx_businesses_domain');

            if (!indexExists) {
                console.log('Creating index on domain column');
                await pool.query(`CREATE INDEX idx_businesses_domain ON businesses(domain)`);
            }
        }

        // Check for business_listings table
        const businessListingsTableExists = await checkTableExists('business_listings');

        if (!businessListingsTableExists) {
            // Create new improved table
            await pool.query(`
        CREATE TABLE IF NOT EXISTS business_listings (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          address TEXT,
          city TEXT,
          state TEXT,
          country TEXT,
          postal_code TEXT,
          website TEXT,
          domain TEXT,
          rating REAL,
          phone TEXT,
          owner_name TEXT,
          business_type TEXT,
          search_term TEXT NOT NULL,
          search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          verified BOOLEAN DEFAULT FALSE,
          contacted BOOLEAN DEFAULT FALSE,
          notes TEXT,
          batch_id TEXT,
          task_id TEXT,
          CONSTRAINT unique_business_listing UNIQUE(name, search_term)
        )
      `);
            console.log('Created business_listings table with improved structure');

            // Create indexes
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_listings_name ON business_listings(name)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_listings_search_term ON business_listings(search_term)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_listings_domain ON business_listings(domain)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_listings_city ON business_listings(city)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_listings_state ON business_listings(state)`);
        } else {
            // Check for state column
            const stateColumnExists = await checkColumnExists('business_listings', 'state');

            if (!stateColumnExists) {
                console.log('Adding state column to business_listings table');
                await pool.query(`ALTER TABLE business_listings ADD COLUMN state TEXT;`);
            }
        }

        // Add batch_transactions table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_transactions (
        id SERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        data JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

        // Add batch operations tables
        await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_operations (
        id TEXT PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        status TEXT,
        total_tasks INTEGER,
        completed_tasks INTEGER DEFAULT 0,
        failed_tasks INTEGER DEFAULT 0,
        states JSON
      )
    `);

        await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_task_failures (
        id SERIAL PRIMARY KEY,
        batch_id TEXT REFERENCES batch_operations(id),
        state TEXT,
        city TEXT,
        error_message TEXT,
        failure_time TIMESTAMP
      )
    `);

        await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_state_progress (
        batch_id TEXT REFERENCES batch_operations(id),
        state TEXT,
        total_cities INTEGER,
        completed_cities INTEGER DEFAULT 0,
        failed_cities INTEGER DEFAULT 0,
        last_updated TIMESTAMP,
        PRIMARY KEY (batch_id, state)
      )
    `);

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing tables:', error);
    }
}

// Helper functions
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
            const result = await pool.query(text, params);
            return result;
        } catch (err) {
            console.error('Database query error:', err);
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
    }
};

module.exports = db;
