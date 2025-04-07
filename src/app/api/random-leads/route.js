import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

// In-memory cache for faster repeated queries
const queryCache = {
    data: {},
    timestamps: {},
    maxAge: 5 * 60 * 1000, // 5 minutes
    clear: () => {
        queryCache.data = {};
        queryCache.timestamps = {};
    }
};

export async function GET(request) {
    try {
        // Initialize database
        await db.init();

        // Parse query parameters
        const { searchParams } = new URL(request.url);
        const category = searchParams.get('category');
        const taskId = searchParams.get('taskId');
        const sortBy = searchParams.get('sortBy') || 'name';
        const sortOrder = searchParams.get('sortOrder') || 'asc';
        const hasEmail = searchParams.get('hasEmail');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const searchTerm = searchParams.get('search') || '';
        const city = searchParams.get('city');
        const state = searchParams.get('state');
        const hasWebsite = searchParams.get('hasWebsite');
        const minRating = searchParams.get('minRating');

        // Generate cache key
        const cacheKey = JSON.stringify({
            category, taskId, sortBy, sortOrder, hasEmail, limit, offset, searchTerm, city, state, hasWebsite, minRating
        });

        // Check cache first
        const now = Date.now();
        if (queryCache.data[cacheKey] &&
            (now - queryCache.timestamps[cacheKey]) < queryCache.maxAge) {
            return NextResponse.json(queryCache.data[cacheKey]);
        }

        // Build query with optimized indexing
        let query = `
            SELECT 
                id, 
                name, 
                email, 
                website, 
                city, 
                state, 
                country, 
                phone, 
                category,
                search_term,
                rating,
                task_id,
                'Lead' as status
            FROM random_category_leads
            WHERE 1=1
        `;

        const queryParams = [];
        let paramIndex = 1;

        // Add filters - optimized for index usage
        if (category) {
            query += ` AND category = $${paramIndex++}`;
            queryParams.push(category);
        }

        if (taskId) {
            query += ` AND task_id = $${paramIndex++}`;
            queryParams.push(taskId);
        }

        if (state) {
            query += ` AND state = $${paramIndex++}`;
            queryParams.push(state);
        }

        if (city) {
            query += ` AND city = $${paramIndex++}`;
            queryParams.push(city);
        }

        if (searchTerm) {
            query += ` AND (
                name ILIKE $${paramIndex} OR
                category ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${searchTerm}%`);
            paramIndex++;
        }

        // Optimize email filter
        if (hasEmail === 'true') {
            query += ` AND email IS NOT NULL AND email != ''`;
        } else if (hasEmail === 'false') {
            query += ` AND (email IS NULL OR email = '')`;
        }

        if (hasWebsite === 'true') {
            query += ` AND website IS NOT NULL AND website != ''`;
        } else if (hasWebsite === 'false') {
            query += ` AND (website IS NULL OR website = '')`;
        }

        if (minRating) {
            query += ` AND rating >= $${paramIndex++}`;
            queryParams.push(parseFloat(minRating));
        }

        // Validate sort parameters
        const allowedSortColumns = ['name', 'email', 'category', 'search_term', 'country', 'state', 'city', 'rating'];
        const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'name';
        const validSortOrder = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        // Add sorting - ensure we're using indexed columns when possible
        query += ` ORDER BY ${validSortBy} ${validSortOrder}`;

        // Add second-level sorting for stability
        if (validSortBy !== 'name') {
            query += `, name ASC`;
        }

        // Add pagination with LIMIT/OFFSET
        query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        queryParams.push(limit, offset);

        // Execute query
        const leads = await db.getMany(query, queryParams);

        // Get total count for pagination - use optimized count query
        let countQuery = `
            SELECT COUNT(*) as total 
            FROM random_category_leads
            WHERE 1=1
        `;

        const countParams = [];
        paramIndex = 1;

        if (category) {
            countQuery += ` AND category = $${paramIndex++}`;
            countParams.push(category);
        }

        if (taskId) {
            countQuery += ` AND task_id = $${paramIndex++}`;
            countParams.push(taskId);
        }

        if (state) {
            countQuery += ` AND state = $${paramIndex++}`;
            countParams.push(state);
        }

        if (city) {
            countQuery += ` AND city = $${paramIndex++}`;
            countParams.push(city);
        }

        if (searchTerm) {
            countQuery += ` AND (
                name ILIKE $${paramIndex} OR
                category ILIKE $${paramIndex}
            )`;
            countParams.push(`%${searchTerm}%`);
            paramIndex++;
        }

        if (hasEmail === 'true') {
            countQuery += ` AND email IS NOT NULL AND email != ''`;
        } else if (hasEmail === 'false') {
            countQuery += ` AND (email IS NULL OR email = '')`;
        }

        if (hasWebsite === 'true') {
            countQuery += ` AND website IS NOT NULL AND website != ''`;
        } else if (hasWebsite === 'false') {
            countQuery += ` AND (website IS NULL OR website = '')`;
        }

        if (minRating) {
            countQuery += ` AND rating >= $${paramIndex++}`;
            countParams.push(parseFloat(minRating));
        }

        const countResult = await db.getOne(countQuery, countParams);
        const total = parseInt(countResult?.total || '0');

        // Get available categories for filtering
        let categories = [];
        const categoriesCacheKey = 'random_categories';
        if (queryCache.data[categoriesCacheKey] &&
            (now - queryCache.timestamps[categoriesCacheKey]) < queryCache.maxAge) {
            categories = queryCache.data[categoriesCacheKey];
        } else {
            categories = await db.getMany(`
                SELECT DISTINCT category 
                FROM random_category_leads 
                ORDER BY category
            `);

            queryCache.data[categoriesCacheKey] = categories;
            queryCache.timestamps[categoriesCacheKey] = now;
        }

        // Prepare response
        const response = {
            leads,
            total,
            filters: {
                categories: categories.map(row => row.category),
            },
            pagination: {
                limit,
                offset,
                total
            }
        };

        // Store in cache
        queryCache.data[cacheKey] = response;
        queryCache.timestamps[cacheKey] = now;

        return NextResponse.json(response);
    } catch (error) {
        logger.error(`Error fetching random category leads: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch random category leads', details: error.message },
            { status: 500 }
        );
    }
}

export async function PUT(request) {
    try {
        await db.init();

        const body = await request.json();
        const { id, email, notes, contacted } = body;

        if (!id) {
            return NextResponse.json(
                { error: 'Lead ID is required' },
                { status: 400 }
            );
        }

        // Update lead with contact info
        const updateFields = [];
        const params = [id];
        let paramIndex = 2;

        if (email !== undefined) {
            updateFields.push(`email = $${paramIndex++}`);
            params.push(email);
        }

        if (notes !== undefined) {
            updateFields.push(`notes = $${paramIndex++}`);
            params.push(notes);
        }

        if (contacted !== undefined) {
            updateFields.push(`contacted = $${paramIndex++}`);
            params.push(contacted);
        }

        if (updateFields.length === 0) {
            return NextResponse.json(
                { error: 'No fields to update' },
                { status: 400 }
            );
        }

        updateFields.push('updated_at = NOW()');

        const query = `UPDATE random_category_leads SET ${updateFields.join(', ')} WHERE id = $1 RETURNING *`;
        const result = await db.query(query, params);

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Lead not found' },
                { status: 404 }
            );
        }

        // Clear cache
        queryCache.clear();

        return NextResponse.json({
            message: 'Lead updated successfully',
            lead: result.rows[0]
        });
    } catch (error) {
        logger.error(`Error updating random category lead: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to update lead', details: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    try {
        // Clear cache
        queryCache.clear();
        
        return NextResponse.json({ message: 'Cache cleared' });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to clear cache', details: error.message },
            { status: 500 }
        );
    }
}
