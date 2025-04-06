import { v4 as uuidv4 } from 'uuid';
import db from './database';
import logger from './logger';

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

        // Set up periodic task processing
        if (typeof window === 'undefined') {
            setInterval(() => this.processTaskQueue(), 5000);
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
        try {
            // Skip if we're at capacity
            if (this.currentRunningTasks >= this.maxConcurrentTasks) {
                return;
            }

            // Get pending tasks from database
            const pendingTasks = await db.getMany(`
                SELECT id, search_term FROM scraping_tasks
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT $1
            `, [this.maxConcurrentTasks - this.currentRunningTasks]);

            // Process each pending task
            for (const task of pendingTasks) {
                this.currentRunningTasks++;

                // Start task in background
                this.runTask(task.id, task.search_term)
                    .catch(error => {
                        logger.error(`Error running task ${task.id}: ${error.message}`);
                    })
                    .finally(() => {
                        this.currentRunningTasks--;
                    });

                // Add small delay between starting tasks
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            logger.error(`Error processing task queue: ${error.message}`);
        }
    }

    /**
     * Add a scraping task
     * @param {string} searchTerm - The search term to scrape
     * @returns {string} The task ID
     */
    async addTask(searchTerm) {
        try {
            await this.ensureBrowser();
            await db.init();

            // Create task ID
            const taskId = uuidv4();

            // Create task entry in database
            await db.query(`
                INSERT INTO scraping_tasks (id, search_term, status, created_at)
                VALUES ($1, $2, $3, NOW())
            `, [taskId, searchTerm, 'pending']);

            // Add to tasks map for tracking
            this.tasks.set(taskId, {
                id: taskId,
                searchTerm,
                status: 'pending',
                progress: 0,
                businessesFound: 0,
                startTime: new Date(),
            });

            // Process queue immediately for faster startup
            setTimeout(() => this.processTaskQueue(), 100);

            return taskId;
        } catch (error) {
            logger.error(`Error adding task: ${error.message}`);
            throw error;
        }
    }

    /**
     * Run a scraping task in the background
     * @param {string} taskId - The task ID
     * @param {string} searchTerm - The search term to scrape
     */
    async runTask(taskId, searchTerm) {
        try {
            // Update task status
            await this.updateTaskStatus(taskId, 'running');

            // Extract location info from search term if available
            let location = '';
            const locationMatch = searchTerm.match(/in\s+([^,]+(?:,\s*\w+)?)/i);
            if (locationMatch) {
                location = locationMatch[1];
            }

            logger.info(`Task ${taskId} running for "${searchTerm}"`);

            // In a real implementation, this would use Playwright to scrape Google Maps
            // For now, we'll just simulate the task running

            // Simulate progressive updates
            const totalSteps = 4;
            for (let i = 1; i <= totalSteps; i++) {
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Update progress
                const task = this.tasks.get(taskId);
                if (task) {
                    task.progress = Math.floor((i / totalSteps) * 100);
                }

                logger.info(`Task ${taskId} progress: ${Math.floor((i / totalSteps) * 100)}%`);
            }

            // Mark task as completed with 0 businesses (real scraper would provide actual data)
            await this.updateTaskStatus(taskId, 'completed', 0);

            logger.info(`Task ${taskId} completed - awaiting real scraper to provide data`);
        } catch (error) {
            logger.error(`Error running task ${taskId}: ${error.message}`);
            await this.updateTaskStatus(taskId, 'failed');
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

            // If not found, get from database
            const task = await db.getOne(`
                SELECT * FROM scraping_tasks WHERE id = $1
            `, [taskId]);

            if (!task) {
                throw new Error('Task not found');
            }

            return task;
        } catch (error) {
            logger.error(`Error getting task status: ${error.message}`);
            throw error;
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
        return this.emailFinderStatus;
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

            // Query businesses without emails
            const query = `
                SELECT id, name, website, domain
                FROM business_listings
                WHERE website IS NOT NULL AND website != '' 
                AND (email IS NULL OR email = '')
                LIMIT $1
            `;

            const businesses = await db.getMany(query, [options.limit || 100]);

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

            // Process businesses one by one
            // In a real implementation, this would be done in parallel with configurable concurrency
            for (const business of businesses) {
                if (!this.emailFinderStatus.isRunning) {
                    break;
                }

                this.emailFinderStatus.runningTasks = 1;

                try {
                    // Simulate email discovery process
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Simulate finding an email (70% chance)
                    const foundEmail = Math.random() > 0.3;

                    if (foundEmail) {
                        const domain = business.domain ||
                            (business.website ? new URL(business.website).hostname.replace(/^www\./, '') : '');

                        const email = `contact@${domain}`;

                        // Update the business with the found email
                        await db.query(`
                            UPDATE business_listings
                            SET email = $1, updated_at = NOW()
                            WHERE id = $2
                        `, [email, business.id]);

                        this.emailFinderStatus.emailsFound++;
                    }

                    this.emailFinderStatus.processed++;
                    this.emailFinderStatus.queueLength--;
                } catch (err) {
                    logger.error(`Error processing email for business ${business.id}: ${err.message}`);
                }
            }

            logger.info(`Email finder completed. Processed ${this.emailFinderStatus.processed} businesses, found ${this.emailFinderStatus.emailsFound} emails.`);
        } catch (error) {
            logger.error(`Error in email processing: ${error.message}`);
        } finally {
            this.emailFinderStatus.isRunning = false;
            this.emailFinderStatus.runningTasks = 0;
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