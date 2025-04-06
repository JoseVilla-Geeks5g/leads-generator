const { v4: uuidv4 } = require('uuid');
const { chromium } = require('playwright');
const db = require('../lib/database');
const logger = require('../lib/logger');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Constants for configuration
const DEFAULT_MAX_RESULTS = 200;
const MEMORY_CHECK_INTERVAL = 60000; // 1 minute

/**
 * Consolidated scraper service that provides:
 * - Google Maps scraping
 * - Email finding
 * - Batch processing
 * - Task management
 */
class ScraperService {
    constructor() {
        // Browser instances
        this.browser = null;
        this.context = null;
        this.page = null;

        // Task tracking
        this.tasks = new Map();
        this.taskProgressCallbacks = new Map();

        // Email finder state
        this.emailFinderQueue = [];
        this.emailFinderRunningTasks = 0;
        this.emailFinderProcessed = 0;
        this.emailFinderEmailsFound = 0;
        this.emailFinderIsRunning = false;
        this.emailFinderIsStopping = false;
        this.currentWebsites = new Map();

        // Batch scraper state
        this.batchTaskQueue = [];
        this.batchRunningTasks = 0;
        this.batchCompletedTasks = 0;
        this.batchFailedTasks = 0;
        this.batchTotalTasks = 0;
        this.batchIsRunning = false;
        this.batchCurrentCity = null;
        this.batchCurrentState = null;
        this.batchId = null;
        this.batchStateProgress = {};

        // Page pool for parallel processing
        this.pagePool = [];
        this.contextPool = [];

        // Email regex patterns
        this.emailRegexes = [
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            /(?:mailto:|email|e-mail|email us at|contact us at|send.*email to).*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
            /contact.*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
            /info.*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
            /(?:sales|support|help|admin|info|contact|hello|team|marketing|media)@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/gi,
        ];

        // Set up memory monitoring
        this.memoryUsage = { rss: 0, heapTotal: 0, heapUsed: 0 };
        setInterval(() => {
            this.memoryUsage = process.memoryUsage();
            if (this.memoryUsage.heapUsed > 1.5 * 1024 * 1024 * 1024) { // 1.5 GB
                logger.warn(`High memory usage: ${Math.round(this.memoryUsage.heapUsed / 1024 / 1024)} MB`);
            }
        }, MEMORY_CHECK_INTERVAL);
    }

    /**
     * Initialize the scraper browser and context
     */
    async initialize() {
        try {
            if (this.browser) {
                return true; // Already initialized
            }

            logger.info('Initializing scraper browser');

            // Use better browser settings for stability
            this.browser = await chromium.launch({
                headless: true,
                args: [
                    '--disable-dev-shm-usage',
                    '--disable-setuid-sandbox',
                    '--no-sandbox',
                    '--disable-extensions'
                ]
            });

            // Create a base context
            this.context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1920, height: 1080 },
            });

            // Create a base page
            this.page = await this.context.newPage();

            // Initialize page pool for parallel processing
            const concurrentTasks = 4; // Default concurrency
            for (let i = 0; i < concurrentTasks; i++) {
                // Create context with anti-detection measures
                const context = await this.browser.newContext({
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport: { width: 1920, height: 1080 },
                    locale: 'en-US',
                    timezoneId: 'America/New_York',
                    bypassCSP: true,
                    deviceScaleFactor: 1,
                    isMobile: false,
                    hasTouch: false,
                    ignoreHTTPSErrors: true,
                    javaScriptEnabled: true
                });

                // Add anti-bot detection
                await context.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => false });
                    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5].map(() => ({ length: 1 })) });
                    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                    window.chrome = { runtime: {} };
                });

                // Create page
                const page = await context.newPage();

                // Store in pools
                this.contextPool.push(context);
                this.pagePool.push(page);
            }

            logger.info('Scraper service initialized successfully');
            return true;
        } catch (error) {
            logger.error(`Error initializing scraper: ${error.message}`);
            await this.close().catch(e => logger.error(`Cleanup error: ${e.message}`));
            throw error;
        }
    }

    /**
     * Close browser and free resources
     */
    async close() {
        logger.info('Closing scraper resources');

        try {
            // Close all pages in the pool
            for (const page of this.pagePool) {
                if (page) await page.close().catch(() => { });
            }
            this.pagePool = [];
            this.page = null;

            // Close all contexts in the pool
            for (const context of this.contextPool) {
                if (context) await context.close().catch(() => { });
            }
            this.contextPool = [];
            this.context = null;

            // Close browser
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }

            logger.info('Scraper resources closed');
        } catch (error) {
            logger.error(`Error closing scraper resources: ${error.message}`);
        }
    }

    // ======================================
    // TASK MANAGEMENT
    // ======================================

    /**
     * Add a scraping task
     * @param {string} searchTerm - The search term to scrape
     * @returns {string} The task ID
     */
    async addTask(searchTerm) {
        try {
            // Ensure browser is initialized
            if (!this.browser) {
                await this.initialize();
            }

            // Create task ID
            const taskId = uuidv4();

            // Create task entry in database
            await db.query(`
        INSERT INTO scraping_tasks (id, search_term, status, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [taskId, searchTerm, 'pending']);

            // Add to tasks map
            this.tasks.set(taskId, {
                id: taskId,
                searchTerm,
                status: 'pending',
                progress: 0,
                businessesFound: 0,
                startTime: new Date(),
            });

            // Start the task
            this.runTask(taskId, searchTerm);

            return taskId;
        } catch (error) {
            logger.error(`Error adding task: ${error.message}`);
            throw error;
        }
    }

    /**
     * Run a scraping task
     * @param {string} taskId - The task ID
     * @param {string} searchTerm - The search term to scrape
     */
    async runTask(taskId, searchTerm) {
        try {
            // Update task status
            await this.updateTaskStatus(taskId, 'running');

            // Run the scraper
            const businesses = await this.searchBusinesses(searchTerm, taskId);

            // Mark task as completed
            await this.updateTaskStatus(taskId, 'completed', businesses.length);

            logger.info(`Task ${taskId} completed, found ${businesses.length} businesses`);
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
                task.businessesFound = businessesFound;
                if (status === 'completed' || status === 'failed') {
                    task.endTime = new Date();
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
                return null;
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

    // ======================================
    // BUSINESS SCRAPING
    // ======================================

    /**
     * Search for businesses
     * @param {string} searchTerm - Search term
     * @param {string} taskId - Task ID
     * @returns {Array} Array of businesses
     */
    async searchBusinesses(searchTerm, taskId) {
        try {
            logger.info(`Searching for "${searchTerm}"`);

            // Reset business counter
            let businessesFound = 0;

            // Ensure we have a page
            if (!this.page) {
                await this.initialize();
            }

            // Navigate to Google Maps
            await this.page.goto('https://www.google.com/maps', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            logger.info('Navigated to Google Maps');

            // Accept cookies if needed
            await this.acceptCookies(this.page);

            // Enter search term
            await this.page.fill('input[name="q"]', searchTerm);
            await this.page.press('input[name="q"]', 'Enter');

            // Wait for results
            await this.page.waitForSelector('div[role="feed"]', { timeout: 15000 })
                .catch(() => logger.info('Feed selector not found, continuing anyway'));

            await this.page.waitForTimeout(3000);

            // Scroll to load more results
            const businesses = await this.scrollAndCollectBusinesses(searchTerm, taskId, DEFAULT_MAX_RESULTS);

            businessesFound = businesses.length;

            // Also update the task status in memory
            const task = this.tasks.get(taskId);
            if (task) {
                task.businessesFound = businessesFound;
            }

            // Update task status in database without changing the status
            await db.query(`
        UPDATE scraping_tasks
        SET businesses_found = $1
        WHERE id = $2
      `, [businessesFound, taskId]);

            return businesses;
        } catch (error) {
            logger.error(`Error searching businesses: ${error.message}`);
            throw error;
        }
    }

    /**
     * Scroll through results and collect businesses
     * @param {string} searchTerm - Search term
     * @param {string} taskId - Task ID
     * @param {number} maxResults - Maximum results to collect
     * @returns {Array} Collected businesses
     */
    async scrollAndCollectBusinesses(searchTerm, taskId, maxResults) {
        const businesses = [];
        let previousResultsCount = 0;
        let noNewResultsCount = 0;
        const MAX_NO_NEW_RESULTS = 3;

        try {
            logger.info(`Starting to scroll for results (max: ${maxResults})`);

            // First check how many results are visible initially
            const initialListings = await this.page.$$('div.Nv2PK');
            logger.info(`Initially found ${initialListings.length} business listings`);

            // Main scroll loop
            while (businesses.length < maxResults && noNewResultsCount < MAX_NO_NEW_RESULTS) {
                // Extract currently visible businesses
                const newBusinesses = await this.extractBusinessListings(searchTerm);

                // Add new unique businesses
                for (const business of newBusinesses) {
                    if (!businesses.some(b => b.name === business.name)) {
                        businesses.push(business);

                        // Insert into database
                        await this.insertBusiness(business, taskId);
                    }
                }

                // Check if we found new results
                if (businesses.length > previousResultsCount) {
                    previousResultsCount = businesses.length;
                    noNewResultsCount = 0;

                    // Report progress
                    logger.info(`Found ${businesses.length}/${maxResults} businesses`);

                    // Call progress callback if registered
                    if (this.taskProgressCallbacks.has(taskId)) {
                        this.taskProgressCallbacks.get(taskId)({
                            businesses: businesses.length,
                            max: maxResults
                        });
                    }
                } else {
                    noNewResultsCount++;
                    logger.info(`No new results found (${noNewResultsCount}/${MAX_NO_NEW_RESULTS})`);
                }

                if (businesses.length >= maxResults) {
                    logger.info(`Reached maximum number of results (${maxResults})`);
                    break;
                }

                // Scroll to load more
                await this.scrollFeed();
            }

            logger.info(`Finished scrolling, found ${businesses.length} businesses`);
            return businesses;
        } catch (error) {
            logger.error(`Error during scroll and collect: ${error.message}`);
            return businesses; // Return what we have so far
        }
    }

    /**
     * Extract business listings from current page
     * @param {string} searchTerm - Search term used
     * @returns {Array} Extracted businesses
     */
    async extractBusinessListings(searchTerm) {
        try {
            // Get all business elements
            const businessElements = await this.page.$$('div.Nv2PK');

            // Extract data from each business
            const businesses = [];

            for (const element of businessElements) {
                try {
                    // Extract basic info visible in the listing
                    const name = await element.$eval('div.qBF1Pd', el => el.textContent.trim())
                        .catch(() => 'Unknown');

                    // Rating might not be present for all businesses
                    const rating = await element.$eval('span.MW4etd', el => {
                        const text = el.textContent.trim();
                        return parseFloat(text);
                    }).catch(() => null);

                    // Address/info line
                    const address = await element.$eval('div.W4Efsd:nth-child(2) > div.W4Efsd > span.W4Efsd:nth-child(1)',
                        el => el.textContent.trim()
                    ).catch(() => '');

                    // Extract city from search term
                    const parts = searchTerm.split('-');
                    let city = '';
                    let country = '';
                    let state = '';

                    if (parts.length >= 2) {
                        city = parts[1].trim();
                    }

                    if (parts.length >= 3) {
                        state = parts[2].trim();
                    }

                    if (parts.length >= 4) {
                        country = parts[3].trim();
                    }

                    businesses.push({
                        name,
                        rating,
                        address,
                        city,
                        state,
                        country,
                        search_term: searchTerm,
                        search_date: new Date()
                    });
                } catch (error) {
                    logger.debug(`Error extracting business data: ${error.message}`);
                }
            }

            return businesses;
        } catch (error) {
            logger.error(`Error extracting business listings: ${error.message}`);
            return [];
        }
    }

    /**
     * Scroll the results feed to load more items
     */
    async scrollFeed() {
        try {
            // Get the feed element
            const feed = await this.page.$('div[role="feed"]');
            if (!feed) {
                logger.warn('Feed element not found for scrolling');
                return;
            }

            // Scroll in the feed
            await this.page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]');
                if (feed) {
                    feed.scrollTop = feed.scrollHeight;
                }
            });

            // Wait for potential loading
            await this.page.waitForTimeout(2000);
        } catch (error) {
            logger.error(`Error scrolling feed: ${error.message}`);
        }
    }

    /**
     * Insert a business into the database
     * @param {Object} business - Business data
     * @param {string} taskId - Task ID
     */
    async insertBusiness(business, taskId) {
        try {
            // Insert into the new business_listings table
            await db.query(`
        INSERT INTO business_listings
        (name, address, city, state, country, rating, search_term, search_date, task_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (name, search_term) DO NOTHING
      `, [
                business.name,
                business.address,
                business.city,
                business.state,
                business.country,
                business.rating,
                business.search_term,
                business.search_date,
                taskId
            ]);

            // Also insert into the old businesses table for backward compatibility
            await db.query(`
        INSERT INTO businesses
        (name, address, city, country, rating, search_term, search_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (name, search_term) DO NOTHING
      `, [
                business.name,
                business.address,
                business.city,
                business.country,
                business.rating,
                business.search_term,
                business.search_date
            ]).catch(() => { }); // Ignore errors in old table
        } catch (error) {
            logger.error(`Error inserting business: ${error.message}`);
        }
    }

    /**
     * Accept cookies on the current page
     * @param {Page} page - The page to accept cookies on
     */
    async acceptCookies(page) {
        try {
            const cookieSelectors = [
                'button:has-text("Accept all")',
                'button:has-text("Accept")',
                'button:has-text("I agree")',
                'button[aria-label="Accept all"]'
            ];

            for (const selector of cookieSelectors) {
                const button = await page.$(selector);
                if (button) {
                    await button.click();
                    await page.waitForTimeout(1000);
                    logger.info(`Accepted cookies using selector: ${selector}`);
                    break;
                }
            }
        } catch (error) {
            logger.debug(`Error accepting cookies: ${error.message}`);
            // Continue anyway - cookie acceptance is optional
        }
    }

    // ======================================
    // EMAIL FINDER
    // ======================================

    /**
     * Process all businesses without emails
     * @param {Object} options - Options for email finder
     * @returns {number} Number of businesses to process
     */
    async processAllPendingBusinesses(options = {}) {
        const searchOptions = {
            searchDepth: 1,
            searchWhois: false,
            limit: 1000,
            ...options
        };

        try {
            if (this.emailFinderIsRunning) {
                logger.info('Email finder is already running');
                return 0;
            }

            this.emailFinderIsRunning = true;
            this.emailFinderIsStopping = false;
            this.emailFinderProcessed = 0;
            this.emailFinderEmailsFound = 0;
            this.currentWebsites.clear();

            // Build query and parameters
            const conditions = [];
            const params = [];

            // Base WHERE conditions that are always included
            const baseWhere = `website IS NOT NULL AND website != '' AND (email IS NULL OR email = '')`;

            // Add optional conditions with proper parameter indexing
            if (searchOptions.batchId) {
                params.push(searchOptions.batchId);
                conditions.push(`batch_id = $${params.length}`);
            }

            if (searchOptions.businessIds) {
                params.push(searchOptions.businessIds);
                conditions.push(`id = ANY($${params.length})`);
            }

            if (searchOptions.domain) {
                params.push(searchOptions.domain);
                conditions.push(`domain = $${params.length}`);
            }

            // Add limit parameter
            params.push(searchOptions.limit || 1000);

            // Build the final query
            const query = `
        SELECT id, name, website, domain
        FROM business_listings
        WHERE ${baseWhere}
        ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
        LIMIT $${params.length}
      `;

            logger.info(`Email finder query: ${query.replace(/\s+/g, ' ')}`);
            logger.info(`Email finder params: ${JSON.stringify(params)}`);

            // Query the database
            const businesses = await db.getMany(query, params);

            logger.info(`Found ${businesses.length} businesses to process for emails`);

            // Initialize if needed
            if (!this.browser) {
                await this.initialize();
            }

            // Add to queue and start processing
            this.emailFinderQueue = [...businesses];

            // Start processing
            await this.processEmailFinderQueue(searchOptions);

            logger.info(`Email finder completed. Processed ${this.emailFinderProcessed} websites, found ${this.emailFinderEmailsFound} emails.`);

            return businesses.length;
        } catch (error) {
            logger.error(`Error in processAllPendingBusinesses: ${error.message}`);
            throw error;
        } finally {
            this.emailFinderIsRunning = false;
        }
    }

    /**
     * Process specific businesses
     * @param {Array} businessIds - Array of business IDs
     * @param {Object} options - Options for processing
     * @returns {number} Number of businesses processed
     */
    async processBusinesses(businessIds, options = {}) {
        if (!Array.isArray(businessIds)) {
            logger.error('businessIds must be an array');
            return 0;
        }

        return this.processAllPendingBusinesses({
            ...options,
            businessIds
        });
    }

    /**
     * Process the queue of businesses in parallel for email finding
     * @param {Object} options - Options for processing
     */
    async processEmailFinderQueue(options) {
        // Create a map of free worker IDs (indexes in the pagePool)
        const freeWorkers = new Set(Array.from({ length: this.pagePool.length }, (_, i) => i));

        logger.info(`Starting to process ${this.emailFinderQueue.length} businesses with ${this.pagePool.length} parallel workers`);

        // Process until queue is empty or stopping is requested
        while (this.emailFinderQueue.length > 0 && !this.emailFinderIsStopping) {
            if (freeWorkers.size === 0) {
                // All workers are busy, wait a bit
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            // Get a free worker ID
            const workerId = freeWorkers.values().next().value;
            freeWorkers.delete(workerId);

            // Get next business to process
            const business = this.emailFinderQueue.shift();

            // Process business with this worker
            this.processBusinessForEmail(business, options, workerId)
                .finally(() => {
                    // Free up the worker when done
                    freeWorkers.add(workerId);
                });

            // Small delay between starting tasks
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Wait for all remaining tasks to complete
        while (this.emailFinderRunningTasks > 0 && !this.emailFinderIsStopping) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    /**
     * Process a single business website using a specific worker
     * @param {Object} business - Business data
     * @param {Object} options - Options for processing
     * @param {number} workerId - Worker ID
     * @returns {Array} Found emails
     */
    async processBusinessForEmail(business, options, workerId = 0) {
        this.emailFinderRunningTasks++;

        // Track current website for this worker
        this.currentWebsites.set(workerId, business.website);

        let emails = [];
        let retries = 0;
        let success = false;

        try {
            logger.info(`Worker ${workerId}: Processing ${business.website} for emails...`);

            // Ensure we have the browser initialized
            if (!this.browser || this.pagePool.length === 0) {
                await this.initialize();
            }

            // Try to extract emails with retries
            while (retries < 3 && !success) {
                try {
                    // Try first with the website URL
                    if (business.website) {
                        const websiteEmails = await this.extractEmailsFromWebsite(business.website, options, workerId);
                        emails = emails.concat(websiteEmails);
                    }

                    // If no emails found and domain is available, try with the domain
                    if (emails.length === 0 && business.domain) {
                        // Try common contact pages 
                        const contactUrls = [
                            `https://${business.domain}/contact`,
                            `https://${business.domain}/contact-us`,
                            `https://${business.domain}/about-us`,
                            `https://${business.domain}/about`,
                            `https://${business.domain}/team`
                        ];

                        // Try each contact URL until we find emails
                        for (const url of contactUrls) {
                            if (emails.length === 0 && !this.emailFinderIsStopping) {
                                logger.info(`Worker ${workerId}: Trying contact page ${url}`);
                                const contactEmails = await this.extractEmailsFromWebsite(url, options, workerId);
                                emails = emails.concat(contactEmails);
                            }
                        }
                    }

                    success = true;
                } catch (error) {
                    retries++;
                    logger.warn(`Worker ${workerId}: Retry ${retries}/3 for ${business.website}: ${error.message}`);

                    // Wait before retrying
                    await this.randomDelay(1000 * retries, 3000 * retries);
                }
            }

            // Process found emails
            if (emails.length > 0) {
                emails = this.prioritizeEmails(emails, business.domain);

                // Remove duplicates and filter invalid emails
                const uniqueEmails = [...new Set(emails)].filter(email => {
                    return !email.match(/example|test|placeholder|noreply|no-reply|@sample|@test/i);
                });

                if (uniqueEmails.length > 0) {
                    const primaryEmail = uniqueEmails[0]; // Use the first email as primary

                    // Save to the database
                    await this.saveEmailToDatabase(business.id, primaryEmail, uniqueEmails.join(', '));

                    this.emailFinderEmailsFound++;
                    logger.info(`Worker ${workerId}: Found ${uniqueEmails.length} emails for ${business.website}: ${uniqueEmails.join(', ')}`);
                } else {
                    logger.info(`Worker ${workerId}: Found only invalid or test emails for ${business.website}`);
                }
            } else {
                logger.info(`Worker ${workerId}: No emails found for ${business.website}`);
            }
        } catch (error) {
            logger.error(`Worker ${workerId}: Error processing ${business.website}: ${error.message}`);
        } finally {
            this.emailFinderProcessed++;
            this.emailFinderRunningTasks--;
            this.currentWebsites.delete(workerId);
        }

        return emails;
    }

    /**
     * Extract emails from a website
     * @param {string} url - Website URL
     * @param {Object} options - Options for extraction
     * @param {number} workerId - Worker ID
     * @returns {Array} Found emails
     */
    async extractEmailsFromWebsite(url, options, workerId = 0) {
        const page = this.pagePool[workerId];

        try {
            logger.info(`Worker ${workerId}: Visiting ${url}`);

            // Set a reasonable timeout
            page.setDefaultTimeout(30000);

            // Navigate to the website with better error handling
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch(async (err) => {
                logger.warn(`Worker ${workerId}: Navigation error for ${url}: ${err.message}`);

                // Try with www. prefix if it might be missing
                if (!url.includes('www.') && url.startsWith('http')) {
                    const wwwUrl = url.replace('://', '://www.');
                    logger.info(`Worker ${workerId}: Retrying with www prefix: ${wwwUrl}`);
                    await page.goto(wwwUrl, { waitUntil: 'domcontentloaded' })
                        .catch(e => logger.warn(`Worker ${workerId}: Failed with www prefix too: ${e.message}`));
                }
            });

            // Wait for page to load properly
            await page.waitForLoadState('domcontentloaded');

            // Accept cookies if needed
            await this.acceptCookies(page);

            // Extract emails from page content
            const emails = await this.extractEmailsFromPage(page);

            // If search depth > 1, also check the contact page
            if (options.searchDepth > 1 && emails.length === 0) {
                // Look for contact links
                const contactLinks = await this.findContactLinks(page);

                for (const contactUrl of contactLinks) {
                    if (emails.length > 0 || this.emailFinderIsStopping) break; // Stop if we already found emails

                    try {
                        logger.info(`Worker ${workerId}: Following contact link: ${contactUrl}`);
                        await page.goto(contactUrl, { waitUntil: 'domcontentloaded' });

                        // Extract emails from the contact page
                        const contactEmails = await this.extractEmailsFromPage(page);
                        emails.push(...contactEmails);
                    } catch (error) {
                        logger.warn(`Worker ${workerId}: Error following contact link ${contactUrl}: ${error.message}`);
                    }
                }
            }

            return [...new Set(emails)]; // Return unique emails
        } catch (error) {
            logger.error(`Worker ${workerId}: Error extracting emails from ${url}: ${error.message}`);
            return [];
        }
    }

    /**
     * Extract emails from the current page
     * @param {Page} page - The page to extract emails from
     * @returns {Array} Found emails
     */
    async extractEmailsFromPage(page) {
        try {
            // Get full page content including hidden text
            const pageContent = await page.content();

            // Extract emails using multiple regex patterns
            const allEmails = [];
            this.emailRegexes.forEach(regex => {
                const matches = pageContent.match(regex) || [];
                allEmails.push(...matches);
            });

            // Extract text from mailto links
            const mailtoEmails = await page.evaluate(() => {
                const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
                return mailtoLinks.map(link => {
                    const href = link.getAttribute('href');
                    return href.replace('mailto:', '').split('?')[0].trim();
                });
            });

            // Clean up and normalize emails
            return [...new Set([...allEmails, ...mailtoEmails])]
                .map(email => {
                    // Extract email from more complex strings
                    const match = email.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/);
                    return match ? match[1].toLowerCase().trim() : email.toLowerCase().trim();
                })
                .filter(email => this.isValidEmail(email));
        } catch (error) {
            logger.error(`Error extracting emails from page: ${error.message}`);
            return [];
        }
    }

    /**
     * Find contact page links
     * @param {Page} page - The page to extract links from
     * @returns {Array} Contact page URLs
     */
    async findContactLinks(page) {
        try {
            return await page.evaluate(() => {
                const contactKeywords = ['contact', 'about', 'team', 'faq', 'help', 'support'];
                const links = Array.from(document.querySelectorAll('a'));

                return links
                    .filter(link => {
                        const href = link.href || '';
                        const text = (link.textContent || '').toLowerCase();

                        return contactKeywords.some(keyword =>
                            href.includes(keyword) || text.includes(keyword)
                        ) && href.startsWith('http');
                    })
                    .map(link => link.href)
                    .slice(0, 3); // Limit to 3 links
            });
        } catch (error) {
            logger.warn(`Error finding contact links: ${error.message}`);
            return [];
        }
    }

    /**
     * Save email to database
     * @param {number} businessId - Business ID
     * @param {string} email - Primary email
     * @param {string} allEmails - All found emails
     * @returns {boolean} Success or failure
     */
    async saveEmailToDatabase(businessId, email, allEmails) {
        try {
            // Update both databases for backward compatibility
            await db.query(
                `UPDATE business_listings 
         SET email = $1, 
             notes = COALESCE(notes, '') || ' | Other emails: ' || $2,
             updated_at = NOW() 
         WHERE id = $3`,
                [email, allEmails, businessId]
            );

            await db.query(
                `UPDATE businesses 
         SET email = $1 
         WHERE id = $2`,
                [email, businessId]
            ).catch(() => { });

            return true;
        } catch (error) {
            logger.error(`Error saving email to database: ${error.message}`);
            return false;
        }
    }

    /**
     * Validate email format
     * @param {string} email - Email to validate
     * @returns {boolean} Whether the email is valid
     */
    isValidEmail(email) {
        if (!email) return false;

        // Basic validation
        const valid = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
        if (!valid) return false;

        // Filter common false positives
        const filters = [
            /example\./i, /test(@|\.)/i, /placeholder/i,
            /noreply/i, /no-reply/i, /donotreply/i,
            /yourname/i, /youremail/i, /yourdomain/i
        ];

        return !filters.some(f => f.test(email));
    }

    /**
     * Add random delay
     * @param {number} min - Minimum delay in ms
     * @param {number} max - Maximum delay in ms
     */
    async randomDelay(min, max) {
        const delay = Math.floor(min + Math.random() * (max - min));
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Prioritize emails by domain
     * @param {Array} emails - List of emails
     * @param {string} domain - Business domain
     * @returns {Array} Prioritized list of emails
     */
    prioritizeEmails(emails, domain) {
        if (!domain || emails.length === 0) return emails;

        // Clean the domain
        domain = domain.replace(/^www\./, '');

        // Create a copy of the emails array
        const sortedEmails = [...emails];

        // Sort by prioritizing emails that match the domain
        sortedEmails.sort((a, b) => {
            const aMatchesDomain = a.endsWith(`@${domain}`) || a.includes(`@${domain.split('.')[0]}`);
            const bMatchesDomain = b.endsWith(`@${domain}`) || b.includes(`@${domain.split('.')[0]}`);

            if (aMatchesDomain && !bMatchesDomain) return -1;
            if (!aMatchesDomain && bMatchesDomain) return 1;

            // Secondary sort by common useful email prefixes
            const aHasGoodPrefix = this.hasGoodEmailPrefix(a);
            const bHasGoodPrefix = this.hasGoodEmailPrefix(b);

            if (aHasGoodPrefix && !bHasGoodPrefix) return -1;
            if (!aHasGoodPrefix && bHasGoodPrefix) return 1;

            return 0;
        });

        return sortedEmails;
    }

    /**
     * Check if email has a useful prefix
     * @param {string} email - Email to check
     * @returns {boolean} Whether the email has a good prefix
     */
    hasGoodEmailPrefix(email) {
        const goodPrefixes = [
            'contact', 'info', 'hello', 'admin',
            'sales', 'support', 'team', 'marketing'
        ];

        const prefix = email.split('@')[0].toLowerCase();
        return goodPrefixes.some(p => prefix === p || prefix.startsWith(p));
    }

    /**
     * Get email finder status
     * @returns {Object} Status object
     */
    getEmailFinderStatus() {
        return {
            isRunning: this.emailFinderIsRunning,
            isStopping: this.emailFinderIsStopping,
            processed: this.emailFinderProcessed,
            emailsFound: this.emailFinderEmailsFound,
            queueLength: this.emailFinderQueue.length,
            runningTasks: this.emailFinderRunningTasks,
            currentWebsites: Array.from(this.currentWebsites.values()),
            memoryUsage: {
                heapUsed: Math.round(this.memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(this.memoryUsage.heapTotal / 1024 / 1024)
            }
        };
    }

    /**
     * Stop email finder
     * @returns {Object} Status object
     */
    async stopEmailFinder() {
        logger.info('Stopping email finder');
        this.emailFinderIsStopping = true;
        this.emailFinderQueue = [];
        return {
            processed: this.emailFinderProcessed,
            emailsFound: this.emailFinderEmailsFound
        };
    }

    // ======================================
    // BATCH SCRAPER
    // ======================================

    /**
     * Start a batch operation for multiple states
     * @param {Array} states - Array of state names to process
     * @param {Object} options - Batch options
     * @returns {Object} Batch operation info
     */
    async startBatch(states = null, options = {}) {
        if (this.batchIsRunning) {
            throw new Error('A batch operation is already running');
        }

        try {
            // Generate batch ID
            this.batchId = uuidv4();

            // Load cities data
            const citiesByState = await this.loadCitiesData();

            // Filter states if specified
            const statesToProcess = states
                ? Object.keys(citiesByState).filter(state => states.includes(state))
                : Object.keys(citiesByState);

            if (statesToProcess.length === 0) {
                throw new Error('No valid states to process');
            }

            // Initialize task queue
            this.batchTaskQueue = [];
            this.batchRunningTasks = 0;
            this.batchCompletedTasks = 0;
            this.batchFailedTasks = 0;
            this.batchStateProgress = {};

            const waitBetweenTasks = options.waitBetweenTasks || 30000; // 30 seconds between tasks
            const maxResultsPerCity = options.maxResultsPerCity || 200;
            const businessType = options.businessType || 'Digital Marketing Agency';

            // Create tasks for each city in each state
            for (const state of statesToProcess) {
                const cities = citiesByState[state];
                this.batchStateProgress[state] = {
                    total: cities.length,
                    completed: 0,
                    failed: 0,
                    inProgress: false
                };

                for (const city of cities) {
                    const searchTerm = `${businessType} - ${city} - ${state}`;
                    this.batchTaskQueue.push({ state, city, searchTerm });
                }
            }

            this.batchTotalTasks = this.batchTaskQueue.length;
            this.batchIsRunning = true;

            // Record batch start in database
            await this.recordBatchStart(statesToProcess);

            // Start processing tasks
            this.processQueueBatch(waitBetweenTasks, maxResultsPerCity);

            return {
                batchId: this.batchId,
                totalStates: statesToProcess.length,
                totalCities: this.batchTotalTasks,
                states: statesToProcess
            };
        } catch (error) {
            this.batchIsRunning = false;
            throw error;
        }
    }

    /**
     * Load cities data
     * @returns {Object} Cities grouped by state
     */
    async loadCitiesData() {
        try {
            // In Next.js you would use dynamic import or getStaticProps 
            // but for now we'll simulate loading cities data
            return {
                "California": ["Los Angeles", "San Francisco", "San Diego", "Sacramento"],
                "New York": ["New York City", "Buffalo", "Rochester", "Albany"],
                "Texas": ["Houston", "Dallas", "Austin", "San Antonio"],
                "Florida": ["Miami", "Orlando", "Tampa", "Jacksonville"],
                "Illinois": ["Chicago", "Springfield", "Aurora", "Naperville"]
            };
        } catch (error) {
            logger.error(`Error loading cities data: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process the batch queue
     * @param {number} waitBetweenTasks - Milliseconds to wait between tasks
     * @param {number} maxResultsPerCity - Maximum results per city
     */
    async processQueueBatch(waitBetweenTasks, maxResultsPerCity) {
        if (this.batchTaskQueue.length === 0) {
            if (this.batchRunningTasks === 0) {
                this.batchIsRunning = false;
                logger.info(`Batch completed: ${this.batchCompletedTasks} tasks completed, ${this.batchFailedTasks} failed`);
                await this.recordBatchCompletion();

                // Run email finder on collected businesses
                await this.processAllPendingBusinesses({
                    batchId: this.batchId,
                    limit: 5000
                });
            }
            return;
        }

        // Only start new task if we're not already running one
        if (this.batchRunningTasks === 0) {
            const task = this.batchTaskQueue.shift();
            this.batchRunningTasks++;
            this.batchCurrentCity = task.city;
            this.batchCurrentState = task.state;

            // Update state progress
            this.batchStateProgress[task.state].inProgress = true;

            // Process task
            setTimeout(() => {
                this.processBatchCity(task).finally(() => {
                    this.batchRunningTasks--;

                    // Update state progress
                    if (this.batchTaskQueue.filter(t => t.state === task.state).length === 0) {
                        this.batchStateProgress[task.state].inProgress = false;
                    }

                    // Wait before next task
                    setTimeout(() => this.processQueueBatch(waitBetweenTasks, maxResultsPerCity), waitBetweenTasks);
                });
            }, 1000);
        }
    }

    /**
     * Process a single city in a batch
     * @param {Object} task - Task information
     */
    async processBatchCity(task) {
        const { state, city, searchTerm } = task;

        logger.info(`Starting batch task for ${city}, ${state} with search term: ${searchTerm}`);

        try {
            // Add task using the regular task system
            const taskId = await this.addTask(searchTerm);

            // Wait for task to complete
            await this.waitForTask(taskId);

            // Task completed successfully
            this.batchCompletedTasks++;
            this.batchStateProgress[state].completed++;
            logger.info(`Batch task completed for ${city}, ${state}`);

            // Update state progress in database
            await this.updateStateProgress(state);

        } catch (error) {
            // Task failed
            this.batchFailedTasks++;
            this.batchStateProgress[state].failed++;
            logger.error(`Batch task failed for ${city}, ${state}: ${error.message}`);

            // Record failure
            await this.recordTaskFailure(state, city, error.message);
        }
    }

    /**
     * Wait for a task to complete
     * @param {string} taskId - Task ID
     */
    async waitForTask(taskId) {
        return new Promise((resolve, reject) => {
            const CHECK_INTERVAL = 5000; // Check every 5 seconds
            const MAX_CHECKS = 60; // Maximum 5 minutes wait

            let checks = 0;

            const checkStatus = async () => {
                try {
                    if (checks >= MAX_CHECKS) {
                        reject(new Error('Task timed out'));
                        return;
                    }

                    const status = await this.getTaskStatus(taskId);

                    if (!status) {
                        reject(new Error('Task not found'));
                        return;
                    }

                    if (status.status === 'completed') {
                        resolve(status);
                        return;
                    } else if (status.status === 'failed') {
                        reject(new Error('Task failed'));
                        return;
                    }

                    // Task is still running, check again
                    checks++;
                    setTimeout(checkStatus, CHECK_INTERVAL);
                } catch (error) {
                    reject(error);
                }
            };

            // Start checking
            checkStatus();
        });
    }

    /**
     * Record batch start in database
     * @param {Array} states - List of states
     */
    async recordBatchStart(states) {
        try {
            await db.query(`
        INSERT INTO batch_operations (
          id, start_time, status, total_tasks, states
        )
        VALUES ($1, NOW(), $2, $3, $4)
      `, [
                this.batchId,
                'running',
                this.batchTotalTasks,
                JSON.stringify(states)
            ]);
        } catch (error) {
            logger.error(`Error recording batch start: ${error.message}`);
        }
    }

    /**
     * Record batch completion
     */
    async recordBatchCompletion() {
        try {
            await db.query(`
        UPDATE batch_operations
        SET 
          status = $1, 
          end_time = NOW(),
          completed_tasks = $2,
          failed_tasks = $3
        WHERE id = $4
      `, [
                'completed',
                this.batchCompletedTasks,
                this.batchFailedTasks,
                this.batchId
            ]);
        } catch (error) {
            logger.error(`Error recording batch completion: ${error.message}`);
        }
    }

    /**
     * Record task failure
     * @param {string} state - State name
     * @param {string} city - City name
     * @param {string} errorMessage - Error message
     */
    async recordTaskFailure(state, city, errorMessage) {
        try {
            await db.query(`
        INSERT INTO batch_task_failures (
          batch_id, state, city, error_message, failure_time
        )
        VALUES ($1, $2, $3, $4, NOW())
      `, [
                this.batchId,
                state,
                city,
                errorMessage
            ]);
        } catch (error) {
            logger.error(`Error recording task failure: ${error.message}`);
        }
    }

    /**
     * Update state progress
     * @param {string} state - State name
     */
    async updateStateProgress(state) {
        try {
            await db.query(`
        INSERT INTO batch_state_progress (
          batch_id, state, total_cities, completed_cities, failed_cities, last_updated
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (batch_id, state) 
        DO UPDATE SET
          completed_cities = $4,
          failed_cities = $5,
          last_updated = NOW()
      `, [
                this.batchId,
                state,
                this.batchStateProgress[state].total,
                this.batchStateProgress[state].completed,
                this.batchStateProgress[state].failed
            ]);
        } catch (error) {
            logger.error(`Error updating state progress: ${error.message}`);
        }
    }

    /**
     * Get batch status
     * @returns {Object} Batch status
     */
    getBatchStatus() {
        return {
            batchId: this.batchId,
            isRunning: this.batchIsRunning,
            totalTasks: this.batchTotalTasks,
            completedTasks: this.batchCompletedTasks,
            failedTasks: this.batchFailedTasks,
            remainingTasks: this.batchTaskQueue.length + this.batchRunningTasks,
            currentState: this.batchCurrentState,
            currentCity: this.batchCurrentCity,
            progress: this.batchTotalTasks ? (this.batchCompletedTasks + this.batchFailedTasks) / this.batchTotalTasks : 0,
            stateProgress: this.batchStateProgress
        };
    }

    /**
     * Stop the batch process
     * @returns {Object} Stop result
     */
    async stop() {
        if (!this.batchIsRunning) {
            return { stopped: false, message: 'No batch is running' };
        }

        this.batchIsRunning = false;
        this.batchTaskQueue = [];

        // Record stop in database
        try {
            await db.query(`
        UPDATE batch_operations
        SET 
          status = $1, 
          end_time = NOW(),
          completed_tasks = $2,
          failed_tasks = $3
        WHERE id = $4
      `, [
                'stopped',
                this.batchCompletedTasks,
                this.batchFailedTasks,
                this.batchId
            ]);
        } catch (error) {
            logger.error(`Error recording batch stop: ${error.message}`);
        }

        return {
            stopped: true,
            completedTasks: this.batchCompletedTasks,
            remainingTasks: this.batchRunningTasks
        };
    }

    // ======================================
    // STATISTICS
    // ======================================

    /**
     * Get system statistics
     * @returns {Object} Statistics
     */
    async getStatistics() {
        try {
            const businessCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings');
            const emailCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
            const websiteCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE website IS NOT NULL AND website != \'\'');
            const searchTerms = await db.getMany('SELECT DISTINCT search_term FROM business_listings');
            const states = await db.getMany('SELECT DISTINCT state FROM business_listings WHERE state IS NOT NULL');

            return {
                totalBusinesses: parseInt(businessCount.count),
                totalEmails: parseInt(emailCount.count),
                totalWebsites: parseInt(websiteCount.count),
                totalSearchTerms: searchTerms.length,
                states: states.map(row => row.state).filter(Boolean)
            };
        } catch (error) {
            logger.error(`Error getting statistics: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get businesses with optional filtering
     * @param {string} searchTerm - Optional search term filter
     * @returns {Array} Array of businesses
     */
    async getBusinesses(searchTerm = null) {
        let query, params;

        if (searchTerm) {
            query = `
        SELECT 
          id, name, email, address, city, state, country, website, domain, rating, 
          phone, search_term, search_date, verified, contacted, notes
        FROM business_listings 
        WHERE search_term = $1
        ORDER BY name
      `;
            params = [searchTerm];
        } else {
            query = `
        SELECT 
          id, name, email, address, city, state, country, website, domain, rating, 
          phone, search_term, search_date, verified, contacted, notes
        FROM business_listings
        ORDER BY created_at DESC
        LIMIT 500
      `;
            params = [];
        }

        return await db.getMany(query, params);
    }
}

// Create singleton instance
const scraperService = new ScraperService();

// Export the service
module.exports = scraperService;
