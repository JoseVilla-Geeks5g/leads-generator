import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

/**
 * API route to set up all required database structures
 * Call this route when first setting up the application
 * or when you encounter database structure errors
 */
export async function GET() {
  try {
    logger.info('Starting database setup');
    
    // Initialize database
    await db.init();
    
    // Create a list to track table creation results
    const results = {
      success: true,
      tables: {},
      errors: []
    };
    
    // Create city_data table and populate it
    try {
      await db.ensureCityDataTable();
      
      // Check if we have data in the city_data table
      const cityCount = await db.getOne('SELECT COUNT(*) as count FROM city_data');
      const count = parseInt(cityCount?.count || '0');
      
      if (count === 0) {
        // Populate it with initial data
        const populatedCount = await db.populateCityData();
        results.tables.city_data = true;
        results.tables.city_data_populated = populatedCount > 0;
        results.citiesPopulated = populatedCount;
      } else {
        results.tables.city_data = true;
        results.tables.city_data_populated = true;
        results.citiesExisted = count;
      }
    } catch (error) {
      logger.error(`Error creating city_data table: ${error.message}`);
      results.tables.city_data = false;
      results.errors.push(`city_data table: ${error.message}`);
      results.success = false;
    }
    
    // Create batch_operations table
    try {
      const batchTablesCreated = await ensureBatchTables();
      results.tables.batch_operations = batchTablesCreated;
    } catch (error) {
      logger.error(`Error creating batch tables: ${error.message}`);
      results.tables.batch_operations = false;
      results.errors.push(`batch tables: ${error.message}`);
      results.success = false;
    }
    
    // Create keyword_search_results table
    try {
      const keywordTableCreated = await ensureKeywordSearchTable();
      results.tables.keyword_search_results = keywordTableCreated;
    } catch (error) {
      logger.error(`Error creating keyword_search_results table: ${error.message}`);
      results.tables.keyword_search_results = false;
      results.errors.push(`keyword_search_results table: ${error.message}`);
      results.success = false;
    }
    
    // Check required columns in scraping_tasks
    try {
      const columnsAdded = await ensureScrapingTaskColumns();
      results.tables.scraping_tasks_columns = columnsAdded;
    } catch (error) {
      logger.error(`Error ensuring scraping_tasks columns: ${error.message}`);
      results.tables.scraping_tasks_columns = false;
      results.errors.push(`scraping_tasks columns: ${error.message}`);
      results.success = false;
    }
    
    logger.info(`Database setup completed with status: ${results.success ? 'SUCCESS' : 'ERRORS'}`);
    return NextResponse.json(results);
  } catch (error) {
    logger.error(`Database setup failed: ${error.message}`);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Database setup failed',
        details: error.message
      },
      { status: 500 }
    );
  }
}

/**
 * Ensure batch-related tables exist
 */
async function ensureBatchTables() {
  try {
    // Check if batch_operations table exists
    const tableExists = await db.getOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'batch_operations'
      ) as exists
    `);

    if (!tableExists || !tableExists.exists) {
      logger.info('Creating batch_operations table');
      
      await db.query(`
        CREATE TABLE batch_operations (
          id VARCHAR(36) PRIMARY KEY,
          start_time TIMESTAMP NOT NULL DEFAULT NOW(),
          end_time TIMESTAMP,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          total_tasks INTEGER NOT NULL DEFAULT 0,
          completed_tasks INTEGER NOT NULL DEFAULT 0,
          failed_tasks INTEGER NOT NULL DEFAULT 0,
          states JSONB,
          options JSONB
        )
      `);
      
      await db.query(`
        CREATE INDEX idx_batch_operations_status ON batch_operations(status);
      `);
      
      logger.info('batch_operations table created successfully');
    }
    
    // Check if batch_state_progress table exists
    const stateProgressExists = await db.getOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'batch_state_progress'
      ) as exists
    `);
    
    if (!stateProgressExists || !stateProgressExists.exists) {
      logger.info('Creating batch_state_progress table');
      
      await db.query(`
        CREATE TABLE batch_state_progress (
          id SERIAL PRIMARY KEY,
          batch_id VARCHAR(36) NOT NULL REFERENCES batch_operations(id),
          state VARCHAR(2) NOT NULL,
          total_cities INTEGER NOT NULL DEFAULT 0,
          completed_cities INTEGER NOT NULL DEFAULT 0,
          failed_cities INTEGER NOT NULL DEFAULT 0,
          last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(batch_id, state)
        )
      `);
      
      logger.info('batch_state_progress table created successfully');
    }
    
    // Check if batch_task_failures table exists
    const taskFailuresExists = await db.getOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'batch_task_failures'
      ) as exists
    `);
    
    if (!taskFailuresExists || !taskFailuresExists.exists) {
      logger.info('Creating batch_task_failures table');
      
      await db.query(`
        CREATE TABLE batch_task_failures (
          id SERIAL PRIMARY KEY,
          batch_id VARCHAR(36) NOT NULL REFERENCES batch_operations(id),
          state VARCHAR(2) NOT NULL,
          city VARCHAR(100),
          error_message TEXT,
          failure_time TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      
      logger.info('batch_task_failures table created successfully');
    }
    
    // Check if batch_tasks table exists
    const batchTasksExists = await db.getOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'batch_tasks'
      ) as exists
    `);
    
    if (!batchTasksExists || !batchTasksExists.exists) {
      logger.info('Creating batch_tasks table');
      
      await db.query(`
        CREATE TABLE batch_tasks (
          id SERIAL PRIMARY KEY,
          batch_id VARCHAR(36) NOT NULL,
          state VARCHAR(2) NOT NULL,
          city VARCHAR(100) NOT NULL,
          search_term TEXT NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW(),
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          businesses_found INTEGER DEFAULT 0,
          error_message TEXT
        )
      `);
      
      await db.query(`
        CREATE INDEX idx_batch_tasks_batch_id ON batch_tasks(batch_id);
        CREATE INDEX idx_batch_tasks_status ON batch_tasks(status);
      `);
      
      logger.info('batch_tasks table created successfully');
    }
    
    return true;
  } catch (error) {
    logger.error(`Error ensuring batch tables: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure the keyword_search_results table exists
 */
async function ensureKeywordSearchTable() {
  try {
    const tableExists = await db.getOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'keyword_search_results'
      ) as exists
    `);
    
    if (!tableExists || !tableExists.exists) {
      logger.info('Creating keyword_search_results table');
      
      await db.query(`
        CREATE TABLE keyword_search_results (
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
          keyword VARCHAR(255) NOT NULL,
          search_location VARCHAR(255),
          batch_id VARCHAR(36),
          task_id VARCHAR(36),
          business_type VARCHAR(100),
          owner_name VARCHAR(255),
          verified BOOLEAN DEFAULT FALSE,
          contacted BOOLEAN DEFAULT FALSE,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // Create helpful indexes
      await db.query(`
        CREATE INDEX idx_keyword_search_results_keyword ON keyword_search_results(keyword);
        CREATE INDEX idx_keyword_search_results_state ON keyword_search_results(state);
        CREATE INDEX idx_keyword_search_results_city ON keyword_search_results(city);
        CREATE INDEX idx_keyword_search_results_batch_id ON keyword_search_results(batch_id);
      `);
      
      logger.info('keyword_search_results table created successfully');
    }
    
    return true;
  } catch (error) {
    logger.error(`Error ensuring keyword_search_results table: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure all required columns exist in the scraping_tasks table
 */
async function ensureScrapingTaskColumns() {
  try {
    // Make sure scraping_tasks table exists
    const tableExists = await db.getOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'scraping_tasks'
      ) as exists
    `);
    
    if (!tableExists || !tableExists.exists) {
      logger.info('Creating scraping_tasks table');
      
      await db.query(`
        CREATE TABLE scraping_tasks (
          id VARCHAR(36) PRIMARY KEY,
          search_term VARCHAR(255) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP,
          businesses_found INTEGER NOT NULL DEFAULT 0
        )
      `);
      
      logger.info('scraping_tasks table created successfully');
    }
    
    // Check for all required columns and add them if missing
    const requiredColumns = [
      { name: 'task_id', type: 'VARCHAR(36)' },
      { name: 'location', type: 'VARCHAR(255)' },
      { name: 'params', type: 'JSONB' },
      { name: 'limit', type: 'INTEGER' },
      { name: 'keywords', type: 'TEXT' }
    ];
    
    const addedColumns = [];
    
    for (const column of requiredColumns) {
      const columnExists = await db.getOne(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name='scraping_tasks' AND column_name=$1
        ) as exists
      `, [column.name]);
      
      if (!columnExists || !columnExists.exists) {
        logger.info(`Adding ${column.name} column to scraping_tasks table`);
        
        // Use proper quoting for reserved words like "limit"
        const columnName = column.name === 'limit' ? `"limit"` : column.name;
        
        await db.query(`
          ALTER TABLE scraping_tasks ADD COLUMN ${columnName} ${column.type}
        `);
        
        addedColumns.push(column.name);
      }
    }
    
    logger.info(`Added columns to scraping_tasks: ${addedColumns.join(', ') || 'none'}`);
    return true;
  } catch (error) {
    logger.error(`Error ensuring scraping_tasks columns: ${error.message}`);
    throw error;
  }
}
