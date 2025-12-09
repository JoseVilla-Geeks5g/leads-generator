/**
 * Scraper Service - Main Entry Point
 *
 * This module acts as the main facade for all scraping-related functionality.
 * It imports from specialized sub-modules and provides a unified API.
 *
 * Sub-modules:
 * - emailService.js: Email discovery and processing
 * - taskService.js: Task queue management and processing
 * - batchService.js: Batch operations for multi-state scraping
 * - businessDataService.js: Business data processing and storage
 * - statisticsService.js: Analytics and statistics
 */

import db from './database';
import logger from './logger';
import emailFinder from '../../emailFinder';

// Import all sub-modules
import emailService from './emailService';
import taskService from './taskService';
import batchService from './batchService';
import statisticsService from './statisticsService';
// Note: businessDataService is used internally by taskService and batchService

/**
 * Process emails by search term with VPN support
 * @param {string} searchTerm - The search term to filter businesses
 * @param {Object} options - Additional options for filtering
 * @returns {Promise<Object>} Result object with processed and found counts
 */
async function processEmailsBySearchTerm(searchTerm, options = {}) {
    try {
        logger.info(`Finding emails for businesses with search term "${searchTerm}"`);

        await db.init();

        let query = `
            SELECT id, name, website, domain
            FROM business_listings
            WHERE search_term = $1
            AND website IS NOT NULL AND website != ''
            AND (email IS NULL OR email = '' OR email = '[null]')
        `;

        const params = [searchTerm];
        let paramIndex = 2;

        if (options.minRating) {
            query += ` AND CAST(rating AS FLOAT) >= $${paramIndex}`;
            params.push(parseFloat(options.minRating));
            paramIndex++;
        }

        if (options.state && options.state !== 'all') {
            query += ` AND state = $${paramIndex}`;
            params.push(options.state);
            paramIndex++;
        }

        if (options.city && options.city !== 'all') {
            query += ` AND city = $${paramIndex}`;
            params.push(options.city);
            paramIndex++;
        }

        const limit = options.limit || 100;
        query += ` LIMIT $${paramIndex}`;
        params.push(limit);

        logger.info(`Executing query with params ${JSON.stringify(params)}`);

        const businesses = await db.getMany(query, params);

        if (!businesses || businesses.length === 0) {
            logger.info(`No businesses found with search term "${searchTerm}" that need emails`);
            return { processed: 0, found: 0 };
        }

        logger.info(`Found ${businesses.length} businesses with search term "${searchTerm}" to process for emails`);

        let processed = 0;
        let emailsFound = 0;

        const batchSize = options.concurrency || 3;

        let vpnUtils;
        try {
            vpnUtils = require('../../vpn-utils');
            await vpnUtils.initialize().catch(err =>
                logger.warn(`VPN utilities initialization error: ${err.message}`)
            );
        } catch (error) {
            logger.warn(`VPN utilities not available: ${error.message}`);
            vpnUtils = null;
        }

        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 5;

        for (let i = 0; i < businesses.length; i += batchSize) {
            const batch = businesses.slice(i, i + batchSize);

            if (consecutiveFailures >= maxConsecutiveFailures && vpnUtils) {
                logger.info(`Detected ${consecutiveFailures} consecutive failures, rotating VPN IP...`);

                try {
                    const rotated = await vpnUtils.rotateIP();
                    if (rotated) {
                        logger.info('Successfully rotated VPN IP address');
                        consecutiveFailures = 0;

                        try {
                            const ipInfo = await vpnUtils.getIPInfo();
                            if (ipInfo) {
                                logger.info(`New IP: ${ipInfo.ip} (${ipInfo.city}, ${ipInfo.country})`);
                            }
                        } catch (ipErr) {
                            logger.warn(`Could not get new IP info: ${ipErr.message}`);
                        }
                    } else {
                        logger.warn('Could not rotate VPN IP address');
                    }
                } catch (vpnError) {
                    logger.error(`VPN rotation error: ${vpnError.message}`);
                }
            }

            const batchPromises = batch.map(business => {
                return emailService.findEmailForBusiness(business)
                    .then(email => {
                        processed++;
                        if (email) {
                            emailsFound++;
                            consecutiveFailures = 0;
                            logger.info(`Found email for business ${business.id}: ${email}`);
                        } else {
                            if (business.website) {
                                consecutiveFailures++;
                            }
                        }
                        return email;
                    })
                    .catch(error => {
                        processed++;
                        consecutiveFailures++;

                        if (vpnUtils && (
                            error.message.includes('captcha') ||
                            error.message.includes('forbidden') ||
                            error.message.includes('denied') ||
                            error.message.includes('429') ||
                            error.message.includes('unusual traffic')
                        )) {
                            vpnUtils.registerBlockDetection();
                            logger.warn(`Detected potential block for ${business.id}: ${error.message}`);
                        }

                        logger.error(`Error processing business ${business.id}: ${error.message}`);
                        return null;
                    });
            });

            await Promise.all(batchPromises);

            logger.info(`Batch progress: processed ${processed}/${businesses.length}, found ${emailsFound} emails`);

            if (vpnUtils && vpnUtils.shouldRotateIP()) {
                logger.info(`Block detection threshold reached, rotating VPN IP...`);
                try {
                    await vpnUtils.rotateIP();
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } catch (vpnError) {
                    logger.error(`Error in automatic VPN rotation: ${vpnError.message}`);
                }
            }
        }

        logger.info(`Email discovery completed: processed ${processed} businesses, found ${emailsFound} emails`);

        return { processed, found: emailsFound };

    } catch (error) {
        logger.error(`Error in processEmailsBySearchTerm: ${error.message}`);
        return { processed: 0, found: 0, error: error.message };
    }
}

// Export the unified service API
export default {
    // Task management (from taskService)
    addTask: (params) => taskService.addTask(params),
    getTaskStatus: (taskId) => taskService.getTaskStatus(taskId),
    getAllTasks: () => taskService.getAllTasks(),
    clearMockBusinesses: () => taskService.clearMockBusinesses(),

    // Batch operations (from batchService)
    startBatch: (states, options) => batchService.startBatch(states, options),
    stopBatch: (batchId) => batchService.stopBatch(batchId),
    getBatchStatus: (batchId) => batchService.getBatchStatus(batchId),
    getAllRunningBatches: () => batchService.getAllRunningBatches(),

    // Settings control (from taskService)
    setAutoProcessing: (enabled, requireAuth) => taskService.setAutoProcessing(enabled, requireAuth),
    isAutoProcessingEnabled: () => taskService.isAutoProcessingEnabled(),
    setMockDataGeneration: (enabled) => taskService.setMockDataGeneration(enabled),
    isMockDataGenerationEnabled: () => taskService.isMockDataGenerationEnabled(),
    triggerTaskProcessing: () => taskService.triggerTaskProcessing(),

    // Statistics (from statisticsService)
    getStatistics: () => statisticsService.getStatistics(),

    // Email finder functionality (from emailService)
    findEmailForBusiness: emailService.findEmailForBusiness,
    processEmailBatch: emailService.processEmailBatch,
    getEmailFinderStatus: () => emailService.getEmailFinderStatus(),

    // Process all pending businesses
    processAllPendingBusinesses: async (options) => {
        logger.info(`Starting email finder with search term "${options.searchTerm || 'all'}" and filters: ${JSON.stringify({
            onlyWithWebsite: options.onlyWithWebsite || true,
            state: options.state || 'all',
            city: options.city || 'all',
            limit: options.limit || 5000
        })}`);

        if (options.searchTerm) {
            return processEmailsBySearchTerm(options.searchTerm, options);
        }

        if (!emailFinder) {
            logger.error('Email finder module is not properly imported');
            return 0;
        }

        try {
            return await emailFinder.processAllPendingBusinesses(options);
        } catch (error) {
            logger.error(`Error in processAllPendingBusinesses: ${error.message}`);
            return 0;
        }
    },

    processBusinesses: async (businessIds, options = {}) => {
        logger.info(`Processing ${businessIds.length} specific businesses for emails`);

        if (!emailFinder) {
            logger.error('Email finder module is not properly imported');
            return 0;
        }

        try {
            return await emailFinder.processBusinesses(businessIds, options);
        } catch (error) {
            logger.error(`Error in processBusinesses: ${error.message}`);
            return 0;
        }
    },

    stopEmailFinder: () => emailService.stopEmailFinder(),

    // Search by specific search term
    processEmailsBySearchTerm: async (searchTerm, options = {}) => {
        return processEmailsBySearchTerm(searchTerm, options);
    },

    // Process a single business with better business ID handling
    processEmailForBusiness: (business) => emailService.processEmailForBusiness(business)
};
