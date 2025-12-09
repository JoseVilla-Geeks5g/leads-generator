/**

import db from './database';
import logger from './logger';
import emailFinder from '../../emailFinder';

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
 * Find email for a specific business
 * @param {Object} business - Business object with website
 * @returns {Promise<string|null>} Found email or null
 */
async function findEmailForBusiness(business) {
    if (!business || !business.website) {
        logger.warn('Cannot find email: Business or website is missing');
        return null;
    }

    const options = {
        businessId: business.id,
        saveToDatabase: true
    };

    logger.info(`Searching for email for business ${business.id} with website ${business.website}`);

    try {
        return await findEmailSafe(business.website, options);
    } catch (error) {
        logger.error(`Error finding email for business ${business.id}: ${error.message}`);
        return null;
    }
}

/**
 * Process a batch of businesses to find their emails
 * @param {Array} businesses - Array of business objects
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Results array
 */
async function processEmailBatch(businesses, options = {}) {
    const results = [];
    let concurrency = options.concurrency || 3;
    let currentRunning = 0;
    let completed = 0;

    const processedIds = new Set();

    while (businesses.length > 0) {
        while (currentRunning < concurrency && businesses.length > 0) {
            const business = businesses.shift();

            if (processedIds.has(business.id) || !business.website) {
                continue;
            }

            processedIds.add(business.id);
            currentRunning++;

            findEmailForBusiness(business).then(email => {
                if (email) {
                    results.push({
                        id: business.id,
                        name: business.name,
                        email: email
                    });

                    logger.info(`Email found for business ${business.id}: ${email} (found in ${emailFinder.lastExtractedEmailSources?.get(email.toLowerCase()) || 'unknown'})`);
                }
            }).catch(error => {
                logger.error(`Error processing business ${business.id}: ${error.message}`);
            }).finally(() => {
                currentRunning--;
                completed++;
            });

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    while (currentRunning > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
}

/**
 * Process all pending businesses for email discovery
 * @param {Object} options - Processing options
 * @returns {Promise<number>} Number of businesses processed
 */
async function processAllPendingBusinesses(options = {}) {
    try {
        const conditions = [];
        const params = [];

        const websiteCondition = options.onlyWithWebsite
            ? `website IS NOT NULL AND website != '' AND website != 'null' AND website NOT LIKE 'http://null%'`
            : `true`;

        conditions.push(`${websiteCondition} AND (email IS NULL OR email = '' OR email = '[null]')`);

        if (options.searchTerm) {
            params.push(options.searchTerm);
            conditions.push(`search_term = $${params.length}`);
        }

        const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

        params.push(options.limit || 1000);

        const query = `
            SELECT id, name, website, domain
            FROM business_listings
            WHERE ${conditions.join(' AND ')}
            ORDER BY created_at ${sortOrder}
            LIMIT $${params.length}
        `;

        logger.info(`Querying businesses with sort order ${sortOrder}: ${query.replace(/\s+/g, ' ')}`);

        // Execute query and process businesses
        const businesses = await db.getMany(query, params);

        if (!businesses || businesses.length === 0) {
            return 0;
        }

        const results = await processEmailBatch(businesses, options);
        return results.length;
    } catch (error) {
        logger.error(`Error processing pending businesses: ${error.message}`);
        return 0;
    }
}

/**
 * Process specific businesses for emails
 * @param {Array} businessIds - Array of business IDs
 * @param {Object} options - Processing options
 * @returns {Promise<number>} Number processed
 */
async function processBusinesses(businessIds, options = {}) {
    if (!Array.isArray(businessIds) || businessIds.length === 0) {
        logger.error('No valid business IDs provided for processing');
        return 0;
    }

    logger.info(`Processing emails for ${businessIds.length} businesses: ${businessIds.slice(0, 5).join(', ')}${businessIds.length > 5 ? '...' : ''}`);

    return await emailFinder.processBusinesses(businessIds, {
        ...options,
        saveToDatabase: true
    });
}

/**
 * Get email finder status
 * @returns {Object} Status object
 */
function getEmailFinderStatus() {
    if (!emailFinder) return { isRunning: false };
    return emailFinder.getStatus ? emailFinder.getStatus() : { isRunning: false };
}

/**
 * Stop the email finder
 * @returns {Promise<Object>} Result object
 */
async function stopEmailFinder() {
    if (!emailFinder || !emailFinder.stop) {
        logger.error('Email finder stop method not available');
        return { processed: 0, emailsFound: 0 };
    }

    try {
        return await emailFinder.stop();
    } catch (error) {
        logger.error(`Error stopping email finder: ${error.message}`);
        return { processed: 0, emailsFound: 0 };
    }
}

/**
 * Process a single business with better ID handling
 * @param {Object} business - Business object
 * @returns {Promise<Object|null>} Result or null
 */
async function processEmailForBusiness(business) {
    if (!business) {
        logger.error('Cannot process email: No business data provided');
        return null;
    }

    if (!business.id) {
        logger.error('Business is missing ID field:', business);
        return null;
    }

    if (!business.website) {
        logger.warn(`Business ${business.id} has no website to check for email`);
        return null;
    }

    const email = await findEmailForBusiness(business);

    return email ? {
        businessId: business.id,
        email,
        success: true
    } : null;
}

export {
    verifyEmailFinder,
    findEmailSafe,
    findEmailForBusiness,
    processEmailBatch,
    processAllPendingBusinesses,
    processBusinesses,
    getEmailFinderStatus,
    stopEmailFinder,
    processEmailForBusiness
};

export default {
    verifyEmailFinder,
    findEmailSafe,
    findEmailForBusiness,
    processEmailBatch,
    processAllPendingBusinesses,
    processBusinesses,
    getEmailFinderStatus,
    stopEmailFinder,
    processEmailForBusiness
};
