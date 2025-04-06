import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import db from '@/services/database';
import logger from '@/services/logger';

// API response cache to reduce database load
const responseCache = {
    tasks: null,
    timestamp: 0,
    maxAge: 20000 // 20 seconds - increased from 5 seconds
};

// Get all tasks or task status
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const taskId = searchParams.get('id');

        // Add a force refresh option
        const forceRefresh = searchParams.get('refresh') === 'true';

        // Initialize database if needed
        await db.init();

        // If taskId is provided, get specific task status
        if (taskId) {
            const task = await scraperService.getTaskStatus(taskId);

            if (!task) {
                return NextResponse.json({ error: 'Task not found' }, { status: 404 });
            }

            return NextResponse.json(task);
        }

        // Check cache first for all tasks (unless force refresh requested)
        const now = Date.now();
        if (!forceRefresh && responseCache.tasks && (now - responseCache.timestamp < responseCache.maxAge)) {
            return NextResponse.json(responseCache.tasks);
        }

        // If no taskId, get all tasks - with limiting and optimization
        // Make sure we only select columns that exist in the table
        let tasks = await db.getMany(`
            SELECT 
                id, 
                search_term, 
                status, 
                created_at, 
                completed_at, 
                businesses_found
            FROM scraping_tasks 
            ORDER BY 
                CASE 
                    WHEN status = 'running' THEN 1
                    WHEN status = 'pending' THEN 2
                    WHEN status = 'completed' THEN 3
                    ELSE 4
                END,
                created_at DESC
            LIMIT 100
        `);

        // Update cache
        responseCache.tasks = tasks;
        responseCache.timestamp = now;

        // Set Cache-Control headers for client caching
        const headers = new Headers();
        headers.set('Cache-Control', 'max-age=10');

        return NextResponse.json(tasks, { headers });
    } catch (error) {
        logger.error(`Error getting task status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get task status', details: error.message },
            { status: 500 }
        );
    }
}

// Create a new task
export async function POST(request) {
    try {
        // Initialize database if needed
        await db.init();

        const body = await request.json();
        const { searchTerm, location, radius, limit, includeCategories, excludeCategories } = body;

        if (!searchTerm) {
            return NextResponse.json(
                { error: 'Search term is required' },
                { status: 400 }
            );
        }

        // Construct a more meaningful search term if location is provided
        const fullSearchTerm = location ? `${searchTerm} in ${location}` : searchTerm;

        // Add the new task
        const taskId = await scraperService.addTask(fullSearchTerm);

        // Clear the tasks cache
        responseCache.tasks = null;

        return NextResponse.json({
            taskId,
            message: 'Task added successfully',
            status: 'pending'
        });
    } catch (error) {
        logger.error(`Error adding task: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to add task', details: error.message },
            { status: 500 }
        );
    }
}
