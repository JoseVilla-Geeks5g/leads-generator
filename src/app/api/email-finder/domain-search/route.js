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

        // Format domain properly - ensure it's clean
        let processedDomain = domain.trim().toLowerCase();

        // Remove protocol if present
        processedDomain = processedDomain.replace(/^https?:\/\//, '');

        // Remove trailing slashes and paths
        processedDomain = processedDomain.split('/')[0];

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

        // Process businessId with detailed logging to help diagnose issues
        // Convert businessId to integer if it's a numeric string
        let processedBusinessId = businessId;
        if (typeof businessId === 'string' && !isNaN(businessId)) {
            processedBusinessId = parseInt(businessId, 10);
            logger.info(`Converting businessId from string "${businessId}" to number ${processedBusinessId}`);
        }

        // Make URL from domain
        const url = `https://${processedDomain}`;
        
        // Call email finder with explicit options including the business ID
        const email = await emailFinder.findEmail(url, {
            useSearchEngines: useSearchEngines !== false,
            searchEngine: searchEngine || 'google',
            businessId: processedBusinessId, // Pass the processed business ID
            saveToDatabase // Explicitly pass saveToDatabase flag
        });

        // Log the result for debugging
        if (email) {
            logger.info(`Found email ${email} for domain ${processedDomain}${processedBusinessId ? ` (business ID: ${processedBusinessId})` : ''}`);
        } else {
            logger.warn(`No email found for domain ${processedDomain}`);
        }

        return NextResponse.json({
            success: !!email,
            email,
            domain: processedDomain
        });
    } catch (error) {
        logger.error(`Error in domain search: ${error.message}`);
        return NextResponse.json({
            error: 'Failed to find email for domain',
            details: error.message
        }, { status: 500 });
    } finally {
        // Ensure email finder resources are cleaned up
        try {
            await emailFinder.close().catch(err => 
                logger.warn(`Error closing email finder: ${err.message}`)
            );
        } catch (closeError) {
            logger.warn(`Error during emailFinder cleanup: ${closeError.message}`);
        }
    }
}
