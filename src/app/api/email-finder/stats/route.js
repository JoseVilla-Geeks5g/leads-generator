import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for stats to reduce DB load
const cache = {
    stats: null,
    timestamp: 0,
    maxAge: 5 * 60 * 1000 // 5 minutes
};

export async function GET() {
    try {
        await db.init();

        // Check if we have cached stats that are still fresh
        const now = Date.now();
        if (cache.stats && (now - cache.timestamp) < cache.maxAge) {
            return NextResponse.json(cache.stats);
        }

        // Get count of businesses without emails
        const withoutEmailQuery = `
            SELECT COUNT(*) as count 
            FROM business_listings 
            WHERE email IS NULL OR email = ''
        `;
        const withoutEmailResult = await db.getOne(withoutEmailQuery);
        const withoutEmail = parseInt(withoutEmailResult?.count || '0');

        // Get count of businesses with websites but no emails
        const withWebsiteNoEmailQuery = `
            SELECT COUNT(*) as count
            FROM business_listings
            WHERE (email IS NULL OR email = '')
            AND website IS NOT NULL AND website != ''
        `;
        const withWebsiteNoEmailResult = await db.getOne(withWebsiteNoEmailQuery);
        const withWebsiteNoEmail = parseInt(withWebsiteNoEmailResult?.count || '0');

        // Get count of businesses with website
        const withWebsiteQuery = `
            SELECT COUNT(*) as count
            FROM business_listings
            WHERE website IS NOT NULL AND website != ''
        `;
        const withWebsiteResult = await db.getOne(withWebsiteQuery);
        const withWebsite = parseInt(withWebsiteResult?.count || '0');

        // Get distribution by domain
        const domainDistributionQuery = `
            SELECT 
                SUBSTRING(domain FROM '^(?:www\.)?([^\.]+)') as main_domain,
                COUNT(*) as count
            FROM business_listings
            WHERE domain IS NOT NULL AND domain != ''
            GROUP BY main_domain
            ORDER BY count DESC
            LIMIT 10
        `;
        const domainDistribution = await db.getMany(domainDistributionQuery);

        // Get email discovery success rate
        const emailSuccessRateQuery = `
            SELECT 
                CASE 
                    WHEN (email IS NOT NULL AND email != '') THEN 'with_email'
                    ELSE 'without_email'
                END as status,
                COUNT(*) as count
            FROM business_listings
            WHERE website IS NOT NULL AND website != ''
            GROUP BY status
        `;
        const emailSuccessRateResults = await db.getMany(emailSuccessRateQuery);

        // Calculate success rate
        let withEmail = 0;
        let totalWithWebsite = 0;

        emailSuccessRateResults.forEach(row => {
            if (row.status === 'with_email') {
                withEmail = parseInt(row.count);
            }
            totalWithWebsite += parseInt(row.count);
        });

        const successRate = totalWithWebsite > 0 ? Math.round((withEmail / totalWithWebsite) * 100) : 0;

        // Create stats object
        const stats = {
            withoutEmail,
            withWebsite,
            withWebsiteNoEmail,
            potential: withWebsiteNoEmail, // Businesses that could get emails found
            successRate,
            domainDistribution: domainDistribution.map(row => ({
                domain: row.main_domain,
                count: parseInt(row.count)
            }))
        };

        // Update cache
        cache.stats = stats;
        cache.timestamp = now;

        return NextResponse.json(stats);
    } catch (error) {
        logger.error(`Error fetching email stats: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch email stats', details: error.message },
            { status: 500 }
        );
    }
}
