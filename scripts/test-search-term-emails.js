/**
 * Test script to find emails for businesses matching a specific search term
 */
const emailFinder = require('../emailFinder');
const db = require('../database');
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

/**
 * Find emails for businesses with a specific search term
 * @param {string} searchTerm - The search term to filter businesses by
 * @param {object} options - Additional options (limit, etc.)
 */
async function findEmailsBySearchTerm(searchTerm, options = {}) {
  try {
    logger.info(`Finding emails for businesses with search term "${searchTerm}"`);
    
    // Initialize database
    await db.init();
    
    // Test database connection
    const connected = await db.testConnection();
    logger.info(`Database connection: ${connected ? 'CONNECTED' : 'FAILED'}`);
    
    if (!connected) {
      logger.error('Cannot proceed without database connection');
      return;
    }
    
    // Build query with proper parameters
    const limit = options.limit || 10; // Default to 10 for testing
    
    const query = `
      SELECT id, name, website, domain 
      FROM business_listings 
      WHERE search_term = $1 
      AND website IS NOT NULL AND website != ''
      AND (email IS NULL OR email = '')
      LIMIT $2
    `;
    
    logger.info(`Executing query with search_term=${searchTerm}, limit=${limit}`);
    
    // Get businesses matching the search term
    const businesses = await db.getMany(query, [searchTerm, limit]);
    
    if (!businesses || businesses.length === 0) {
      logger.info(`No businesses found with search term "${searchTerm}" that need emails`);
      return;
    }
    
    logger.info(`Found ${businesses.length} businesses with search term "${searchTerm}" to process for emails`);
    
    // Initialize email finder
    await emailFinder.initialize();
    
    // Process each business
    for (const business of businesses) {
      logger.info(`Processing business ID ${business.id}: ${business.name} (${business.website})`);
      
      // Find email with explicit businessId and saveToDatabase=true
      const email = await emailFinder.findEmail(business.website, {
        businessId: business.id,
        saveToDatabase: true,
        useSearchEngines: options.useSearchEngines || true,
        searchEngine: options.searchEngine || 'google'
      });
      
      if (email) {
        logger.info(`✓ Found email for business ${business.id}: ${email}`);
      } else {
        logger.warn(`No email found for business ${business.id}: ${business.name}`);
      }
      
      // Brief pause between businesses to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    logger.info(`Processing completed for ${businesses.length} businesses`);
  } catch (error) {
    logger.error(`Error finding emails: ${error.message}`);
  } finally {
    // Close email finder resources
    try {
      await emailFinder.close();
    } catch (e) {
      logger.warn(`Error closing email finder: ${e.message}`);
    }
  }
}

// Run the function if this script is executed directly
if (require.main === module) {
  // Get search term from command line argument or use default
  const searchTerm = process.argv[2] || 'Digital Marketing Agency';
  const limit = parseInt(process.argv[3], 10) || 10;
  
  logger.info(`Starting email search for search term "${searchTerm}" with limit ${limit}`);
  
  findEmailsBySearchTerm(searchTerm, { limit }).catch(error => {
    logger.error(`Script error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { findEmailsBySearchTerm };
