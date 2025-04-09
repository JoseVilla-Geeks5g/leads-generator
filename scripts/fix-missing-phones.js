const db = require('../src/services/database');
const logger = require('../src/services/logger');

async function fixMissingPhones() {
    try {
        logger.info('Starting phone data fix...');
        
        // Initialize database
        await db.init();
        
        // Get count of records before fix
        const beforeCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE phone IS NOT NULL AND phone != \'\'');
        logger.info(`Before fix: ${beforeCount.count} records with phone numbers`);
        
        // Fix null phones that should be empty strings
        const nullFixResult = await db.query('UPDATE business_listings SET phone = \'\' WHERE phone IS NULL');
        logger.info(`Fixed ${nullFixResult.rowCount} NULL phone values`);
        
        // Get count of records after fix
        const afterCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE phone IS NOT NULL AND phone != \'\'');
        logger.info(`After fix: ${afterCount.count} records with phone numbers`);
        
        // Log success message
        logger.info('Database phone data fix completed successfully');
        process.exit(0);
    } catch (error) {
        logger.error(`Error fixing database phones: ${error.message}`);
        process.exit(1);
    }
}

// Run the function
fixMissingPhones();
