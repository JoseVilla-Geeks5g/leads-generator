import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for statistics data - much longer cache time
const statsCache = {
    data: null,
    timestamp: 0,
    maxAge: 60 * 60 * 1000, // 1 hour (instead of 5 minutes)
    isFetching: false
};

// Track clients that requested stats
const clientRequests = new Set();

export async function GET(request) {
    try {
        // Extract request info for logging
        const requestId = Math.random().toString(36).substring(2, 10);
        const { searchParams, headers } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';
        const userAgent = headers.get('user-agent') || 'unknown';

        // Get client IP for tracking duplicate requests
        const clientIp = request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            'unknown';

        const clientKey = `${clientIp}:${userAgent.substring(0, 20)}`;
        const logPrefix = `[Stats:${requestId}]`;

        // If this client has requested recently, log and use cache more aggressively
        const now = Date.now();
        const cacheAge = now - statsCache.timestamp;

        // Only log the first request from each client - reduces log spam
        if (!clientRequests.has(clientKey)) {
            clientRequests.add(clientKey);
            setTimeout(() => clientRequests.delete(clientKey), 60000); // Clear after 1 minute
            logger.debug(`${logPrefix} New stats request from client ${clientKey}`);
        }

        // Use cached data unless force refresh or cache expired
        if (!forceRefresh && statsCache.data && cacheAge < statsCache.maxAge) {
            return NextResponse.json(statsCache.data);
        }

        // Prevent multiple concurrent stats fetches
        if (statsCache.isFetching) {
            // Return cached data if available
            if (statsCache.data) {
                return NextResponse.json(statsCache.data);
            }

            // If no cached data, return simple response
            return NextResponse.json({
                status: 'loading',
                message: 'Statistics are currently being fetched'
            });
        }

        // Initialize database if needed
        await db.init();

        try {
            statsCache.isFetching = true;
            logger.info(`${logPrefix} Fetching fresh statistics`);

            // Optimized query to get count statistics in one go
            const counts = await db.getOne(`
                SELECT 
                    (SELECT COUNT(*) FROM business_listings) AS total_businesses,
                    (SELECT COUNT(*) FROM business_listings WHERE email IS NOT NULL AND email != '') AS total_emails,
                    (SELECT COUNT(*) FROM business_listings WHERE website IS NOT NULL AND website != '') AS total_websites
            `);

            // Get distinct search terms count only
            const searchTermCount = await db.getOne('SELECT COUNT(DISTINCT search_term) AS count FROM business_listings');

            // Get states with counts - limit to top states
            const stateData = await db.getMany(`
                SELECT state, COUNT(*) as count 
                FROM business_listings 
                WHERE state IS NOT NULL 
                GROUP BY state 
                ORDER BY count DESC 
                LIMIT 10
            `);

            // Get task statistics
            const taskStats = await db.getMany(`
                SELECT status, COUNT(*) as count 
                FROM scraping_tasks 
                GROUP BY status
            `);

            // Get recent tasks
            const recentTasks = await db.getMany(`
                SELECT id, search_term, status, created_at, completed_at, businesses_found
                FROM scraping_tasks
                ORDER BY created_at DESC
                LIMIT 5
            `);

            // Calculate coverage percentages
            const totalBusinesses = parseInt(counts?.total_businesses || '0');
            const totalEmails = parseInt(counts?.total_emails || '0');
            const totalWebsites = parseInt(counts?.total_websites || '0');

            const emailCoverage = totalBusinesses > 0
                ? Math.round((totalEmails / totalBusinesses) * 100)
                : 0;

            const websiteCoverage = totalBusinesses > 0
                ? Math.round((totalWebsites / totalBusinesses) * 100)
                : 0;

            // Return stats
            const stats = {
                totalBusinesses,
                totalEmails,
                totalWebsites,
                totalSearchTerms: parseInt(searchTermCount?.count || '0'),
                states: stateData.map(row => row.state),
                stateData,
                emailCoverage,
                websiteCoverage,
                tasks: {
                    total: taskStats.reduce((acc, curr) => acc + parseInt(curr.count), 0),
                    byStatus: taskStats.reduce((acc, curr) => {
                        acc[curr.status] = parseInt(curr.count);
                        return acc;
                    }, {}),
                    recent: recentTasks
                },
                generatedAt: new Date().toISOString()
            };

            // Update cache
            statsCache.data = stats;
            statsCache.timestamp = now;

            logger.info(`Statistics fetched successfully`);

            // Set cache headers on response
            const headers = new Headers();
            headers.set('Cache-Control', 'max-age=3600');

            return NextResponse.json(stats, { headers });
        } finally {
            statsCache.isFetching = false;
        }
    } catch (error) {
        logger.error(`Error getting statistics: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get statistics', details: error.message },
            { status: 500 }
        );
    }
}

// Add an endpoint to manually clear the cache if needed
export async function DELETE() {
    statsCache.data = null;
    statsCache.timestamp = 0;
    return NextResponse.json({ message: 'Statistics cache cleared' });
}
