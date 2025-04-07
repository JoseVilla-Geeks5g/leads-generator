const { chromium } = require('playwright');
const db = require('./database'); // Fix database path
const logger = { // Create simple logger that matches your project's logger interface
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};
const path = require('path');
const fs = require('fs');
const os = require('os');

// Replace debug with logger throughout the file
class EmailFinder {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.contextPool = []; // For parallelization
    this.pagePool = []; // For parallelization
    this.queue = [];
    this.runningTasks = 0;
    this.processed = 0;
    this.emailsFound = 0;
    this.isRunning = false;
    this.isStopping = false;
    this.currentWebsites = new Map(); // Track multiple sites for parallel processing

    // Configuration options with defaults
    this.options = {
      maxConcurrentTasks: 4,          // Process 4 sites at a time (default parallelization)
      maxRetries: 3,                  // Number of retry attempts
      timeout: 30000,                 // 30 seconds timeout
      searchDepth: 1,                 // How many pages deep to search
      searchWhois: false,             // Disable WHOIS search by default
      searchSocialMedia: true,        // Whether to search linked social media
      useSearchEngines: true,         // NEW: Whether to use search engines as last resort
      searchEngine: 'google',         // NEW: Which search engine to use (google, bing, duckduckgo)
      maxSearchResults: 5,            // NEW: Maximum search results to check
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      takeScreenshots: false,         // Whether to save screenshots for debugging
      minDelay: 1000,                 // Minimum delay between requests
      maxDelay: 3000,                 // Maximum delay between requests
      ...options
    };

    // Adjust concurrency based on system resources
    const cpuCount = os.cpus().length;
    if (!options.maxConcurrentTasks) {
      // Use 50% of available CPUs but at least 2 and at most 8
      this.options.maxConcurrentTasks = Math.max(2, Math.min(Math.floor(cpuCount / 2), 8));
      logger.info(`Auto-configured email finder to use ${this.options.maxConcurrentTasks} concurrent tasks based on ${cpuCount} CPUs`);
    }

    // Regular expressions for email extraction - enhanced patterns
    this.emailRegexes = [
      // Basic email regex
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      // More targeted for contact pages
      /(?:mailto:|email|e-mail|email us at|contact us at|send.*email to).*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
      // Look for email in text nodes
      /contact.*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
      /info.*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/gi,
      // Common email prefixes
      /(?:sales|support|help|admin|info|contact|hello|team|marketing|media)@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/gi,
      // Email obfuscation techniques
      /\b[A-Za-z0-9._%+-]+\s*[\[\(]at\[\)\]\s*[A-Za-z0-9.-]+\s*[\[\(]dot\[\)\]\s*[A-Z|a-z]{2,}\b/gi,
      // Email with entity encoding
      /\b[A-Za-z0-9._%+-]+&#[x0]*40;[A-Za-z0-9.-]+&#[x0]*46;[A-Z|a-z]{2,}\b/gi,
    ];

    // Setup debug directory
    this.debugDir = path.join(__dirname, 'debug/emailfinder');
    if (this.options.takeScreenshots && !fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }

    // Track resource usage
    this.memoryUsage = { rss: 0, heapTotal: 0, heapUsed: 0 };
    setInterval(() => {
      this.memoryUsage = process.memoryUsage();
      if (this.memoryUsage.heapUsed > 1.5 * 1024 * 1024 * 1024) { // 1.5 GB
        logger.warn(`High memory usage: ${Math.round(this.memoryUsage.heapUsed / 1024 / 1024)} MB`);
      }
    }, 60000);
  }

  // Replace all instances of debug with logger in this file
  async initialize() {
    try {
      if (this.browser) {
        // Already initialized
        return;
      }

      logger.info('Initializing email finder browser');

      // Launch browser with enhanced privacy settings
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-extensions',
          '--disable-popup-blocking',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });

      // Initialize pool of contexts and pages for parallelization
      for (let i = 0; i < this.options.maxConcurrentTasks; i++) {
        // Create context with better privacy and anti-bot detection
        const context = await this.browser.newContext({
          userAgent: this.options.userAgent,
          viewport: { width: 1920, height: 1080 },
          locale: 'en-US',
          timezoneId: 'America/New_York',
          bypassCSP: true,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          ignoreHTTPSErrors: true, // Handle HTTPS errors gracefully
          javaScriptEnabled: true,
          permissions: ['notifications']
        });

        // Set up browser anti-detection measures
        await context.addInitScript(() => {
          // Overwrite property to hide automated browser
          Object.defineProperty(navigator, 'webdriver', { get: () => false });

          // Add dummy plugins to appear more like a real browser
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5].map(() => ({ length: 1 }))
          });

          // Strengthen fingerprint masking
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
          });

          // Hide automation by tricking common detection methods
          window.chrome = {
            runtime: {}
          };
        });

        // Create page in this context
        const page = await context.newPage();

        // Store in pools
        this.contextPool.push(context);
        this.pagePool.push(page);
      }

      // Keep backward compatibility
      this.context = this.contextPool[0];
      this.page = this.pagePool[0];

      logger.info(`Email finder initialized successfully with ${this.options.maxConcurrentTasks} parallel workers`);
      return true;
    } catch (error) {
      logger.error(`Error initializing email finder: ${error.message}`);
      // Cleanup if initialization fails
      await this.close().catch(e => logger.error(`Cleanup error: ${e.message}`));
      throw error;
    }
  }

  async close() {
    logger.info('Closing email finder resources');
    try {
      // Close all pages in the pool
      for (const page of this.pagePool) {
        if (page) {
          await page.close().catch(e => logger.warn(`Error closing page: ${e.message}`));
        }
      }
      this.pagePool = [];
      this.page = null;

      // Close all contexts in the pool
      for (const context of this.contextPool) {
        if (context) {
          await context.close().catch(e => logger.warn(`Error closing context: ${e.message}`));
        }
      }
      this.contextPool = [];
      this.context = null;

      // Close main browser
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      logger.info('Email finder resources closed');
    } catch (error) {
      logger.error(`Error closing email finder resources: ${error.message}`);
    }
  }

  // Process all businesses without emails - with improved reliability and resume capability
  async processAllPendingBusinesses(options = {}) {
    const searchOptions = { ...this.options, ...options };
    let resumeOffset = 0;
    let totalProcessed = 0;

    try {
      if (this.isRunning) {
        logger.info('Email finder is already running');
        return 0;
      }

      this.isRunning = true;
      this.isStopping = false;
      this.processed = 0;
      this.emailsFound = 0;
      this.currentWebsites.clear();

      // Attempt to load progress state from temporary file if it exists
      const progressFile = path.join(__dirname, 'email_finder_progress.json');
      if (fs.existsSync(progressFile)) {
        try {
          const savedProgress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
          if (savedProgress.timestamp && (Date.now() - savedProgress.timestamp < 24 * 60 * 60 * 1000)) {
            // Only resume if the saved state is less than 24 hours old
            resumeOffset = savedProgress.offset || 0;
            totalProcessed = savedProgress.totalProcessed || 0;
            this.processed = totalProcessed;
            logger.info(`Resuming from previous run at offset ${resumeOffset}, already processed ${totalProcessed} businesses`);
          }
        } catch (err) {
          logger.warn(`Failed to load progress state: ${err.message}`);
        }
      }

      // Initialize if needed
      if (!this.browser) {
        await this.initialize();
      }

      // Process in smaller batches to prevent memory issues and enable better resuming
      const batchSize = 100; // Process 100 businesses at a time
      let hasMoreBusinesses = true;

      while (hasMoreBusinesses && !this.isStopping) {
        // Build query and parameters with offset for pagination
        const conditions = [];
        const params = [];

        // Base WHERE conditions that are always included
        const baseWhere = `website IS NOT NULL AND website != '' AND (email IS NULL OR email = '')`;

        // Add optional conditions with proper parameter indexing
        if (searchOptions.batchId) {
          params.push(searchOptions.batchId);
          conditions.push(`batch_id = $${params.length}`);
        }

        if (searchOptions.business_ids) {
          params.push(searchOptions.business_ids);
          conditions.push(`id = ANY($${params.length})`);
        }

        if (searchOptions.domain) {
          params.push(searchOptions.domain);
          conditions.push(`domain = $${params.length}`);
        }

        // Skip contacted businesses if specified
        if (searchOptions.skipContacted) {
          conditions.push(`(contacted IS NULL OR contacted = FALSE)`);
        }

        // Add domain filter if specified
        if (searchOptions.domainFilter) {
          params.push(`%${searchOptions.domainFilter}%`);
          conditions.push(`domain LIKE $${params.length}`);
        }

        // Add limit and offset parameters
        const limit = Math.min(batchSize, searchOptions.limit || 1000);
        params.push(limit);
        params.push(resumeOffset);

        // Build the final query with OFFSET for pagination
        const query = `
          SELECT id, name, website, domain
          FROM business_listings
          WHERE ${baseWhere}
          ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
          ORDER BY id
          LIMIT $${params.length - 1} 
          OFFSET $${params.length}
        `;

        logger.info(`Email finder batch query with offset ${resumeOffset}: ${query.replace(/\s+/g, ' ')}`);

        // Query the database
        const businesses = await db.getMany(query, params);

        // Check if we have more businesses to process after this batch
        hasMoreBusinesses = businesses.length === limit &&
          (totalProcessed + businesses.length < (searchOptions.limit || Infinity));

        logger.info(`Got batch of ${businesses.length} businesses to process starting at offset ${resumeOffset}`);

        if (businesses.length === 0) {
          break; // No more businesses to process
        }

        // Add to queue and start processing
        this.queue = [...businesses];

        // Start processing this batch
        await this.processQueue(searchOptions);

        // Update progress
        resumeOffset += businesses.length;
        totalProcessed += businesses.length;

        // Save progress state to file for potential resume
        try {
          fs.writeFileSync(progressFile, JSON.stringify({
            offset: resumeOffset,
            totalProcessed,
            timestamp: Date.now()
          }));
        } catch (err) {
          logger.warn(`Failed to save progress state: ${err.message}`);
        }

        // Reset browser and page pool every few batches to prevent memory issues
        if (resumeOffset % 300 === 0) {
          logger.info('Recycling browser to prevent memory issues');
          await this.recycleBrowser();
        }
      }

      // Clean up progress file when complete
      try {
        if (fs.existsSync(progressFile)) {
          fs.unlinkSync(progressFile);
        }
      } catch (err) {
        logger.warn(`Failed to remove progress file: ${err.message}`);
      }

      logger.info(`Email finder completed. Processed ${this.processed} websites, found ${this.emailsFound} emails.`);
      return this.processed;
    } catch (error) {
      logger.error(`Error in processAllPendingBusinesses: ${error.message}`);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  // New method to recycle the browser instance to prevent memory leaks
  async recycleBrowser() {
    logger.info('Recycling browser to free up memory...');

    // Set a flag to prevent new tasks from starting during recycling
    this.isRecycling = true;

    try {
      // Wait a moment for any in-flight operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Close current browser and all resources
      await this.close();

      // Wait a bit before reopening
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Clear any references to old objects
      this.browser = null;
      this.page = null;
      this.pagePool = [];
      this.contextPool = [];

      // Re-initialize browser
      await this.initialize();

      logger.info('Browser recycled successfully');
    } catch (error) {
      logger.error(`Error recycling browser: ${error.message}`);

      // Try to recover with a new browser instance
      try {
        this.browser = null;
        this.page = null;
        this.pagePool = [];
        this.contextPool = [];
        await this.initialize();
        logger.info('Recovered with new browser instance after recycling error');
      } catch (e) {
        logger.error(`Failed to recover after browser recycling error: ${e.message}`);
      }
    } finally {
      // Clear the recycling flag
      this.isRecycling = false;
    }
  }

  // Process specific businesses by IDs
  async processBusinesses(businessIds, options = {}) {
    if (!Array.isArray(businessIds)) {
      logger.error('businessIds must be an array');
      return 0;
    }

    return this.processAllPendingBusinesses({
      ...options,
      business_ids: businessIds
    });
  }

  // Stop processing
  async stop() {
    logger.info('Stopping email finder');
    this.isStopping = true;
    this.queue = [];
    return {
      processed: this.processed,
      emailsFound: this.emailsFound
    };
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      isStopping: this.isStopping,
      processed: this.processed,
      emailsFound: this.emailsFound,
      queueLength: this.queue.length,
      runningTasks: this.runningTasks,
      currentWebsites: Array.from(this.currentWebsites.values()),
      memoryUsage: {
        heapUsed: Math.round(this.memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(this.memoryUsage.heapTotal / 1024 / 1024)
      }
    };
  }

  // Process the queue of businesses in parallel with better error handling
  async processQueue(options) {
    // Create a map of free worker IDs (indexes in the pagePool)
    const freeWorkers = new Set(Array.from({ length: this.options.maxConcurrentTasks }, (_, i) => i));
    const activePromises = new Map(); // Track active promises for better error handling

    logger.info(`Starting to process ${this.queue.length} businesses with ${this.options.maxConcurrentTasks} parallel workers`);

    // Process until queue is empty or stopping is requested
    while (this.queue.length > 0 && !this.isStopping) {
      // Don't start new tasks if we're recycling
      if (this.isRecycling) {
        logger.info('Browser recycling in progress, pausing new task assignment');
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (freeWorkers.size === 0) {
        // All workers are busy, wait for at least one to complete
        try {
          // Wait for any promise to settle (either resolved or rejected)
          if (activePromises.size > 0) {
            const promises = Array.from(activePromises.values());
            await Promise.race(promises);

            // Check for free workers now
            if (freeWorkers.size === 0) {
              // Still no free workers, wait a little bit before checking again
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } else {
            // No active promises but no free workers? Something's wrong, short wait
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        } catch (error) {
          // If a worker promise fails, log and continue
          logger.error(`Worker promise failed: ${error.message}`);
          continue;
        }
      }

      // Get a free worker ID
      const workerId = freeWorkers.values().next().value;
      freeWorkers.delete(workerId);

      // Get next business to process
      const business = this.queue.shift();

      // Validate worker page before assigning task
      const isWorkerValid = await this.isPageValid(this.pagePool[workerId], workerId)
        .catch(() => false);

      // If worker is not valid, try to recover it first
      if (!isWorkerValid) {
        logger.warn(`Worker ${workerId} appears to be invalid, attempting to recover before assigning task`);

        try {
          await this.recoverWorkerContext(workerId);
        } catch (e) {
          logger.error(`Failed to recover worker ${workerId}: ${e.message}`);

          // Put business back in queue and return the worker ID to the pool
          this.queue.unshift(business);
          freeWorkers.add(workerId);

          // Short pause before trying next worker
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }

      // Process business with this worker
      const promise = this.processBusiness(business, options, workerId)
        .catch(error => {
          logger.error(`Worker ${workerId} failed: ${error.message}`);
          return null; // Return null on error so the promise resolves
        })
        .finally(() => {
          // Free up the worker when done
          freeWorkers.add(workerId);
          activePromises.delete(workerId);
        });

      // Store the promise to track it
      activePromises.set(workerId, promise);

      // Small delay between starting tasks to spread out resource usage
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Wait for all remaining tasks to complete with timeout protection
    if (activePromises.size > 0) {
      logger.info(`Waiting for ${activePromises.size} active tasks to complete...`);

      // Wait with a generous timeout to avoid hanging indefinitely
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes max wait
      const waitStart = Date.now();

      while (activePromises.size > 0 && Date.now() - waitStart < maxWaitTime && !this.isStopping) {
        try {
          const promises = Array.from(activePromises.values());
          // Wait for any promise to complete with a 10-second timeout
          await Promise.race([
            Promise.race(promises),
            new Promise(r => setTimeout(r, 10000))
          ]);

          // Short wait before next check
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Error waiting for tasks to complete: ${error.message}`);
        }
      }

      if (activePromises.size > 0) {
        logger.warn(`Timed out waiting for all tasks to complete. ${activePromises.size} still active.`);
      }
    }
  }

  // Process a single business website using a specific worker
  async processBusiness(business, options, workerId = 0) {
    this.runningTasks++;

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
      while (retries < options.maxRetries && !success) {
        try {
          // ONLY search for real emails - no generation
          if (business.website) {
            const websiteEmails = await this.extractEmailsFromWebsite(business.website, options, workerId);
            emails = emails.concat(websiteEmails);
          }

          // If no emails found and domain is available, try with the domain
          if (emails.length === 0 && business.domain) {
            // Clean and validate the domain first
            let cleanDomain = business.domain;

            // Remove protocol if accidentally included
            cleanDomain = cleanDomain.replace(/^https?:\/\//, '');

            // Remove www if present for consistency
            cleanDomain = cleanDomain.replace(/^www\./, '');

            // Remove any paths or trailing slashes
            cleanDomain = cleanDomain.split('/')[0];

            logger.info(`Worker ${workerId}: No emails found on main page, trying contact pages for domain: ${cleanDomain}`);

            // Try common contact pages - ONLY for real email extraction
            const contactUrls = [
              // Standard paths
              `https://${cleanDomain}/contact`,
              `https://${cleanDomain}/contact-us`,
              `https://${cleanDomain}/about-us`,
              `https://${cleanDomain}/about`,
              `https://www.${cleanDomain}/contact`,
              `https://www.${cleanDomain}/contact-us`,

              // Additional with stronger error handling
              `https://${cleanDomain}/support`,
              `https://${cleanDomain}/help`,
              `https://${cleanDomain}/faq`,
              `https://${cleanDomain}/team`,
              `https://${cleanDomain}/staff`,
              `https://${cleanDomain}/info`,
              `https://${cleanDomain}/information`,
              `https://${cleanDomain}/get-in-touch`,
              `https://${cleanDomain}/company`,
              `https://${cleanDomain}/company/contact`,
              `https://${cleanDomain}/company/about`,
              `https://${cleanDomain}/reach-us`,
              `https://${cleanDomain}/contacto`,
              `https://${cleanDomain}/kontakt`,
              `https://${cleanDomain}/our-team`,
              `https://${cleanDomain}/directory`
            ];

            // Try each contact URL until we find emails, with improved error handling
            for (const url of contactUrls) {
              try {
                if (emails.length === 0 && !this.isStopping) {
                  logger.info(`Worker ${workerId}: Trying contact page ${url}`);

                  // Set shorter timeout for contact pages
                  const contactPageOptions = {
                    ...options,
                    timeout: Math.min(options.timeout, 15000) // Max 15 seconds for contact pages
                  };

                  const contactEmails = await this.extractEmailsFromWebsite(url, contactPageOptions, workerId);

                  if (contactEmails && contactEmails.length > 0) {
                    logger.info(`Worker ${workerId}: Found ${contactEmails.length} emails on ${url}`);
                    emails = emails.concat(contactEmails);
                    break; // Exit loop once we find emails
                  }
                }
              } catch (contactError) {
                // Log but continue to next URL
                logger.warn(`Worker ${workerId}: Error checking contact URL ${url}: ${contactError.message}`);
                continue;
              }

              // Small delay between contact page attempts to avoid overloading
              await this.randomDelay(300, 700);
            }
          }

          success = true;
        } catch (error) {
          retries++;
          logger.warn(`Worker ${workerId}: Retry ${retries}/${options.maxRetries} for ${business.website}: ${error.message}`);

          // Wait before retrying
          await this.randomDelay(options.minDelay * retries, options.maxDelay * retries);
        }
      }

      // Process found emails - if none found, return null
      if (emails.length > 0) {
        // Remove duplicates and strictly filter out suspicious/invalid emails
        emails = this.prioritizeEmails(emails, business.domain);

        // Apply more strict validation to ensure we only get real emails
        const uniqueEmails = [...new Set(emails)].filter(email => {
          // Filter out common unwanted emails and ensure proper format
          const isRealEmail = this.isValidEmail(email) &&
            !email.match(/example|test|placeholder|noreply|no-reply|@sample|@test|support@|contact@|info@.*\.com$/i);

          // Extra check: if it's an email not hosted on the same domain, be extra cautious
          if (business.domain && !email.includes(business.domain.replace('www.', ''))) {
            // Generic emails from other domains need extra scrutiny - ensure they're definitely real
            // by checking they were found in specific contexts like mailto: links
            return this.highConfidenceEmail(email);
          }

          return isRealEmail;
        });

        if (uniqueEmails.length > 0) {
          // Use the best found email - domain emails prioritized already by prioritizeEmails
          const primaryEmail = uniqueEmails[0];

          // Save to the database
          await this.saveEmailToDatabase(business.id, primaryEmail, uniqueEmails.join(', '));

          this.emailsFound++;
          logger.info(`Worker ${workerId}: Found REAL email for ${business.website}: ${primaryEmail}`);

          return uniqueEmails[0]; // Return only the best email
        } else {
          logger.info(`Worker ${workerId}: Only found invalid/suspicious emails for ${business.website} - not using them`);
        }
      } else {
        logger.info(`Worker ${workerId}: No emails found for ${business.website} - returning null`);
      }

      // If no valid emails found, return null
      return null;
    } catch (error) {
      logger.error(`Worker ${workerId}: Error processing ${business.website}: ${error.message}`);
      return null;
    } finally {
      this.processed++;
      this.runningTasks--;
      this.currentWebsites.delete(workerId);
    }
  }

  // Extract emails from a website with enhanced error recovery
  async extractEmailsFromWebsite(url, options, workerId = 0) {
    // First validate that we have a working browser and page
    if (!this.browser || !this.pagePool[workerId]) {
      logger.warn(`Worker ${workerId}: Page or browser not available, attempting to reinitialize`);
      try {
        // Wait for any pending operations to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try to reinitialize just this worker
        if (!this.browser) {
          await this.initialize();
        } else if (!this.pagePool[workerId]) {
          await this.recoverWorkerContext(workerId);
        }
      } catch (initError) {
        logger.error(`Worker ${workerId}: Failed to reinitialize browser: ${initError.message}`);
        return []; // Return empty result since we can't proceed
      }
    }

    // Verify we have a valid page after reinitialization attempt
    if (!this.pagePool[workerId]) {
      logger.error(`Worker ${workerId}: Still no valid page after reinitialization`);
      return [];
    }

    const page = this.pagePool[workerId];
    const maxRetries = 2;
    let retryCount = 0;

    // Now proceed with the existing extraction logic with the verified page
    while (retryCount <= maxRetries) {
      try {
        logger.info(`Worker ${workerId}: Visiting ${url} (attempt ${retryCount + 1}/${maxRetries + 1})`);

        // Validate URL format first
        if (!url || !url.startsWith('http')) {
          throw new Error(`Invalid URL format: ${url}`);
        }

        // IMPORTANT: Create a new page for each navigation to avoid context issues
        // This is more reliable than trying to reuse the same page
        try {
          // Close the existing page if it exists
          if (this.pagePool[workerId]) {
            await this.pagePool[workerId].close().catch(e => {
              logger.warn(`Worker ${workerId}: Error closing existing page: ${e.message}`);
            });
          }

          // Create a fresh page in the existing context
          const context = this.contextPool[workerId];
          if (!context) {
            throw new Error("Context is not available, need full reinitialization");
          }

          // Create new page in this context
          const newPage = await context.newPage();
          this.pagePool[workerId] = newPage; // Update our working reference

          logger.info(`Worker ${workerId}: Created fresh page for navigation`);
        } catch (pageError) {
          logger.error(`Worker ${workerId}: Failed to create fresh page: ${pageError.message}`);
          // Fall back to full context recovery as a last resort
          await this.recoverWorkerContext(workerId);
        }

        // Set a reasonable timeout
        page.setDefaultTimeout(options.timeout || 30000);

        // First check if page is valid and accessible
        let navigationSuccess = false;
        let navigationAttempts = 0;
        let pageStable = false;

        while (!navigationSuccess && navigationAttempts < 2) {
          try {
            // Use a more reliable navigation approach with longer timeouts
            await page.goto(url, {
              waitUntil: 'domcontentloaded', // Changed from 'load' to be more reliable
              timeout: options.timeout * 1.2 // Give extra time for navigation
            });

            // Wait for the page to stabilize
            await page.waitForTimeout(1500);

            // Verify the page loaded successfully by checking that document and body exist
            pageStable = await page.evaluate(() => {
              return document && document.body ? true : false;
            }).catch(e => {
              logger.warn(`Worker ${workerId}: Page stability check failed: ${e.message}`);
              return false;
            });

            if (pageStable) {
              navigationSuccess = true;
              logger.info(`Worker ${workerId}: Successfully loaded ${url}`);
            } else {
              throw new Error("Page not stable after navigation");
            }
          } catch (navError) {
            navigationAttempts++;
            logger.warn(`Worker ${workerId}: Navigation attempt ${navigationAttempts} failed for ${url}: ${navError.message}`);

            // Try with www. prefix if it might be missing
            if (navigationAttempts === 1 && !url.includes('www.') && url.startsWith('http')) {
              const wwwUrl = url.replace('://', '://www.');
              logger.info(`Worker ${workerId}: Retrying with www prefix: ${wwwUrl}`);

              try {
                // Try with longer timeout for www version
                await page.goto(wwwUrl, {
                  waitUntil: 'domcontentloaded',
                  timeout: options.timeout * 1.5
                });

                // Verify page is stable
                await page.waitForTimeout(1000);
                pageStable = await page.evaluate(() => {
                  return document && document.body ? true : false;
                }).catch(() => false);

                if (pageStable) {
                  navigationSuccess = true;
                  logger.info(`Worker ${workerId}: Successfully loaded ${wwwUrl}`);
                }
              } catch (wwwError) {
                logger.warn(`Worker ${workerId}: Failed with www prefix too: ${wwwError.message}`);
              }
            }

            if (!navigationSuccess) {
              // Reset page state to avoid issues with partially loaded pages
              try {
                await page.goto('about:blank', { waitUntil: 'load', timeout: 5000 });
                await page.waitForTimeout(500);
              } catch (e) {
                // Ignore errors on reset
              }

              // Delay before next attempt
              const backoffDelay = Math.min(1000 * Math.pow(2, navigationAttempts), 5000);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
          }
        }

        // If we still couldn't navigate successfully, throw an error
        if (!navigationSuccess) {
          throw new Error(`Could not navigate to ${url} after multiple attempts`);
        }

        // Extract emails with robust error handling
        const emails = await this.extractEmailsWithRetry(page, url, workerId);
        return emails;

      } catch (error) {
        // Check if error is related to closed browser/context
        const needsRecovery = error.message.includes('context') ||
          error.message.includes('closed') ||
          error.message.includes('destroyed') ||
          error.message.includes('detached') ||
          error.message.includes('undefined');

        if (needsRecovery) {
          logger.warn(`Worker ${workerId}: Browser context issue detected: ${error.message}. Attempting recovery.`);

          // Full context recovery for any execution context issues
          try {
            await this.recoverWorkerContext(workerId);
            // Short delay after recovery
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (recoveryError) {
            logger.error(`Worker ${workerId}: Failed to recover context: ${recoveryError.message}`);
          }
        }

        // Implement exponential backoff for retries
        retryCount++;

        if (retryCount <= maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
          logger.warn(`Worker ${workerId}: Error extracting emails (attempt ${retryCount}/${maxRetries + 1}), retrying in ${backoffDelay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        } else {
          logger.error(`Worker ${workerId}: Failed to extract emails after ${maxRetries + 1} attempts: ${error.message}`);
          return []; // Return empty array after all retries failed
        }
      }
    }

    return []; // Return empty array if somehow we exit the retry loop
  }

  // New method to recover a specific worker's context and page - improved version
  async recoverWorkerContext(workerId) {
    logger.info(`Recovering browser context for worker ${workerId}`);

    try {
      // Close existing resources if they exist
      if (this.pagePool[workerId]) {
        await this.pagePool[workerId].close().catch(e =>
          logger.warn(`Error closing worker ${workerId} page: ${e.message}`)
        );
        this.pagePool[workerId] = null;
      }

      if (this.contextPool[workerId]) {
        await this.contextPool[workerId].close().catch(e =>
          logger.warn(`Error closing worker ${workerId} context: ${e.message}`)
        );
        this.contextPool[workerId] = null;
      }

      // Create new context and page
      if (this.browser) {
        const context = await this.browser.newContext({
          userAgent: this.options.userAgent,
          viewport: { width: 1920, height: 1080 },
          locale: 'en-US',
          timezone: 'America/New_York', // Using timezone instead of timezoneId
          bypassCSP: true,
          ignoreHTTPSErrors: true,
          javaScriptEnabled: true
        });

        // Add anti-detection script
        await context.addInitScript(() => {
          // Hide that we're automated
          Object.defineProperty(navigator, 'webdriver', { get: () => false });

          // Add more browser "fingerprints"
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5].map(() => ({ length: 1 }))
          });

          // Add chrome object expected by some detection scripts
          window.chrome = { runtime: {} };
        });

        const page = await context.newPage();

        // Update pools
        this.contextPool[workerId] = context;
        this.pagePool[workerId] = page;

        logger.info(`Worker ${workerId}: Successfully recovered browser context`);
        return true;
      } else {
        // If browser itself is invalid, we need to fully reinitialize
        await this.initialize();
        logger.info(`Full browser reinitialization completed for worker ${workerId}`);
        return true;
      }
    } catch (error) {
      logger.error(`Failed to recover context for worker ${workerId}: ${error.message}`);
      throw error; // Rethrow so caller knows recovery failed
    }
  }

  // New method to verify if a page is still valid
  async isPageValid(page, workerId) {
    if (!page) return false;

    try {
      // Try a simple operation that would fail if page is not valid
      await Promise.race([
        page.evaluate(() => true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
      ]);
      return true;
    } catch (e) {
      logger.warn(`Worker ${workerId}: Page validation failed: ${e.message}`);
      return false;
    }
  }

  // New method for processing contact URLs with better error handling
  async processContactUrls(contactUrls, domain, options, workerId) {
    let emails = [];

    // Try each contact URL until we find emails, with improved error handling
    for (const url of contactUrls) {
      try {
        if (emails.length === 0 && !this.isStopping) {
          logger.info(`Worker ${workerId}: Trying contact page ${url}`);

          // Set shorter timeout for contact pages
          const contactPageOptions = {
            ...options,
            timeout: Math.min(options.timeout, 15000) // Max 15 seconds for contact pages
          };

          // Clear page state before trying new URL
          try {
            await this.pagePool[workerId].goto('about:blank', { waitUntil: 'load', timeout: 5000 });
            await this.pagePool[workerId].waitForTimeout(300);
          } catch (e) {
            // Ignore errors on blank page
          }

          const contactEmails = await this.extractEmailsFromWebsite(url, contactPageOptions, workerId);

          if (contactEmails && contactEmails.length > 0) {
            logger.info(`Worker ${workerId}: Found ${contactEmails.length} emails on ${url}`);
            emails = emails.concat(contactEmails);
            break; // Exit loop once we find emails
          }
        }
      } catch (contactError) {
        // Log but continue to next URL
        logger.warn(`Worker ${workerId}: Error checking contact URL ${url}: ${contactError.message}`);
        continue;
      }

      // Small delay between contact page attempts to avoid overloading
      await this.randomDelay(300, 700);
    }

    return emails;
  }

  // Add cleanup method to avoid the "not a function" error
  async cleanup() {
    logger.info('Cleaning up email finder resources');
    try {
      await this.close();
    } catch (error) {
      logger.error(`Error in email finder cleanup: ${error.message}`);
    }
  }

  // FIXED: Search engine based email discovery with correct parameter name
  async searchEngineEmailDiscovery(domain, options, workerId = 0) {
    try {
      const searchEngine = options.searchEngine || this.options.searchEngine || 'google';
      logger.info(`Worker ${workerId}: Using ${searchEngine} to search for emails on domain ${domain}`);

      // Create a separate context for search engine queries with enhanced anti-bot measures
      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezone: 'America/New_York', // FIXED: Changed from timezoneId to timezone
        geolocation: { longitude: -73.58, latitude: 45.50 }, // New York area
        permissions: ['geolocation', 'notifications'],
        colorScheme: 'light',
        deviceScaleFactor: 1,
        hasTouch: false
      });

      // Enhanced anti-bot detection measures
      await context.addInitScript(() => {
        // Override navigator properties to look more human-like
        const originalNavigator = window.navigator;

        // Make navigator properties non-enumerable to avoid detection
        Object.defineProperty(window, 'navigator', {
          value: new Proxy(originalNavigator, {
            get: function (target, key) {
              switch (key) {
                case 'webdriver':
                  return false;
                case 'plugins':
                  // Create fake plugins
                  return {
                    length: 5,
                    refresh: () => { },
                    item: () => ({
                      description: 'PDF Viewer',
                      filename: 'internal-pdf-viewer',
                      name: 'Chrome PDF Viewer'
                    }),
                    namedItem: () => null
                  };
                case 'languages':
                  return ['en-US', 'en', 'es'];
                case 'platform':
                  return 'Win32';
                default:
                  return Reflect.get(target, key);
              }
            }
          }),
          configurable: false
        });

        // Add chrome object for detector evasion
        if (!window.chrome) {
          window.chrome = {
            runtime: {},
            loadTimes: () => { },
            csi: () => { },
            app: {}
          };
        }

        // Override permissions behavior
        const originalPermissions = window.Permissions;
        if (originalPermissions) {
          window.Permissions.prototype.query = async function (param) {
            return { state: 'granted', onchange: null };
          };
        }
      });

      const page = await context.newPage();
      const foundEmails = new Set();

      // Emulate human-like behavior - add mouse jiggler and scrolling
      this.setupHumanBehavior(page);

      // Track which search engine(s) we've tried
      const attemptedEngines = new Set();

      try {
        // Try multiple search engines in order of preference
        const engines = [searchEngine, 'bing', 'duckduckgo'].filter(
          (engine, index, self) => self.indexOf(engine) === index
        );

        for (const engine of engines) {
          if (foundEmails.size > 0) break; // Stop if we found emails
          if (attemptedEngines.has(engine)) continue; // Skip if already tried

          attemptedEngines.add(engine);
          logger.info(`Worker ${workerId}: Trying search engine: ${engine}`);

          // Create search queries optimized for finding emails - specialized for each search engine
          const searchQueries = this.getOptimizedQueries(domain, engine);

          // Try each search query until we find emails
          for (let i = 0; i < searchQueries.length; i++) {
            if (foundEmails.size > 0) break; // Stop if we already found emails

            const query = searchQueries[i];
            const searchUrl = this.buildSearchUrl(query, engine);

            logger.info(`Worker ${workerId}: Searching with ${engine} for "${query}"`);

            try {
              // Enhanced navigation with more human-like behavior
              await this.performHumanLikeSearch(page, searchUrl, workerId);

              // Take a screenshot for debugging if enabled
              if (options.takeScreenshots) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = path.join(this.debugDir, `search-${engine}-${this.sanitizeFilename(query)}-${timestamp}.png`);
                await page.screenshot({ path: filename, fullPage: true })
                  .catch(e => logger.warn(`Screenshot error: ${e.message}`));
              }

              // Check if we got a captcha or empty results
              const isCaptcha = await page.evaluate(() => {
                return document.title.includes('CAPTCHA') ||
                  document.body.textContent.includes('robot') ||
                  document.body.innerHTML.includes('recaptcha') ||
                  document.body.innerHTML.includes('security check');
              });

              if (isCaptcha) {
                logger.warn(`Worker ${workerId}: Detected CAPTCHA or security check on ${engine}, switching engines`);
                break; // Move to next engine
              }

              // Extract both visible and hidden content to find emails
              const pageContent = await page.content();
              const bodyText = await page.evaluate(() => document.body.innerText);

              logger.info(`Worker ${workerId}: Searching for emails in ${bodyText.length} characters of text`);

              // Direct email extraction from page content - simpler and more reliable
              const directEmails = this.extractEmailsFromText(pageContent, bodyText, domain);

              if (directEmails.length > 0) {
                directEmails.forEach(email => {
                  logger.info(`Worker ${workerId}: Found email directly in search results: ${email}`);
                  foundEmails.add(email.toLowerCase());
                });
                continue; // Try next query in case we find more
              }

              // Extract URLs from search results that might contain contact information
              const resultUrls = await this.extractSearchResultUrls(page, domain);
              logger.info(`Worker ${workerId}: Found ${resultUrls.length} result URLs to check`);

              if (resultUrls.length === 0) {
                logger.info(`Worker ${workerId}: No result URLs found, trying next search`);
                continue;
              }

              // Visit first few search result pages to find emails
              const maxToCheck = Math.min(resultUrls.length, options.maxSearchResults || 3);

              for (let j = 0; j < maxToCheck; j++) {
                if (foundEmails.size > 0) break; // Stop if we found emails

                try {
                  const url = resultUrls[j];
                  logger.info(`Worker ${workerId}: Checking result page ${j + 1}: ${url}`);

                  // Visit the page with human-like behavior
                  await this.visitPageHumanLike(page, url, workerId);

                  // Extract emails from this search result page
                  const resultPageEmails = await this.extractEmailsFromPage(page);

                  if (resultPageEmails.length > 0) {
                    resultPageEmails.forEach(email => {
                      foundEmails.add(email.toLowerCase());
                      logger.info(`Worker ${workerId}: Found email on result page: ${email}`);
                    });
                  }
                } catch (pageError) {
                  logger.warn(`Worker ${workerId}: Error visiting result: ${pageError.message}`);
                }

                // Random delay between visiting results
                await this.randomDelay(2000, 4000);
              }

              // Slightly longer delay between searches
              await this.randomDelay(3000, 5000);

            } catch (searchError) {
              logger.warn(`Worker ${workerId}: Error with search query: ${searchError.message}`);
              continue; // Try next query
            }
          }
        }
      } finally {
        // Always close the context when done
        await context.close().catch(e => logger.warn(`Error closing context: ${e.message}`));
      }

      return Array.from(foundEmails);
    } catch (error) {
      logger.error(`Worker ${workerId}: Search engine discovery failed: ${error.message}`);
      return [];
    }
  }

  // Helper to extract emails from text
  extractEmailsFromText(html, text, domain) {
    // Combine multiple regex patterns for better coverage
    const foundEmails = new Set();

    // Domain-specific regex to prioritize emails matching our domain
    const domainPattern = new RegExp(`\\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9.-]*\\.)?${domain.replace(/\./g, '\\.')}\\b`, 'gi');
    const domainMatches = html.match(domainPattern) || [];

    // Generic email pattern
    const genericPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
    const genericMatches = html.match(genericPattern) || [];

    // Look for email patterns in text (like "email: user@domain.com")
    const emailLabelPattern = /\b(?:email|e-mail|contact|mail)(?:\s+us)?(?:\s*(?:at|:|=|is|to))?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let match;
    const labelMatches = [];

    while ((match = emailLabelPattern.exec(text)) !== null) {
      if (match[1]) labelMatches.push(match[1]);
    }

    // Add all found emails to the result set
    [...domainMatches, ...labelMatches, ...genericMatches].forEach(email => {
      // Basic normalization to extract just the email
      const normalizedEmail = email.toLowerCase()
        .replace(/^.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}).*$/, '$1');

      if (this.isValidEmail(normalizedEmail)) {
        foundEmails.add(normalizedEmail);
      }
    });

    return Array.from(foundEmails);
  }

  // Get optimized search queries for different engines
  getOptimizedQueries(domain, engine) {
    const baseQueries = [
      // Direct domain queries
      `${domain} contact email`,
      `${domain} "email us"`,
      `${domain} "contact us"`,
      `${domain} "email:"`,

      // Common email prefixes for the domain
      `${domain} "contact@"`,
      `${domain} "info@"`,
      `${domain} "hello@"`,

      // Site-specific searches
      `site:${domain} email`,
      `site:${domain} contact`,
      `site:${domain} mailto:`,
    ];

    // Customize queries based on search engine
    switch (engine) {
      case 'google':
        return [
          ...baseQueries,
          `site:${domain} intitle:contact`,
          `site:${domain}/contact intext:email`,
          `site:${domain} intext:"email us" OR intext:"contact us"`,
          `site:${domain} intext:@${domain.split('.')[0]}`,
        ];

      case 'bing':
        return [
          ...baseQueries,
          `domain:${domain} email`,
          `site:${domain} contains:mailto`,
          `site:${domain} "get in touch"`,
        ];

      case 'duckduckgo':
        return baseQueries; // DuckDuckGo works well with the base queries

      default:
        return baseQueries;
    }
  }

  // Build search URL based on engine
  buildSearchUrl(query, engine) {
    const encodedQuery = encodeURIComponent(query);

    switch (engine) {
      case 'google':
        // Use multiple country versions to avoid geo-restrictions
        const googleDomains = ['com', 'co.uk', 'ca', 'com.au'];
        const domain = googleDomains[Math.floor(Math.random() * googleDomains.length)];
        return `https://www.google.${domain}/search?q=${encodedQuery}&num=100&hl=en`;

      case 'bing':
        return `https://www.bing.com/search?q=${encodedQuery}&count=50&cc=us`;

      case 'duckduckgo':
        return `https://duckduckgo.com/?q=${encodedQuery}&kl=us-en`;

      default:
        return `https://www.google.com/search?q=${encodedQuery}&num=50`;
    }
  }

  // Setup human-like behavior for page
  setupHumanBehavior(page) {
    try {
      // We'll implement this method to simulate mouse movements and scrolling
      page.on('load', async () => {
        try {
          await page.evaluate(() => {
            // Simulate random scrolling
            const scrollRandomly = () => {
              const maxScrolls = 3 + Math.floor(Math.random() * 5);
              let scrollCount = 0;

              const scroll = () => {
                if (scrollCount >= maxScrolls) return;

                const scrollAmount = 100 + Math.floor(Math.random() * 400);
                window.scrollBy(0, scrollAmount);
                scrollCount++;

                setTimeout(scroll, 500 + Math.random() * 1000);
              };

              setTimeout(scroll, 500);
            };

            // Start random scrolling
            scrollRandomly();
          });
        } catch (e) {
          // Ignore errors in human behavior simulation
        }
      });
    } catch (error) {
      logger.warn(`Error setting up human behavior: ${error.message}`);
    }
  }

  // Perform human-like search
  async performHumanLikeSearch(page, searchUrl, workerId) {
    try {
      logger.info(`Worker ${workerId}: Navigating to search URL: ${searchUrl}`);

      // Navigate with realistic parameters
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for a bit to let page fully render
      await page.waitForTimeout(2000 + Math.random() * 1000);

      // Accept any consent dialogs
      await this.handleConsentDialogs(page);

      // Random scrolling behavior
      await page.evaluate(() => {
        window.scrollBy(0, 300 + Math.random() * 400);
      });

      // Wait a bit longer
      await page.waitForTimeout(1000 + Math.random() * 1000);

      // Log the page title to help with debugging
      const pageTitle = await page.title();
      logger.info(`Worker ${workerId}: Search page loaded: "${pageTitle}"`);

      return true;
    } catch (error) {
      logger.warn(`Worker ${workerId}: Error in human-like search: ${error.message}`);
      throw error;
    }
  }

  // Visit a page with human-like behavior
  async visitPageHumanLike(page, url, workerId) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for network to be idle
      await page.waitForLoadState('networkidle').catch(() => { });

      // Random scrolling
      await page.evaluate(() => {
        const maxScroll = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );
        const scrollSteps = 5 + Math.floor(Math.random() * 5);
        const scrollStep = maxScroll / scrollSteps;

        for (let i = 1; i <= scrollSteps; i++) {
          setTimeout(() => {
            window.scrollTo(0, i * scrollStep);
          }, i * 300);
        }
      });

      // Wait for scrolling to complete
      await page.waitForTimeout(2000);

      // Accept any cookie prompts
      await this.acceptCookies(page);

      return true;
    } catch (error) {
      logger.warn(`Worker ${workerId}: Error visiting page: ${error.message}`);
      throw error;
    }
  }

  // Extract search result URLs with better targeting
  async extractSearchResultUrls(page, domain) {
    try {
      return await page.evaluate((targetDomain) => {
        // Get all links on the page
        const allLinks = Array.from(document.querySelectorAll('a[href^="http"]'))
          .map(a => a.href)
          .filter(href => {
            // Filter out search engine links and tracking URLs
            return !href.includes('google.com') &&
              !href.includes('bing.com') &&
              !href.includes('duckduckgo.com') &&
              !href.includes('youtube.com') &&
              !href.includes('facebook.com') &&
              !href.includes('linkedin.com') &&
              !href.includes('twitter.com') &&
              !href.includes('gstatic.com') &&
              !href.includes('webcache.googleusercontent.com') &&
              !href.includes('/search?') &&
              !href.includes('?utm_');
          });

        // Prioritize domain-related links
        const domainLinks = allLinks.filter(url => {
          try {
            return new URL(url).hostname.includes(targetDomain);
          } catch {
            return false;
          }
        });

        // Prioritize contact-related links
        const contactLinks = allLinks.filter(url =>
          url.includes('/contact') ||
          url.includes('/about') ||
          url.includes('/team') ||
          url.includes('/email') ||
          url.includes('/get-in-touch') ||
          url.includes('/staff')
        );

        // Combine links with priority order and remove duplicates
        return [...new Set([...domainLinks, ...contactLinks, ...allLinks])].slice(0, 15);
      }, domain);
    } catch (error) {
      logger.warn(`Error extracting search result URLs: ${error.message}`);
      return [];
    }
  }

  // Enhanced consent dialog handling with visual clue detection
  async handleConsentDialogs(page) {
    try {
      logger.info("Checking for consent dialogs to accept");

      // First try common selectors for buttons
      const commonSelectors = [
        // Google's consent dialogs
        'button[aria-label="Accept all"]',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Agree")',
        'form button[jsaction*="click"]',
        '#L2AGLb', // Google cookie consent button ID

        // Bing consent dialog
        'button[aria-label="Accept"]',
        'button:has-text("Accept")',
        '#bnp_btn_accept',

        // Generic consent buttons
        'button:has-text("OK")',
        'button:has-text("Accept cookies")',
        '.accept-cookies',
        '#accept-cookies',
        '.consent-btn',
        '.cookie-accept'
      ];

      // Try clicking each selector
      for (const selector of commonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            logger.info(`Found consent button with selector: ${selector}. Clicking...`);
            await button.click().catch(e => logger.warn(`Failed to click ${selector}: ${e.message}`));
            await page.waitForTimeout(1000);
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Try to find elements that LOOK like consent dialogs based on visual clues
      const foundConsentDialog = await page.evaluate(() => {
        // Helper to check if an element is visible
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0;
        };

        // Look for elements that might be consent dialogs based on common patterns
        const consentKeywords = [
          'consent', 'cookie', 'gdpr', 'accept', 'privacy',
          'we use cookies', 'data policy', 'agree'
        ];

        // First look for visible fixed position elements (often overlays)
        const possibleDialogs = Array.from(document.querySelectorAll('div[class*="consent"], div[class*="cookie"], div[class*="notice"], div[class*="banner"], div[class*="popup"], div[class*="modal"], div[id*="consent"], div[id*="cookie"]'))
          .filter(el => {
            const style = window.getComputedStyle(el);
            return isVisible(el) && (
              style.position === 'fixed' ||
              style.position === 'absolute'
            );
          });

        // Check if any of these elements contain consent keywords
        for (const dialog of possibleDialogs) {
          const text = dialog.textContent.toLowerCase();

          if (consentKeywords.some(keyword => text.includes(keyword))) {
            // Found a likely consent dialog, now look for buttons inside it
            const buttons = Array.from(dialog.querySelectorAll('button, a.button, a[class*="btn"], input[type="button"], input[type="submit"]'));

            // Try to find the accept button by looking at button text
            for (const button of buttons) {
              const buttonText = button.textContent.toLowerCase().trim();

              if (buttonText.includes('accept') ||
                buttonText.includes('agree') ||
                buttonText.includes('ok') ||
                buttonText.includes('yes')) {

                // This looks like an accept button - click it
                button.click();
                return true;
              }
            }

            // If we can't find a specific accept button, just click the first button
            if (buttons.length > 0) {
              buttons[0].click();
              return true;
            }
          }
        }

        return false;
      });

      if (foundConsentDialog) {
        logger.info("Found and clicked consent dialog through visual detection");
        await page.waitForTimeout(1000);
        return true;
      }

      return false;
    } catch (error) {
      logger.warn(`Error handling consent dialogs: ${error.message}`);
      return false;
    }
  }

  // Enhanced saveEmailToDatabase method for more reliable database updates
  async saveEmailToDatabase(businessId, email, allEmails) {
    if (!businessId || !email) {
      logger.error(`Cannot save email to database: Missing businessId=${businessId} or email=${email}`);
      return false;
    }

    // Log details for debugging
    logger.info(`Saving email "${email}" to database for business ID "${businessId}" (type: ${typeof businessId})`);

    // Convert businessId to number if it's a string containing a number
    const processedId = typeof businessId === 'string' && !isNaN(businessId) ?
      parseInt(businessId, 10) : businessId;

    // Log the processed ID
    if (processedId !== businessId) {
      logger.info(`Converted businessId from string "${businessId}" to number ${processedId}`);
    }

    const maxRetries = 2;
    let retryCount = 0;
    let success = false;

    while (!success && retryCount <= maxRetries) {
      try {
        // First attempt to use direct db.query for most reliable operation
        const result = await db.query(
          `UPDATE business_listings 
           SET email = $1, 
               notes = CASE 
                  WHEN notes IS NULL OR notes = '' THEN 'Email found: ' || $2
                  ELSE notes || ' | Email found: ' || $2
               END,
               updated_at = NOW() 
           WHERE id = $3
           RETURNING id, name`,
          [email, allEmails || email, processedId]
        );

        // Check if any rows were actually updated
        if (!result || result.rowCount === 0) {
          logger.warn(`No rows updated in business_listings for ID ${processedId}. Business may not exist.`);

          // Try the original ID if conversion was done
          if (processedId !== businessId) {
            logger.info(`Trying with original businessId format: ${businessId}`);

            const retryResult = await db.query(
              `UPDATE business_listings 
               SET email = $1, 
                   notes = CASE 
                      WHEN notes IS NULL OR notes = '' THEN 'Email found: ' || $2
                      ELSE notes || ' | Email found: ' || $2
                   END,
                   updated_at = NOW() 
               WHERE id = $3
               RETURNING id, name`,
              [email, allEmails || email, businessId]
            );

            if (retryResult && retryResult.rowCount > 0) {
              const businessName = retryResult.rows[0]?.name || 'Unknown';
              logger.info(`Successfully updated business "${businessName}" (ID: ${businessId}) with email ${email}`);
              success = true;

              // Also try to update legacy businesses table
              try {
                await db.query(
                  `UPDATE businesses SET email = $1 WHERE id = $2`,
                  [email, businessId]
                );
              } catch (legacyError) {
                logger.warn(`Could not update legacy businesses table: ${legacyError.message}`);
              }

              return true;
            } else {
              throw new Error(`Business with ID ${businessId} not found in database`);
            }
          } else {
            throw new Error(`Business with ID ${processedId} not found in database`);
          }
        } else {
          const businessName = result.rows[0]?.name || 'Unknown';
          logger.info(`Successfully updated business "${businessName}" (ID: ${processedId}) with email ${email}`);

          // Also update legacy businesses table if it exists
          try {
            await db.query(
              `UPDATE businesses SET email = $1 WHERE id = $2`,
              [email, processedId]
            );
            logger.info(`Also updated legacy businesses table for ID ${processedId}`);
          } catch (legacyError) {
            // Just log but don't treat as failure - legacy table is optional
            logger.warn(`Could not update legacy businesses table: ${legacyError.message}`);
          }

          success = true;
          return true;
        }
      } catch (error) {
        retryCount++;
        logger.error(`Error saving email to database (attempt ${retryCount}/${maxRetries + 1}): ${error.message}`);
        logger.error(`Stack trace: ${error.stack}`);

        // Try to get database connection status
        try {
          const isConnected = await db.testConnection();
          logger.info(`Database connection test: ${isConnected ? 'CONNECTED' : 'FAILED'}`);
        } catch (dbError) {
          logger.error(`Database connection test error: ${dbError.message}`);
        }

        if (retryCount <= maxRetries) {
          // Wait before retrying with exponential backoff
          const backoffDelay = 1000 * Math.pow(2, retryCount - 1);
          logger.info(`Retrying database update in ${backoffDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    // If we get here, all retries failed
    logger.error(`Failed to save email ${email} for business ID ${businessId} after ${maxRetries + 1} attempts`);
    return false;
  }

  // Save email to database
  async saveEmailToDatabase(businessId, email, allEmails) {
    if (!businessId || !email) {
      logger.warn(`Cannot save email to database: Missing businessId or email value`);
      return false;
    }

    const maxRetries = 2;
    let retryCount = 0;
    let success = false;

    while (!success && retryCount <= maxRetries) {
      try {
        // First update the main business_listings table
        await db.query(
          `UPDATE business_listings 
           SET email = $1, 
               notes = CASE 
                  WHEN notes IS NULL OR notes = '' THEN 'Other emails: ' || $2
                  ELSE notes || ' | Other emails: ' || $2
               END,
               updated_at = NOW() 
           WHERE id = $3`,
          [email, allEmails || email, businessId]
        );

        // Then try to update the legacy businesses table if it exists
        try {
          const legacyResult = await db.query(
            `UPDATE businesses 
             SET email = $1 
             WHERE id = $2
             RETURNING id`,
            [email, businessId]
          );

          // Log successful update to legacy table if any rows were affected
          if (legacyResult.rowCount > 0) {
            logger.info(`Updated email in legacy businesses table for ID ${businessId}`);
          }
        } catch (legacyError) {
          // Just log but don't treat as failure - legacy table is optional
          logger.warn(`Could not update legacy businesses table: ${legacyError.message}`);
        }

        logger.info(`Successfully saved email ${email} for business ID ${businessId}`);
        success = true;
        return true;
      } catch (error) {
        retryCount++;
        logger.error(`Error saving email to database (attempt ${retryCount}/${maxRetries + 1}): ${error.message}`);

        if (retryCount <= maxRetries) {
          // Wait before retrying with exponential backoff
          const backoffDelay = 1000 * Math.pow(2, retryCount - 1);
          logger.info(`Retrying database update in ${backoffDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    return success;
  }

  // Utility function to validate email format
  isValidEmail(email) {
    if (!email) return false;

    // Expanded basic validation
    const valid = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
    if (!valid) return false;

    // Filter suspicious domains and patterns
    const suspiciousPatterns = [
      /example\./i,
      /test(@|\.)/i,
      /placeholder/i,
      /noreply/i,
      /no-reply/i,
      /donotreply/i,
      /yourname/i,
      /youremail/i,
      /yourdomain/i,
      /someone@/i,
      /user@/i,
      /email@email/i,
      /email@domain/i,
      /sample@/i,
      /demo@/i
    ];

    // Check if email matches any suspicious pattern
    if (suspiciousPatterns.some(pattern => pattern.test(email))) {
      return false;
    }

    // Check for obviously fake TLDs
    const fakeTlds = /\.(test|example|invalid|localhost|local)$/i;
    if (fakeTlds.test(email)) {
      return false;
    }

    return true;
  }

  // Add random delay to appear more human-like
  async randomDelay(min, max) {
    const delay = Math.floor(min + Math.random() * (max - min));
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Sanitize filename for screenshots
  sanitizeFilename(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace(/[^\w.-]/g, '_');
    } catch (e) {
      return url.replace(/[^\w.-]/g, '_').substring(0, 50);
    }
  }

  // New method: Extract domain-specific emails
  async extractDomainSpecificEmails(page, domain) {
    try {
      // Clean the domain (remove www. and extract the main domain)
      const cleanDomain = domain.replace(/^www\./, '').split('.').slice(-2).join('.');

      // Create a regex specifically for this domain
      const domainRegex = new RegExp(`\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*${cleanDomain.replace('.', '\\.')}\\b`, 'gi');

      // Get page content and extract domain-specific emails
      const pageContent = await page.content();
      const matches = pageContent.match(domainRegex) || [];

      return matches;
    } catch (error) {
      logger.error(`Error extracting domain-specific emails: ${error.message}`);
      return [];
    }
  }

  // Enhanced method: Extract obfuscated emails with additional targeting
  async extractObfuscatedEmails(page, workerId = 0) {
    try {
      return await this.safeEvaluate(page, () => {
        const results = [];

        try {
          // Check if document.body exists before proceeding
          if (!document || !document.body) {
            return []; // Return empty array if document.body doesn't exist
          }

          // More sophisticated detection of obfuscated emails
          const obfuscationPatterns = [
            // Standard email pattern
            /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,

            // [at]/[dot] obfuscation - improved with variations
            /([a-zA-Z0-9._%+-]+)\s*[\[\(](?:at|@)[\]\)]\s*([a-zA-Z0-9.-]+)\s*[\[\(](?:dot|\.)[\]\)]\s*([a-zA-Z]{2,})/gi,

            // NEW: Patterns specifically for "email us at" format
            /email\s+(?:us|me)?\s*(?:at|@):?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
            /(?:contact|reach|mail|write)(?:\s+to)?(?:\s+us)?(?:\s+at):?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
            /(?:email|e-mail|mail|contact):?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
            /(?:for|with)?\s*(?:any|more|further)?\s*(?:questions|inquiries|information),?\s*(?:please|kindly)?\s*(?:contact|email|reach|write)(?:\s+to)?(?:\s+us)?\s*(?:at|@):?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
          ];

          // Get all text from the page
          const allText = document.body.innerText;

          // Apply all obfuscation patterns to find emails
          obfuscationPatterns.forEach(pattern => {
            const matches = allText.match(pattern) || [];
            results.push(...matches);
          });

          // NEW: Check specific elements where emails are likely to be found, with focus on <em> tags
          const potentialEmailContainers = [
            // Emphasis tags (high priority)
            'em', 'i', 'b', 'strong', 'span.email', '.contact-email', '.email-address',

            // Common contact containers
            '.contact-info', '.contact', '.email', '.footer-contact',
            '#contact', '#email', '#footer-contact',
            '[itemprop="email"]', '[data-email]',
            '.address', '.contact-details', '.vcard',
            'footer', '.footer', '.site-footer',
            '.info', '.contact-us', '.get-in-touch',
            '.social-media', '.team-member', '.staff-info',

            // NEW: Additional common containers
            '#contact-email', '.email-link', '[itemprop="email"]',
            '.email-container', '.mail', '.email-info',
            'address', '.address-block', '.contact-details',
            'dl dd', 'ul.contact li', '.contact-methods'
          ];

          // IMPROVED: More thorough scanning of elements
          potentialEmailContainers.forEach(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach(el => {
                // Check element text content
                const text = el.innerText || el.textContent || '';

                // Regular email pattern
                const emailMatches = text.match(/([a-zA-Z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi) || [];
                emailMatches.forEach(match => results.push(match));

                // Check for "email us at" pattern
                if (text.match(/email\s+(?:us|me)?\s*(?:at|:)/i)) {
                  const afterPhrase = text.split(/email\s+(?:us|me)?\s*(?:at|:)/i)[1]?.trim();
                  if (afterPhrase) {
                    const emailMatch = afterPhrase.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                    if (emailMatch) results.push(emailMatch[1]);
                  }
                }

                // Apply other patterns
                obfuscationPatterns.forEach(pattern => {
                  const matches = text.match(pattern) || [];
                  results.push(...matches);
                });
              });
            } catch (e) {
              // Ignore errors for individual selectors
            }
          });

          // Check for emails encoded as HTML entities via innerHTML
          try {
            const allHtml = document.body.innerHTML;
            const entityPattern = /([a-zA-Z0-9._%+-]+)&#(?:x0*40|64);([a-zA-Z0-9.-]+)&#(?:x0*2E|46);([a-zA-Z]{2,})/gi;
            const entityMatches = allHtml.match(entityPattern) || [];
            entityMatches.forEach(match => {
              const decoded = match
                .replace(/&#x0*40;|&#64;/gi, '@')
                .replace(/&#x0*2E;|&#46;/gi, '.');
              results.push(decoded);
            });
          } catch (e) {
            // Ignore entity parsing errors
          }

          // Look for JavaScript email variables in scripts
          try {
            const scriptTags = document.querySelectorAll('script:not([src])');
            scriptTags.forEach(script => {
              const scriptContent = script.textContent;
              // Look for common email variable patterns in JavaScript
              const jsEmailPatterns = [
                /\bemail\s*[:=]\s*["']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/gi,
                /\bemailAddress\s*[:=]\s*["']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/gi,
                /\bcontact\s*[:=]\s*["']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/gi
              ];

              jsEmailPatterns.forEach(pattern => {
                let match;
                while (match = pattern.exec(scriptContent)) {
                  if (match[1]) results.push(match[1]);
                }
              });
            });
          } catch (e) {
            // Ignore script parsing errors
          }

          // Check image alt text for emails (sometimes websites use this to avoid scraping)
          try {
            const images = document.querySelectorAll('img[alt]');
            images.forEach(img => {
              const alt = img.getAttribute('alt');
              if (alt) {
                obfuscationPatterns.forEach(pattern => {
                  const matches = alt.match(pattern) || [];
                  results.push(...matches);
                });
              }
            });
          } catch (e) {
            // Ignore image alt text errors
          }

          // Look for emails in data attributes
          try {
            // Find elements with data-* attributes
            const dataElements = document.querySelectorAll('[data-email], [data-contact], [data-mail], [data-user]');
            dataElements.forEach(el => {
              // Check all data attributes
              Array.from(el.attributes)
                .filter(attr => attr.name.startsWith('data-'))
                .forEach(attr => {
                  // Apply email patterns to attribute values
                  obfuscationPatterns.forEach(pattern => {
                    const matches = attr.value.match(pattern) || [];
                    results.push(...matches);
                  });
                });
            });
          } catch (e) {
            // Ignore data attribute errors
          }

          // NEW: Extract emails from comment nodes (sometimes emails are hidden in comments)
          try {
            // Use a trick to get comment nodes by converting them temporarily to elements
            const html = document.documentElement.outerHTML;
            const commentRegex = /<!--([\s\S]*?)-->/g;
            let commentMatch;

            while ((commentMatch = commentRegex.exec(html)) !== null) {
              const commentContent = commentMatch[1];
              obfuscationPatterns.forEach(pattern => {
                const emailMatches = commentContent.match(pattern) || [];
                results.push(...emailMatches);
              });
            }
          } catch (e) {
            // Ignore comment extraction errors
          }

          // Check mailto links (most reliable source)
          if (document.querySelectorAll) {
            try {
              const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
              mailtoLinks.forEach(link => {
                if (link && link.href) {
                  const email = link.href.replace('mailto:', '').split('?')[0];
                  if (email) results.push(email);
                }
              });
            } catch (e) {
              // Ignore errors with query selector
            }
          }

          // NEW: Look for email spans with intentional text separation
          try {
            // Some sites split emails into multiple spans to avoid scraping
            // Example: <span>info</span>@<span>example.com</span>
            const spans = document.querySelectorAll('span');

            // Convert to array so we can iterate with indexes
            const spansArray = Array.from(spans);

            for (let i = 0; i < spansArray.length - 2; i++) {
              const span1 = spansArray[i];
              const nextNode = span1.nextSibling;
              const span2 = spansArray[i + 1];

              // Check if there's a @ between two spans
              if (nextNode && nextNode.nodeType === Node.TEXT_NODE &&
                nextNode.textContent.trim() === '@' &&
                span1.textContent && span2.textContent) {

                // Potential email parts found
                const username = span1.textContent.trim();
                const domain = span2.textContent.trim();

                // Basic validation
                if (username.match(/^[A-Za-z0-9._%+-]+$/) &&
                  domain.match(/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/)) {
                  results.push(`${username}@${domain}`);
                }
              }
            }
          } catch (e) {
            // Ignore split span errors
          }

          // Process each potential email to clean it up
          const cleanedResults = results.map(email => {
            try {
              // Extract email from a more complex string if necessary
              let cleanedEmail = email;

              // If it's already a proper email, just return it
              if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(cleanedEmail)) {
                return cleanedEmail;
              }

              // Extract email pattern from string that might contain it
              const emailMatch = email.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
              if (emailMatch) {
                return emailMatch[1];
              }

              // Handle "at" / "dot" obfuscation
              cleanedEmail = cleanedEmail
                .replace(/\s*\[\(?at\)?\]\s*/i, '@')
                .replace(/\s*\[\(?dot\)?\]\s*/gi, '.')
                .replace(/\s+at\s+/i, '@')
                .replace(/\s+dot\s+/gi, '.');

              // Try to match a clean email address
              const finalMatch = cleanedEmail.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
              return finalMatch ? finalMatch[1] : cleanedEmail;
            } catch (e) {
              return email; // Return original if cleaning fails
            }
          });

          return [...new Set(cleanedResults.filter(e => e))]; // Return unique, non-empty results

        } catch (e) {
          // Ignore internal errors to prevent the page.evaluate from failing
          console.error('Error in browser context:', e);
          return [];
        }
      }, [], workerId);
    } catch (error) {
      logger.error(`Error extracting obfuscated emails: ${error.message}`);
      return [];
    }
  }

  async findContactLinks(page) {
    try {
      return await page.evaluate(() => {
        // Expanded list of contact keywords for better coverage
        const contactKeywords = [
          'contact', 'contacts', 'about', 'about-us', 'about-me', 'about-company',
          'team', 'staff', 'people', 'our-team', 'meet-the-team', 'meet-us',
          'help', 'support', 'customer-support', 'customer-service',
          'get-in-touch', 'reach-out', 'reach-us', 'connect', 'connect-with-us',
          'talk-to-us', 'email', 'email-us', 'mail', 'send-message',
          'inquiry', 'enquiry', 'info', 'information', 'contact-info',
          'faq', 'faqs', 'help-center', 'helpdesk',
          'directory', 'locations', 'our-locations', 'offices'
        ];

        // More sophisticated link detection
        const getContactLinks = () => {
          // First try: href and text content matching
          const allLinks = Array.from(document.querySelectorAll('a[href]'));

          // Filter links that match contact keywords
          const contactLinks = allLinks.filter(link => {
            const href = link.href?.toLowerCase() || '';
            const text = link.textContent?.toLowerCase() || '';

            // Check for keyword match in either href or text
            return contactKeywords.some(keyword =>
              href.includes(keyword) || text.includes(keyword)
            ) && href.startsWith('http');
          });

          // Find links with contact-related text nearby (limited to first 10 for performance)
          const contactAreaLinks = [];
          allLinks.slice(0, 500).forEach(link => {
            if (link.parentElement) {
              const parentText = link.parentElement.textContent.toLowerCase();
              const hasContactKeyword = contactKeywords.some(keyword => parentText.includes(keyword));

              if (hasContactKeyword && link.href.startsWith('http')) {
                contactAreaLinks.push(link);
              }
            }
          });

          // Combined unique links from both approaches
          const allContactLinks = [...contactLinks, ...contactAreaLinks]
            .filter(link => link.href && link.href.startsWith('http'))
            .map(link => link.href);

          // Return unique links
          return [...new Set(allContactLinks)];
        };

        // Get contact links
        const links = getContactLinks();

        // Try to prioritize links containing common contact page patterns
        const prioritized = links.sort((a, b) => {
          const aIsContact = /contact|email|connect|touch|reach/i.test(a);
          const bIsContact = /contact|email|connect|touch|reach/i.test(b);

          if (aIsContact && !bIsContact) return -1;
          if (!aIsContact && bIsContact) return 1;
          return 0;
        });

        // Return the most likely contact links (up to 8)
        return prioritized.slice(0, 8);
      });
    } catch (error) {
      logger.warn(`Error finding contact links: ${error.message}`);
      return [];
    }
  }

  // Add the missing prioritizeEmails method that is called but not implemented
  prioritizeEmails(emails, domain) {
    // Skip if no emails found
    if (!emails || emails.length === 0) return [];

    // Normalize domain for comparison (remove www prefix)
    const normalizedDomain = domain ? domain.replace(/^www\./, '') : null;

    // First, remove duplicates
    const uniqueEmails = [...new Set(emails)].map(email => email.toLowerCase());

    // Create validated array
    const validEmails = uniqueEmails.filter(email => this.isValidEmail(email));

    // If no domain provided or no valid emails, just return valid emails
    if (!normalizedDomain || validEmails.length === 0) {
      return validEmails;
    }

    // Prioritize emails:
    // 1. Emails from the same domain as the website
    // 2. Emails from known business domains (not free email providers)
    // 3. Other valid emails

    // Define free email providers to deprioritize
    const freeEmailProviders = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
      'aol.com', 'icloud.com', 'mail.com', 'protonmail.com'
    ];

    return validEmails.sort((a, b) => {
      // Extract domain parts
      const domainA = a.split('@')[1];
      const domainB = b.split('@')[1];

      // Check if email domain matches website domain
      const aMatchesDomain = normalizedDomain && domainA.includes(normalizedDomain);
      const bMatchesDomain = normalizedDomain && domainB.includes(normalizedDomain);

      // Check if email is from a free email provider
      const aIsFreeEmail = freeEmailProviders.some(provider => domainA.includes(provider));
      const bIsFreeEmail = freeEmailProviders.some(provider => domainB.includes(provider));

      // First priority: domain matches
      if (aMatchesDomain && !bMatchesDomain) return -1;
      if (!aMatchesDomain && bMatchesDomain) return 1;

      // Second priority: business emails over free emails
      if (!aIsFreeEmail && bIsFreeEmail) return -1;
      if (aIsFreeEmail && !bIsFreeEmail) return 1;

      // If all criteria are the same, sort by length (shorter emails first)
      return a.length - b.length;
    });
  }

  // Make sure the findEmail method is properly defined at the class level
  async findEmail(website, options = {}) {
    try {
      await this.initialize();

      // Create tracking for high confidence sources
      this.lastExtractedEmailSources = new Map();

      // Extract domain from website
      let domain;
      try {
        domain = new URL(website).hostname.replace(/^www\./, '');
      } catch (err) {
        domain = website;
      }

      // IMPORTANT: Track the business ID if provided in options (for database updates)
      // Log the businessId in detail to help diagnose issues
      const businessId = options.businessId || null;
      const saveToDatabase = options.saveToDatabase !== false;

      // Log the key parameters for debugging
      logger.info(`Looking for email with businessId=${businessId} (${typeof businessId}), saveToDatabase=${saveToDatabase}`);

      // Log any ID conversion happening
      if (businessId !== null && typeof businessId === 'string' && !isNaN(businessId)) {
        logger.info(`Business ID is a numeric string: "${businessId}" - will convert to number when saving`);
      }

      // FIRST STRATEGY: Try the main website
      let emails = await this.extractEmailsFromWebsite(website, {
        ...this.options,
        generateArtificialEmails: false, // Explicitly disable any generation
        useSearchEngines: false, // Don't use search engines yet
        ...options
      }, 0);

      // Process and validate found emails
      if (emails && emails.length > 0) {
        logger.info(`Found ${emails.length} potential emails on main website`);
        this.lastExtractedEmailSources.set(emails[0].toLowerCase(), 'Main website');
      } else {
        logger.info(`No emails found on main website for ${website}, trying contact pages`);

        // SECOND STRATEGY: Try common contact pages
        if (domain) {
          // Clean domain for contact page URLs
          let cleanDomain = domain;

          // Remove protocol if accidentally included
          cleanDomain = cleanDomain.replace(/^https?:\/\//, '');

          // Remove www if present for consistency
          cleanDomain = cleanDomain.replace(/^www\./, '');

          // Remove any paths or trailing slashes
          cleanDomain = cleanDomain.split('/')[0];

          logger.info(`Trying contact pages for domain: ${cleanDomain}`);

          // Common contact page URLs
          const contactUrls = [
            `https://${cleanDomain}/contact`,
            `https://${cleanDomain}/contact-us`,
            `https://${cleanDomain}/about-us`,
            `https://www.${cleanDomain}/contact`,
            `https://${cleanDomain}/support`,
            `https://${cleanDomain}/help`,
            `https://${cleanDomain}/team`,
            `https://${cleanDomain}/company/contact`
          ];

          // Process contact URLs with error handling
          const contactEmails = await this.processContactUrls(contactUrls, domain, options, 0);

          if (contactEmails && contactEmails.length > 0) {
            logger.info(`Found ${contactEmails.length} emails on contact pages`);
            emails = contactEmails;
            this.lastExtractedEmailSources.set(contactEmails[0].toLowerCase(), 'Contact page');
          }
        }

        // THIRD STRATEGY: Use search engines if enabled and still no emails
        if ((!emails || emails.length === 0) &&
          (options.useSearchEngines || this.options.useSearchEngines)) {
          logger.info(`No emails found in website, trying search engine discovery for ${domain}`);

          const searchEngineEmails = await this.searchEngineEmailDiscovery(domain, options, 0);

          if (searchEngineEmails && searchEngineEmails.length > 0) {
            logger.info(`Found ${searchEngineEmails.length} emails using search engines`);
            emails = searchEngineEmails;
            this.lastExtractedEmailSources.set(searchEngineEmails[0].toLowerCase(), 'Search engine');
          }
        }
      }

      // Process and validate all found emails
      if (emails && emails.length > 0) {
        // Remove duplicates and filter suspicious emails
        const validatedEmails = this.prioritizeEmails(emails, domain);

        if (validatedEmails.length > 0) {
          const bestEmail = validatedEmails[0]; // Take the highest priority email

          // Save to database if requested and business ID provided - add more detail
          if (saveToDatabase && businessId) {
            logger.info(`Found email ${bestEmail} for business ID ${businessId}, saving to database...`);
            const saveResult = await this.saveEmailToDatabase(businessId, bestEmail, validatedEmails.join(', '));

            if (saveResult) {
              logger.info(`✅ Successfully saved email ${bestEmail} to database for business ID ${businessId}`);
            } else {
              logger.error(`❌ Failed to save email ${bestEmail} to database for business ID ${businessId}`);
            }
          } else {
            logger.info(`Not saving to database: saveToDatabase=${saveToDatabase}, businessId=${businessId || 'not provided'}`);
          }

          // Return the email
          return bestEmail;
        }
      }

      logger.info(`No valid emails found for ${website}`);
      return null;
    } catch (error) {
      logger.error(`Error finding email for ${website}: ${error.message}`);
      return null;
    }
  }

  // Method to safely evaluate JavaScript in the page context
  async safeEvaluate(page, fn, args = [], workerId = 0) {
    if (!page) {
      logger.warn(`Worker ${workerId}: Page is null, cannot evaluate`);
      return [];
    }

    try {
      return await page.evaluate(fn, ...args);
    } catch (error) {
      logger.warn(`Worker ${workerId}: Error evaluating in page: ${error.message}`);
      return [];
    }
  }

  // Method to determine if an email is high confidence (not just pattern matched)
  highConfidenceEmail(email) {
    // Check if this email was found in a high-confidence context
    if (this.lastExtractedEmailSources &&
      this.lastExtractedEmailSources.has(email.toLowerCase())) {
      return true;
    }

    // Conservative approach - if we don't explicitly know it's high confidence, be cautious
    return false;
  }

  // Extract emails from a page with retry mechanism
  async extractEmailsWithRetry(page, url, workerId = 0) {
    try {
      const emails = new Set();

      // First try to get emails from mailto: links (highest confidence)
      const mailtoEmails = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        return links.map(link => {
          const email = link.href.replace('mailto:', '').split('?')[0].trim();
          return email;
        }).filter(Boolean);
      }).catch(e => {
        logger.warn(`Worker ${workerId}: Error extracting mailto links: ${e.message}`);
        return [];
      });

      mailtoEmails.forEach(email => {
        if (this.isValidEmail(email)) {
          emails.add(email);
          // Track these as high confidence sources
          if (this.lastExtractedEmailSources) {
            this.lastExtractedEmailSources.set(email.toLowerCase(), 'mailto link');
          }
        }
      });

      // Next try obfuscated emails with a more thorough approach
      const obfuscatedEmails = await this.extractObfuscatedEmails(page, workerId);

      obfuscatedEmails.forEach(email => {
        if (this.isValidEmail(email)) {
          emails.add(email);
          // These might be less reliable, so don't mark as high confidence
        }
      });

      // If domain is known, try domain-specific extraction
      try {
        const domain = new URL(url).hostname;
        if (domain) {
          const domainEmails = await this.extractDomainSpecificEmails(page, domain);

          domainEmails.forEach(email => {
            if (this.isValidEmail(email)) {
              emails.add(email);
              // Domain-specific emails are higher confidence
              if (this.lastExtractedEmailSources) {
                this.lastExtractedEmailSources.set(email.toLowerCase(), 'domain match');
              }
            }
          });
        }
      } catch (e) {
        // Ignore domain extraction errors
      }

      // Return unique emails as array
      return Array.from(emails);
    } catch (error) {
      logger.error(`Worker ${workerId}: Error extracting emails with retry: ${error.message}`);
      return [];
    }
  }

  // Method to handle cookie accept dialogs
  async acceptCookies(page) {
    try {
      // Common cookie accept button selectors
      const cookieSelectors = [
        'button[id*="cookie"][id*="accept"]',
        'button[id*="cookie"][id*="agree"]',
        'button[id*="accept"][id*="cookie"]',
        'button[id*="agree"][id*="cookie"]',
        '.accept-cookies',
        '#accept-cookies',
        '.cookie-accept',
        '.cookie-agree',
        '.cookie-consent-accept',
        'button:has-text("Accept")',
        'button:has-text("Accept All")',
        'button:has-text("I Agree")',
        'button:has-text("OK")',
        'button:has-text("Got it")'
      ];

      // Try each selector
      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click().catch(() => { });
            await page.waitForTimeout(500);
            return true;
          }
        } catch (e) {
          // Ignore individual selector errors
        }
      }

      return false;
    } catch (error) {
      logger.warn(`Error accepting cookies: ${error.message}`);
      return false;
    }
  }

  // ...existing code...
}

// Make sure we're exporting a valid instance with all methods
const emailFinderInstance = new EmailFinder();

// Debug the instance to verify the method exists
if (typeof emailFinderInstance.findEmail !== 'function') {
  console.error('WARNING: findEmail method is not properly defined on the EmailFinder instance');

  // Explicitly add the method if it's somehow missing
  emailFinderInstance.findEmail = async function (website, options = {}) {
    logger.info(`Fallback findEmail called for ${website}`);
    try {
      await this.initialize();
      return await this.extractEmailsFromWebsite(website, options, 0)[0] || null;
    } catch (error) {
      logger.error(`Error in fallback findEmail: ${error.message}`);
      return null;
    }
  };
}

// Export the instance
module.exports = emailFinderInstance;
