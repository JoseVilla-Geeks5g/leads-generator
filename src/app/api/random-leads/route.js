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
        await db.init();

        // Parse query parameters
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '500');
        const offset = parseInt(searchParams.get('offset') || '0');
        const category = searchParams.get('category');

        // Build query for random category leads
        let query = `
            SELECT * FROM random_category_leads 
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        // Add category filter if specified
        if (category) {
            query += ` AND category = $${paramIndex++}`;
            params.push(category);
        }

        // Add ordering and pagination
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);

        // Execute query
        const leads = await db.getMany(query, params);

        // Get total count for pagination
        let countQuery = `SELECT COUNT(*) as total FROM random_category_leads WHERE 1=1`;
        if (category) {
            countQuery += ` AND category = $1`;
        }

        const countResult = await db.getOne(countQuery, category ? [category] : []);
        const total = parseInt(countResult?.total || '0');

        // Get available categories
        const categories = await db.getMany(`
            SELECT DISTINCT category FROM random_category_leads 
            ORDER BY category
        `);

        return NextResponse.json({
            leads,
            total,
            categories: categories.map(row => row.category)
        });
    } catch (error) {
        logger.error(`Error fetching random leads: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch random leads', details: error.message },
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
