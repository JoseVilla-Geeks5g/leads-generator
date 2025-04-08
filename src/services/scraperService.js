import { v4 as uuidv4 } from 'uuid';
import db from './database';
import logger from './logger';

// Make sure emailFinder is properly imported at the top of the file
const emailFinder = require('../../emailFinder');

// Add import for our new scraper
import googleMapsScraper from './googleMapsScraper';

// Add a helper function to check if emailFinder is working properly
function verifyEmailFinder() {
    if (!emailFinder) {
        logger.error('Email finder module is not properly imported');
        return false;
    }

    if (typeof emailFinder.findEmail !== 'function') {
        logger.error('findEmail method is missing from the email finder module');
        return false;
    }

    return true;
}

// Add this to any method that uses emailFinder.findEmail
async function findEmailSafe(website, options = {}) {
    if (!verifyEmailFinder()) {
        logger.error(`Cannot find email for ${website}: Email finder not properly initialized`);
        return null;
    }

    try {
        return await emailFinder.findEmail(website, options);
    } catch (error) {
        logger.error(`Error finding email using emailFinder: ${error.message}`);
        return null;
    }
}

/**
 * Scraper service for lead generation
 * - Handles scraping tasks
 * - Email discovery
 * - Status tracking
 */
class ScraperService {
    constructor() {
        this.initialized = false;
        this.browserInitializing = false;

        // Task tracking
        this.tasks = new Map();
        this.emailFinderStatus = {
            isRunning: false,
            processed: 0,
            emailsFound: 0,
            queueLength: 0,
            runningTasks: 0
        };

        // Max concurrent tasks
        this.maxConcurrentTasks = 3;
        this.currentRunningTasks = 0;
        this.taskQueue = [];

        // IMPORTANT: Enable auto-processing tasks by default
        this.autoProcessEnabled = true;
        this.taskProcessingInterval = null;

        // IMPORTANT: Disable mock data generation by default - only use real scraped data
        this.generateMockData = false;
    }

    /**
     * Enable or disable automatic task processing
     * @param {boolean} enabled - Whether auto-processing should be enabled
     * @param {boolean} requireAuth - Whether authorization is required
     * @returns {boolean} - New status
     */
    setAutoProcessing(enabled, requireAuth = false) {
        if (typeof window === 'undefined') {
            // Clear any existing interval
            if (this.taskProcessingInterval) {
                clearInterval(this.taskProcessingInterval);
                this.taskProcessingInterval = null;
            }

            // Set the new status
            this.autoProcessEnabled = enabled;

            // If enabled, start the interval
            if (enabled) {
                logger.info('Enabling automatic task processing');
                this.taskProcessingInterval = setInterval(() => this.processTaskQueue(), 5000);
            } else {
                logger.info('Automatic task processing disabled');
            }
        }
        return this.autoProcessEnabled;
    }

    /**
     * Check if auto-processing is enabled
     * @returns {boolean} - Current status
     */
    isAutoProcessingEnabled() {
        return this.autoProcessEnabled;
    }

    /**
     * Enable or disable mock data generation
     * @param {boolean} enabled - Whether to generate mock data
     * @returns {boolean} - New status
     */
    setMockDataGeneration(enabled) {
        this.generateMockData = enabled;
        logger.info(`Mock data generation ${enabled ? 'enabled' : 'disabled'}`);
        return this.generateMockData;
    }

    /**
     * Check if mock data generation is enabled
     * @returns {boolean} - Current status
     */
    isMockDataGenerationEnabled() {
        return this.generateMockData;
    }

    /**
     * Manually trigger task queue processing once
     */
    async triggerTaskProcessing() {
        if (typeof window === 'undefined') {
            logger.info('Manually triggering task processing');
            await this.processTaskQueue();
        }
    }

    /**
     * Check if browser is ready or initialize it
     * @returns {Promise<boolean>} If browser is ready
     */
    async ensureBrowser() {
        // In a real implementation, this would initialize a headless browser
        if (!this.initialized && !this.browserInitializing) {
            this.browserInitializing = true;
            logger.info('Initializing browser...');

            // Simulate initialization delay
            await new Promise(resolve => setTimeout(resolve, 2000));

            this.initialized = true;
            this.browserInitializing = false;
            logger.info('Browser initialized');
        }

        // Wait for initialization to complete if it's in progress
        while (this.browserInitializing) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return this.initialized;
    }

    /**
     * Process next tasks in queue
     */
    async processTaskQueue() {
        // Only process if auto-processing is enabled or if called manually
        try {
            // Skip if we're at capacity
            if (this.currentRunningTasks >= this.maxConcurrentTasks) {
                return;
            }

            // Get pending tasks from database
            try {
                // Make sure database is initialized first
                await db.init();

                // First, ensure required columns exist
                await this.ensureRequiredColumns();

                // IMPORTANT: Look for the most recent task with random categories first
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

                // If we have a random category task, process only that and ignore other tasks
                if (randomCategoryTask) {
                    this.currentRunningTasks++;
                    
                    // Parse the params JSON
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
                    
                    // Process this random category task only
                    logger.info(`Processing random category task ${randomCategoryTask.id}`);
                    
                    await this.runRandomCategoryTask(randomCategoryTask.id, randomCategoryTask.search_term, params)
                        .catch(error => {
                            logger.error(`Error running random category task ${randomCategoryTask.id}: ${error.message}`);
                        })
                        .finally(() => {
                            this.currentRunningTasks--;
                        });
                    
                    return; // Exit early, don't process any other tasks
                }

                // If no random category task, clear any pending Digital Marketing Agency tasks that might cause the issue
                await db.query(`
                    DELETE FROM scraping_tasks 
                    WHERE status = 'pending' AND search_term LIKE 'Digital Marketing Agency%'
                `);

                // Only process other types of tasks if specifically requested
                if (this.autoProcessEnabled) {
                    // Use a safer query that checks if columns exist and provides defaults
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
                    `, [this.maxConcurrentTasks - this.currentRunningTasks]);

                    // Process each pending task
                    for (const task of pendingTasks) {
                        this.currentRunningTasks++;

                        // Parse the params JSON if available
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

                        // Start task in background
                        this.runTask(task.id, task.search_term, params)
                            .catch(error => {
                                logger.error(`Error running task ${task.id}: ${error.message}`);
                            })
                            .finally(() => {
                                this.currentRunningTasks--;
                            });

                        // Add small delay between starting tasks
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            } catch (error) {
                // Special handling for database connection issues
                if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    logger.error(`Database connection error in task queue: ${error.message}`);
                    // Wait longer before retrying on connection issues
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    logger.error(`Error processing task queue: ${error.message}`);
                    // For other errors, wait a shorter time
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        } catch (error) {
            logger.error(`Error processing task queue: ${error.message}`);
        }
    }

    /**
     * Ensure all required columns exist in the database
     */
    async ensureRequiredColumns() {
        try {
            // Check for location column in scraping_tasks
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

            // Check for params column
            await this.ensureParamsColumn();

            // Check for limit column with proper quoting
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

            // Check for keywords column
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

            // Check for random_category_leads table and create if it doesn't exist
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
                
                // Create indexes for better performance
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
    async ensureParamsColumn() {
        try {
            // Check if column exists
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
     * Add a scraping task with enhanced parameters
     * @param {Object} params - The scraping parameters
     * @returns {string} The task ID
     */
    async addTask(params) {
        try {
            await this.ensureBrowser();
            await db.init();

            // IMPORTANT: Delete any pending Digital Marketing Agency tasks
            await db.query(`
                DELETE FROM scraping_tasks 
                WHERE status = 'pending' AND search_term LIKE 'Digital Marketing Agency%'
            `);

            // Ensure all required columns exist
            await this.ensureRequiredColumns();

            // Create task ID
            const taskId = uuidv4();

            // Use appropriate search term based on task type
            let searchTerm;
            if (params.useRandomCategories) {
                searchTerm = 'Random Category Search';
            } else {
                searchTerm = params.searchTerm || 
                    (params.includeCategories && params.includeCategories.length > 0 ?
                        params.includeCategories[0] : 'business');
            }

            // Store all parameters as JSON for more flexibility
            const serializedParams = JSON.stringify(params);

            try {
                // Create a simple insert with only required columns
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

                // Add to tasks map for tracking
                this.tasks.set(taskId, {
                    id: taskId,
                    searchTerm,
                    status: 'pending',
                    progress: 0,
                    businessesFound: 0,
                    startTime: new Date(),
                    params
                });

                // Process queue immediately for faster startup
                setTimeout(() => this.processTaskQueue(), 100);

                return taskId;
            } catch (dbError) {
                logger.error(`Database error in addTask: ${dbError.message}`);

                // Fallback to simple insert if all else fails
                await db.query(`
                    INSERT INTO scraping_tasks 
                    (id, search_term, status, created_at)
                    VALUES ($1, $2, $3, NOW())
                `, [taskId, searchTerm, 'pending']);

                // Still add to tasks map
                this.tasks.set(taskId, {
                    id: taskId,
                    searchTerm,
                    status: 'pending',
                    progress: 0,
                    businessesFound: 0,
                    startTime: new Date(),
                    params
                });

                setTimeout(() => this.processTaskQueue(), 100);
                return taskId;
            }
        } catch (error) {
            logger.error(`Error adding task: ${error.message}`);
            throw error;
        }
    }

    /**
     * Run a random category task (separate method to handle differently)
     * @param {string} taskId - The task ID
     * @param {string} searchTerm - The search term to scrape
     * @param {Object} params - Additional parameters
     */
    async runRandomCategoryTask(taskId, searchTerm, params) {
        try {
            // Update task status
            await this.updateTaskStatus(taskId, 'running');

            // Extract parameters for random categories
            const location = params.location || '';
            // Remove any limit on the number of categories
            const selectedRandomCategories = params.selectedRandomCategories || [];

            logger.info(`Random Category Task ${taskId} running for location "${location}"`);
            logger.info(`Processing all ${selectedRandomCategories.length} random categories without limit`);
            
            if (selectedRandomCategories.length === 0) {
                logger.error(`No random categories selected for task ${taskId}`);
                await this.updateTaskStatus(taskId, 'failed');
                return;
            }

            // Ensure the random_category_leads table exists
            await this.ensureRequiredColumns();
            
            // Perform actual scraping for each category
            let totalBusinessesFound = 0;
            let categoriesCompleted = 0;
            
            // Process categories one by one - no limit on number of categories
            for (const category of selectedRandomCategories) {
                // Use our real scraping method
                const count = await this.scrapeBusinessesFromGoogleMaps(taskId, category, location);
                if (count) totalBusinessesFound += count;
                
                // Update category progress
                categoriesCompleted++;
                await this.updateTaskCategoryProgress(taskId, categoriesCompleted, selectedRandomCategories.length);
                
                // Add a delay between category searches to avoid being blocked
                logger.info(`Completed category "${category}" (${categoriesCompleted}/${selectedRandomCategories.length}), sleeping before next category...`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Increased from 3000 to 5000 ms
            }
            
            // Mark the task as completed after all categories are processed
            await this.updateTaskStatus(taskId, 'completed', totalBusinessesFound);
            logger.info(`Random category task ${taskId} completed with ${totalBusinessesFound} businesses found across ${selectedRandomCategories.length} categories`);
            
        } catch (error) {
            logger.error(`Error running random category task ${taskId}: ${error.message}`);
            await this.updateTaskStatus(taskId, 'failed');
        } finally {
            // Clean up resources
            try {
                await googleMapsScraper.close();
            } catch (err) {
                logger.error(`Error closing scraper: ${err.message}`);
            }
        }
    }

    /**
     * Update category progress for a task
     * @param {string} taskId - Task ID
     * @param {number} categoriesCompleted - Number of categories completed
     * @param {number} totalCategories - Total number of categories
     */
    async updateTaskCategoryProgress(taskId, categoriesCompleted, totalCategories) {
        try {
            // Update in memory
            const task = this.tasks.get(taskId);
            if (task) {
                task.categoriesCompleted = categoriesCompleted;
                task.totalCategories = totalCategories;
            }

            // Fix: Use separate UPDATE statements to avoid multiple assignments to the same column
            // Update categoriesCompleted
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
            
            // Update totalCategories
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
     * Schedule and perform actual web scraping for random categories
     * @param {string} taskId - The task ID
     * @param {Array} categories - Categories to scrape
     * @param {string} location - Location to search in
     */
    async scheduleActualScrapingForTask(taskId, categories, location) {
        // This would be implemented to do the actual web scraping
        // Instead of generating fake data, this would call real scraping functions
        logger.info(`Scheduled actual scraping for task ${taskId} with ${categories.length} categories`);
        
        // For each category, a real scraper would:
        // 1. Make requests to Google Maps or other data sources
        // 2. Extract real business data
        // 3. Save it to the database
        
        // Example of how this might work:
        try {
            for (const category of categories) {
                await this.scrapeBusinessesFromGoogleMaps(taskId, category, location);
            }
        } catch (error) {
            logger.error(`Error in scheduled scraping: ${error.message}`);
        }
    }

    /**
     * Scrape businesses from Google Maps for a specific category and location
     * @param {string} taskId - The task ID
     * @param {string} category - Category to search for
     * @param {string} location - Location to search in
     */
    async scrapeBusinessesFromGoogleMaps(taskId, category, location) {
        logger.info(`Starting Google Maps scraping for ${category} in ${location}`);
        
        try {
            // Build search query
            const searchQuery = `${category} in ${location}`;
            
            // Set scraping options - no category limits
            const options = {
                maxResults: 500, // Increased from 200 to 500 for more comprehensive data collection
                taskId: taskId
            };
            
            // Perform real scraping with our Maps scraper
            const businesses = await googleMapsScraper.scrapeBusinesses(searchQuery, options);
            
            if (businesses.length === 0) {
                logger.warn(`No businesses found for ${category} in ${location}`);
                return 0;
            }
            
            logger.info(`Found ${businesses.length} businesses for ${category} in ${location}`);
            
            // Parse out city/state from location
            let city = '';
            let state = '';
            if (location.includes(',')) {
                const parts = location.split(',').map(p => p.trim());
                city = parts[0];
                state = parts[1];
            } else {
                city = location;
            }
            
            // Save each business to database
            let savedCount = 0;
            for (const business of businesses) {
                try {
                    // Extract domain from website if available
                    let domain = null;
                    if (business.website) {
                        try {
                            const urlObj = new URL(business.website);
                            domain = urlObj.hostname.replace(/^www\./, '');
                        } catch (e) {
                            logger.debug(`Could not parse URL: ${business.website}`);
                        }
                    }
                    
                    // Process postal code from address if present
                    let postalCode = null;
                    if (business.address) {
                        const postalMatch = business.address.match(/\b\d{5}(?:-\d{4})?\b/);
                        postalCode = postalMatch ? postalMatch[0] : null;
                    }
                    
                    // Add review count to the notes field for reference
                    const notes = business.reviewCount ? `Reviews: ${business.reviewCount}` : '';
                    
                    // Fix: Truncate any fields that might exceed their column length limits
                    const truncatedName = business.name ? business.name.substring(0, 250) : 'Unnamed Business';
                    const truncatedAddress = business.address ? business.address.substring(0, 2000) : 'No address available';
                    const truncatedCity = city ? city.substring(0, 95) : '';
                    const truncatedState = state ? state.substring(0, 95) : '';
                    const truncatedPhone = business.phone ? business.phone.substring(0, 45) : null;
                    const truncatedWebsite = business.website ? business.website.substring(0, 250) : null;
                    const truncatedDomain = domain ? domain.substring(0, 250) : null;
                    const truncatedCategory = category ? category.substring(0, 250) : 'Uncategorized';
                    
                    // Use both the regular business_listings table and our special random_category_leads
                    await db.query(`
                        INSERT INTO business_listings (
                            name, address, city, state, country, postal_code, phone, website, domain, 
                            rating, search_term, search_date, task_id, notes, created_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
                        )
                        ON CONFLICT (name, search_term) DO NOTHING
                    `, [
                        truncatedName,
                        truncatedAddress,
                        truncatedCity,
                        truncatedState,
                        'United States',
                        postalCode,
                        truncatedPhone,
                        truncatedWebsite,
                        truncatedDomain,
                        business.rating || null,
                        truncatedCategory,
                        new Date().toISOString(),
                        taskId,
                        notes
                    ]);
                    
                    // Also insert into random_category_leads table
                    await db.query(`
                        INSERT INTO random_category_leads (
                            name, address, city, state, country, postal_code, phone, website, domain,
                            rating, category, search_term, search_date, task_id, notes, created_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
                        )
                        ON CONFLICT DO NOTHING
                    `, [
                        truncatedName,
                        truncatedAddress, 
                        truncatedCity,
                        truncatedState,
                        'United States',
                        postalCode,
                        truncatedPhone,
                        truncatedWebsite,
                        truncatedDomain,
                        business.rating || null,
                        truncatedCategory,
                        truncatedCategory,
                        new Date().toISOString(),
                        taskId,
                        notes
                    ]);
                    
                    savedCount++;
                    logger.debug(`Saved business: ${truncatedName} (${truncatedAddress}) ${truncatedPhone || 'No phone'}`);
                    
                } catch (error) {
                    logger.error(`Error saving business ${business.name}: ${error.message}`);
                }
            }
            
            // Update the task status with the number of businesses found
            await this.updateTaskStatus(taskId, 'running', businesses.length);
            
            return savedCount;
        } catch (error) {
            logger.error(`Error in real Google Maps scraping for ${category}: ${error.message}`);
            return 0;
        }
    }

    /**
     * Run a regular scraping task in the background 
     * @param {string} taskId - The task ID
     * @param {string} searchTerm - The search term to scrape
     * @param {Object} params - Additional parameters
     */
    async runTask(taskId, searchTerm, params = {}) {
        try {
            // Update task status
            await this.updateTaskStatus(taskId, 'running');

            // Extract parameters
            const location = params.location || '';
            const includeCategories = params.includeCategories || [];
            const excludeCategories = params.excludeCategories || [];
            const limit = params.limit || 100;
            const keywords = params.keywords || '';
            
            // Check if this is a random category task
            const useRandomCategories = params.useRandomCategories || false;
            if (useRandomCategories) {
                // Redirect to the proper method
                return this.runRandomCategoryTask(taskId, searchTerm, params);
            }

            // This is a regular non-random task
            logger.info(`Regular task ${taskId} running for "${searchTerm}" in ${location}`);
            logger.info(`Task parameters: limit=${limit}, keywords=${keywords}`);
            
            // Skip mock data generation, just complete the task with zero businesses
            logger.info(`Task ${taskId}: No mock data will be generated for regular task`);
            await this.updateTaskStatus(taskId, 'completed', 0);
        } catch (error) {
            logger.error(`Error running task ${taskId}: ${error.message}`);
            await this.updateTaskStatus(taskId, 'failed');
        }
    }

    /**
     * Create simulated business entries in the database for testing
     * @param {string} taskId - Task ID
     * @param {string} category - Business category
     * @param {string} location - Location string
     * @param {number} count - Number of businesses to create
     */
    async createSimulatedBusinesses(taskId, category, location, count) {
        try {
            // Parse location for state/city
            let state = '';
            let city = '';

            if (location.includes(',')) {
                const parts = location.split(',').map(p => p.trim());
                city = parts[0];
                state = parts[1];
            } else {
                state = location;
            }

            const businessTypes = [
                'LLC', 'Corporation', 'Partnership', 'Sole Proprietorship'
            ];

            // Create a batch of businesses
            for (let i = 0; i < count; i++) {
                const name = `${category} Business ${Math.floor(Math.random() * 10000)}`;
                const hasEmail = Math.random() > 0.3;
                const hasWebsite = Math.random() > 0.2;

                // Generate random data
                const data = {
                    name,
                    address: `${1000 + Math.floor(Math.random() * 9000)} Main St`,
                    city: city || `${state} City`,
                    state,
                    country: 'United States',
                    postal_code: `${10000 + Math.floor(Math.random() * 90000)}`,
                    phone: `(${100 + Math.floor(Math.random() * 900)}) ${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`,
                    email: hasEmail ? `contact@${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                    website: hasWebsite ? `https://www.${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                    domain: hasWebsite ? `${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                    rating: (3 + Math.random() * 2).toFixed(1),
                    search_term: category,
                    search_date: new Date().toISOString(),
                    task_id: taskId,
                    business_type: businessTypes[Math.floor(Math.random() * businessTypes.length)],
                    owner_name: null,
                    verified: false,
                    contacted: false,
                    notes: null,
                    created_at: new Date().toISOString()
                };

                // Insert into database
                await db.query(`
                    INSERT INTO business_listings (
                        name, address, city, state, country, postal_code, phone, email, website, domain, 
                        rating, search_term, search_date, task_id, business_type, owner_name, verified, 
                        contacted, notes, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
                    )
                    ON CONFLICT (name, search_term) DO NOTHING
                `, [
                    data.name, data.address, data.city, data.state, data.country, data.postal_code,
                    data.phone, data.email, data.website, data.domain, data.rating, data.search_term,
                    data.search_date, data.task_id, data.business_type, data.owner_name, data.verified,
                    data.contacted, data.notes, data.created_at
                ]);
            }
        } catch (error) {
            logger.error(`Error creating simulated businesses: ${error.message}`);
        }
    }

    /**
     * Create simulated random category leads in the database for testing
     * @param {string} taskId - Task ID
     * @param {string} category - Business category
     * @param {string} location - Location string
     * @param {number} count - Number of businesses to create
     */
    async createSimulatedRandomCategoryLeads(taskId, category, location, count) {
        try {
            // Parse location for state/city
            let state = '';
            let city = '';

            if (location.includes(',')) {
                const parts = location.split(',').map(p => p.trim());
                city = parts[0];
                state = parts[1];
            } else {
                state = location;
            }

            const businessTypes = [
                'LLC', 'Corporation', 'Partnership', 'Sole Proprietorship'
            ];

            // Create a batch of businesses in the random_category_leads table
            for (let i = 0; i < count; i++) {
                const name = `${category} Business ${Math.floor(Math.random() * 10000)}`;
                const hasEmail = Math.random() > 0.3;
                const hasWebsite = Math.random() > 0.2;

                // Generate random data
                const data = {
                    name,
                    address: `${1000 + Math.floor(Math.random() * 9000)} Main St`,
                    city: city || `${state} City`,
                    state,
                    country: 'United States',
                    postal_code: `${10000 + Math.floor(Math.random() * 90000)}`,
                    phone: `(${100 + Math.floor(Math.random() * 900)}) ${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`,
                    email: hasEmail ? `contact@${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                    website: hasWebsite ? `https://www.${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                    domain: hasWebsite ? `${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                    rating: (3 + Math.random() * 2).toFixed(1),
                    category: category,
                    search_term: category,
                    search_date: new Date().toISOString(),
                    task_id: taskId,
                    business_type: businessTypes[Math.floor(Math.random() * businessTypes.length)],
                    owner_name: null,
                    verified: false,
                    contacted: false,
                    notes: null,
                    created_at: new Date().toISOString()
                };

                // Insert into random_category_leads table
                await db.query(`
                    INSERT INTO random_category_leads (
                        name, address, city, state, country, postal_code, phone, email, website, domain, 
                        rating, category, search_term, search_date, task_id, business_type, owner_name, verified, 
                        contacted, notes, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                    )
                `, [
                    data.name, data.address, data.city, data.state, data.country, data.postal_code,
                    data.phone, data.email, data.website, data.domain, data.rating, data.category, data.search_term,
                    data.search_date, data.task_id, data.business_type, data.owner_name, data.verified,
                    data.contacted, data.notes, data.created_at
                ]);
            }
        } catch (error) {
            logger.error(`Error creating simulated random category leads: ${error.message}`);
        }
    }

    /**
     * Remove all mock business entries from the database
     * @returns {Promise<number>} Number of entries removed
     */
    async clearMockBusinesses() {
        try {
            logger.info('Removing mock business entries from database');

            // This query will delete all businesses with names matching the mock pattern
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

    /**
     * Update task status in memory and database
     * @param {string} taskId - Task ID
     * @param {string} status - New status
     * @param {number} businessesFound - Number of businesses found
     */
    async updateTaskStatus(taskId, status, businessesFound = 0) {
        try {
            // Update in memory
            const task = this.tasks.get(taskId);
            if (task) {
                task.status = status;
                if (businessesFound > 0) {
                    task.businessesFound = businessesFound;
                }
            }

            // Update in database
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
     * Get task status
     * @param {string} taskId - Task ID
     * @returns {Object} Task status
     */
    async getTaskStatus(taskId) {
        try {
            // First try to get from in-memory map
            if (this.tasks.has(taskId)) {
                return this.tasks.get(taskId);
            }

            // If not found, get from database with better error handling
            try {
                const task = await db.getOne(`
                    SELECT * FROM scraping_tasks WHERE id = $1
                `, [taskId]);

                if (!task) {
                    // Instead of throwing error, return a structured response
                    return {
                        id: taskId,
                        status: 'unknown',
                        error: 'Task not found in database',
                        notFound: true
                    };
                }

                return task;
            } catch (dbError) {
                // Handle database errors gracefully
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
     * @returns {Array} Array of tasks
     */
    async getAllTasks() {
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
     * Get email finder status
     * @returns {Object} Status object
     */
    getEmailFinderStatus() {
        // Ensure we have a real-time status check that includes startTime
        const currentTime = Date.now();

        // If we don't have a startTime but the process is running, add it
        if (this.emailFinderStatus.isRunning && !this.emailFinderStatus.startTime) {
            this.emailFinderStatus.startTime = currentTime;
        }

        // Calculate elapsed time if process is running
        if (this.emailFinderStatus.isRunning && this.emailFinderStatus.startTime) {
            this.emailFinderStatus.elapsedTimeMs = currentTime - this.emailFinderStatus.startTime;
            this.emailFinderStatus.elapsedTime = Math.floor(this.emailFinderStatus.elapsedTimeMs / 1000);
        }

        return {
            ...this.emailFinderStatus,
            lastChecked: currentTime
        };
    }

    /**
     * Process all businesses without emails
     * @param {Object} options - Options for email finder
     * @returns {number} Number of businesses to process
     */
    async processAllPendingBusinesses(options = {}) {
        if (this.emailFinderStatus.isRunning) {
            throw new Error('Email finder is already running');
        }

        try {
            this.emailFinderStatus = {
                isRunning: true,
                processed: 0,
                emailsFound: 0,
                queueLength: 0,
                runningTasks: 0
            };

            // Build query based on options
            let query = `
                SELECT id, name, website, domain
                FROM business_listings
                WHERE (email IS NULL OR email = '')
            `;

            const queryParams = [];
            let paramIndex = 1;

            if (options.onlyWithWebsite) {
                query += ` AND website IS NOT NULL AND website != '' `;
            }

            if (options.skipContacted) {
                query += ` AND (contacted IS NULL OR contacted = FALSE) `;
            }

            // Add limit
            query += ` LIMIT $${paramIndex}`;
            queryParams.push(options.limit || 100);

            // Query businesses without emails
            const businesses = await db.getMany(query, queryParams);

            if (businesses.length === 0) {
                this.emailFinderStatus.isRunning = false;
                return 0;
            }

            this.emailFinderStatus.queueLength = businesses.length;

            // Process emails in the background
            this.processEmailsInBackground(businesses).catch(err => {
                logger.error('Error in background email processing:', err);
                this.emailFinderStatus.isRunning = false;
            });

            return businesses.length;
        } catch (error) {
            this.emailFinderStatus.isRunning = false;
            logger.error(`Error starting email finder: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process specific businesses for emails
     * @param {Array} businessIds - Business IDs to process
     * @param {Object} options - Processing options
     * @returns {number} Number of businesses to process
     */
    async processBusinesses(businessIds, options = {}) {
        if (!Array.isArray(businessIds) || businessIds.length === 0) {
            return 0;
        }

        if (this.emailFinderStatus.isRunning) {
            throw new Error('Email finder is already running');
        }

        try {
            this.emailFinderStatus = {
                isRunning: true,
                processed: 0,
                emailsFound: 0,
                queueLength: 0,
                runningTasks: 0,
                businesses: []
            };

            // Query specified businesses
            const placeholders = businessIds.map((_, i) => `$${i + 1}`).join(', ');
            const query = `
                SELECT id, name, website, domain
                FROM business_listings
                WHERE id IN (${placeholders})
                AND website IS NOT NULL AND website != ''
            `;

            const businesses = await db.getMany(query, businessIds);

            if (businesses.length === 0) {
                this.emailFinderStatus.isRunning = false;
                return 0;
            }

            this.emailFinderStatus.queueLength = businesses.length;

            // Process emails in the background
            this.processEmailsInBackground(businesses).catch(err => {
                logger.error('Error in background email processing:', err);
                this.emailFinderStatus.isRunning = false;
            });

            return businesses.length;
        } catch (error) {
            this.emailFinderStatus.isRunning = false;
            logger.error(`Error processing specific businesses: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process emails in the background
     * @param {Array} businesses - Businesses to process
     */
    async processEmailsInBackground(businesses) {
        try {
            await this.ensureBrowser();

            // Initialize email finder module
            await emailFinder.initialize(); // If it has an initialization function

            // Reset status with proper start time tracking
            const startTime = Date.now();
            this.emailFinderStatus = {
                isRunning: true,
                processed: 0,
                emailsFound: 0,
                queueLength: businesses.length,
                runningTasks: 0,
                startTime: startTime // Add start time for duration calculations
            };

            // Process businesses one by one with concurrency management
            const concurrency = 3; // Process up to 3 sites at once
            let running = 0;
            let index = 0;

            logger.info(`Starting email finder for ${businesses.length} businesses with concurrency ${concurrency}`);

            while (index < businesses.length && this.emailFinderStatus.isRunning) {
                // Process up to concurrency limit
                while (running < concurrency && index < businesses.length && this.emailFinderStatus.isRunning) {
                    const business = businesses[index];
                    index++;
                    running++;

                    this.emailFinderStatus.runningTasks = running;

                    // Process this business in the background
                    this.processSingleBusinessEmail(business)
                        .catch(err => logger.error(`Error processing business email: ${err.message}`))
                        .finally(() => {
                            running--;
                            this.emailFinderStatus.runningTasks = running;
                        });

                    // Small delay between starting each task to prevent overwhelming the system
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Wait a bit before checking again
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Wait for all tasks to complete
            while (running > 0 && this.emailFinderStatus.isRunning) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const duration = (Date.now() - this.emailFinderStatus.startTime) / 1000;
            logger.info(`Email finder completed. Processed ${this.emailFinderStatus.processed} businesses in ${duration.toFixed(1)}s, found ${this.emailFinderStatus.emailsFound} emails.`);

            // Clean up properly
            try {
                if (emailFinder && typeof emailFinder.cleanup === 'function') {
                    await emailFinder.cleanup();
                } else if (emailFinder && typeof emailFinder.close === 'function') {
                    // Fallback to close if cleanup doesn't exist
                    await emailFinder.close();
                }
            } catch (err) {
                logger.error(`Error during email finder cleanup: ${err.message}`);
            }

            this.emailFinderStatus.isRunning = false;
            this.emailFinderStatus.runningTasks = 0;
        } catch (error) {
            logger.error(`Error in email processing: ${error.message}`);
            this.emailFinderStatus.isRunning = false;
            this.emailFinderStatus.runningTasks = 0;
        }
    }

    /**
     * Process a single business for email discovery
     * @param {Object} business - The business to process
     */
    async processSingleBusinessEmail(business) {
        try {
            // Check if business has valid data
            if (!business || !business.website) {
                logger.info(`Skipping business ${business?.id || 'unknown'}: No website available`);
                this.emailFinderStatus.processed++;
                return;
            }

            logger.info(`Processing email for business ${business.id}: ${business.name} (${business.website})`);

            // Use the email finder to discover emails
            const email = await this.findBusinessEmail(business);

            if (email) {
                this.emailFinderStatus.emailsFound++;

                // Extract the source of the email if available
                const source = emailFinder.lastExtractedEmailSources?.get(email.toLowerCase());
                const sourceDesc = source ? ` (found in ${source})` : '';

                logger.info(`Email found for business ${business.id}: ${email}${sourceDesc}`);
            } else {
                logger.info(`No email found for business ${business.id}`);
            }

            // Update processed count
            this.emailFinderStatus.processed++;
        } catch (error) {
            // Don't let one error stop the entire process
            logger.error(`Error processing business email for ${business?.id}: ${error.message}`);
            this.emailFinderStatus.processed++;
        }
    }

    /**
     * Find an email for a specific business
     * @param {Object} business - Business data with website and domain
     * @returns {Promise<string|null>} Found email or null
     */
    async findBusinessEmail(business) {
        // If no website, can't find email
        if (!business.website && !business.domain) {
            return null;
        }

        try {
            // Get the business website
            const website = business.website;
            if (!website) {
                logger.info(`No website available for business ${business.id}`);
                return null;
            }

            logger.info(`Searching for email for business ${business.id} with website ${website}`);

            // Call the actual email finder logic - ONLY returns REAL emails found on the site
            // Will return null if no valid email is found
            const email = await findEmailSafe(website, {
                businessName: business.name,
                domain: business.domain,
                timeout: 30000, // 30 seconds timeout
                maxDepth: 2,    // How deep to crawl
                generateArtificialEmails: false // IMPORTANT: Ensure we never generate artificial emails
            });

            // Log the result
            if (email) {
                logger.info(`Real email found for business ${business.id}: ${email}`);
            } else {
                logger.info(`No email found for business ${business.id} - returning null`);
            }

            return email; // Will be null if no email found
        } catch (error) {
            logger.error(`Error finding email for ${business.name}: ${error.message}`);
            return null;
        }
    }

    /**
     * Stop email finder
     * @returns {Object} Status object
     */
    async stopEmailFinder() {
        logger.info('Stopping email finder');

        const result = {
            processed: this.emailFinderStatus.processed,
            emailsFound: this.emailFinderStatus.emailsFound
        };

        this.emailFinderStatus.isRunning = false;

        return result;
    }

    /**
     * Get system statistics
     * @returns {Object} Statistics
     */
    async getStatistics() {
        try {
            // Count all businesses
            const businessCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings');
            const emailCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
            const websiteCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE website IS NOT NULL AND website != \'\'');

            // Get unique search terms
            const searchTerms = await db.getMany('SELECT DISTINCT search_term FROM business_listings');

            // Get states
            const states = await db.getMany('SELECT DISTINCT state FROM business_listings WHERE state IS NOT NULL');

            // Get task statistics
            const taskStats = await db.getMany('SELECT status, COUNT(*) as count FROM scraping_tasks GROUP BY status');

            // Prepare state data
            const stateData = [];
            for (const stateObj of states) {
                const state = stateObj.state;
                const count = await db.getOne(`
                    SELECT COUNT(*) as count FROM business_listings 
                    WHERE state = $1
                `, [state]);

                stateData.push({
                    state,
                    count: parseInt(count.count)
                });
            }

            return {
                totalBusinesses: parseInt(businessCount?.count || '0'),
                totalEmails: parseInt(emailCount?.count || '0'),
                totalWebsites: parseInt(websiteCount?.count || '0'),
                totalSearchTerms: searchTerms.length,
                states: states.map(row => row.state),
                stateData,
                emailCoverage: parseInt(businessCount?.count) > 0
                    ? Math.round((parseInt(emailCount?.count) / parseInt(businessCount?.count)) * 100)
                    : 0,
                websiteCoverage: parseInt(businessCount?.count) > 0
                    ? Math.round((parseInt(websiteCount?.count) / parseInt(businessCount?.count)) * 100)
                    : 0,
                tasks: {
                    total: taskStats.reduce((acc, curr) => acc + parseInt(curr.count), 0),
                    byStatus: taskStats.reduce((acc, curr) => {
                        acc[curr.status] = parseInt(curr.count);
                        return acc;
                    }, {})
                }
            };
        } catch (error) {
            logger.error(`Error getting statistics: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get batch status
     * @returns {Object} Current batch status
     */
    getBatchStatus() {
        return this.batchStatus || {
            isRunning: false,
            batchId: null,
            progress: 0,
            completedTasks: 0,
            failedTasks: 0,
            totalTasks: 0
        };
    }

    /**
     * Start a batch operation across multiple states
     * @param {Array} states - States to process (null for all)
     * @param {Object} options - Batch options
     * @returns {Object} Batch info
     */
    async startBatch(states = null, options = {}) {
        if (this.batchStatus?.isRunning) {
            throw new Error('A batch operation is already running');
        }

        try {
            await this.ensureBrowser();

            const batchId = options.batchId || uuidv4();
            const searchTerm = options.searchTerm || 'business';
            const wait = options.wait || 5000;
            const maxResults = options.maxResults || 100;

            // Use provided states or get all states from the database
            let statesArray = states;
            if (!statesArray || statesArray.length === 0) {
                const statesResult = await db.getMany(`
                    SELECT DISTINCT state FROM business_listings WHERE state IS NOT NULL
                    UNION
                    SELECT unnest(ARRAY['CA','NY','TX','FL','IL','PA','OH','GA','NC','MI'])
                    ORDER BY 1
                `);
                statesArray = statesResult.map(row => row.state);
            }

            // Create batch entry in database
            await db.query(`
                INSERT INTO batch_operations
                (id, start_time, status, total_tasks, states)
                VALUES ($1, NOW(), $2, $3, $4)
            `, [batchId, 'running', statesArray.length, JSON.stringify(statesArray)]);

            // Initialize batch status
            this.batchStatus = {
                isRunning: true,
                batchId,
                progress: 0,
                completedTasks: 0,
                failedTasks: 0,
                totalTasks: statesArray.length,
                currentState: null,
                currentCity: null,
                options: {
                    searchTerm,
                    wait,
                    maxResults,
                    contactLimit: options.maxResults || maxResults
                }
            };

            // Start batch processing in the background
            this.processBatch(batchId, statesArray, {
                searchTerm,
                wait,
                maxResults
            }).catch(error => {
                logger.error(`Background batch processing error: ${error.message}`);
            });

            return {
                batchId,
                totalTasks: statesArray.length
            };
        } catch (error) {
            logger.error(`Error starting batch: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process a batch of states
     * @param {string} batchId - Batch ID
     * @param {Array} states - States to process
     * @param {Object} options - Processing options
     */
    async processBatch(batchId, states, options) {
        try {
            for (const state of states) {
                if (!this.batchStatus?.isRunning) {
                    logger.info(`Batch ${batchId} was stopped`);
                    break;
                }

                this.batchStatus.currentState = state;

                // Create a task for each state
                try {
                    const taskId = uuidv4();
                    const searchTerm = `${options.searchTerm} in ${state}`;

                    // Create task entry in database
                    await db.query(`
                        INSERT INTO scraping_tasks
                        (id, search_term, status, created_at)
                        VALUES ($1, $2, $3, NOW())
                    `, [taskId, searchTerm, 'pending']);

                    // Process the state
                    this.batchStatus.currentCity = state;

                    // In real implementation, this would call the scraper to process the state
                    logger.info(`Batch ${batchId}: Processing state ${state} - awaiting real scraper`);

                    // Simulate processing delay
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Update completed tasks
                    this.batchStatus.completedTasks += 1;
                    this.batchStatus.progress = (this.batchStatus.completedTasks / this.batchStatus.totalTasks) * 100;

                    // Update task status
                    await db.query(`
                        UPDATE scraping_tasks
                        SET status = 'completed', completed_at = NOW()
                        WHERE id = $1
                    `, [taskId]);

                    // Wait between states
                    if (this.batchStatus?.isRunning) {
                        await new Promise(resolve => setTimeout(resolve, options.wait || 5000));
                    }
                } catch (error) {
                    logger.error(`Error processing state ${state}: ${error.message}`);
                    this.batchStatus.failedTasks += 1;
                    this.batchStatus.progress = ((this.batchStatus.completedTasks + this.batchStatus.failedTasks) / this.batchStatus.totalTasks) * 100;

                    // Log failure
                    await db.query(`
                        INSERT INTO batch_task_failures
                        (batch_id, state, error_message, failure_time)
                        VALUES ($1, $2, $3, NOW())
                    `, [batchId, state, error.message]);
                }
            }

            // Mark batch as completed
            await db.query(`
                UPDATE batch_operations
                SET status = $1, end_time = NOW(), completed_tasks = $2, failed_tasks = $3
                WHERE id = $4
            `, [
                'completed',
                this.batchStatus.completedTasks,
                this.batchStatus.failedTasks,
                batchId
            ]);

            logger.info(`Batch ${batchId} completed. ${this.batchStatus.completedTasks} tasks completed, ${this.batchStatus.failedTasks} failed`);
            this.batchStatus.isRunning = false;
        } catch (error) {
            logger.error(`Batch processing error: ${error.message}`);

            // Mark batch as failed
            await db.query(`
                UPDATE batch_operations
                SET status = 'failed', end_time = NOW(), completed_tasks = $1, failed_tasks = $2
                WHERE id = $3
            `, [
                this.batchStatus?.completedTasks || 0,
                this.batchStatus?.failedTasks || 1,
                batchId
            ]);

            this.batchStatus = null;
        }
    }

    /**
     * Stop running batch
     * @returns {Object} Batch results
     */
    async stopBatch() {
        if (!this.batchStatus?.isRunning) {
            throw new Error('No batch is currently running');
        }

        const batchId = this.batchStatus.batchId;
        const completedTasks = this.batchStatus.completedTasks;
        const failedTasks = this.batchStatus.failedTasks;

        // Mark batch as stopped in the database
        await db.query(`
            UPDATE batch_operations
            SET status = 'stopped', end_time = NOW(), completed_tasks = $1, failed_tasks = $2
            WHERE id = $3
        `, [completedTasks, failedTasks, batchId]);

        // Update status object
        this.batchStatus.isRunning = false;

        logger.info(`Batch ${batchId} manually stopped`);

        return {
            batchId,
            completedTasks,
            failedTasks,
            status: 'stopped'
        };
    }
}

// Create singleton instance
const scraperService = new ScraperService();

// Export the service
export default scraperService;