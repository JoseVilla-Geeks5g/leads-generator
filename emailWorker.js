const db = require('./database');
const logger = require('./logger');

/**
 * Find emails for a business using website analysis
 * @param {number|string|object} businessIdOrObject - Business ID, business object, or any object with id property
 * @param {string} websiteOrObject - Website URL or object with website property
 * @param {boolean} saveToDatabase - Whether to save results to database
 * @returns {Promise<Object>} - Found emails and metadata
 */
async function findEmails(businessIdOrObject, websiteOrObject, saveToDatabase = true) {
    // Extract businessId - handle all possible input formats
    let businessId;
    let website;
    
    // Handle if first parameter is an object containing the business details
    if (typeof businessIdOrObject === 'object' && businessIdOrObject !== null) {
        // Try to extract ID from various possible properties
        businessId = businessIdOrObject.id || businessIdOrObject.business_id || businessIdOrObject.businessId;
        
        // If the first parameter contains the website too, extract it
        website = businessIdOrObject.website || businessIdOrObject.domain;
    } else {
        // Direct ID parameter
        businessId = businessIdOrObject;
    }
    
    // Handle website parameter
    if (typeof websiteOrObject === 'object' && websiteOrObject !== null) {
        // Extract website from object if second param is an object
        website = websiteOrObject.website || websiteOrObject.domain || websiteOrObject.url;
    } else if (typeof websiteOrObject === 'string') {
        // Direct website URL
        website = websiteOrObject;
    }
    
    // Force businessId to a string representation for logging
    const businessIdStr = businessId ? `${businessId}` : 'null';
    
    // Log the extracted values to verify
    logger.info(`Looking for email with businessId=${businessIdStr}, website=${website}, saveToDatabase=${saveToDatabase}`);

    // If we don't have both required parameters, we can't proceed
    if (!businessId) {
        logger.error('Business ID not provided or could not be extracted from parameters');
        return { emails: [] };
    }
    
    if (!website) {
        logger.warn(`No website provided for business ${businessIdStr}`);
        return { emails: [] };
    }

    try {
        // Simulate finding emails (replace with your actual email finding logic)
        const emails = [`info@${website.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]}`];
        
        // Save to database if requested
        if (saveToDatabase && emails.length > 0) {
            await saveEmailToDatabase(businessId, emails[0]);
        }
        
        return {
            businessId,
            emails,
            website,
            saveToDatabase
        };
    } catch (error) {
        logger.error(`Error finding emails for business ${businessIdStr}: ${error.message}`);
        return { 
            businessId,
            emails: [] 
        };
    }
}

/**
 * Save email to database
 * @param {number|string} businessId - Business ID
 * @param {string} email - Email to save
 * @returns {Promise<boolean>} - Success or failure
 */
async function saveEmailToDatabase(businessId, email) {
    // Make sure businessId is valid
    if (!businessId) {
        logger.error('Cannot save email to database: businessId not provided');
        return false;
    }
    
    try {
        // First try to convert businessId to a number if it's a string number
        let idForDatabase = businessId;
        if (typeof businessId === 'string' && !isNaN(businessId)) {
            idForDatabase = parseInt(businessId, 10);
        }
        
        logger.info(`Saving email ${email} for business ${idForDatabase} to database`);
        
        const query = `
            UPDATE business_listings
            SET email = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, email
        `;
        
        const result = await db.query(query, [email, idForDatabase]);
        
        if (result.rows && result.rows.length > 0) {
            logger.info(`Email updated for business ${idForDatabase}: ${result.rows[0].email}`);
            return true;
        } else {
            // Try again with the original businessId if conversion didn't work
            if (idForDatabase !== businessId) {
                logger.warn(`Retrying with original businessId: ${businessId}`);
                const retryResult = await db.query(query, [email, businessId]);
                
                if (retryResult.rows && retryResult.rows.length > 0) {
                    logger.info(`Email updated for business ${businessId}: ${retryResult.rows[0].email}`);
                    return true;
                }
            }
            
            logger.warn(`No rows updated when saving email for business ${businessId}`);
            return false;
        }
    } catch (error) {
        logger.error(`Error saving email to database for business ${businessId}: ${error.message}`);
        return false;
    }
}

module.exports = {
    findEmails,
    saveEmailToDatabase
};
