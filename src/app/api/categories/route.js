import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for category data
const categoryCache = {
    data: null,
    timestamp: 0,
    maxAge: 60 * 1000, // 60 seconds
};

export async function GET(request) {
    try {
        // Initialize database if needed
        await db.init();

        const { searchParams } = new URL(request.url);
        const query = searchParams.get('query') || '';
        const limit = parseInt(searchParams.get('limit') || '50');
        const refresh = searchParams.get('refresh') === 'true';

        // Check if we can use cached data for non-search requests
        const now = Date.now();
        if (!query && !refresh && categoryCache.data && (now - categoryCache.timestamp < categoryCache.maxAge)) {
            return NextResponse.json({ categories: categoryCache.data });
        }

        // Get categories from the dedicated table with search functionality
        let categoriesQuery;
        if (query) {
            categoriesQuery = await db.getMany(`
                SELECT name as category, usage_count 
                FROM categories 
                WHERE LOWER(name) LIKE LOWER($1)
                ORDER BY usage_count DESC, name ASC
                LIMIT $2
            `, [`%${query}%`, limit]);
        } else {
            categoriesQuery = await db.getMany(`
                SELECT name as category, usage_count 
                FROM categories 
                ORDER BY usage_count DESC, name ASC
                LIMIT $1
            `, [limit]);
        }

        // Extract categories from query results
        const dbCategories = categoriesQuery.map(row => row.category);

        // If not a search, update the cache
        if (!query) {
            categoryCache.data = dbCategories;
            categoryCache.timestamp = now;
        }

        return NextResponse.json({ categories: dbCategories });
    } catch (error) {
        logger.error(`Error fetching categories: ${error.message}`);

        // Don't use default categories now - we want to rely on user's actual categories
        return NextResponse.json(
            { categories: [], error: 'Failed to fetch categories from database' },
            { status: 500 }
        );
    }
}

// Add new categories via POST
export async function POST(request) {
    try {
        await db.init();

        const body = await request.json();
        const { categories } = body;

        if (!categories || !Array.isArray(categories) || categories.length === 0) {
            return NextResponse.json(
                { error: 'No categories provided' },
                { status: 400 }
            );
        }

        // Filter out empty strings and trim whitespace
        const validCategories = categories
            .map(cat => cat.trim())
            .filter(cat => cat.length > 0);

        if (validCategories.length === 0) {
            return NextResponse.json(
                { error: 'No valid categories found' },
                { status: 400 }
            );
        }

        // Insert categories into database
        const result = { added: 0, duplicates: 0 };

        for (const category of validCategories) {
            try {
                const res = await db.query(`
                    INSERT INTO categories (name)
                    VALUES ($1)
                    ON CONFLICT (name) DO NOTHING
                    RETURNING name
                `, [category]);

                if (res.rowCount > 0) {
                    result.added++;
                } else {
                    result.duplicates++;
                }
            } catch (err) {
                logger.error(`Error inserting category "${category}": ${err.message}`);
                result.duplicates++;
            }
        }

        // Invalidate the cache
        categoryCache.data = null;
        categoryCache.timestamp = 0;

        return NextResponse.json({
            message: `Added ${result.added} categories. ${result.duplicates} were duplicates.`,
            added: result.added,
            duplicates: result.duplicates
        });
    } catch (error) {
        logger.error(`Error adding categories: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to add categories', details: error.message },
            { status: 500 }
        );
    }
}

// Delete a category via DELETE
export async function DELETE(request) {
    try {
        await db.init();

        const { searchParams } = new URL(request.url);
        const categoryName = searchParams.get('name');

        if (!categoryName) {
            return NextResponse.json(
                { error: 'Category name is required' },
                { status: 400 }
            );
        }

        const result = await db.query(`
            DELETE FROM categories
            WHERE name = $1
            RETURNING name
        `, [categoryName]);

        // Invalidate the cache
        categoryCache.data = null;
        categoryCache.timestamp = 0;

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Category not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            message: `Category "${categoryName}" deleted successfully`
        });
    } catch (error) {
        logger.error(`Error deleting category: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to delete category', details: error.message },
            { status: 500 }
        );
    }
}
