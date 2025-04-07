import { NextResponse } from 'next/server';
import emailFinder from '../../../../../emailFinder';
import logger from '@/services/logger';
import db from '@/services/database';

/**
 * API route to find emails for a specific domain
 */
export async function POST(request) {
    try {
        const {
            domain,
            useSearchEngines,
            searchEngine,
            businessId, // Optional business ID to update in database
            saveToDatabase = true // Default to saving in database if businessId provided
        } = await request.json();

        if (!domain) {
            return NextResponse.json({
                error: 'Domain is required'
            }, { status: 400 });
        }

        // Ensure database is initialized - IMPORTANT for database operations
        await db.init();

        // Test database connection before proceeding
        const dbConnected = await db.testConnection();
        logger.info(`Database connection status before email finder: ${dbConnected ? 'Connected' : 'NOT connected'}`);

        if (!dbConnected) {
            logger.error('Cannot connect to database before running email finder');
            return NextResponse.json({
                error: 'Database connection error',
                details: 'Failed to connect to database before running email finder'
            }, { status: 500 });
        }

        // Initialize the email finder if needed
        try {
            await emailFinder.initialize();
        } catch (initErr) {
            logger.error(`Failed to initialize email finder: ${initErr.message}`);
            return NextResponse.json({
                error: 'Email finder initialization failed',
                details: initErr.message
            }, { status: 500 });
        }

        // Format domain properly - ensure it's clean
        let processedDomain = domain.trim().toLowerCase();

        // Remove protocol if present
        processedDomain = processedDomain.replace(/^https?:\/\//, '');

        // Remove trailing slashes and paths
        processedDomain = processedDomain.split('/')[0];

        // Process businessId with detailed logging to help diagnose issues
        let processedBusinessId = businessId;

        if (businessId !== null && businessId !== undefined) {
            logger.info(`Received businessId: ${businessId} (type: ${typeof businessId})`);

            // Convert string businessId to number if it's numeric
            if (typeof businessId === 'string' && !isNaN(businessId)) {
                processedBusinessId = parseInt(businessId, 10);
                logger.info(`Converted string businessId "${businessId}" to number ${processedBusinessId}`);
            }

            // Log the final businessId details for debugging
            logger.info(`Using processed businessId: ${processedBusinessId} (${typeof processedBusinessId}) for email update`);

            // Verify the ID exists in database before proceeding
            try {
                const business = await db.getOne('SELECT id, name FROM business_listings WHERE id = $1', [processedBusinessId]);
                if (business) {
                    logger.info(`Verified business exists: ID ${processedBusinessId}, name "${business.name}"`);
                } else {
                    logger.warn(`No business found with ID ${processedBusinessId} - email save will likely fail`);
                }
            } catch (dbError) {
                logger.error(`Error verifying business ID: ${dbError.message}`);
            }
        } else {
            logger.info('No businessId provided - will not save to a specific business record');
        }

        // Configure the options for the search with explicit settings
        const options = {
            useSearchEngines: useSearchEngines !== undefined ? useSearchEngines : true,
            searchEngine: searchEngine || 'google',
            timeout: 60000, // Extended timeout for better results
            maxDepth: 2,    // Search deeper for single domain searches
            maxRetries: 3,  // Set explicit retry count
            takeScreenshots: false,
            businessId: processedBusinessId,
            saveToDatabase: !!processedBusinessId // Only save if valid ID provided
        };

        // Use the full URL with https:// prefix for better compatibility
        const fullUrl = `https://${processedDomain}`;

        logger.info(`Starting email search for ${fullUrl} with options: ${JSON.stringify({
            businessId: options.businessId,
            saveToDatabase: options.saveToDatabase,
            useSearchEngines: options.useSearchEngines,
            timeout: options.timeout
        })}`);

        // Run the email finder
        const email = await emailFinder.findEmail(fullUrl, options);

        // Get source information if available
        const source = email && emailFinder.lastExtractedEmailSources?.get(email.toLowerCase());

        // Ensure the email was saved if a business ID was provided
        let savedSuccess = false;
        if (email && processedBusinessId) {
            // Double-check if save was successful by querying the database
            try {
                const checkResult = await db.getOne(
                    'SELECT email FROM business_listings WHERE id = $1',
                    [processedBusinessId]
                );

                savedSuccess = checkResult && checkResult.email === email;

                if (!savedSuccess) {
                    logger.warn(`Email ${email} may not have been saved for business ${processedBusinessId}, attempting manual save`);
                    // Try one more save attempt
                    await emailFinder.saveEmailToDatabase(processedBusinessId, email, email);

                    // Check again
                    const verifyResult = await db.getOne(
                        'SELECT email FROM business_listings WHERE id = $1',
                        [processedBusinessId]
                    );
                    savedSuccess = verifyResult && verifyResult.email === email;
                }
            } catch (dbErr) {
                logger.error(`Error verifying email save: ${dbErr.message}`);
                savedSuccess = false;
            }
        }

        // If we found an email but didn't save it to database (no businessId provided),
        // check if we should update any businesses with this domain
        if (email && !businessId && saveToDatabase) {
            try {
                // Look up businesses with this domain that don't have emails
                const businesses = await db.getMany(
                    `SELECT id FROM business_listings 
                     WHERE domain = $1 
                     AND (email IS NULL OR email = '') 
                     LIMIT 10`,
                    [processedDomain]
                );

                // Update each matching business
                if (businesses.length > 0) {
                    logger.info(`Found ${businesses.length} businesses with domain ${processedDomain} to update with email: ${email}`);

                    for (const business of businesses) {
                        await emailFinder.saveEmailToDatabase(business.id, email, email);
                    }
                }
            } catch (dbError) {
                logger.warn(`Error updating domain-matched businesses: ${dbError.message}`);
                // Continue execution - this is just an enhancement
            }
        }

        // Return the result with detailed status
        return NextResponse.json({
            domain: processedDomain,
            email,
            source,
            businessId: processedBusinessId,
            savedToDatabase: savedSuccess,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Error in domain search: ${error.message}`);
        return NextResponse.json({
            error: 'Failed to find email for domain',
            details: error.message
        }, { status: 500 });
    }
}
