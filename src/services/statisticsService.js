/**
 * Statistics Service Module
 * Handles statistics and analytics for the scraper service
 */

import db from './database';
import logger from './logger';

/**
 * Get system statistics
 * @returns {Promise<Object>} Statistics object
 */
async function getStatistics() {
    try {
        const businessCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings');
        const emailCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
        const websiteCount = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE website IS NOT NULL AND website != \'\'');

        const searchTerms = await db.getMany('SELECT DISTINCT search_term FROM business_listings');
        const states = await db.getMany('SELECT DISTINCT state FROM business_listings WHERE state IS NOT NULL');
        const taskStats = await db.getMany('SELECT status, COUNT(*) as count FROM scraping_tasks GROUP BY status');

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

export { getStatistics };

export default {
    getStatistics
};
