import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for stats to reduce DB load
const cache = {
    stats: null,
    timestamp: 0,
    maxAge: 30 * 60 * 1000 // 30 minutes
};

export async function GET() {
    try {
        await db.init();

        // Check if we have cached stats that are still fresh
        const now = Date.now();
        if (cache.stats && (now - cache.timestamp) < cache.maxAge) {
            return NextResponse.json(cache.stats);
        }

        // Count all businesses
        const businessCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings');
        const emailCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
        const websiteCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE website IS NOT NULL AND website != \'\'');

        // Get unique search terms (categories)
        const searchTerms = await db.getMany('SELECT COUNT(DISTINCT search_term) as count FROM business_listings');

        // Get states with at least 1 business
        const states = await db.getMany('SELECT DISTINCT state FROM business_listings WHERE state IS NOT NULL AND state != \'\' ORDER BY state');

        // Get top states by count
        const stateData = await db.getMany(`
      SELECT state, COUNT(*) as count 
      FROM business_listings 
      WHERE state IS NOT NULL AND state != '' 
      GROUP BY state 
      ORDER BY count DESC 
      LIMIT 10
    `);

        // Get task statistics
        const taskStats = await db.getMany('SELECT status, COUNT(*) as count FROM scraping_tasks GROUP BY status');

        // Get category statistics
        const categoryStats = await db.getMany(`
      SELECT COUNT(*) as count FROM categories
    `);

        // Create stats object
        const stats = {
            totalBusinesses: parseInt(businessCount?.count || '0'),
            totalEmails: parseInt(emailCount?.count || '0'),
            totalWebsites: parseInt(websiteCount?.count || '0'),
            totalSearchTerms: parseInt(searchTerms[0]?.count || '0'),
            totalCategories: parseInt(categoryStats[0]?.count || '0'),
            states: states.map(row => row.state),
            stateData: stateData.map(row => ({
                state: row.state,
                count: parseInt(row.count)
            })),
            emailCoverage: parseInt(businessCount?.count) > 0
                ? Math.round((parseInt(emailCount?.count) / parseInt(businessCount?.count)) * 100)
                : 0,
            websiteCoverage: parseInt(businessCount?.count) > 0
                ? Math.round((parseInt(websiteCount?.count) / parseInt(businessCount?.count)) * 100)
                : 0,
            tasks: {
                total: taskStats.reduce((acc, curr) => acc + parseInt(curr.count), 0),
                byStatus: taskStats.reduce((acc, curr) => {
                    acc[curr.status] = parseInt(curr.count);
                    return acc;
                }, {})
            }
        };

        // Update cache
        cache.stats = stats;
        cache.timestamp = now;

        return NextResponse.json(stats);
    } catch (error) {
        logger.error(`Error fetching stats: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch stats', details: error.message },
            { status: 500 }
        );
    }
}
