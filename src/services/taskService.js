/**
 * Task Service Module
 * Handles scraping task queue management and processing
 */

import { v4 as uuidv4 } from 'uuid';
import db from './database';
import logger from './logger';
import googleMapsScraper from './googleMapsScraper';
import businessDataService from './businessDataService';

// Task tracking state
const state = {
    tasks: new Map(),
    maxConcurrentTasks: 3,
    currentRunningTasks: 0,
    taskQueue: [],
    autoProcessEnabled: true,
    taskProcessingInterval: null,
    generateMockData: false,
    initialized: false,
    browserInitializing: false
};

/**
 * Enable or disable automatic task processing
 * @param {boolean} enabled - Whether auto-processing should be enabled
 * @param {boolean} requireAuth - Whether authorization is required
 * @returns {boolean} New status
 */
function setAutoProcessing(enabled, requireAuth = false) {
    if (typeof window === 'undefined') {
        if (state.taskProcessingInterval) {
            clearInterval(state.taskProcessingInterval);
            state.taskProcessingInterval = null;
        }

        state.autoProcessEnabled = enabled;

        if (enabled) {
            logger.info('Enabling automatic task processing');
            state.taskProcessingInterval = setInterval(() => processTaskQueue(), 5000);
        } else {
            logger.info('Automatic task processing disabled');
        }
    }
    return state.autoProcessEnabled;
}

/**
 * Check if auto-processing is enabled
 * @returns {boolean} Current status
 */
function isAutoProcessingEnabled() {
    return state.autoProcessEnabled;
}

/**
 * Enable or disable mock data generation
 * @param {boolean} enabled - Whether to generate mock data
 * @returns {boolean} New status
 */
function setMockDataGeneration(enabled) {
    state.generateMockData = enabled;
    logger.info(`Mock data generation ${enabled ? 'enabled' : 'disabled'}`);
    return state.generateMockData;
}

/**
 * Check if mock data generation is enabled
 * @returns {boolean} Current status
 */
function isMockDataGenerationEnabled() {
    return state.generateMockData;
}

/**
 * Manually trigger task queue processing once
 */
async function triggerTaskProcessing() {
    if (typeof window === 'undefined') {
        logger.info('Manually triggering task processing');
        await processTaskQueue();
    }
}

/**
 * Check if browser is ready or initialize it
 * @returns {Promise<boolean>} If browser is ready
 */
async function ensureBrowser() {
    if (!state.initialized && !state.browserInitializing) {
        state.browserInitializing = true;
        logger.info('Initializing browser...');

        await new Promise(resolve => setTimeout(resolve, 2000));

        state.initialized = true;
        state.browserInitializing = false;
        logger.info('Browser initialized');
    }

    while (state.browserInitializing) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return state.initialized;
}

/**
 * Ensure all required columns exist in the database
 */
async function ensureRequiredColumns() {
    try {
        const locationExists = await db.getOne(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='scraping_tasks' AND column_name='location'
            ) as exists
        `);

        if (!locationExists || !locationExists.exists) {
            logger.info('Adding location column to scraping_tasks table');
            await db.query(`ALTER TABLE scraping_tasks ADD COLUMN location VARCHAR(255)`);
        }

        await ensureParamsColumn();

        const limitExists = await db.getOne(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='scraping_tasks' AND column_name='limit'
            ) as exists
        `);

        if (!limitExists || !limitExists.exists) {
            logger.info('Adding limit column to scraping_tasks table');
            await db.query(`ALTER TABLE scraping_tasks ADD COLUMN "limit" INTEGER DEFAULT 100`);
        }

        const keywordsExists = await db.getOne(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='scraping_tasks' AND column_name='keywords'
            ) as exists
        `);

        if (!keywordsExists || !keywordsExists.exists) {
            logger.info('Adding keywords column to scraping_tasks table');
            await db.query(`ALTER TABLE scraping_tasks ADD COLUMN keywords TEXT`);
        }

        const randomCategoryLeadsExists = await db.getOne(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name='random_category_leads'
            ) as exists
        `);

        if (!randomCategoryLeadsExists || !randomCategoryLeadsExists.exists) {
            logger.info('Creating random_category_leads table');
            await db.query(`
                CREATE TABLE random_category_leads (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    address TEXT,
                    city VARCHAR(100),
                    state VARCHAR(100),
                    country VARCHAR(100),
                    postal_code VARCHAR(20),
                    phone VARCHAR(50),
                    email VARCHAR(255),
                    website VARCHAR(255),
                    domain VARCHAR(255),
                    rating NUMERIC(3,1),
                    category VARCHAR(255) NOT NULL,
                    search_term VARCHAR(255) NOT NULL,
                    search_date TIMESTAMP,
                    task_id VARCHAR(36) REFERENCES scraping_tasks(id),
                    business_type VARCHAR(100),
                    owner_name VARCHAR(255),
                    verified BOOLEAN DEFAULT FALSE,
                    contacted BOOLEAN DEFAULT FALSE,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await db.query(`
                CREATE INDEX IF NOT EXISTS idx_random_leads_category ON random_category_leads(category);
                CREATE INDEX IF NOT EXISTS idx_random_leads_task_id ON random_category_leads(task_id);
            `);
        }
    } catch (error) {
        logger.error(`Error ensuring required columns: ${error.message}`);
    }
}

/**
 * Ensure params column exists in the scraping_tasks table
 */
async function ensureParamsColumn() {
    try {
        const columnExists = await db.getOne(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='scraping_tasks' AND column_name='params'
            ) as exists
        `);

        if (!columnExists || !columnExists.exists) {
            logger.info('Adding params column to scraping_tasks table');
            await db.query(`ALTER TABLE scraping_tasks ADD COLUMN params TEXT`);
        }
    } catch (error) {
        logger.error(`Error ensuring params column: ${error.message}`);
    }
}

/**
 * Process next tasks in queue
 */
async function processTaskQueue() {
    try {
        if (state.currentRunningTasks >= state.maxConcurrentTasks) {
            return;
        }

        try {
            await db.init();
            await ensureRequiredColumns();

            const randomCategoryTask = await db.getOne(`
                SELECT
                    id,
                    search_term,
                    params,
                    COALESCE("limit", 100) as "limit",
                    COALESCE(keywords, '') as keywords,
                    COALESCE(location, '') as location
                FROM scraping_tasks
                WHERE status = 'pending' AND params IS NOT NULL AND params::text LIKE '%"useRandomCategories":true%'
                ORDER BY created_at DESC
                LIMIT 1
            `);

            if (randomCategoryTask) {
                state.currentRunningTasks++;

                let params = {
                    limit: randomCategoryTask.limit || 100,
                    keywords: randomCategoryTask.keywords || '',
                    location: randomCategoryTask.location || '',
                };

                try {
                    if (randomCategoryTask.params) {
                        const parsedParams = JSON.parse(randomCategoryTask.params);
                        params = { ...params, ...parsedParams };
                    }
                } catch (e) {
                    logger.warn(`Failed to parse params for task ${randomCategoryTask.id}: ${e.message}`);
                }

                logger.info(`Processing random category task ${randomCategoryTask.id}`);

                await runRandomCategoryTask(randomCategoryTask.id, randomCategoryTask.search_term, params)
                    .catch(error => {
                        logger.error(`Error running random category task ${randomCategoryTask.id}: ${error.message}`);
                    })
                    .finally(() => {
                        state.currentRunningTasks--;
                    });

                return;
            }

            await db.query(`
                DELETE FROM scraping_tasks
                WHERE status = 'pending' AND search_term LIKE 'Digital Marketing Agency%'
            `);

            if (state.autoProcessEnabled) {
                const pendingTasks = await db.getMany(`
                    SELECT
                        id,
                        search_term,
                        params,
                        COALESCE("limit", 100) as "limit",
                        COALESCE(keywords, '') as keywords,
                        COALESCE(location, '') as location
                    FROM scraping_tasks
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT $1
                `, [state.maxConcurrentTasks - state.currentRunningTasks]);

                for (const task of pendingTasks) {
                    state.currentRunningTasks++;

                    let params = {
                        limit: task.limit || 100,
                        keywords: task.keywords || '',
                        location: task.location || '',
                    };

                    if (task.params) {
                        try {
                            const parsedParams = JSON.parse(task.params);
                            params = { ...params, ...parsedParams };
                        } catch (e) {
                            logger.warn(`Failed to parse params for task ${task.id}: ${e.message}`);
                        }
                    }

                    runTask(task.id, task.search_term, params)
                        .catch(error => {
                            logger.error(`Error running task ${task.id}: ${error.message}`);
                        })
                        .finally(() => {
                            state.currentRunningTasks--;
                        });

                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                logger.error(`Database connection error in task queue: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                logger.error(`Error processing task queue: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    } catch (error) {
        logger.error(`Error processing task queue: ${error.message}`);
    }
}

/**
 * Add a scraping task with enhanced parameters
 * @param {Object} params - The scraping parameters
 * @returns {Promise<string>} The task ID
 */
async function addTask(params) {
    try {
        await ensureBrowser();
        await db.init();

        await db.query(`
            DELETE FROM scraping_tasks
            WHERE status = 'pending' AND search_term LIKE 'Digital Marketing Agency%'
        `);

        await ensureRequiredColumns();

        const taskId = uuidv4();

        let searchTerm;
        if (params.useRandomCategories) {
            searchTerm = 'Random Category Search';
        } else {
            searchTerm = params.searchTerm ||
                (params.includeCategories && params.includeCategories.length > 0 ?
                    params.includeCategories[0] : 'business');
        }

        const serializedParams = JSON.stringify(params);

        try {
            await db.query(`
                INSERT INTO scraping_tasks
                (id, search_term, status, created_at, params, location, "limit", keywords)
                VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
            `, [
                taskId,
                searchTerm,
                'pending',
                serializedParams,
                params.location || '',
                params.limit || 100,
                params.keywords || ''
            ]);

            state.tasks.set(taskId, {
                id: taskId,
                searchTerm,
                status: 'pending',
                progress: 0,
                businessesFound: 0,
                startTime: new Date(),
                params
            });

            setTimeout(() => processTaskQueue(), 100);

            return taskId;
        } catch (dbError) {
            logger.error(`Database error in addTask: ${dbError.message}`);

            await db.query(`
                INSERT INTO scraping_tasks
                (id, search_term, status, created_at)
                VALUES ($1, $2, $3, NOW())
            `, [taskId, searchTerm, 'pending']);

            state.tasks.set(taskId, {
                id: taskId,
                searchTerm,
                status: 'pending',
                progress: 0,
                businessesFound: 0,
                startTime: new Date(),
                params
            });

            setTimeout(() => processTaskQueue(), 100);
            return taskId;
        }
    } catch (error) {
        logger.error(`Error adding task: ${error.message}`);
        throw error;
    }
}

/**
 * Update task status in memory and database
 * @param {string} taskId - Task ID
 * @param {string} status - New status
 * @param {number} businessesFound - Number of businesses found
 */
async function updateTaskStatus(taskId, status, businessesFound = 0) {
    try {
        const task = state.tasks.get(taskId);
        if (task) {
            task.status = status;
            if (businessesFound > 0) {
                task.businessesFound = businessesFound;
            }
        }

        if (status === 'completed' || status === 'failed') {
            await db.query(`
                UPDATE scraping_tasks
                SET status = $1, businesses_found = $2, completed_at = NOW()
                WHERE id = $3
            `, [status, businessesFound, taskId]);
        } else {
            await db.query(`
                UPDATE scraping_tasks
                SET status = $1, businesses_found = $2
                WHERE id = $3
            `, [status, businessesFound, taskId]);
        }
    } catch (error) {
        logger.error(`Error updating task status: ${error.message}`);
    }
}

/**
 * Update category progress for a task
 * @param {string} taskId - Task ID
 * @param {number} categoriesCompleted - Number of categories completed
 * @param {number} totalCategories - Total number of categories
 */
async function updateTaskCategoryProgress(taskId, categoriesCompleted, totalCategories) {
    try {
        const task = state.tasks.get(taskId);
        if (task) {
            task.categoriesCompleted = categoriesCompleted;
            task.totalCategories = totalCategories;
        }

        await db.query(`
            UPDATE scraping_tasks
            SET params = jsonb_set(
                CASE
                    WHEN params IS NULL THEN '{}'::jsonb
                    WHEN params::text = '' THEN '{}'::jsonb
                    ELSE params::jsonb
                END,
                '{categoriesCompleted}', $1::jsonb
            )
            WHERE id = $2
        `, [JSON.stringify(categoriesCompleted), taskId]);

        await db.query(`
            UPDATE scraping_tasks
            SET params = jsonb_set(
                CASE
                    WHEN params IS NULL THEN '{}'::jsonb
                    WHEN params::text = '' THEN '{}'::jsonb
                    ELSE params::jsonb
                END,
                '{totalCategories}', $1::jsonb
            )
            WHERE id = $2
        `, [JSON.stringify(totalCategories), taskId]);

    } catch (error) {
        logger.error(`Error updating task category progress: ${error.message}`);
    }
}

/**
 * Get task status
 * @param {string} taskId - Task ID
 * @returns {Promise<Object>} Task status
 */
async function getTaskStatus(taskId) {
    try {
        if (state.tasks.has(taskId)) {
            return state.tasks.get(taskId);
        }

        try {
            const task = await db.getOne(`
                SELECT * FROM scraping_tasks WHERE id = $1
            `, [taskId]);

            if (!task) {
                return {
                    id: taskId,
                    status: 'unknown',
                    error: 'Task not found in database',
                    notFound: true
                };
            }

            return task;
        } catch (dbError) {
            logger.error(`Database error while getting task status: ${dbError.message}`);
            return {
                id: taskId,
                status: 'error',
                error: `Database error: ${dbError.message}`
            };
        }
    } catch (error) {
        logger.error(`Error getting task status: ${error.message}`);
        return {
            id: taskId,
            status: 'error',
            error: error.message
        };
    }
}

/**
 * Get all tasks
 * @returns {Promise<Array>} Array of tasks
 */
async function getAllTasks() {
    try {
        const tasks = await db.getMany(`
            SELECT * FROM scraping_tasks ORDER BY created_at DESC
        `, []);

        return tasks;
    } catch (error) {
        logger.error(`Error getting all tasks: ${error.message}`);
        throw error;
    }
}

/**
 * Run a random category task
 * @param {string} taskId - The task ID
 * @param {string} searchTerm - The search term
 * @param {Object} params - Additional parameters
 */
async function runRandomCategoryTask(taskId, searchTerm, params) {
    try {
        await updateTaskStatus(taskId, 'running');

        const location = params.location || '';
        const selectedRandomCategories = params.selectedRandomCategories || [];

        logger.info(`Random Category Task ${taskId} running for location "${location}"`);
        logger.info(`Processing all ${selectedRandomCategories.length} random categories without limit`);

        if (selectedRandomCategories.length === 0) {
            logger.error(`No random categories selected for task ${taskId}`);
            await updateTaskStatus(taskId, 'failed');
            return;
        }

        await ensureRequiredColumns();

        let totalBusinessesFound = 0;
        let categoriesCompleted = 0;

        for (const category of selectedRandomCategories) {
            const count = await scrapeBusinessesFromGoogleMaps(taskId, category, location);
            if (count) totalBusinessesFound += count;

            categoriesCompleted++;
            await updateTaskCategoryProgress(taskId, categoriesCompleted, selectedRandomCategories.length);

            logger.info(`Completed category "${category}" (${categoriesCompleted}/${selectedRandomCategories.length}), sleeping before next category...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        await updateTaskStatus(taskId, 'completed', totalBusinessesFound);
        logger.info(`Random category task ${taskId} completed with ${totalBusinessesFound} businesses found across ${selectedRandomCategories.length} categories`);

    } catch (error) {
        logger.error(`Error running random category task ${taskId}: ${error.message}`);
        await updateTaskStatus(taskId, 'failed');
    } finally {
        try {
            await googleMapsScraper.close();
        } catch (err) {
            logger.error(`Error closing scraper: ${err.message}`);
        }
    }
}

/**
 * Scrape businesses from Google Maps
 * @param {string} taskId - The task ID
 * @param {string} category - Category to search for
 * @param {string} location - Location to search in
 * @returns {Promise<number>} Number of businesses saved
 */
async function scrapeBusinessesFromGoogleMaps(taskId, category, location) {
    logger.info(`Starting Google Maps scraping for ${category} in ${location}`);

    try {
        if (!googleMapsScraper) {
            logger.error("Google Maps scraper is not available");
            throw new Error("Google Maps scraper is not available");
        }

        const searchQuery = `${category} in ${location}`;

        const options = {
            maxResults: 100,
            taskId: taskId
        };

        try {
            await googleMapsScraper.initialize();
        } catch (initErr) {
            logger.error(`Error initializing Google Maps scraper: ${initErr.message}`);
            throw initErr;
        }

        const businesses = await googleMapsScraper.scrapeBusinesses(searchQuery, options);

        if (!businesses || businesses.length === 0) {
            logger.warn(`No businesses found for ${category} in ${location}`);
            return 0;
        }

        logger.info(`Found ${businesses.length} businesses for ${category} in ${location}`);

        let city = '';
        let stateCode = '';
        if (location.includes(',')) {
            const parts = location.split(',').map(p => p.trim());
            city = parts[0];
            stateCode = parts[1];
        } else {
            city = location;
        }

        let savedCount = 0;
        for (const business of businesses) {
            try {
                const processedBusiness = businessDataService.processBusinessData(business, city, stateCode, category, taskId);
                const saved = await businessDataService.saveScrapedBusiness(processedBusiness, taskId);
                if (saved) {
                    savedCount++;
                }
            } catch (error) {
                logger.error(`Error saving business data: ${error.message}`);
            }
        }

        logger.info(`Saved ${savedCount} businesses from ${location}`);
        return savedCount;
    } catch (error) {
        logger.error(`Error in Google Maps scraping for ${category} in ${location}: ${error.message}`);
        throw error;
    }
}

/**
 * Run a regular scraping task
 * @param {string} taskId - The task ID
 * @param {string} searchTerm - The search term
 * @param {Object} params - Additional parameters
 */
async function runTask(taskId, searchTerm, params = {}) {
    try {
        await updateTaskStatus(taskId, 'running');

        const location = params.location || '';
        const limit = params.limit || 100;
        const keywords = params.keywords || '';

        const useRandomCategories = params.useRandomCategories || false;
        if (useRandomCategories) {
            return runRandomCategoryTask(taskId, searchTerm, params);
        }

        logger.info(`Regular task ${taskId} running for "${searchTerm}" in ${location}`);
        logger.info(`Task parameters: limit=${limit}, keywords=${keywords}`);

        logger.info(`Task ${taskId}: No mock data will be generated for regular task`);
        await updateTaskStatus(taskId, 'completed', 0);
    } catch (error) {
        logger.error(`Error running task ${taskId}: ${error.message}`);
        await updateTaskStatus(taskId, 'failed');
    }
}

/**
 * Remove all mock business entries from the database
 * @returns {Promise<number>} Number of entries removed
 */
async function clearMockBusinesses() {
    try {
        logger.info('Removing mock business entries from database');

        const result = await db.query(`
            DELETE FROM business_listings
            WHERE name LIKE '%Business %'
            RETURNING id
        `);

        const count = result.rowCount;
        logger.info(`Removed ${count} mock business entries`);

        return count;
    } catch (error) {
        logger.error(`Error clearing mock businesses: ${error.message}`);
        throw error;
    }
}

// Create the service object
const taskService = {
    state,
    setAutoProcessing,
    isAutoProcessingEnabled,
    setMockDataGeneration,
    isMockDataGenerationEnabled,
    triggerTaskProcessing,
    ensureBrowser,
    ensureRequiredColumns,
    processTaskQueue,
    addTask,
    updateTaskStatus,
    updateTaskCategoryProgress,
    getTaskStatus,
    getAllTasks,
    runRandomCategoryTask,
    scrapeBusinessesFromGoogleMaps,
    runTask,
    clearMockBusinesses
};

export default taskService;
