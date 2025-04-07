/**
 * Utility to validate database connections and table structure
 */
const db = require('../database');
const logger = require('../services/logger');

/**
 * Performs comprehensive validation of database connection and required tables
 */
async function validateDatabaseSetup() {
    try {
        // Check basic database connection
        const isConnected = await db.testConnection();
        if (!isConnected) {
            logger.error('Database connection failed');
            return {
                success: false,
                error: 'Could not connect to database'
            };
        }

        // Verify required tables exist
        const requiredTables = ['business_listings', 'businesses', 'scraping_tasks'];
        const tableChecks = {};

        for (const table of requiredTables) {
            try {
                const result = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )`, [table]);

                tableChecks[table] = result.rows[0].exists;
            } catch (error) {
                tableChecks[table] = false;
                logger.error(`Error checking table ${table}: ${error.message}`);
            }
        }

        // Check if email column exists in business_listings
        let emailColumnExists = false;
        try {
            const result = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'business_listings'
          AND column_name = 'email'
        )`);
            emailColumnExists = result.rows[0].exists;
        } catch (error) {
            logger.error(`Error checking email column: ${error.message}`);
        }

        // Test inserting and retrieving data
        let testDataOk = false;
        try {
            // Insert test data
            const insertResult = await db.query(`
        INSERT INTO business_listings (name, search_term, created_at, updated_at) 
        VALUES ('__TEST__', '__TEST__', NOW(), NOW()) 
        RETURNING id`);

            if (insertResult.rows.length > 0) {
                const testId = insertResult.rows[0].id;

                // Retrieve test data
                const selectResult = await db.query(`
          SELECT id FROM business_listings WHERE id = $1`, [testId]);

                testDataOk = selectResult.rows.length > 0;

                // Clean up test data
                await db.query(`DELETE FROM business_listings WHERE id = $1`, [testId]);
            }
        } catch (error) {
            logger.error(`Error in database read/write test: ${error.message}`);
        }

        return {
            success: isConnected && tableChecks['business_listings'] && emailColumnExists && testDataOk,
            connection: isConnected,
            tables: tableChecks,
            emailColumnExists,
            testDataOk
        };
    } catch (error) {
        logger.error(`Database validation error: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    validateDatabaseSetup
};
