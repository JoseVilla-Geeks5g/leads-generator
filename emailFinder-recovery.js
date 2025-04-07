/**
 * Email Finder Recovery Utility
 * 
 * This script can be run directly to test and repair email finder browser issues
 */

const emailFinder = require('./emailFinder');
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

/**
 * Test the email finder on a specific domain with extended diagnostics
 */
async function testDomain(url) {
    try {
        logger.info(`Testing email finder on ${url}...`);

        // First ensure we have a clean browser instance
        await emailFinder.close().catch(e => logger.warn(`Close error: ${e.message}`));
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Initialize with explicit options
        await emailFinder.initialize();

        // Memory usage before search
        const memBefore = process.memoryUsage();
        logger.info(`Memory before search: ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB`);

        // Try to find an email
        const email = await emailFinder.findEmail(url, {
            maxRetries: 2,
            timeout: 30000,
            useSearchEngines: false,  // Start without search engines for quicker test
            saveToDatabase: false     // Don't save to database during testing
        });

        // Memory usage after search
        const memAfter = process.memoryUsage();
        logger.info(`Memory after search: ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB`);

        // Check the result
        if (email) {
            logger.info(`SUCCESS - Found email: ${email}`);
            const source = emailFinder.lastExtractedEmailSources?.get(email.toLowerCase()) || 'unknown';
            logger.info(`Email source: ${source}`);
        } else {
            logger.warn(`No email found for ${url}`);
        }

        // Test browser status
        const contextStatus = await testBrowserContexts();

        return {
            success: !!email,
            email,
            browserStatus: contextStatus,
            memoryIncrease: Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024)
        };
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        return { success: false, error: error.message };
    } finally {
        // Always close the browser when done
        await emailFinder.close().catch(e => logger.warn(`Close error: ${e.message}`));
    }
}

/**
 * Test all browser contexts to ensure they're working
 */
async function testBrowserContexts() {
    try {
        const results = [];

        // Initialize if needed
        if (!emailFinder.browser) {
            await emailFinder.initialize();
        }

        // Try a simple operation on each context
        for (let i = 0; i < emailFinder.contextPool.length; i++) {
            try {
                const context = emailFinder.contextPool[i];
                const page = emailFinder.pagePool[i];

                if (!context || !page) {
                    results.push({ workerId: i, status: 'missing' });
                    continue;
                }

                // Try to navigate to a simple page
                await page.goto('about:blank', { timeout: 5000 }).catch(e => {
                    throw new Error(`Navigation failed: ${e.message}`);
                });

                // Try to execute a simple script
                const isValid = await page.evaluate(() => true).catch(e => {
                    throw new Error(`Evaluation failed: ${e.message}`);
                });

                results.push({ workerId: i, status: isValid ? 'valid' : 'invalid' });
            } catch (error) {
                results.push({ workerId: i, status: 'error', message: error.message });

                // Try recovery
                logger.info(`Attempting to recover worker ${i}...`);
                try {
                    await emailFinder.recoverWorkerContext(i);
                    results[i].recoveryStatus = 'recovered';
                } catch (recoveryError) {
                    results[i].recoveryStatus = 'failed';
                    results[i].recoveryError = recoveryError.message;
                }
            }
        }

        return results;
    } catch (error) {
        logger.error(`Context test failed: ${error.message}`);
        return [];
    }
}

/**
 * Run the tests when this script is executed directly
 */
if (require.main === module) {
    (async () => {
        try {
            const testUrl = process.argv[2] || 'https://example.com';
            logger.info(`Starting email finder recovery test with URL: ${testUrl}`);

            const result = await testDomain(testUrl);
            logger.info(`Test completed with result: ${JSON.stringify(result, null, 2)}`);

            process.exit(0);
        } catch (error) {
            logger.error(`Test script error: ${error.message}`);
            process.exit(1);
        }
    })();
}

module.exports = {
    testDomain,
    testBrowserContexts
};
