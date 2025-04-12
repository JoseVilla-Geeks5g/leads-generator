import { NextResponse } from 'next/server';
import db from '@/services/database';
import scraperService from '@/services/scraperService';
import logger from '@/services/logger';

export async function GET(request) {
    try {
        // Return current email finder status
        const status = scraperService.getEmailFinderStatus();
        return NextResponse.json(status);
    } catch (error) {
        logger.error(`Error getting email finder status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get email finder status', details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const {
            action, // 'start', 'stop', 'specific', 'filter'
            limit = 50000, // Use the higher limit of 50k
            onlyWithWebsite = true,
            skipContacted = true,
            businessIds = [],
            concurrency = 3,    // How many sites to process concurrently
            timeout = 30000,    // 30 seconds default timeout per site
            maxDepth = 2,       // How deep to crawl links on site
            domainFilter = null, // Optional domain filter
            useSearchEngines = true, // Whether to use search engines
            searchEngine = 'google', // Which search engine to use
            searchTerm = null,   // NEW: Filter by search term
            minRating = null,    // NEW: Filter by minimum rating
            hasWebsite = true,   // NEW: Explicit filter for businesses with websites
            state = null,        // NEW: Filter by state
            city = null,         // NEW: Filter by city
            sortOrder = 'desc'   // NEW: Sort order for created_at (asc or desc)
        } = body;

        // Database must be initialized before any operations
        await db.init();

        // Test connection and log result
        const dbConnected = await db.testConnection();
        logger.info(`Database connection test before email finder: ${dbConnected ? 'CONNECTED' : 'FAILED'}`);

        if (!dbConnected) {
            return NextResponse.json(
                { error: 'Database connection failed. Cannot proceed with email finder.' },
                { status: 500 }
            );
        }

        // Handle different actions
        switch (action) {
            case 'start':
                // Check if email finder is already running
                if (scraperService.getEmailFinderStatus().isRunning) {
                    return NextResponse.json(
                        { error: 'Email finder is already running' },
                        { status: 400 }
                    );
                }

                // Configure advanced email finder options with new filters
                const options = {
                    limit,
                    onlyWithWebsite: hasWebsite !== false, // Always true unless explicitly set to false
                    skipContacted,
                    concurrency,
                    timeout,
                    maxDepth,
                    domainFilter,
                    useSearchEngines,
                    searchEngine,
                    searchTerm,
                    minRating,
                    state,
                    city,
                    sortOrder // NEW: Pass sort order to the service
                };

                // Add options to the logger for debugging
                logger.info(`Starting email finder with options: ${JSON.stringify({
                    limit,
                    onlyWithWebsite: options.onlyWithWebsite,
                    skipContacted,
                    concurrency,
                    maxDepth,
                    domainFilter: domainFilter || 'none',
                    useSearchEngines,
                    searchEngine,
                    searchTerm: searchTerm || 'none',
                    minRating: minRating || 'none',
                    state: state || 'all',
                    city: city || 'all',
                    sortOrder: sortOrder || 'desc'
                })}`);

                // Start email finder with the real implementation
                const queueSize = await scraperService.processAllPendingBusinesses(options);

                return NextResponse.json({
                    message: 'Email finder started',
                    queueSize,
                    isRunning: true,
                    options
                });

            case 'filter':
                // NEW: Special case to process businesses based on filters
                if (scraperService.getEmailFinderStatus().isRunning) {
                    return NextResponse.json(
                        { error: 'Email finder is already running' },
                        { status: 400 }
                    );
                }

                // Configure filter options
                const filterOptions = {
                    limit,
                    onlyWithWebsite: hasWebsite !== false,
                    skipContacted,
                    concurrency,
                    timeout,
                    maxDepth,
                    domainFilter,
                    useSearchEngines,
                    searchEngine,
                    searchTerm,
                    minRating,
                    state,
                    city,
                    sortOrder // NEW: Pass sort order to the service
                };

                logger.info(`Starting email finder with search term "${searchTerm || 'all'}" and filters: ${JSON.stringify({
                    onlyWithWebsite: filterOptions.onlyWithWebsite,
                    state: state || 'all',
                    city: city || 'all',
                    limit,
                    sortOrder: sortOrder || 'desc'
                })}`);

                // Use the specialized method when search term is provided
                if (searchTerm) {
                    const processPromise = scraperService.processEmailsBySearchTerm(searchTerm, filterOptions);
                    
                    // We don't need to await here - just trigger the process
                    processPromise.catch(err => logger.error(`Error in batch process: ${err.message}`));
                    
                    return NextResponse.json({
                        message: `Email finder started for search term "${searchTerm}" with sort order ${sortOrder || 'desc'}`,
                        queueSize: filterOptions.limit,
                        isRunning: true,
                        options: filterOptions
                    });
                }
                
                // Start email finder with filters (regular way when no search term)
                const filteredQueueSize = await scraperService.processAllPendingBusinesses(filterOptions);

                return NextResponse.json({
                    message: `Email finder started for search term "${searchTerm || 'all businesses'}"`,
                    queueSize: filteredQueueSize,
                    isRunning: true,
                    options: filterOptions
                });

            case 'stop':
                // Stop email finder if it's running
                if (!scraperService.getEmailFinderStatus().isRunning) {
                    return NextResponse.json(
                        { message: 'Email finder is not running' }
                    );
                }

                const results = await scraperService.stopEmailFinder();
                return NextResponse.json({
                    message: 'Email finder stopped',
                    ...results,
                    isRunning: false
                });

            case 'specific':
                // Process specific business IDs
                if (!Array.isArray(businessIds) || businessIds.length === 0) {
                    return NextResponse.json(
                        { error: 'No business IDs provided' },
                        { status: 400 }
                    );
                }

                // Convert string IDs to numbers if needed
                const processedIds = businessIds.map(id =>
                    typeof id === 'string' && !isNaN(id) ? parseInt(id, 10) : id
                );

                logger.info(`Processing ${processedIds.length} specific businesses: ${JSON.stringify(processedIds.slice(0, 5))}${processedIds.length > 5 ? '...' : ''}`);

                // Configure specific business processing options
                const specificOptions = {
                    concurrency: concurrency || 3,
                    timeout: timeout || 30000,
                    maxDepth: maxDepth || 2,
                    domainFilter: domainFilter || null,
                    saveToDatabase: true  // Always save to database for specific businesses
                };

                const processedCount = await scraperService.processBusinesses(processedIds, specificOptions);

                return NextResponse.json({
                    message: `Processing ${processedCount} specific businesses`,
                    queueSize: processedCount,
                    isRunning: true,
                    options: specificOptions,
                    businessIds: processedIds
                });

            default:
                return NextResponse.json(
                    { error: 'Invalid action. Use "start", "stop", "filter", or "specific"' },
                    { status: 400 }
                );
        }
    } catch (error) {
        logger.error(`Error in email finder API: ${error.message}`);
        return NextResponse.json(
            { error: 'Email finder operation failed', details: error.message },
            { status: 500 }
        );
    }
}
