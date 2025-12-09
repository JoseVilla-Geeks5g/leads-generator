/**
 * Business Data Service Module
 * Handles processing and saving of business data
 */

import db from './database';
import logger from './logger';

/**
 * Process and sanitize raw business data
 * @param {Object} business - Raw business data
 * @param {string} city - City name
 * @param {string} state - State name
 * @param {string} category - Business category
 * @param {string} taskId - Task ID
 * @returns {Object} Processed business data
 */
function processBusinessData(business, city, state, category, taskId) {
    try {
        let domain = null;
        if (business.website) {
            try {
                const urlObj = new URL(business.website);
                domain = urlObj.hostname.replace(/^www\./, '');
            } catch (e) {
                logger.debug(`Could not parse URL: ${business.website}`);
            }
        }

        let postalCode = null;
        if (business.address) {
            const postalMatch = business.address.match(/\b\d{5}(?:-\d{4})?\b/);
            postalCode = postalMatch ? postalMatch[0] : null;
        }

        const notes = business.reviewCount ? `Reviews: ${business.reviewCount}` : '';

        return {
            name: business.name ? business.name.substring(0, 250) : 'Unnamed Business',
            address: business.address ? business.address.substring(0, 2000) : 'No address available',
            city: city ? city.substring(0, 95) : '',
            state: state ? state.substring(0, 95) : '',
            postalCode: postalCode,
            phone: business.phone ? business.phone.substring(0, 45) : null,
            website: business.website ? business.website.substring(0, 250) : null,
            domain: domain ? domain.substring(0, 250) : null,
            rating: business.rating || null,
            category: category ? category.substring(0, 250) : 'Uncategorized',
            notes: notes
        };
    } catch (error) {
        logger.error(`Error processing business data: ${error.message}`);
        return {
            name: business.name || 'Unknown Business',
            address: business.address || 'Unknown Address',
            city: city,
            state: state,
            postalCode: null,
            phone: null,
            website: null,
            domain: null,
            rating: null,
            category: category,
            notes: 'Error processing data'
        };
    }
}

/**
 * Save scraped business to database
 * @param {Object} processedBusiness - The processed business data
 * @param {string} taskId - The task ID
 * @returns {Promise<boolean>} Success or failure
 */
async function saveScrapedBusiness(processedBusiness, taskId) {
    try {
        const existingBusiness = await db.getOne(`
            SELECT id FROM business_listings
            WHERE name = $1 AND search_term = $2
        `, [
            processedBusiness.name,
            processedBusiness.category
        ]);

        if (existingBusiness) {
            logger.debug(`Business already exists: ${processedBusiness.name}`);
            return true;
        }

        await db.query(`
            INSERT INTO business_listings (
                name, address, city, state, country, postal_code, phone, website, domain,
                rating, search_term, search_date, task_id, notes, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
            )
        `, [
            processedBusiness.name,
            processedBusiness.address,
            processedBusiness.city,
            processedBusiness.state,
            'United States',
            processedBusiness.postalCode,
            processedBusiness.phone,
            processedBusiness.website,
            processedBusiness.domain,
            processedBusiness.rating,
            processedBusiness.category,
            new Date().toISOString(),
            taskId,
            processedBusiness.notes
        ]);

        return true;
    } catch (error) {
        logger.error(`Error saving business data: ${error.message}`);
        return false;
    }
}

/**
 * Create simulated business entries in the database for testing
 * @param {string} taskId - Task ID
 * @param {string} category - Business category
 * @param {string} location - Location string
 * @param {number} count - Number of businesses to create
 */
async function createSimulatedBusinesses(taskId, category, location, count) {
    try {
        let state = '';
        let city = '';

        if (location.includes(',')) {
            const parts = location.split(',').map(p => p.trim());
            city = parts[0];
            state = parts[1];
        } else {
            state = location;
        }

        const businessTypes = [
            'LLC', 'Corporation', 'Partnership', 'Sole Proprietorship'
        ];

        for (let i = 0; i < count; i++) {
            const name = `${category} Business ${Math.floor(Math.random() * 10000)}`;
            const hasEmail = Math.random() > 0.3;
            const hasWebsite = Math.random() > 0.2;

            const data = {
                name,
                address: `${1000 + Math.floor(Math.random() * 9000)} Main St`,
                city: city || `${state} City`,
                state,
                country: 'United States',
                postal_code: `${10000 + Math.floor(Math.random() * 90000)}`,
                phone: `(${100 + Math.floor(Math.random() * 900)}) ${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`,
                email: hasEmail ? `contact@${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                website: hasWebsite ? `https://www.${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                domain: hasWebsite ? `${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                rating: (3 + Math.random() * 2).toFixed(1),
                search_term: category,
                search_date: new Date().toISOString(),
                task_id: taskId,
                business_type: businessTypes[Math.floor(Math.random() * businessTypes.length)],
                owner_name: null,
                verified: false,
                contacted: false,
                notes: null,
                created_at: new Date().toISOString()
            };

            await db.query(`
                INSERT INTO business_listings (
                    name, address, city, state, country, postal_code, phone, email, website, domain,
                    rating, search_term, search_date, task_id, business_type, owner_name, verified,
                    contacted, notes, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
                )
                ON CONFLICT (name, search_term) DO NOTHING
            `, [
                data.name, data.address, data.city, data.state, data.country, data.postal_code,
                data.phone, data.email, data.website, data.domain, data.rating, data.search_term,
                data.search_date, data.task_id, data.business_type, data.owner_name, data.verified,
                data.contacted, data.notes, data.created_at
            ]);
        }
    } catch (error) {
        logger.error(`Error creating simulated businesses: ${error.message}`);
    }
}

/**
 * Create simulated random category leads in the database for testing
 * @param {string} taskId - Task ID
 * @param {string} category - Business category
 * @param {string} location - Location string
 * @param {number} count - Number of businesses to create
 */
async function createSimulatedRandomCategoryLeads(taskId, category, location, count) {
    try {
        let state = '';
        let city = '';

        if (location.includes(',')) {
            const parts = location.split(',').map(p => p.trim());
            city = parts[0];
            state = parts[1];
        } else {
            state = location;
        }

        const businessTypes = [
            'LLC', 'Corporation', 'Partnership', 'Sole Proprietorship'
        ];

        for (let i = 0; i < count; i++) {
            const name = `${category} Business ${Math.floor(Math.random() * 10000)}`;
            const hasEmail = Math.random() > 0.3;
            const hasWebsite = Math.random() > 2;

            const data = {
                name,
                address: `${1000 + Math.floor(Math.random() * 9000)} Main St`,
                city: city || `${state} City`,
                state,
                country: 'United States',
                postal_code: `${10000 + Math.floor(Math.random() * 90000)}`,
                phone: `(${100 + Math.floor(Math.random() * 900)}) ${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`,
                email: hasEmail ? `contact@${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                website: hasWebsite ? `https://www.${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                domain: hasWebsite ? `${name.toLowerCase().replace(/\s+/g, '-')}.com` : null,
                rating: (3 + Math.random() * 2).toFixed(1),
                category: category,
                search_term: category,
                search_date: new Date().toISOString(),
                task_id: taskId,
                business_type: businessTypes[Math.floor(Math.random() * businessTypes.length)],
                owner_name: null,
                verified: false,
                contacted: false,
                notes: null,
                created_at: new Date().toISOString()
            };

            await db.query(`
                INSERT INTO random_category_leads (
                    name, address, city, state, country, postal_code, phone, email, website, domain,
                    rating, category, search_term, search_date, task_id, business_type, owner_name, verified,
                    contacted, notes, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                )
            `, [
                data.name, data.address, data.city, data.state, data.country, data.postal_code,
                data.phone, data.email, data.website, data.domain, data.rating, data.category, data.search_term,
                data.search_date, data.task_id, data.business_type, data.owner_name, data.verified,
                data.contacted, data.notes, data.created_at
            ]);
        }
    } catch (error) {
        logger.error(`Error creating simulated random category leads: ${error.message}`);
    }
}

export {
    processBusinessData,
    saveScrapedBusiness,
    createSimulatedBusinesses,
    createSimulatedRandomCategoryLeads
};

export default {
    processBusinessData,
    saveScrapedBusiness,
    createSimulatedBusinesses,
    createSimulatedRandomCategoryLeads
};
