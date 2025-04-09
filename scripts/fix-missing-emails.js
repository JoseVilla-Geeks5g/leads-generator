const db = require('../database');
const logger = require('../logger');

async function fixMissingEmails() {
    try {
        logger.info('Starting database email data fix...');
        
        // Initialize database
        await db.init();
        
        // Get count of records before fix
        const beforeCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
        logger.info(`Before fix: ${beforeCount.count} records with emails`);
        
        // Fix null emails that should be empty strings
        const nullFixResult = await db.query('UPDATE business_listings SET email = \'\' WHERE email IS NULL');
        logger.info(`Fixed ${nullFixResult.rowCount} NULL email values`);
        
        // Fix null websites that should be empty strings
        const nullWebsiteFixResult = await db.query('UPDATE business_listings SET website = \'\' WHERE website IS NULL');
        logger.info(`Fixed ${nullWebsiteFixResult.rowCount} NULL website values`);
        
        // Get count of records after fix
        const afterCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
        logger.info(`After fix: ${afterCount.count} records with emails`);
        
        // Log success message
        logger.info('Database email data fix completed successfully');
        
        process.exit(0);
    } catch (error) {
        logger.error(`Error fixing database emails: ${error.message}`);
        process.exit(1);
    }
}

// Run the function
fixMissingEmails();
