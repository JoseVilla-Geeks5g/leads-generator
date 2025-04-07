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
        const country = searchParams.get('country');
        const state = searchParams.get('state');
        const sortBy = searchParams.get('sortBy') || 'name';
        const sortOrder = searchParams.get('sortOrder') || 'asc';
        const hasEmail = searchParams.get('hasEmail');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const searchTerm = searchParams.get('search') || '';
        const category = searchParams.get('category');
        const city = searchParams.get('city');
        const hasWebsite = searchParams.get('hasWebsite');
        const minRating = searchParams.get('minRating');

        // Generate cache key
        const cacheKey = JSON.stringify({
            country, state, sortBy, sortOrder, hasEmail, limit, offset, searchTerm, category, city, hasWebsite, minRating
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
                search_term as company,
                rating,
                'Lead' as status
            FROM business_listings
            WHERE 1=1
        `;

        const queryParams = [];
        let paramIndex = 1;

        // Add filters - optimized for index usage
        if (country) {
            query += ` AND country = $${paramIndex++}`;
            queryParams.push(country);
        }

        if (state) {
            query += ` AND state = $${paramIndex++}`;
            queryParams.push(state);
        }

        if (searchTerm) {
            query += ` AND (
                name ILIKE $${paramIndex} OR
                search_term ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${searchTerm}%`);
            paramIndex++;
        }

        if (category) {
            query += ` AND search_term = $${paramIndex++}`;
            queryParams.push(category);
        }

        if (city) {
            query += ` AND city = $${paramIndex++}`;
            queryParams.push(city);
        }

        // Optimize email filter to use the idx_business_listings_email_exists index
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
        const allowedSortColumns = ['name', 'email', 'company', 'country', 'state', 'city', 'rating'];
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

        // Execute query with optimizations
        console.time('Contact query execution');
        const contacts = await db.getMany(query, queryParams);
        console.timeEnd('Contact query execution');

        // Get total count for pagination - use optimized count query
        let countQuery = `
            SELECT COUNT(*) as total 
            FROM business_listings 
            WHERE 1=1
        `;

        const countParams = [];
        paramIndex = 1;

        if (country) {
            countQuery += ` AND country = $${paramIndex++}`;
            countParams.push(country);
        }

        if (state) {
            countQuery += ` AND state = $${paramIndex++}`;
            countParams.push(state);
        }

        if (searchTerm) {
            countQuery += ` AND (
                name ILIKE $${paramIndex} OR
                search_term ILIKE $${paramIndex}
            )`;
            countParams.push(`%${searchTerm}%`);
            paramIndex++;
        }

        if (category) {
            countQuery += ` AND search_term = $${paramIndex++}`;
            countParams.push(category);
        }

        if (city) {
            countQuery += ` AND city = $${paramIndex++}`;
            countParams.push(city);
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

        const countResult = await db.getCount('business_listings', countQuery.replace('SELECT COUNT(*) as total FROM business_listings WHERE', ''), countParams);
        const total = parseInt(countResult || '0');

        // Get available countries and states for filtering - cache these separately
        let countries = [];
        let states = [];

        // Check if there are existing countries in cache
        const countriesCacheKey = 'distinct_countries';
        if (queryCache.data[countriesCacheKey] &&
            (now - queryCache.timestamps[countriesCacheKey]) < queryCache.maxAge) {
            countries = queryCache.data[countriesCacheKey];
        } else {
            countries = await db.getMany(`
                SELECT DISTINCT country 
                FROM business_listings 
                WHERE country IS NOT NULL 
                ORDER BY country
            `);

            // Cache countries
            queryCache.data[countriesCacheKey] = countries;
            queryCache.timestamps[countriesCacheKey] = now;
        }

        // Check if there are existing states in cache
        const statesCacheKey = 'distinct_states';
        if (queryCache.data[statesCacheKey] &&
            (now - queryCache.timestamps[statesCacheKey]) < queryCache.maxAge) {
            states = queryCache.data[statesCacheKey];
        } else {
            states = await db.getMany(`
                SELECT DISTINCT state 
                FROM business_listings 
                WHERE state IS NOT NULL 
                ORDER BY state
            `);

            // Cache states
            queryCache.data[statesCacheKey] = states;
            queryCache.timestamps[statesCacheKey] = now;
        }

        // Prepare response
        const response = {
            contacts,
            total,
            filters: {
                countries: countries.map(row => row.country),
                states: states.map(row => row.state)
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
        logger.error(`Error fetching contacts: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch contacts', details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        await db.init();

        const body = await request.json();
        const { businessId, notes, contacted } = body;

        if (!businessId) {
            return NextResponse.json(
                { error: 'Business ID is required' },
                { status: 400 }
            );
        }

        // Update business with contact info
        const updateFields = [];
        const params = [businessId];
        let paramIndex = 2;

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

        const query = `UPDATE business_listings SET ${updateFields.join(', ')} WHERE id = $1 RETURNING *`;
        const result = await db.query(query, params);

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Business not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            message: 'Business updated successfully',
            business: result.rows[0]
        });
    } catch (error) {
        logger.error(`Error updating business: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to update business', details: error.message },
            { status: 500 }
        );
    }
}

// Endpoint to clear cache if needed
export async function DELETE() {
    queryCache.clear();
    return NextResponse.json({ message: 'Cache cleared' });
}
