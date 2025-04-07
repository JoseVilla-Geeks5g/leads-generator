import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for categories to reduce database load
const cache = {
    all: null,
    queries: {},
    timestamp: 0,
    maxAge: 30 * 60 * 1000 // 30 minutes - categories don't change often
};

export async function GET(request) {
    try {
        await db.init();

        const { searchParams } = new URL(request.url);
        const query = searchParams.get('query')?.toLowerCase() || '';
        const limit = parseInt(searchParams.get('limit') || '50');
        const refresh = searchParams.get('refresh') === 'true';

        // Check if we should use the cache
        const now = Date.now();
        const cacheExpired = now - cache.timestamp > cache.maxAge;

        // If no query and we have a cached list that's not expired
        if (!query && cache.all && !cacheExpired && !refresh) {
            // Return from cache, but apply the limit
            return NextResponse.json({
                categories: cache.all.slice(0, limit)
            });
        }

        // If there's a query and we have it cached and not expired
        if (query && cache.queries[query] && !cacheExpired && !refresh) {
            // Return the cached query results with limit
            return NextResponse.json({
                categories: cache.queries[query].slice(0, limit)
            });
        }

        // If we need all categories (no query)
        if (!query) {
            // Build the query for all categories
            const categoriesQuery = `
                SELECT name FROM categories
                ORDER BY usage_count DESC, name
                LIMIT $1
            `;

            const result = await db.getMany(categoriesQuery, [limit]);
            const categories = result.map(row => row.name);

            // Update cache
            cache.all = categories;
            cache.timestamp = now;

            return NextResponse.json({ categories });
        }
        // If we have a search query
        else {
            // Build the query for searched categories
            const searchQuery = `
                SELECT name FROM categories
                WHERE name ILIKE $1
                ORDER BY 
                    CASE WHEN name ILIKE $2 THEN 1
                         WHEN name ILIKE $3 THEN 2
                         ELSE 3 END,
                    usage_count DESC, name
                LIMIT $4
            `;

            const result = await db.getMany(
                searchQuery,
                [`%${query}%`, `${query}%`, `% ${query}%`, limit]
            );
            const categories = result.map(row => row.name);

            // Update cache for this query
            cache.queries[query] = categories;

            // If this is a fresh query and we don't have all categories cached
            if (!cache.all || cacheExpired) {
                // Fetch all categories in the background to build cache
                db.getMany(
                    `SELECT name FROM categories ORDER BY usage_count DESC, name LIMIT 500`
                ).then(result => {
                    cache.all = result.map(row => row.name);
                    cache.timestamp = Date.now();
                }).catch(err => {
                    logger.error(`Error caching categories: ${err.message}`);
                });
            }

            return NextResponse.json({ categories });
        }
    } catch (error) {
        logger.error(`Error fetching categories: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch categories', details: error.message },
            { status: 500 }
        );
    }
}

// Allow adding new categories
export async function POST(request) {
    try {
        await db.init();

        const body = await request.json();
        const { name, description } = body;

        if (!name) {
            return NextResponse.json(
                { error: 'Category name is required' },
                { status: 400 }
            );
        }

        // Check if category already exists
        const existingCategory = await db.getOne(
            'SELECT name FROM categories WHERE name = $1',
            [name]
        );

        if (existingCategory) {
            // Update usage count instead of adding duplicate
            await db.query(
                'UPDATE categories SET usage_count = usage_count + 1 WHERE name = $1',
                [name]
            );

            // Clear cache
            cache.all = null;
            cache.queries = {};

            return NextResponse.json({
                message: 'Category usage count updated',
                name: existingCategory.name
            });
        }

        // Add new category
        const result = await db.query(
            'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
            [name, description || null]
        );

        // Clear cache
        cache.all = null;
        cache.queries = {};

        return NextResponse.json({
            message: 'Category added successfully',
            category: result.rows[0]
        });
    } catch (error) {
        logger.error(`Error adding category: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to add category', details: error.message },
            { status: 500 }
        );
    }
}
