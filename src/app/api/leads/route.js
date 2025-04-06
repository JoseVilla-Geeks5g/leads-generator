import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function GET(request) {
    try {
        // Initialize database if needed
        await db.init();

        // Parse query parameters
        const { searchParams } = new URL(request.url);
        const searchTerm = searchParams.get('searchTerm');
        const state = searchParams.get('state');
        const city = searchParams.get('city');
        const limit = parseInt(searchParams.get('limit') || '20');
        const offset = parseInt(searchParams.get('offset') || '0');
        const hasEmail = searchParams.get('hasEmail');
        const hasWebsite = searchParams.get('hasWebsite');
        const sortBy = searchParams.get('sortBy') || 'created_at';
        const sortOrder = searchParams.get('sortOrder') || 'desc';
        const keywords = searchParams.get('keywords');
        const excludeCategories = searchParams.getAll('excludeCategory');
        const includeCategories = searchParams.getAll('includeCategory');
        const minRating = searchParams.get('minRating');
        const lastId = searchParams.get('lastId'); // For cursor-based pagination

        // Check if we should use cursor-based pagination for better performance
        const useCursor = Boolean(lastId && parseInt(lastId) > 0);

        // Build query based on params
        let baseQuery = 'SELECT * FROM business_listings WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM business_listings WHERE 1=1';
        let params = [];
        let countParams = [];
        let paramIndex = 1;

        // Apply filters
        if (searchTerm) {
            baseQuery += ` AND (search_term ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
            countQuery += ` AND (search_term ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
            params.push(`%${searchTerm}%`);
            countParams.push(`%${searchTerm}%`);
            paramIndex++;
        }

        if (state) {
            baseQuery += ` AND state = $${paramIndex}`;
            countQuery += ` AND state = $${paramIndex}`;
            params.push(state);
            countParams.push(state);
            paramIndex++;
        }

        if (city) {
            baseQuery += ` AND city = $${paramIndex}`;
            countQuery += ` AND city = $${paramIndex}`;
            params.push(city);
            countParams.push(city);
            paramIndex++;
        }

        // Advanced filtering
        if (hasEmail === 'true') {
            baseQuery += ` AND email IS NOT NULL AND email != ''`;
            countQuery += ` AND email IS NOT NULL AND email != ''`;
        } else if (hasEmail === 'false') {
            baseQuery += ` AND (email IS NULL OR email = '')`;
            countQuery += ` AND (email IS NULL OR email = '')`;
        }

        if (hasWebsite === 'true') {
            baseQuery += ` AND website IS NOT NULL AND website != ''`;
            countQuery += ` AND website IS NOT NULL AND website != ''`;
        } else if (hasWebsite === 'false') {
            baseQuery += ` AND (website IS NULL OR website = '')`;
            countQuery += ` AND (website IS NULL OR website = '')`;
        }

        // Handle keyword search (split keywords and search each)
        if (keywords) {
            const keywordList = keywords.split(',').filter(k => k.trim());
            if (keywordList.length > 0) {
                baseQuery += ' AND (';
                countQuery += ' AND (';

                const keywordConditions = keywordList.map((keyword, idx) => {
                    params.push(`%${keyword.trim()}%`);
                    countParams.push(`%${keyword.trim()}%`);
                    return `name ILIKE $${paramIndex++} OR search_term ILIKE $${paramIndex - 1}`;
                });

                baseQuery += keywordConditions.join(' OR ') + ')';
                countQuery += keywordConditions.join(' OR ') + ')';
            }
        }

        // Category inclusion/exclusion
        if (includeCategories.length > 0) {
            baseQuery += ' AND (';
            countQuery += ' AND (';

            const categoryConditions = includeCategories.map((category, idx) => {
                params.push(`%${category}%`);
                countParams.push(`%${category}%`);
                return `search_term ILIKE $${paramIndex++}`;
            });

            baseQuery += categoryConditions.join(' OR ') + ')';
            countQuery += categoryConditions.join(' OR ') + ')';
        }

        if (excludeCategories.length > 0) {
            excludeCategories.forEach((category) => {
                params.push(`%${category}%`);
                countParams.push(`%${category}%`);
                baseQuery += ` AND search_term NOT ILIKE $${paramIndex++}`;
                countQuery += ` AND search_term NOT ILIKE $${paramIndex - 1}`;
            });
        }

        if (minRating) {
            baseQuery += ` AND rating >= $${paramIndex}`;
            countQuery += ` AND rating >= $${paramIndex}`;
            params.push(parseFloat(minRating));
            countParams.push(parseFloat(minRating));
            paramIndex++;
        }

        // Add sorting (validate against allowed columns)
        const allowedSortColumns = ['name', 'city', 'state', 'rating', 'created_at', 'id'];
        const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
        const validSortOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        // Add cursor-based pagination or standard offset pagination
        let businesses = [];

        if (useCursor) {
            // Cursor-based pagination (more efficient for deep pages)
            const cursorColumnValue = parseInt(lastId);
            const cursorDirection = validSortOrder === 'ASC';

            baseQuery += ` AND id ${cursorDirection ? '>' : '<'} $${paramIndex++}`;
            params.push(cursorColumnValue);

            baseQuery += ` ORDER BY id ${validSortOrder}`;
            baseQuery += ` LIMIT $${paramIndex++}`;
            params.push(limit);

            businesses = await db.getMany(baseQuery, params);
        } else {
            // Standard pagination with offset
            baseQuery += ` ORDER BY ${validSortBy} ${validSortOrder}, id ${validSortOrder}`;
            baseQuery += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(limit, offset);

            businesses = await db.getMany(baseQuery, params);
        }

        // Only perform count if we actually need it (expensive on large tables)
        let totalCount = 0;
        if (!useCursor) {
            // Check if we're on page 1 with fewer results than limit
            if (offset === 0 && businesses.length < limit) {
                totalCount = businesses.length;
            } else {
                // Get count for pagination
                const countResult = await db.getOne(countQuery, countParams);
                totalCount = parseInt(countResult?.total || '0');
            }
        }

        // For cursor pagination, provide the last ID as a cursor
        const lastItem = businesses.length > 0 ? businesses[businesses.length - 1] : null;
        const nextCursor = lastItem ? lastItem.id : null;
        const hasMore = businesses.length >= limit;

        logger.info(`Fetched ${businesses.length} businesses with ${useCursor ? 'cursor' : 'offset'} pagination`);

        return NextResponse.json({
            businesses,
            pagination: useCursor
                ? { nextCursor, hasMore, limit }
                : { total: totalCount, limit, offset },
            filters: {
                searchTerm,
                state,
                city,
                hasEmail: hasEmail === 'true' ? true : hasEmail === 'false' ? false : null,
                hasWebsite: hasWebsite === 'true' ? true : hasWebsite === 'false' ? false : null,
                keywords,
                includeCategories,
                excludeCategories,
                minRating
            }
        });
    } catch (error) {
        logger.error(`Error fetching leads: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch leads', details: error.message },
            { status: 500 }
        );
    }
}
