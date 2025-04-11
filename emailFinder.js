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

// Import VPN utilities
let vpnUtils;
try {
  vpnUtils = require('./vpn-utils');
} catch (error) {
  console.warn(`VPN utilities not available: ${error.message}`);
  vpnUtils = null;
}

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

        // Define website condition based on options - enhanced with strict validation
        const websiteCondition = searchOptions.onlyWithWebsite 
          ? `website IS NOT NULL AND website != '' AND website != 'null' AND website NOT LIKE 'http://null%' AND website LIKE 'http%'` 
          : `true`;
        
        // Base WHERE conditions that are always included
        const baseWhere = `${websiteCondition} AND (email IS NULL OR email = '' OR email = '[null]')`;
        conditions.push(baseWhere);

        // Add search term filter - NEW
        if (searchOptions.searchTerm) {
          params.push(searchOptions.searchTerm);
          conditions.push(`search_term = $${params.length}`);
        }

        // Add state filter - NEW
        if (searchOptions.state) {
          params.push(searchOptions.state);
          conditions.push(`state = $${params.length}`);
        }

        // Add city filter - NEW
        if (searchOptions.city) {
          params.push(searchOptions.city);
          conditions.push(`city = $${params.length}`);
        }

        // Add minimum rating filter - NEW
        if (searchOptions.minRating && !isNaN(searchOptions.minRating)) {
          params.push(parseFloat(searchOptions.minRating));
          conditions.push(`CAST(rating AS FLOAT) >= $${params.length}`);
        }

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
          WHERE ${conditions.join(' AND ')}
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

  // Process specific businesses with search term filter
  async processBusinessesWithSearchTerm(searchTerm, options = {}) {
    try {
      if (!searchTerm) {
        logger.error('Search term is required');
        return 0;
      }

      logger.info(`Processing businesses with search term: ${searchTerm}`);
      
      // Initialize database
      if (db.init) {
        await db.init();
      }
      
      // Get businesses that match the search term and have missing emails
      const query = `
        SELECT id, name, website, domain
        FROM business_listings
        WHERE search_term = $1
          AND website IS NOT NULL AND website != '' 
          AND (email IS NULL OR email = '')
        LIMIT $2
      `;
      
      const limit = options.limit || 1000;
      const businesses = await db.getMany(query, [searchTerm, limit]);
      
      if (!businesses || businesses.length === 0) {
        logger.info(`No businesses found with search term "${searchTerm}" that need emails`);
        return 0;
      }
      
      logger.info(`Found ${businesses.length} businesses with search term "${searchTerm}" to process for emails`);
      
      // Set up the queue for processing
      this.queue = [...businesses];
      
      // Process the queue
      await this.processQueue({
        ...this.options,
        ...options,
        saveToDatabase: true // Force saving to database
      });
      
      return this.processed;
    } catch (error) {
      logger.error(`Error in processBusinessesWithSearchTerm: ${error.message}`);
      return 0;
    }
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
            // Pass BOTH business.id and saveToDatabase:true to ensure emails are saved
            const websiteEmails = await this.extractEmailsFromWebsite(business.website, {
              ...options,
              businessId: business.id,
              saveToDatabase: true
            }, workerId);
            
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
                    timeout: Math.min(options.timeout, 15000), // Max 15 seconds for contact pages
                    businessId: business.id, // Pass business ID here too
                    saveToDatabase: true
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

          // Save to the database - make sure to pass the business ID explicitly
          logger.info(`Worker ${workerId}: Found REAL email for ${business.website}: ${primaryEmail} with businessId=${business.id}`);
          await this.saveEmailToDatabase(business.id, primaryEmail, uniqueEmails.join(', '));

          this.emailsFound++;
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

  // Extract emails from a website with enhanced error recovery and better browser handling
  async extractEmailsFromWebsite(url, options, workerId = 0) {
    // First validate that we have a working browser 
    if (!this.browser) {
      logger.warn(`Worker ${workerId}: Browser not available, attempting to reinitialize`);
      try {
        await this.initialize();
      } catch (initError) {
        logger.error(`Worker ${workerId}: Failed to initialize browser: ${initError.message}`);
        return []; // Return empty result since we can't proceed
      }
    }

    // Get a fresh context for this navigation attempt
    const context = await this.getOrCreateContext(workerId);
    if (!context) {
      logger.error(`Worker ${workerId}: Unable to get valid browser context`);
      return [];
    }

    // Create a fresh page for each navigation attempt
    let page;
    try {
      // Always create a fresh page to avoid stale context issues
      page = await context.newPage();
      logger.info(`Worker ${workerId}: Created fresh page for ${url}`);
      
      // Monitor for block-related console messages
      page.on('console', async msg => {
        const text = msg.text();
        if (text.toLowerCase().includes('captcha') || 
            text.toLowerCase().includes('security check') ||
            text.toLowerCase().includes('unusual traffic')) {
          logger.warn(`Worker ${workerId}: Detected potential block via console: ${text}`);
          if (vpnUtils) vpnUtils.registerBlockDetection();
        }
      });
      
      // Monitor response statuses for blocks
      page.on('response', async response => {
        const status = response.status();
        if (status === 403 || status === 429 || status === 503) {
          logger.warn(`Worker ${workerId}: Received blocked status code ${status} from ${response.url()}`);
          if (vpnUtils) vpnUtils.registerBlockDetection();
          
          // Check if we should rotate IP immediately
          if (vpnUtils && vpnUtils.shouldRotateIP()) {
            logger.info(`Worker ${workerId}: Block detection threshold reached, triggering VPN rotation`);
            try {
              // Force rotation when explicit block is detected
              await vpnUtils.rotateIP(true);
              // Close this page to ensure we start fresh after IP rotation
              await page.close().catch(e => {});
              page = null;
              throw new Error(`Forced page closure due to IP rotation`);
            } catch (vpnErr) {
              logger.error(`Worker ${workerId}: Error rotating IP: ${vpnErr.message}`);
            }
          }
        }
      });
    } catch (pageError) {
      logger.error(`Worker ${workerId}: Failed to create page: ${pageError.message}`);
      await this.recoverWorkerContext(workerId);
      return [];
    }

    const maxRetries = 3;
    let retryCount = 0;
    let rotatedIP = false;

    while (retryCount < maxRetries) {
      try {
        // Skip if the page was closed by VPN rotation
        if (!page) {
          logger.info(`Worker ${workerId}: Recreating page after IP rotation`);
          try {
            page = await context.newPage();
          } catch (e) {
            logger.error(`Worker ${workerId}: Failed to create new page after IP rotation: ${e.message}`);
            return [];
          }
        }
      
        logger.info(`Worker ${workerId}: Visiting ${url} (attempt ${retryCount + 1}/${maxRetries})`);

        // Validate URL format first
        if (!url || !url.startsWith('http')) {
          throw new Error(`Invalid URL format: ${url}`);
        }
        
        // Set navigation options with appropriate timeouts
        const navigationOptions = {
          waitUntil: 'domcontentloaded',
          timeout: options.timeout || 30000
        };
        
        // IMPORTANT: Implement additional navigation timeout protection
        const navigationPromise = page.goto(url, navigationOptions);
        
        // Set up a separate timeout to guard against hanging navigations
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Navigation timeout exceeded')), navigationOptions.timeout * 1.2)
        );
        
        try {
          // Race the navigation against our manual timeout
          await Promise.race([navigationPromise, timeoutPromise]);
          
          // Check response status code
          const response = await page.evaluate(() => ({
            status: window.performance.getEntries().length > 0 ? 200 : 0
          })).catch(() => ({ status: 0 }));
          
          // Get page content to check for blocks
          const html = await page.content().catch(() => '');
          
          // Check if we're blocked using vpnUtils
          if (vpnUtils && vpnUtils.isBlocked(response.status, html)) {
            logger.warn(`Worker ${workerId}: Detected block or CAPTCHA on ${url}`);
            
            // Rotate IP if we haven't already for this attempt
            if (!rotatedIP) {
              logger.info(`Worker ${workerId}: Attempting to rotate VPN IP and retry...`);
              // Force rotation when explicit block is detected
              rotatedIP = await vpnUtils.rotateIP(true);
              
              if (rotatedIP) {
                logger.info(`Worker ${workerId}: Successfully rotated IP, retrying request`);
                
                // Close current page to start fresh
                await page.close().catch(() => {});
                page = await context.newPage();
                continue; // Retry without incrementing retryCount
              }
            }
            
            // If we couldn't rotate or already did, increment retry and continue
            retryCount++;
            continue;
          }
          
          // Wait for the page to stabilize
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Verify the page loaded successfully
          const pageStable = await this.isPageContentLoaded(page);
          
          if (pageStable) {
            logger.info(`Worker ${workerId}: Successfully loaded ${url}`);
            
            // Extract emails with much more thorough methods
            const emails = await this.extractImprovedEmails(page, url, workerId);
            
            // Close the page to free up resources
            await page.close().catch(() => {});
            
            return emails;
          } else {
            throw new Error("Page content not properly loaded");
          }
        } catch (navError) {
          logger.warn(`Worker ${workerId}: Navigation error: ${navError.message}`);
          
          // Check if this looks like a block and we haven't rotated IP yet
          const isBlockError = navError.message.includes('Navigation timeout') || 
                             navError.message.includes('net::ERR_');
                             
          if (isBlockError && !rotatedIP && vpnUtils) {
            logger.info(`Worker ${workerId}: Navigation error might indicate blocking, rotating IP...`);
            // Force rotation for navigation errors that indicate blocking
            rotatedIP = await vpnUtils.rotateIP(true);
            
            if (rotatedIP) {
              await page.close().catch(() => {});
              page = await context.newPage();
              continue; // Retry without incrementing retry counter
            }
          }
          
          // Clean up and retry
          await page.close().catch(() => {});
          page = await context.newPage();
          retryCount++;
          
          // Add delay before retry
          await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
        }
      } catch (error) {
        logger.error(`Worker ${workerId}: Error during extraction attempt: ${error.message}`);
        
        // Clean up
        if (page) {
          await page.close().catch(() => {});
        }
        
        // Create a fresh page for next attempt
        try {
          page = await context.newPage();
        } catch (e) {
          logger.error(`Worker ${workerId}: Could not create new page: ${e.message}`);
          await this.recoverWorkerContext(workerId);
          try {
            page = await context.newPage();
          } catch (e2) {
            logger.error(`Worker ${workerId}: Failed to create page even after recovery: ${e2.message}`);
            return [];
          }
        }
        
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
      }
    }

    // Close the page if it's still open
    if (page) {
      await page.close().catch(() => {});
    }

    logger.error(`Worker ${workerId}: Failed to extract emails after ${maxRetries} attempts: Could not navigate to ${url}`);
    return [];
  }

  // Get or create a browser context for a worker
  async getOrCreateContext(workerId) {
    try {
      // Make sure browser is initialized
      if (!this.browser) {
        logger.warn(`Worker ${workerId}: Browser not initialized, initializing now`);
        await this.initialize();
      }

      // Check if we have a context at the worker's index
      if (!this.contextPool[workerId]) {
        logger.info(`Worker ${workerId}: Creating new browser context`);
        
        // Create a new context with proper configuration
        const context = await this.browser.newContext({
          userAgent: this.options.userAgent,
          viewport: { width: 1920, height: 1080 },
          locale: 'en-US',
          timezoneId: 'America/New_York',
          bypassCSP: true,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          ignoreHTTPSErrors: true,
          javaScriptEnabled: true,
          permissions: ['notifications']
        });
        
        // Add anti-detection script
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5].map(() => ({ length: 1 })) });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          window.chrome = { runtime: {} };
        });
        
        // Store in pool
        this.contextPool[workerId] = context;
        
        // Create a corresponding page in this context
        const page = await context.newPage();
        this.pagePool[workerId] = page;
      }

      return this.contextPool[workerId];
    } catch (error) {
      logger.error(`Worker ${workerId}: Error getting or creating context: ${error.message}`);
      return null;
    }
  }

  // Check if a page is valid and usable
  async isPageValid(page, workerId) {
    if (!page) {
      logger.warn(`Worker ${workerId}: Page is null`);
      return false;
    }

    try {
      // Simple test to check if page evaluation still works
      await page.evaluate(() => document.title).catch(() => {
        throw new Error('Page evaluation failed');
      });
      
      return true;
    } catch (error) {
      logger.warn(`Worker ${workerId}: Page validation failed: ${error.message}`);
      return false;
    }
  }

  // Recover worker context if it becomes invalid
  async recoverWorkerContext(workerId) {
    logger.info(`Worker ${workerId}: Recovering browser context`);
    
    try {
      // Close existing resources if they exist
      if (this.pagePool[workerId]) {
        await this.pagePool[workerId].close().catch(e => 
          logger.warn(`Worker ${workerId}: Error closing page: ${e.message}`)
        );
      }

      if (this.contextPool[workerId]) {
        await this.contextPool[workerId].close().catch(e => 
          logger.warn(`Worker ${workerId}: Error closing context: ${e.message}`)
        );
      }

      // Create new context
      const context = await this.browser.newContext({
        userAgent: this.options.userAgent,
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        bypassCSP: true,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        permissions: ['notifications']
      });

      // Add anti-detection script
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5].map(() => ({ length: 1 })) });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
      });

      // Create new page
      const page = await context.newPage();
      
      // Update pools
      this.contextPool[workerId] = context;
      this.pagePool[workerId] = page;
      
      logger.info(`Worker ${workerId}: Context and page successfully recovered`);
      return true;
    } catch (error) {
      logger.error(`Worker ${workerId}: Failed to recover context: ${error.message}`);
      throw error;
    }
  }

  // Check if page content loaded successfully
  async isPageContentLoaded(page) {
    try {
      if (!page) return false;

      // Check if document body exists and has content
      const hasContent = await page.evaluate(() => {
        return document && 
               document.body && 
               document.body.innerText && 
               document.body.innerText.length > 10;
      }).catch(() => false);

      return hasContent;
    } catch (error) {
      logger.warn(`Error checking page content: ${error.message}`);
      return false;
    }
  }

  // Process URL list for contact pages
  async processContactUrls(urls, domain, options, workerId) {
    const emails = new Set();
    
    logger.info(`Worker ${workerId}: Processing ${urls.length} contact URLs for ${domain}`);
    
    // Process only the first 3 URLs to avoid spending too much time
    const limitedUrls = urls.slice(0, 3);
    
    for (const url of limitedUrls) {
      // Stop if we already found emails
      if (emails.size > 0 || this.isStopping) break;
      
      try {
        logger.info(`Worker ${workerId}: Checking contact URL: ${url}`);
        
        const contactOptions = {
          ...options,
          timeout: 15000  // Shorter timeout for contact pages
        };
        
        const contactEmails = await this.extractEmailsFromWebsite(url, contactOptions, workerId);
        
        if (contactEmails && contactEmails.length > 0) {
          logger.info(`Worker ${workerId}: Found ${contactEmails.length} emails on ${url}`);
          contactEmails.forEach(email => emails.add(email));
        }
      } catch (error) {
        logger.warn(`Worker ${workerId}: Error checking contact URL ${url}: ${error.message}`);
      }
      
      // Add small delay between attempts
      if (emails.size === 0 && !this.isStopping) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return Array.from(emails);
  }

  // Add the missing randomDelay function
  async randomDelay(min = 0, max = 10) {
    // With VPN, we can use minimal delays (0-10ms) or none at all
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    if (delay > 0) {
      logger.info(`Minimal delay: ${delay}ms`);
      return new Promise(resolve => setTimeout(resolve, delay));
    }
    return Promise.resolve(); // No delay
  }

  // Extract emails from text content
  extractEmailsFromText(html, text, domain) {
    try {
      // Try all email regexes on both HTML and text content
      const allEmailMatches = new Set();
      
      this.emailRegexes.forEach(regex => {
        // Reset regex before each use
        regex.lastIndex = 0;
        
        // Search in HTML
        const htmlMatches = html.match(regex) || [];
        htmlMatches.forEach(match => allEmailMatches.add(match));
        
        // Search in text if available
        if (text) {
          regex.lastIndex = 0;
          const textMatches = text.match(regex) || [];
          textMatches.forEach(match => allEmailMatches.add(match));
        }
      });
      
      // Process and clean up emails
      const processedEmails = Array.from(allEmailMatches).map(email => {
        // Extract actual email from string that might contain it
        const emailPattern = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;
        const match = email.match(emailPattern);
        return match ? match[1] : email;
      });
      
      // Filter duplicates and invalid emails
      const uniqueEmails = [...new Set(processedEmails)].filter(email => this.isValidEmail(email));
      
      return uniqueEmails;
    } catch (error) {
      logger.error(`Error extracting emails from text: ${error.message}`);
      return [];
    }
  }

  // Use search engines to discover emails
  async searchEngineEmailDiscovery(domain, options, workerId = 0) {
    try {
      if (!this.browser) {
        await this.initialize();
      }
      
      // Get a fresh context for search engine
      const context = await this.getOrCreateContext(workerId);
      if (!context) {
        logger.error(`Worker ${workerId}: Unable to get search engine context`);
        return [];
      }
      
      // Create a fresh page
      const page = await context.newPage();
      
      let searchEngine = options.searchEngine || this.options.searchEngine || 'google';
      logger.info(`Worker ${workerId}: Using ${searchEngine} to search for emails on ${domain}`);
      
      // Create search queries
      const baseQueries = [
        `site:${domain} email`,
        `site:${domain} contact`,
        `site:${domain} "contact us"`,
        `site:${domain} "mailto"`,
        `site:${domain} "email us"`,
        `site:${domain} "get in touch"`,
        `site:${domain}/contact email`,
        `site:${domain}/about email`,
        `site:${domain}/team email`
      ];
      
      // Shuffle and select a few queries to try
      const queries = baseQueries.sort(() => 0.5 - Math.random()).slice(0, 5);
      logger.info(`Worker ${workerId}: Using queries: ${JSON.stringify(queries)}`);
      
      // Try each query until we find emails
      for (const query of queries) {
        try {
          // Construct search URL based on engine
          let searchUrl;
          switch(searchEngine.toLowerCase()) {
            case 'bing':
              searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
              break;
            case 'duckduckgo':
              searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=us-en`;
              break;
            case 'google':
            default:
              searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
              break;
          }
          
          logger.info(`Worker ${workerId}: Navigating to search URL: ${searchUrl}`);
          
          // Navigate to search page with timeout protection
          await Promise.race([
            page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 35000))
          ]);
          
          // Check for consent dialogs
          logger.info(`Checking for consent dialogs to accept`);
          await this.acceptCookies(page);
          
          // Wait for page to stabilize
          await page.waitForTimeout(2000);
          
          // Verify we're on a search page
          const pageTitle = await page.title();
          logger.info(`Worker ${workerId}: Search page loaded: "${pageTitle}"`);
          
          // Extract emails from search results
          const emails = await this.extractEmailsFromSearchResults(page, domain, workerId);
          
          if (emails && emails.length > 0) {
            logger.info(`Worker ${workerId}: ✓ Found email in search results: ${emails[0]}`);
            
            // Close the page
            await page.close().catch(() => {});
            
            return emails;
          }
          
          // Small delay between searches (fix this to use the added randomDelay method)
          await this.randomDelay(1000, 2000);
        } catch (searchError) {
          logger.warn(`Worker ${workerId}: Error searching with query "${query}": ${searchError.message}`);
          continue; // Try next query
        }
      }
      
      // Close the page when done
      await page.close().catch(() => {});
      
      logger.info(`Worker ${workerId}: No emails found using ${searchEngine} search for ${domain}`);
      return [];
    } catch (error) {
      logger.error(`Worker ${workerId}: Error in search engine discovery: ${error.message}`);
      return [];
    }
  }

  // New method: Extract domain-specific emails
  async extractDomainSpecificEmails(page, domain) {
    try {
      // Clean the domain (remove www. and extract the main domain)
      const cleanDomain = domain.replace(/^www\./, '').split('.').slice(-2).join('.');

      // Create a regex specifically for this domain
      const domainRegex = new RegExp(`\\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9.-]*\\.)?${cleanDomain.replace('.', '\\.')}\\b`, 'gi');

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

      // Extract domain from website with better handling of different formats
      let domain;
      try {
        // Handle various website input formats
        website = website.trim();
        if (!website.startsWith('http')) {
          website = `https://${website}`;
        }
        
        domain = new URL(website).hostname.replace(/^www\./, '');
      } catch (err) {
        // Handle cases where website might just be a domain
        domain = website.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
        website = `https://${domain}`;
      }

      // Process all possible business ID field names to ensure compatibility
      const businessId = options.businessId || options.id || options.business_id || null;
      
      // Log the key parameters for debugging with clearer information
      const logPrefix = '🔍 EMAIL FINDER: ';
      logger.info(`${logPrefix}Looking for email on ${website} with businessId=${businessId !== null ? businessId : 'not provided'}`);

      // Log any ID conversion happening
      if (businessId !== null && typeof businessId === 'string' && !isNaN(businessId)) {
        logger.info(`${logPrefix}Business ID is a numeric string: "${businessId}" - will convert to number when saving`);
      }

      // Determine if we should save to database
      // We'll save if saveToDatabase is true (default) AND we have a businessId
      const shouldSaveToDb = (options.saveToDatabase !== false) && (businessId !== null);
      
      logger.info(`${logPrefix}Will ${shouldSaveToDb ? '' : 'NOT '}save to database. saveToDatabase=${options.saveToDatabase !== false}, businessId=${businessId !== null ? businessId : 'not provided'}`);

      // STRATEGY 1: Try the main website directly
      logger.info(`${logPrefix}STRATEGY 1: Checking main website ${website}`);
      let emails = await this.extractEmailsFromWebsite(website, {
        ...this.options,
        generateArtificialEmails: false, // Explicitly disable any generation
        useSearchEngines: false, // Don't use search engines yet
        businessId, // Pass businessId to make it available during extraction
        saveToDatabase: shouldSaveToDb, // Pass save preference based on our determination
        ...options
      }, 0);

      // Process and validate found emails
      if (emails && emails.length > 0) {
        logger.info(`${logPrefix}Found ${emails.length} emails on main website: ${emails.join(', ')}`);
        this.lastExtractedEmailSources.set(emails[0].toLowerCase(), 'Main website');
      } else {
        logger.info(`${logPrefix}No emails found on main website, trying contact pages`);

        // STRATEGY 2: Try common contact pages - EXPANDED with more variations
        if (domain) {
          logger.info(`${logPrefix}STRATEGY 2: Checking contact pages for ${domain}`);
          
          // Clean domain for contact page URLs
          let cleanDomain = domain;

          // Remove protocol if accidentally included
          cleanDomain = cleanDomain.replace(/^https?:\/\//, '');

          // Remove www if present for consistency
          cleanDomain = cleanDomain.replace(/^www\./, '');

          // Remove any paths or trailing slashes
          cleanDomain = cleanDomain.split('/')[0];

          logger.info(`${logPrefix}Trying contact pages for domain: ${cleanDomain}`);

          // EXPANDED: Common contact page URLs with many more variations
          const contactUrls = [
            // Standard paths
            `https://${cleanDomain}/contact`,
            `https://${cleanDomain}/contact-us`,
            `https://${cleanDomain}/about-us`,
            `https://${cleanDomain}/about`,
            `https://www.${cleanDomain}/contact`,
            `https://www.${cleanDomain}/contact-us`,
            
            // Business support pages
            `https://${cleanDomain}/support`,
            `https://${cleanDomain}/help`,
            `https://${cleanDomain}/customer-support`,
            `https://${cleanDomain}/customer-service`,
            
            // Team/About pages
            `https://${cleanDomain}/team`,
            `https://${cleanDomain}/staff`,
            `https://${cleanDomain}/our-team`, 
            `https://${cleanDomain}/about/team`,
            `https://${cleanDomain}/company/team`,
            
            // Company/Info pages
            `https://${cleanDomain}/info`,
            `https://${cleanDomain}/information`,
            `https://${cleanDomain}/company`,
            `https://${cleanDomain}/company/contact`,
            `https://${cleanDomain}/company/about`,
            
            // Connect/Reach pages
            `https://${cleanDomain}/get-in-touch`,
            `https://${cleanDomain}/reach-us`, 
            `https://${cleanDomain}/connect`,
            `https://${cleanDomain}/write-to-us`,
            
            // International variations
            `https://${cleanDomain}/contacto`, // Spanish
            `https://${cleanDomain}/kontakt`,  // German
            
            // Other common paths
            `https://${cleanDomain}/directory`,
            `https://${cleanDomain}/email-us`,
            `https://${cleanDomain}/locations`,
            `https://${cleanDomain}/offices`
          ];

          // Process contact URLs with error handling
          const contactEmails = await this.processContactUrls(contactUrls, domain, {
            ...options,
            businessId, // Make sure to pass the businessId
            saveToDatabase: shouldSaveToDb // Use our determination
          }, 0);

          if (contactEmails && contactEmails.length > 0) {
            logger.info(`${logPrefix}Found ${contactEmails.length} emails on contact pages: ${contactEmails.join(', ')}`);
            emails = contactEmails;
            this.lastExtractedEmailSources.set(contactEmails[0].toLowerCase(), 'Contact page');
          }
        }

        // STRATEGY 3: Use search engines - properly passing businessId
        if ((!emails || emails.length === 0) &&
          (options.useSearchEngines || this.options.useSearchEngines)) {
          logger.info(`${logPrefix}STRATEGY 3: Using search engine discovery for ${domain}`);

          const searchEngineEmails = await this.searchEngineEmailDiscovery(domain, {
            ...options, 
            businessId,  // Pass businessId explicitly for direct database updates
            saveToDatabase: shouldSaveToDb // Use our determination
          }, 0);

          if (searchEngineEmails && searchEngineEmails.length > 0) {
            logger.info(`${logPrefix}Found ${searchEngineEmails.length} emails using search engines: ${searchEngineEmails.join(', ')}`);
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
          logger.info(`${logPrefix}Best email found for ${website}: ${bestEmail}`);

          // Save to database if we determined we should
          if (shouldSaveToDb) {
            logger.info(`${logPrefix}Saving email ${bestEmail} for business ID ${businessId}`);
            const saveResult = await this.saveEmailToDatabase(businessId, bestEmail, validatedEmails.join(', '));

            if (saveResult) {
              logger.info(`${logPrefix}✓ Successfully saved email ${bestEmail} for business ID ${businessId}`);
            } else {
              logger.error(`${logPrefix}⚠️ Failed to save email ${bestEmail} for business ID ${businessId}`);
            }
          } else {
            logger.info(`${logPrefix}Not saving to database: saveToDatabase=${options.saveToDatabase !== false}, businessId=${businessId !== null ? businessId : 'not provided'}`);
          }

          // Return the email
          return bestEmail;
        }
      }

      logger.info(`${logPrefix}No valid emails found for ${website}`);
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

  // Extract emails from search results with emphasis on <em> tags
  async extractEmailsFromSearchResults(page, domain, workerId = 0) {
    try {
      // Log the action for debugging
      logger.info(`Worker ${workerId}: Extracting emails from search results for ${domain}`);
      
      // Take a screenshot for debugging if enabled
      if (this.options.takeScreenshots) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = path.join(this.debugDir, `search-results-${domain}-${timestamp}.png`);
        await page.screenshot({ path: filename, fullPage: true })
          .catch(e => logger.warn(`Screenshot error: ${e.message}`));
        logger.info(`Worker ${workerId}: Saved search results screenshot to ${filename}`);
      }

      // First look specifically for emails in <em> tags as requested
      const emailsInEmphasis = await page.evaluate((domainToCheck) => {
        console.log('Searching <em> tags and other highlighted elements for emails');
        
        const results = new Set();
        
        // Function to extract emails from text
        const extractEmailsFromText = (text) => {
          const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
          const matches = text.match(emailRegex);
          
          if (matches) {
            console.log(`Found emails: ${matches.join(', ')}`);
            matches.forEach(email => results.add(email.toLowerCase()));
          }
        };
        
        // 1. FIRST PRIORITY: Find all <em> tags that might contain emails
        const emphasisElements = document.querySelectorAll('em');
        console.log(`Found ${emphasisElements.length} <em> elements`);
        
        // Extract content from each <em> tag
        for (const elem of emphasisElements) {
          const text = elem.textContent || '';
          console.log(`<em> content: "${text}"`);
          extractEmailsFromText(text);
        }

        // 2. SECOND PRIORITY: Check other highlighting elements often used in search results
        const highlightElements = document.querySelectorAll('strong, b, .highlight, span[style*="bold"], span[class*="highlight"]');
        console.log(`Found ${highlightElements.length} highlighted elements`);
        
        for (const elem of highlightElements) {
          const text = elem.textContent || '';
          extractEmailsFromText(text);
        }
        
        // 3. THIRD PRIORITY: Check elements that might contain text near or including emails
        const potentialContainers = document.querySelectorAll('cite, .cite, .url, .visurl, .urlStr');
        console.log(`Found ${potentialContainers.length} potential URL/citation containers`);
        
        for (const elem of potentialContainers) {
          const text = elem.textContent || '';
          extractEmailsFromText(text);
        }
        
        // 4. FOURTH PRIORITY: Check text snippets in search results
        const snippets = document.querySelectorAll('.snippet, .description, .abstract, .content, .s');
        console.log(`Found ${snippets.length} text snippets`);
        
        for (const elem of snippets) {
          const text = elem.textContent || '';
          extractEmailsFromText(text);
        }
        
        // Return the found emails as an array
        return Array.from(results);
      }, domain.replace(/^www\./, ''));
      
      // If we found emails in <em> or other tags, log and filter them
      if (emailsInEmphasis && emailsInEmphasis.length > 0) {
        // Filter out search engine error emails and apply domain relevance check
        const filteredEmails = emailsInEmphasis
          .filter(email => this.isValidEmail(email))
          .filter(email => this.emailMatchesDomain(email, domain));
        
        if (filteredEmails.length > 0) {
          logger.info(`Worker ${workerId}: Found ${filteredEmails.length} valid emails in emphasized/highlighted elements: ${filteredEmails.join(', ')}`);
          
          // Save source information for each email found
          filteredEmails.forEach(email => {
            if (this.lastExtractedEmailSources) {
              this.lastExtractedEmailSources.set(email.toLowerCase(), 'search result emphasis');
            }
          });
          
          return filteredEmails;
        } else {
          logger.info(`Worker ${workerId}: Found ${emailsInEmphasis.length} emails but all were filtered out as invalid or unrelated to the domain`);
        }
      }
      
      // If still no emails found, try the full page content
      logger.info(`Worker ${workerId}: No valid emails found in emphasized elements, checking full page content`);
      
      // Get both HTML content and plain text
      const pageContent = await page.content();
      const bodyText = await page.evaluate(() => document.body.innerText);
      
      // Look for emails in the page content
      let emails = this.extractEmailsFromText(pageContent, bodyText, domain);
      
      // Filter out search engine error emails
      emails = emails.filter(email => 
        this.isValidEmail(email) && this.emailMatchesDomain(email, domain)
      );
      
      if (emails.length > 0) {
        logger.info(`Worker ${workerId}: Found ${emails.length} valid emails in page content: ${emails.join(', ')}`);
      } else {
        logger.info(`Worker ${workerId}: No valid emails found in search results for ${domain}`);
      }
      
      return emails;
    } catch (error) {
      logger.error(`Worker ${workerId}: Error extracting emails from search results: ${error.message}`);
      return [];
    }
  }

  // Enhanced saveEmailToDatabase method for more reliable database updates
  async saveEmailToDatabase(businessId, email, allEmails) {
    if (!businessId || !email) {
      logger.error(`Cannot save email to database: Missing businessId=${businessId} or email=${email}`);
      return false;
    }

    // Log details for debugging - use eye-catching formatting for database operations
    const logPrefix = '📝 DATABASE: ';
    logger.info(`${logPrefix}Saving email "${email}" for business ID ${businessId} (${typeof businessId})`);

    // Convert businessId to number if it's a string containing a number
    const processedId = typeof businessId === 'string' && !isNaN(businessId) ?
      parseInt(businessId, 10) : businessId;

    // Log the processed ID
    if (processedId !== businessId) {
      logger.info(`${logPrefix}Converted businessId from string "${businessId}" to number ${processedId}`);
    }

    // Initialize database if needed
    if (db.init && typeof db.init === 'function') {
      try {
        await db.init();
        logger.info(`${logPrefix}Database initialization successful`);
      } catch (initError) {
        logger.warn(`${logPrefix}Database initialization error: ${initError.message} (continuing anyway)`);
      }
    }

    // Explicitly test database connection before attempting update
    try {
      const isConnected = await db.testConnection();
      logger.info(`${logPrefix}Database connection test before save: ${isConnected ? 'CONNECTED' : 'FAILED'}`);
      
      if (!isConnected) {
        logger.error(`${logPrefix}Database connection test failed, cannot save email for business ${processedId}`);
        return false;
      }
    } catch (testError) {
      logger.error(`${logPrefix}Error testing database connection: ${testError.message}`);
    }

    const maxRetries = 3; // Increase retries for more reliability
    let retryCount = 0;
    let success = false;

    while (!success && retryCount <= maxRetries) {
      try {
        // First attempt with processed ID
        const queryText = `
          UPDATE business_listings 
          SET email = $1, 
              notes = CASE 
                WHEN notes IS NULL OR notes = '' THEN 'Email found: ' || $2
                ELSE notes || ' | Email found: ' || $2
              END,
              updated_at = NOW() 
          WHERE id = $3
          RETURNING id, name, email`;
          
        const result = await db.query(queryText, [email, allEmails || email, processedId]);

        // Check if any rows were actually updated
        if (!result || result.rowCount === 0) {
          logger.warn(`${logPrefix}No rows updated in business_listings for ID ${processedId}. Business may not exist.`);

          // Try the original ID if conversion was done
          if (processedId !== businessId) {
            logger.info(`${logPrefix}Trying with original businessId format: ${businessId}`);

            // Try with the original format
            const retryResult = await db.query(queryText, [email, allEmails || email, businessId]);

            if (retryResult && retryResult.rowCount > 0) {
              const businessName = retryResult.rows[0]?.name || 'Unknown';
              const savedEmail = retryResult.rows[0]?.email || 'Unknown';
              logger.info(`${logPrefix}✓ Successfully updated business "${businessName}" (ID: ${businessId}) with email ${savedEmail}`);
              success = true;

              // Also try to update legacy businesses table
              try {
                await db.query(
                  `UPDATE businesses SET email = $1 WHERE id = $2`,
                  [email, businessId]
                );
              } catch (legacyError) {
                logger.warn(`${logPrefix}Could not update legacy businesses table: ${legacyError.message}`);
              }

              return true;
            } 
          }

          // Try a different approach - verify if the business exists first
          const checkResult = await db.getOne(
            `SELECT id, name FROM business_listings WHERE id = $1`,
            [processedId === businessId ? businessId : processedId]
          );

          if (!checkResult) {
            logger.error(`${logPrefix}Business with ID ${processedId} not found in database. Email save failed.`);
            throw new Error(`Business with ID ${processedId} not found in database`);
          } else {
            // The business exists but the update didn't affect any rows - try INSERT or alternative update
            logger.warn(`${logPrefix}Business found but update didn't work. Trying alternative update method.`);
            
            // Try a direct field-by-field update without text concatenation
            const alternativeResult = await db.query(
              `UPDATE business_listings 
               SET email = $1, updated_at = NOW() 
               WHERE id = $2
               RETURNING id, name`,
              [email, processedId]
            );
            
            if (alternativeResult && alternativeResult.rowCount > 0) {
              const businessName = alternativeResult.rows[0]?.name || 'Unknown';
              logger.info(`${logPrefix}✓ Successfully updated business "${businessName}" (ID: ${processedId}) with email ${email} using alternative method`);
              success = true;
              return true;
            } else {
              throw new Error(`Alternative update failed for business ID ${processedId}`);
            }
          }
        } else {
          // Update was successful
          const businessName = result.rows[0]?.name || 'Unknown';
          const savedEmail = result.rows[0]?.email || 'Unknown';
          logger.info(`${logPrefix}✓ Successfully updated business "${businessName}" (ID: ${processedId}) with email ${savedEmail}`);

          // Also update legacy businesses table if it exists
          try {
            await db.query(
              `UPDATE businesses SET email = $1 WHERE id = $2`,
              [email, processedId]
            );
            logger.info(`${logPrefix}✓ Also updated legacy businesses table for ID ${processedId}`);
          } catch (legacyError) {
            // Just log but don't treat as failure - legacy table is optional
            logger.warn(`${logPrefix}Could not update legacy businesses table: ${legacyError.message}`);
          }

          success = true;
          return true;
        }
      } catch (error) {
        retryCount++;
        logger.error(`${logPrefix}Error saving email to database (attempt ${retryCount}/${maxRetries + 1}): ${error.message}`);

        // Try to get database connection status
        try {
          const isConnected = await db.testConnection();
          logger.info(`${logPrefix}Database connection test: ${isConnected ? 'CONNECTED' : 'FAILED'}`);
        } catch (dbError) {
          logger.error(`${logPrefix}Database connection test error: ${dbError.message}`);
        }

        if (retryCount <= maxRetries) {
          // Wait before retrying with exponential backoff
          const backoffDelay = 1000 * Math.pow(2, retryCount - 1);
          logger.info(`${logPrefix}Retrying database update in ${backoffDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    // If we get here, all retries failed
    logger.error(`${logPrefix}⚠️ Failed to save email ${email} for business ID ${businessId} after ${maxRetries + 1} attempts`);
    return false;
  }

  // Utility function to validate email format with improved filtering
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
      /demo@/i,
      // New: Add search engine error email patterns
      /error\+[a-z0-9]+@duckduckgo\.com/i,
      /alert@google\.com/i,
      /do-not-reply@/i,
      /search@/i,
      /automated@/i,
      /webmaster@/i,
      /error@/i
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

  // NEW METHOD: Check if an email belongs to or is relevant to target domain
  emailMatchesDomain(email, domain) {
    if (!email || !domain) return false;
    
    // Clean up domain (remove www, protocol, etc.)
    const cleanDomain = domain.replace(/^www\./i, '').replace(/^https?:\/\//i, '').split('/')[0];
    
    // Get the base domain name (e.g., "example" from "example.com")
    const baseDomain = cleanDomain.split('.')[0];
    
    // Get the email domain
    const emailDomain = email.split('@')[1];
    
    // Direct domain match is best
    if (emailDomain === cleanDomain) return true;
    
    // If email domain contains the base domain name, it's likely related
    // (e.g., info@mail.example.com for example.com)
    if (emailDomain && emailDomain.includes(baseDomain)) return true;
    
    // For some search engine results, we want to be extra cautious
    if (emailDomain) {
      // Detect search engine domains and reject them
      const searchEngineDomains = [
        'google.com', 'googlemail.com', 'bing.com', 'duckduckgo.com', 
        'yahoo.com', 'baidu.com', 'yandex.com', 'search.com'
      ];
      
      if (searchEngineDomains.some(seDomain => emailDomain.includes(seDomain))) {
        // This is an email from a search engine, likely an error or notification
        return false;
      }
    }
    
    // Otherwise, default to accepting if it passes other validation
    return true;
  }

  // Extract emails from search results with emphasis on <em> tags
  async extractEmailsFromSearchResults(page, domain, workerId = 0) {
    try {
      // Log the action for debugging
      logger.info(`Worker ${workerId}: Extracting emails from search results for ${domain}`);
      
      // Take a screenshot for debugging if enabled
      if (this.options.takeScreenshots) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = path.join(this.debugDir, `search-results-${domain}-${timestamp}.png`);
        await page.screenshot({ path: filename, fullPage: true })
          .catch(e => logger.warn(`Screenshot error: ${e.message}`));
        logger.info(`Worker ${workerId}: Saved search results screenshot to ${filename}`);
      }

      // First look specifically for emails in <em> tags as requested
      const emailsInEmphasis = await page.evaluate((domainToCheck) => {
        console.log('Searching <em> tags and other highlighted elements for emails');
        
        const results = new Set();
        
        // Function to extract emails from text
        const extractEmailsFromText = (text) => {
          const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
          const matches = text.match(emailRegex);
          
          if (matches) {
            console.log(`Found emails: ${matches.join(', ')}`);
            matches.forEach(email => results.add(email.toLowerCase()));
          }
        };
        
        // 1. FIRST PRIORITY: Find all <em> tags that might contain emails
        const emphasisElements = document.querySelectorAll('em');
        console.log(`Found ${emphasisElements.length} <em> elements`);
        
        // Extract content from each <em> tag
        for (const elem of emphasisElements) {
          const text = elem.textContent || '';
          console.log(`<em> content: "${text}"`);
          extractEmailsFromText(text);
        }

        // 2. SECOND PRIORITY: Check other highlighting elements often used in search results
        const highlightElements = document.querySelectorAll('strong, b, .highlight, span[style*="bold"], span[class*="highlight"]');
        console.log(`Found ${highlightElements.length} highlighted elements`);
        
        for (const elem of highlightElements) {
          const text = elem.textContent || '';
          extractEmailsFromText(text);
        }
        
        // 3. THIRD PRIORITY: Check elements that might contain text near or including emails
        const potentialContainers = document.querySelectorAll('cite, .cite, .url, .visurl, .urlStr');
        console.log(`Found ${potentialContainers.length} potential URL/citation containers`);
        
        for (const elem of potentialContainers) {
          const text = elem.textContent || '';
          extractEmailsFromText(text);
        }
        
        // 4. FOURTH PRIORITY: Check text snippets in search results
        const snippets = document.querySelectorAll('.snippet, .description, .abstract, .content, .s');
        console.log(`Found ${snippets.length} text snippets`);
        
        for (const elem of snippets) {
          const text = elem.textContent || '';
          extractEmailsFromText(text);
        }
        
        // Return the found emails as an array
        return Array.from(results);
      }, domain.replace(/^www\./, ''));
      
      // If we found emails in <em> or other tags, log and filter them
      if (emailsInEmphasis && emailsInEmphasis.length > 0) {
        // Filter out search engine error emails and apply domain relevance check
        const filteredEmails = emailsInEmphasis
          .filter(email => this.isValidEmail(email))
          .filter(email => this.emailMatchesDomain(email, domain));
        
        if (filteredEmails.length > 0) {
          logger.info(`Worker ${workerId}: Found ${filteredEmails.length} valid emails in emphasized/highlighted elements: ${filteredEmails.join(', ')}`);
          
          // Save source information for each email found
          filteredEmails.forEach(email => {
            if (this.lastExtractedEmailSources) {
              this.lastExtractedEmailSources.set(email.toLowerCase(), 'search result emphasis');
            }
          });
          
          return filteredEmails;
        } else {
          logger.info(`Worker ${workerId}: Found ${emailsInEmphasis.length} emails but all were filtered out as invalid or unrelated to the domain`);
        }
      }
      
      // If still no emails found, try the full page content
      logger.info(`Worker ${workerId}: No valid emails found in emphasized elements, checking full page content`);
      
      // Get both HTML content and plain text
      const pageContent = await page.content();
      const bodyText = await page.evaluate(() => document.body.innerText);
      
      // Look for emails in the page content
      let emails = this.extractEmailsFromText(pageContent, bodyText, domain);
      
      // Filter out search engine error emails
      emails = emails.filter(email => 
        this.isValidEmail(email) && this.emailMatchesDomain(email, domain)
      );
      
      if (emails.length > 0) {
        logger.info(`Worker ${workerId}: Found ${emails.length} valid emails in page content: ${emails.join(', ')}`);
      } else {
        logger.info(`Worker ${workerId}: No valid emails found in search results for ${domain}`);
      }
      
      return emails;
    } catch (error) {
      logger.error(`Worker ${workerId}: Error extracting emails from search results: ${error.message}`);
      return [];
    }
  }

  // Add a new comprehensive email extraction method
  async extractImprovedEmails(page, url, workerId = 0) {
    try {
      logger.info(`Worker ${workerId}: Extracting emails with improved method from ${url}`);
      const emails = new Set();
      
      // 1. First try to get emails from mailto: links (highest confidence)
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

      // Add mailto emails to our set
      mailtoEmails.forEach(email => {
        if (this.isValidEmail(email)) {
          emails.add(email);
          // Track these as high confidence sources
          if (this.lastExtractedEmailSources) {
            this.lastExtractedEmailSources.set(email.toLowerCase(), 'mailto link');
          }
        }
      });

      // 2. Extract emails from text content
      const pageContent = await page.content().catch(e => '');
      const bodyText = await page.evaluate(() => document.body.innerText).catch(e => '');
      
      const textEmails = this.extractEmailsFromText(pageContent, bodyText || '');
      textEmails.forEach(email => {
        if (this.isValidEmail(email)) {
          emails.add(email);
          // Track source
          if (this.lastExtractedEmailSources && !this.lastExtractedEmailSources.has(email.toLowerCase())) {
            this.lastExtractedEmailSources.set(email.toLowerCase(), 'page content');
          }
        }
      });

      // 3. Look for obfuscated emails
      const obfuscatedEmails = await this.extractObfuscatedEmails(page, workerId);
      obfuscatedEmails.forEach(email => {
        if (this.isValidEmail(email)) {
          emails.add(email);
          // Track source
          if (this.lastExtractedEmailSources && !this.lastExtractedEmailSources.has(email.toLowerCase())) {
            this.lastExtractedEmailSources.set(email.toLowerCase(), 'obfuscated');
          }
        }
      });

      // 4. Extract domain-specific emails if domain is known
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

      // 5. Follow contact links if no emails found
      if (emails.size === 0) {
        logger.info(`Worker ${workerId}: No emails found on main page, looking for contact links`);
        const contactLinks = await this.findContactLinks(page);
        
        if (contactLinks.length > 0) {
          logger.info(`Worker ${workerId}: Found ${contactLinks.length} potential contact links`);
          // Only follow the first 2 contact links to avoid too much recursion
          for (const contactLink of contactLinks.slice(0, 2)) {
            try {
              // Create a new page to avoid navigation issues
              const contactPage = await page.context().newPage();
              logger.info(`Worker ${workerId}: Checking contact link: ${contactLink}`);
              
              await contactPage.goto(contactLink, { 
                waitUntil: 'domcontentloaded',
                timeout: 20000 
              });
              
              await contactPage.waitForTimeout(1000);
              
              // Extract emails from the contact page
              const contactEmails = await this.extractEmailsWithRetry(contactPage, contactLink);
              
              // Add any found emails to our set
              contactEmails.forEach(email => {
                if (this.isValidEmail(email)) {
                  emails.add(email);
                  if (this.lastExtractedEmailSources && !this.lastExtractedEmailSources.has(email.toLowerCase())) {
                    this.lastExtractedEmailSources.set(email.toLowerCase(), 'contact page');
                  }
                }
              });
              
              // Close the contact page
              await contactPage.close().catch(() => {});
              
              // If we found emails, no need to check more contact links
              if (emails.size > 0) break;
              
            } catch (contactError) {
              logger.warn(`Worker ${workerId}: Error checking contact link ${contactLink}: ${contactError.message}`);
              continue;
            }
          }
        }
      }

      // Return all found unique emails as array
      const uniqueEmails = Array.from(emails);
      logger.info(`Worker ${workerId}: Found ${uniqueEmails.length} emails on ${url}`);
      return uniqueEmails;
    } catch (error) {
      logger.error(`Worker ${workerId}: Error in extractImprovedEmails: ${error.message}`);
      return [];
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
