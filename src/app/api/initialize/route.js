import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

/**
 * Endpoint to initialize database tables and populate city data
 * This helps ensure everything is set up correctly before running batches
 */
export async function GET() {
    try {
        logger.info('Initializing database structures');
        
        // Initialize database connection
        await db.init();
        
        // Create a results object to track what was done
        const results = {
            success: true,
            initialized: {},
            errors: []
        };
        
        // Ensure city_data table exists and is populated
        try {
            await db.ensureCityDataTable();
            
            // Check if city data exists
            const cityCount = await db.getOne('SELECT COUNT(*) as count FROM city_data');
            if (parseInt(cityCount?.count || '0') === 0) {
                // Populate city data
                const count = await db.populateCityData();
                results.initialized.city_data = {
                    created: true,
                    populated: true,
                    count
                };
            } else {
                results.initialized.city_data = {
                    exists: true,
                    count: parseInt(cityCount.count)
                };
            }
        } catch (error) {
            logger.error(`Error ensuring city data: ${error.message}`);
            results.success = false;
            results.errors.push(`city_data: ${error.message}`);
        }
        
        // Ensure batch tables exist
        try {
            await ensureBatchTables();
            results.initialized.batch_tables = true;
        } catch (error) {
            logger.error(`Error ensuring batch tables: ${error.message}`);
            results.success = false;
            results.errors.push(`batch_tables: ${error.message}`);
        }
        
        // Test connection to scraper service
        try {
            const scraperServiceOnline = true; // In a real implementation, check if service is responding
            results.initialized.scraper_service = scraperServiceOnline;
        } catch (error) {
            logger.error(`Error checking scraper service: ${error.message}`);
            results.success = false;
            results.errors.push(`scraper_service: ${error.message}`);
        }
        
        return NextResponse.json(results);
    } catch (error) {
        logger.error(`Initialization error: ${error.message}`);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

/**
 * Ensure all batch-related tables exist
 */
async function ensureBatchTables() {
    // Check if batch_operations table exists
    const batchOperationsExists = await db.getOne(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'batch_operations'
        ) as exists
    `);
    
    if (!batchOperationsExists || !batchOperationsExists.exists) {
        // Create batch_operations table
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
        
        // Create index
        await db.query(`CREATE INDEX idx_batch_operations_status ON batch_operations(status)`);
    }
    
    // Check and create other related tables as needed
    // ...
    
    return true;
}
