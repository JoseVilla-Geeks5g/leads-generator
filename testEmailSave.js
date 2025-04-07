const emailFinder = require('./emailFinder');
const db = require('./database');
const logger = console;

// Test function to directly attempt database saves
async function testEmailSave() {
    try {
        console.log('Testing direct email save to database...');

        // Initialize database first
        await db.init();
        const isConnected = await db.testConnection();
        console.log(`Database connection: ${isConnected ? 'Connected' : 'Failed'}`);

        if (!isConnected) {
            console.error('Cannot proceed - database connection failed');
            return;
        }

        // Test with string ID
        const testId = '1234'; // Replace with a real ID from your database
        const testEmail = `test${Date.now()}@example.com`;

        console.log(`Attempting to save email ${testEmail} to business ID ${testId}`);

        // Try saving directly using the emailFinder method
        const result = await emailFinder.saveEmailToDatabase(testId, testEmail, testEmail);

        console.log(`Save result: ${result ? 'Success' : 'Failed'}`);

        // Also try with the database directly to compare
        console.log('Attempting same operation with direct database query...');

        const dbResult = await db.query(
            `UPDATE business_listings 
       SET email = $1, 
           notes = CASE 
              WHEN notes IS NULL OR notes = '' THEN 'Test email'
              ELSE notes || ' | Test email' 
           END,
           updated_at = NOW() 
       WHERE id = $2
       RETURNING id, name, email`,
            [testEmail + '.direct', parseInt(testId, 10)]
        );

        console.log(`Direct DB operation result: ${dbResult.rowCount > 0 ? 'Success' : 'Failed'}`);
        if (dbResult.rowCount > 0) {
            console.log(`Updated business: ${JSON.stringify(dbResult.rows[0])}`);
        } else {
            console.log('No rows were updated');
        }

    } catch (error) {
        console.error(`Test failed with error: ${error.message}`);
        console.error(error.stack);
    } finally {
        process.exit(0);
    }
}

// Run the test
testEmailSave();
