import { NextResponse } from 'next/server';
import exportService from '@/services/exportService';
import db from '@/services/database';
import logger from '@/services/logger';

// Simple cache to reduce database load
const cache = {
    estimates: new Map(),
    maxAge: 2 * 60 * 1000, // 2 minutes
};

export async function POST(request) {
    try {
        const body = await request.json();
        const { taskId, state, filter, randomCategories, randomCategoryCount, excludeCategories, forceUnfiltered } = body;

        // Generate a cache key based on request
        const cacheKey = JSON.stringify(body);

        // Check if we have this estimate in cache
        const now = Date.now();
        const cachedEstimate = cache.estimates.get(cacheKey);
        if (cachedEstimate && (now - cachedEstimate.timestamp < cache.maxAge)) {
            return NextResponse.json({
                count: cachedEstimate.count,
                cached: true,
                timeToEstimate: 0
            });
        }

        // Initialize database if needed
        await db.init();

        const startTime = Date.now();
        let estimatedCount = 0;

        if (taskId) {
            // Estimate task results count
            const task = await exportService.getTaskById(taskId);

            if (!task) {
                return NextResponse.json({
                    error: 'Task not found',
                    count: 0
                }, { status: 404 });
            }

            estimatedCount = await db.getCount(
                'business_listings',
                'task_id = $1',
                [taskId]
            );
        } else if (state) {
            // Estimate state export count
            estimatedCount = await exportService.getCountByState(state);
        } else if (randomCategories) {
            // For random categories, we need to estimate based on category counts
            let excludeClause = '';
            const params = [];

            if (excludeCategories && excludeCategories.length > 0) {
                excludeClause = `WHERE search_term NOT IN (${excludeCategories.map((_, i) => `$${i + 1}`).join(',')})`;
                params.push(...excludeCategories);
            }

            // Get counts per category and select random ones
            const categoryCounts = await db.getMany(`
        SELECT search_term, COUNT(*) as count
        FROM business_listings
        ${excludeClause}
        GROUP BY search_term
        ORDER BY RANDOM()
        LIMIT $${params.length + 1}
      `, [...params, randomCategoryCount || 5]);

            // Sum up the counts, applying the contact limit per category
            const contactLimit = filter?.contactLimit || 200;
            estimatedCount = categoryCounts.reduce((total, cat) => {
                return total + Math.min(parseInt(cat.count), contactLimit);
            }, 0);
        } else if (filter && Object.keys(filter).length > 0) {
            // Estimate filtered count
            estimatedCount = await exportService.getFilteredCount(filter);
        } else if (forceUnfiltered) {
            // For unfiltered export, get total count
            estimatedCount = await exportService.getTotalCount();
        } else {
            // Default to all businesses
            estimatedCount = await exportService.getTotalCount();
        }

        const timeToEstimate = Date.now() - startTime;

        // Store in cache
        cache.estimates.set(cacheKey, {
            count: estimatedCount,
            timestamp: now
        });

        return NextResponse.json({
            count: estimatedCount,
            timeToEstimate,
            cached: false
        });
    } catch (error) {
        logger.error(`Error estimating export: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to estimate export size', details: error.message, count: 0 },
            { status: 500 }
        );
    }
}
