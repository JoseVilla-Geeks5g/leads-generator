import logger from './logger';
import puppeteer from 'puppeteer';

class GoogleMapsScraper {
  constructor() {
    this.browser = null;
    this.initialized = false;
    this.maxRetries = 3;
    this.delayBetweenActions = 1000; // ms
  }

  /**
   * Initialize the browser for scraping
   */
  async initialize() {
    if (this.initialized) return;

    try {
      logger.info('Initializing Google Maps scraper...');
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-features=IsolateOrigins,site-per-process',
          // Add anti-detection flags
          '--disable-blink-features=AutomationControlled',
          '--window-size=1920,1080',
        ],
        ignoreHTTPSErrors: true
      });
      
      this.initialized = true;
      logger.info('Google Maps scraper initialized');
    } catch (error) {
      logger.error(`Failed to initialize scraper: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wait a random amount of time to appear more human-like
   */
  async randomDelay(min = 500, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Scrape businesses from Google Maps for a specific search query
   * @param {string} searchQuery - The search query (category + location)
   * @param {Object} options - Scraping options
   * @returns {Array} - Scraped businesses
   */
  async scrapeBusinesses(searchQuery, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const businesses = [];
    // Remove maximum results cap to allow full data collection
    const maxResults = options.maxResults || 500; // Increased from 20 to 500
    let retries = 0;

    logger.info(`Starting to scrape Google Maps for: ${searchQuery}`);
    
    const page = await this.browser.newPage();
    try {
      // Configure page to avoid detection
      await page.evaluateOnNewDocument(() => {
        // Overwrite the 'navigator.webdriver' property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        
        // Overwrite the 'navigator.plugins' property
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map(() => ({})),
        });
        
        // Add chrome property
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
      });
      
      // Set a reasonable viewport and user agent
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      // Go to Google Maps
      logger.info(`Navigating to Google Maps...`);
      await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2' });
      await this.randomDelay();
      
      // Accept cookies if the dialog appears
      try {
        const acceptButton = await page.$('button[aria-label="Accept all"]');
        if (acceptButton) {
          await acceptButton.click();
          // Wait for network activity to settle
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        // Ignore if cookie dialog doesn't appear
      }

      // Find and fill the search box
      logger.info(`Searching for: ${searchQuery}`);
      await page.waitForSelector('#searchboxinput', { timeout: 10000 });
      await page.type('#searchboxinput', searchQuery, { delay: 50 });
      await this.randomDelay(300, 600);
      
      // Press Enter to search
      await page.keyboard.press('Enter');
      
      // Wait for results to load - the first panel of search results
      await page.waitForSelector('.Nv2PK, [role="feed"]', { timeout: 15000 })
        .catch(() => logger.warn('Could not find standard result selectors, continuing anyway'));
      
      // Wait for results to stabilize
      await this.randomDelay(2000, 3000);
      
      // Extract the first batch of results
      let extractedCount = 0;
      let previousResultsLength = 0;
      let noNewResultsCount = 0;
      
      // Scroll and collect results until we have enough or no more new results
      // Increase the no-results threshold to ensure we get more complete results
      const maxNoNewResults = 5; // Increased from 3 to 5 for more thorough scraping
      while (extractedCount < maxResults && noNewResultsCount < maxNoNewResults) {
        // Extract visible businesses
        logger.info(`Extracting businesses from current view...`);
        const newBusinesses = await this.extractBusinessesFromPage(page);
        
        // Add new unique businesses
        for (const business of newBusinesses) {
          if (!businesses.some(b => b.name === business.name)) {
            businesses.push(business);
            extractedCount++;
          }
        }
        
        // Check if we found new businesses
        if (businesses.length > previousResultsLength) {
          previousResultsLength = businesses.length;
          noNewResultsCount = 0;
        } else {
          noNewResultsCount++;
        }
        
        logger.info(`Found ${businesses.length} businesses so far (target: ${maxResults})`);
        
        // Scroll to load more results if needed
        if (extractedCount < maxResults) {
          await this.scrollPage(page);
          // Use fixed delay instead of waitForTimeout
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      logger.info(`Completed scraping for "${searchQuery}". Found ${businesses.length} businesses.`);
      return businesses;
      
    } catch (error) {
      logger.error(`Error scraping Google Maps: ${error.message}`);
      
      if (retries < this.maxRetries) {
        retries++;
        logger.info(`Retrying... (${retries}/${this.maxRetries})`);
        await this.randomDelay(5000, 10000);
        return this.scrapeBusinesses(searchQuery, options);
      }
      
      return businesses;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Extract business data from the current page
   * @param {Page} page - Puppeteer page object
   * @returns {Array} - Array of business objects
   */
  async extractBusinessesFromPage(page) {
    try {
      return await page.evaluate(() => {
        const businesses = [];
        
        // First try to find business cards with the typical Google Maps class
        const elements = document.querySelectorAll('.Nv2PK');
        
        if (elements.length > 0) {
          for (const element of elements) {
            try {
              // Extract name
              const nameElement = element.querySelector('.qBF1Pd');
              if (!nameElement) continue;
              const name = nameElement.textContent.trim();
              
              // Extract rating
              let rating = null;
              let reviewCount = '';
              const ratingElement = element.querySelector('.MW4etd');
              if (ratingElement) {
                rating = parseFloat(ratingElement.textContent.trim());
                
                // Get review count if available
                const reviewCountElem = element.querySelector('.UY7F9');
                if (reviewCountElem) {
                  reviewCount = reviewCountElem.textContent.trim();
                }
              }
              
              // Extract address with improved selector targeting the structure shown in the HTML example
              let address = 'No address available';
              
              // First try to find address after the dot separator (·)
              const addressContainers = element.querySelectorAll('.W4Efsd');
              for (const container of addressContainers) {
                // Try to find spans containing the middle dot character
                const spans = container.querySelectorAll('span');
                for (let i = 0; i < spans.length; i++) {
                  const span = spans[i];
                  if (span.textContent.includes('·')) {
                    // Check if there's a next sibling span that might contain the address
                    const nextSpan = spans[i+1];
                    if (nextSpan) {
                      const potentialAddress = nextSpan.textContent.trim();
                      // Check if it looks like an address (contains numbers, not too short)
                      if (potentialAddress.length > 3 && /\d/.test(potentialAddress)) {
                        address = potentialAddress;
                        break;
                      }
                    }
                  }
                }
                
                // If we found an address, break out of the container loop
                if (address !== 'No address available') break;
                
                // Alternative approach: look for text patterns in the container
                const text = container.textContent;
                const match = text.match(/·\s*([^·]+)/);
                if (match && !text.includes("Abierto") && !text.includes("Cierra")) {
                  address = match[1].trim();
                  break;
                }
              }
              
              // If address is still not found, try secondary approaches
              if (address === 'No address available') {
                // Try selectors found in sample HTML
                const addressSelectors = [
                  '.W4Efsd span:not(.MW4etd):not(.UY7F9)',
                  '[data-tooltip="Copy address"]',
                  '.W4Efsd:nth-child(2) > div.W4Efsd > span:nth-child(2)'
                ];
                
                for (const selector of addressSelectors) {
                  const addressElement = element.querySelector(selector);
                  if (addressElement && addressElement.textContent.trim()) {
                    address = addressElement.textContent.trim();
                    break;
                  }
                }
                
                // Last attempt: parse all span contents to find address pattern
                if (address === 'No address available') {
                  const allSpans = element.querySelectorAll('span');
                  for (const span of allSpans) {
                    const text = span.textContent.trim();
                    // Look for text that might be an address (contains numbers and isn't too short)
                    if (text.length > 5 && /\d+/.test(text) && !/^[0-9+()]+$/.test(text) && 
                        !text.includes("estrellas") && !text.includes("opiniones")) {
                      address = text;
                      break;
                    }
                  }
                }
              }
              
              // Try to extract phone number with improved approach
              let phone = '';
              const allSpans = element.querySelectorAll('span');
              for (const span of allSpans) {
                const text = span.textContent.trim();
                if (/^(?:\+\d|\(\d)[\d\s\(\)\-\+\.]{7,}$/.test(text)) {
                  phone = text;
                  break;
                }
              }
              
              // Extract website URL if available
              let website = '';
              const links = element.querySelectorAll('a');
              for (const link of links) {
                const href = link.href || '';
                // Website links often have these patterns in Google Maps
                if (href.includes('/url?') || (href.startsWith('http') && !href.includes('google.com/maps'))) {
                  website = href.includes('/url?') ? new URL(href).searchParams.get('q') : href;
                  if (website) break;
                }
              }
              
              businesses.push({
                name,
                rating,
                reviewCount,
                address,
                phone,
                website
              });
            } catch (e) {
              console.error('Error extracting business data:', e);
            }
          }
        } else {
          // Alternative approach for different layouts
          const feedItems = document.querySelectorAll('[role="feed"] > div');
          if (feedItems.length > 0) {
            for (const item of feedItems) {
              try {
                // Find business name
                const nameEl = item.querySelector('div[role="heading"]');
                if (!nameEl) continue;
                
                const name = nameEl.textContent.trim();
                
                // Get rating and review count if available
                let rating = null;
                let reviewCount = '';
                const ratingText = item.querySelector('[aria-label*="star"]')?.getAttribute('aria-label');
                if (ratingText) {
                  const ratingMatch = ratingText.match(/([0-9.]+) star/);
                  if (ratingMatch) rating = parseFloat(ratingMatch[1]);
                  
                  // Get review count if present
                  const reviewMatch = ratingText.match(/(\d[\d,.]*) review/);
                  if (reviewMatch) reviewCount = reviewMatch[1];
                }
                
                // Get address - try multiple approaches
                let address = 'No address available';
                // Look for address in typical locations in feed items
                const addressCandidates = item.querySelectorAll('div[role="link"] div:not([role="heading"]) > span');
                for (const candidate of addressCandidates) {
                  const text = candidate.textContent.trim();
                  // Address typically doesn't look like a phone number or website and has some length
                  if (text && text.length > 5 && !/^[0-9+()]+$/.test(text) && !text.includes('.com')) {
                    address = text;
                    break;
                  }
                }
                
                // Get phone if available - better phone number detection
                let phone = '';
                const allSpans = item.querySelectorAll('span');
                for (const span of allSpans) {
                  const text = span.textContent.trim();
                  // More robust phone detection pattern
                  if (/^(?:\+\d|\(\d)[\d\s\(\)\-\+\.]{7,}$/.test(text)) {
                    phone = text;
                    break;
                  }
                }
                
                // Try to find website
                let website = '';
                const links = item.querySelectorAll('a');
                for (const link of links) {
                  const href = link.href || '';
                  if (href.includes('/url?') || (href.startsWith('http') && !href.includes('google.com/maps'))) {
                    website = href.includes('/url?') ? new URL(href).searchParams.get('q') : href;
                    if (website) break;
                  }
                }
                
                businesses.push({
                  name,
                  rating,
                  reviewCount,
                  address,
                  phone,
                  website
                });
              } catch (e) {
                console.error('Error extracting business data:', e);
              }
            }
          }
        }
        
        return businesses;
      });
    } catch (error) {
      logger.error(`Error extracting businesses: ${error.message}`);
      return [];
    }
  }

  /**
   * Scroll down to load more results
   * @param {Page} page - Puppeteer page object 
   */
  async scrollPage(page) {
    try {
      // Use evaluate instead of waitForTimeout
      await page.evaluate(() => {
        // Try scrolling the feed element first
        const feed = document.querySelector('[role="feed"]');
        if (feed) {
          feed.scrollTop = feed.scrollHeight;
          return;
        }

        // Otherwise, scroll the main page
        window.scrollBy(0, 800);
      });

      // Use setTimeout instead of waitForTimeout
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      logger.warn(`Error scrolling page: ${error.message}`);
    }
  }

  /**
   * Clean up resources
   */
  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.initialized = false;
    }
  }
}

// Create and export singleton instance
const googleMapsScraper = new GoogleMapsScraper();
export default googleMapsScraper;
