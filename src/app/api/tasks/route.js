import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for task listing to reduce database load
const cache = {
    tasks: null,
    timestamp: 0,
    maxAge: 5 * 60 * 1000 // 5 minutes
};

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const taskId = searchParams.get('id');

        // If task ID provided, get specific task
        if (taskId) {
            const task = await scraperService.getTaskStatus(taskId);
            
            // Handle task not found case more gracefully
            if (task && task.notFound) {
                return NextResponse.json(
                    { 
                        error: 'Task not found',
                        id: taskId,
                        status: 'unknown'
                    }, 
                    { status: 404 }
                );
            }
            
            return NextResponse.json(task);
        }

        // Otherwise, get all tasks with basic caching
        const now = Date.now();
        if (cache.tasks && now - cache.timestamp < cache.maxAge) {
            return NextResponse.json(cache.tasks);
        }

        // No cache or expired, fetch from database
        const tasks = await scraperService.getAllTasks();

        // Update cache
        cache.tasks = tasks;
        cache.timestamp = now;

        return NextResponse.json(tasks);
    } catch (error) {
        logger.error(`Error in GET /api/tasks: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch tasks', details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        // Initialize database tables first to ensure the params column exists
        await db.init();

        const body = await request.json();

        // Extract all needed parameters with updated default limit
        const {
            searchTerm,
            location,
            radius = 10,
            limit = 5000, // Increased default limit
            includeCategories = [],
            excludeCategories = [], // Added default empty array here
            keywords = '',
            useRandomCategories = false,
            dataToExtract = []
        } = body;

        logger.info(`Creating scraper task: ${JSON.stringify({
            searchTerm,
            location,
            useRandomCategories,
            excludedCount: excludeCategories?.length || 0,
            limit
        })}`);

        // Set up the scraping parameters
        const scrapingParams = {
            searchTerm,
            location,
            radius,
            limit,
            includeCategories,
            excludeCategories: excludeCategories || [], 
            keywords,
            useRandomCategories,
            dataToExtract,
            useDirectDatabaseInsert: true,
            useRealScraper: true
        };

        // For random category mode, we need to fetch random categories from the database
        if (useRandomCategories) {
            try {
                // Get random categories excluding the ones in excludeCategories
                const excludeArray = Array.isArray(excludeCategories) ? excludeCategories : [];
                const excludeClause = excludeArray.length > 0
                    ? `WHERE name NOT IN (${excludeArray.map((_, i) => `$${i + 1}`).join(',')})`
                    : '';

                // Get all matching categories without a limit - use all available
                const randomCategoriesQuery = `
                    SELECT name FROM categories
                    ${excludeClause}
                    ORDER BY RANDOM()
                `;

                const randomCategories = await db.getMany(
                    randomCategoriesQuery,
                    excludeArray
                );

                if (randomCategories.length === 0) {
                    return NextResponse.json(
                        { error: 'No categories available after applying exclusions' },
                        { status: 400 }
                    );
                }

                // Use all these random categories for scraping
                scrapingParams.useRandomCategories = true;
                scrapingParams.searchTerm = randomCategories[0].name;
                scrapingParams.includeCategories = randomCategories.map(cat => cat.name);
                scrapingParams.selectedRandomCategories = randomCategories.map(cat => cat.name);

                logger.info(`Using all ${randomCategories.length} random categories: ${JSON.stringify(scrapingParams.includeCategories)}`);
            } catch (error) {
                logger.error(`Error fetching random categories: ${error.message}`);
                return NextResponse.json(
                    { error: 'Failed to select random categories', details: error.message },
                    { status: 500 }
                );
            }
        } else if (!searchTerm && includeCategories.length === 0) {
            return NextResponse.json(
                { error: 'SearchTerm or includeCategories is required' },
                { status: 400 }
            );
        }

        // Add task to scraper service
        const taskId = await scraperService.addTask(scrapingParams);

        // Clear cache since we have a new task
        cache.tasks = null;

        return NextResponse.json({
            taskId,
            message: 'Task created successfully',
            isRandomCategoryTask: useRandomCategories,
            categoriesSelected: scrapingParams.selectedRandomCategories?.length || 0
        });
    } catch (error) {
        logger.error(`Error creating scraper task: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to create scraper task', details: error.message },
            { status: 500 }
        );
    }
}
