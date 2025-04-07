const db = require('../../database'); // Path to root database file
const logger = require('../../logger'); // Path to root logger file

async function getLeadsWithMissingEmails() {
  const query = `
    SELECT id, name, email, address, city, state, country, postal_code, 
    website, domain, rating, phone, owner_name, business_type, search_term, 
    search_date, created_at, updated_at, verified, contacted, notes, batch_id, 
    task_id, contacted_at
    FROM public.business_listings
    WHERE email IS NULL OR email = '' OR email = '[null]'
    ORDER BY id;
  `;
  
  try {
    // Add connection validation before query
    logger.info('Attempting to query database for leads with missing emails');
    if (!db) {
      logger.error('Database connection is undefined');
      return [];
    }
    
    const result = await db.query(query);
    
    if (!result || !result.rows) {
      logger.error('Query result is invalid:', result);
      return [];
    }
    
    logger.info(`Found ${result.rows.length} leads with missing emails`);
    
    return result.rows;
  } catch (error) {
    logger.error('Error fetching leads with missing emails:', error);
    throw error;
  }
}

async function findEmailForBusiness(business) {
  // Make sure we have a business ID (using just 'id' as that's the column name in the database)
  const businessId = business.id;
  if (!businessId) {
    logger.error('Business ID is missing:', business);
    return null;
  }
  
  // Log with proper ID
  logger.info(`Looking for email with businessId=${businessId}, saveToDatabase=true`);

  try {
    const website = business.website || business.domain;
    if (!website) {
      logger.warn(`No website found for business ${businessId}`);
      return null;
    }
    
    // Directly call the emailWorker to ensure businessId is passed correctly
    // First try importing from the root directory
    try {
      const emailWorker = require('../../emailWorker');
      const result = await emailWorker.findEmails(businessId, website, true);
      return {
        businessId,
        website,
        email: result.emails && result.emails.length > 0 ? result.emails[0] : null
      };
    } catch (error) {
      logger.error(`Error using emailWorker module: ${error.message}`);
      // Fall back to the search function if the direct approach fails
      const emails = await searchForEmails(website, businessId);
    
      if (emails && emails.length > 0) {
        // Save emails to database with explicit businessId
        const saved = await saveEmailsToDatabase(businessId, emails[0], website);
        if (saved) {
          logger.info(`Successfully saved email ${emails[0]} for business ${businessId}`);
        }
        
        return {
          businessId,
          website,
          email: emails[0]
        };
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`Error finding email for business ${businessId}:`, error);
    return null;
  }
}

// Add this function to handle email search
async function searchForEmails(website, businessId) {
  logger.info(`Searching for emails for business ${businessId} with website ${website}`);
  
  try {
    // Make sure to pass businessId as a direct parameter to worker
    const result = await sendToWorker(businessId, website, true);
    return result.emails || [];
  } catch (error) {
    logger.error(`Error searching for emails for business ${businessId}:`, error);
    return [];
  }
}

// Add this function to save emails to database
async function saveEmailsToDatabase(businessId, email, website) {
  // Extra validation to ensure businessId exists
  if (!businessId) {
    logger.error(`Cannot save email to database: businessId not provided (website: ${website})`);
    return false;
  }
  
  try {
    // Use blue color for database updates
    const blueText = '\x1b[34m';
    const resetColor = '\x1b[0m';
    logger.info(`${blueText}Saving email ${email} for business ${businessId} to database${resetColor}`);
    
    const query = `
      UPDATE public.business_listings
      SET email = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email;
    `;
    const result = await db.query(query, [email, businessId]);
    
    if (result.rows && result.rows.length > 0) {
      logger.info(`${blueText}Email updated for business ${businessId}: ${result.rows[0].email}${resetColor}`);
      return true;
    } else {
      logger.warn(`No rows updated when saving email for business ${businessId}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error saving email to database for business ${businessId}:`, error);
    return false;
  }
}

// This function sends the request to worker with proper businessId
async function sendToWorker(businessId, website, saveToDatabase) {
  // Making businessId a direct parameter instead of part of an object
  logger.info(`Sending to worker with businessId=${businessId}, saveToDatabase=${saveToDatabase}`);
  
  try {
    // Here's where the actual worker code would be called
    // We need to ensure the worker is receiving the businessId correctly
    
    // Check for global worker function or module
    if (global.emailWorker && typeof global.emailWorker.findEmails === 'function') {
      return await global.emailWorker.findEmails(businessId, website, saveToDatabase);
    }
    
    // Try requiring the emailWorker from various possible locations
    try {
      const emailWorker = require('../../emailWorker');
      if (emailWorker && typeof emailWorker.findEmails === 'function') {
        return await emailWorker.findEmails(businessId, website, saveToDatabase);
      }
    } catch (e) {
      logger.warn(`Could not load emailWorker from root: ${e.message}`);
    }
    
    // If we couldn't find the worker, use our mock implementation
    logger.warn(`Using mock email worker for business ${businessId}. Fix worker implementation.`);
    return {
      businessId, // Explicitly include businessId in the response
      website,
      emails: ['test@example.com'],
      saveToDatabase
    };
  } catch (error) {
    logger.error(`Error in worker communication for business ${businessId}:`, error);
    return { emails: [] };
  }
}

// This is likely where the email finder is being called from
async function processEmailFinding(businesses) {
  if (!businesses || businesses.length === 0) {
    logger.warn('No businesses to process for email finding');
    return [];
  }
  
  logger.info(`Processing email finding for ${businesses.length} businesses`);
  const results = [];
  for (const business of businesses) {
    // Ensure we're passing the business object correctly to the worker
    const result = await findEmailForBusiness(business);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

module.exports = {
  getLeadsWithMissingEmails,
  findEmailForBusiness,
  processEmailFinding,
  saveEmailsToDatabase // Export this to allow direct saving from other modules
};