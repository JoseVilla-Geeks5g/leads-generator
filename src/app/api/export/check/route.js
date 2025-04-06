import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function POST(request) {
    try {
        await db.init();
        const body = await request.json();
        const { taskId, state, filter } = body;

        let query = '';
        let params = [];
        let paramIndex = 1;
        let description = '';

        // Build the appropriate query based on the request type
        if (taskId) {
            // Check task exists and has records
            const task = await db.getOne('SELECT search_term FROM scraping_tasks WHERE id = $1', [taskId]);

            if (!task) {
                return NextResponse.json(
                    { count: 0, message: 'Task not found', query: `Task ID: ${taskId}` },
                    { status: 404 }
                );
            }

            query = 'SELECT COUNT(*) FROM business_listings WHERE task_id = $1';
            params = [taskId];
            description = `Task: ${task.search_term}`;
        }
        else if (state) {
            // Check state has records
            query = 'SELECT COUNT(*) FROM business_listings WHERE state = $1';
            params = [state];
            description = `State: ${state}`;
        }
        else if (filter) {
            // Build filtered query
            query = 'SELECT COUNT(*) FROM business_listings WHERE 1=1';

            if (filter.state) {
                query += ` AND state = $${paramIndex++}`;
                params.push(filter.state);
            }

            if (filter.city) {
                query += ` AND city = $${paramIndex++}`;
                params.push(filter.city);
            }

            if (filter.searchTerm) {
                query += ` AND (search_term ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
                params.push(`%${filter.searchTerm}%`);
                paramIndex++;
            }

            if (filter.hasEmail === true) {
                query += ' AND email IS NOT NULL AND email != \'\'';
            } else if (filter.hasEmail === false) {
                query += ' AND (email IS NULL OR email = \'\')';
            }

            if (filter.hasWebsite === true) {
                query += ' AND website IS NOT NULL AND website != \'\'';
            } else if (filter.hasWebsite === false) {
                query += ' AND (website IS NULL OR website = \'\')';
            }

            description = `Filter: ${JSON.stringify(filter)}`;
        }
        else {
            // Count all records
            query = 'SELECT COUNT(*) FROM business_listings';
            description = 'All records';
        }

        // Log the query for debugging
        logger.info(`Checking export count: ${description}`);

        // Execute the count query
        const result = await db.getOne(query, params);
        const count = parseInt(result?.count || '0');

        // Return the count with diagnostic info
        return NextResponse.json({
            count,
            description,
            query: `${query} with ${params.length} parameters`,
            hasData: count > 0
        });
    } catch (error) {
        logger.error(`Error checking exportable data: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to check data for export', details: error.message },
            { status: 500 }
        );
    }
}
