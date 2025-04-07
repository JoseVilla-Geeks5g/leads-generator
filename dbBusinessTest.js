/**
 * Test utility to verify business ID handling and database operations
 */
const db = require('./database');
const emailFinder = require('./emailFinder');
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

/**
 * Verify business ID exists and test saving an email to it
 * @param {string|number} businessId - ID to test
 */
async function testBusinessIdEmail(businessId) {
    try {
        // Initialize database
        logger.info(`Initializing database...`);
        await db.init();

        // Test connection
        const connected = await db.testConnection();
        logger.info(`Database connected: ${connected}`);

        if (!connected) {
            logger.error(`Cannot proceed - database not connected`);
            return;
        }

        // Check the ID type and format
        logger.info(`Testing business ID: ${businessId} (${typeof businessId})`);

        // Try to convert if it's a string
        let processedId = businessId;
        if (typeof businessId === 'string' && !isNaN(businessId)) {
            processedId = parseInt(businessId, 10);
            logger.info(`Converted string ID "${businessId}" to number ${processedId}`);
        }

        // Check if business exists
        logger.info(`Checking if business exists with ID ${processedId}...`);
        const business = await db.getOne(
            'SELECT id, name, email, website, domain FROM business_listings WHERE id = $1',
            [processedId]
        );

        if (!business) {
            logger.error(`No business found with ID ${processedId}`);

            // Try with original ID format if we converted
            if (processedId !== businessId) {
                logger.info(`Trying with original ID format: ${businessId}`);
                const altBusiness = await db.getOne(
                    'SELECT id, name, email, website FROM business_listings WHERE id = $1',
                    [businessId]
                );

                if (altBusiness) {
                    logger.info(`Found business with original ID format: ${JSON.stringify(altBusiness)}`);
                } else {
                    logger.error(`No business found with either ID format: ${businessId} or ${processedId}`);
                    return;
                }
            } else {
                return;
            }
        } else {
            logger.info(`Found business: ${JSON.stringify(business)}`);
        }

        // Test direct database update
        const testEmail = `test_${Date.now()}@example.com`;
        logger.info(`Testing direct database update with email ${testEmail}...`);

        try {
            const updateResult = await db.query(
                `UPDATE business_listings 
                 SET email = $1, 
                     notes = CASE 
                        WHEN notes IS NULL OR notes = '' THEN 'Test email'
                        ELSE notes || ' | Test email' 
                     END,
                     updated_at = NOW() 
                 WHERE id = $2
                 RETURNING id, name, email`,
                [testEmail + '_direct', processedId]
            );

            if (updateResult && updateResult.rowCount > 0) {
                logger.info(`Direct database update successful: ${JSON.stringify(updateResult.rows[0])}`);
            } else {
                logger.error(`Direct database update failed: No rows updated`);
            }
        } catch (dbError) {
            logger.error(`Direct database update error: ${dbError.message}`);
        }

        // Test through email finder
        logger.info(`Testing email finder saveEmailToDatabase method...`);
        const testEmail2 = `test_finder_${Date.now()}@example.com`;

        try {
            const saveResult = await emailFinder.saveEmailToDatabase(businessId, testEmail2, testEmail2);
            logger.info(`Email finder save result: ${saveResult}`);

            // Verify the update happened
            const verifyBusiness = await db.getOne(
                'SELECT id, name, email FROM business_listings WHERE id = $1',
                [processedId]
            );

            if (verifyBusiness && verifyBusiness.email === testEmail2) {
                logger.info(`Verified email was saved correctly: ${verifyBusiness.email}`);
            } else if (verifyBusiness) {
                logger.error(`Email doesn't match what we tried to save: ${verifyBusiness.email} vs ${testEmail2}`);
            } else {
                logger.error(`Couldn't verify saved email - business not found after save`);
            }
        } catch (saveError) {
            logger.error(`Email finder save error: ${saveError.message}`);
        }

        logger.info(`Test completed`);
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        logger.error(error.stack);
    } finally {
        // Close any resources
        process.exit(0);
    }
}

// Run the test if executed directly
if (require.main === module) {
    // Get business ID from command line argument or use default test ID
    const testId = process.argv[2] || '1234';
    testBusinessIdEmail(testId);
}

module.exports = { testBusinessIdEmail };
