import { NextResponse } from 'next/server';
import db from '@/services/database';
import emailFinder from '../../../../../emailFinder';
import logger from '@/services/logger';

/**
 * API endpoint to update multiple businesses with discovered emails
 * This is useful for bulk updating businesses that share the same domain
 */
export async function POST(request) {
    try {
        const { domain, email, limit = 20 } = await request.json();

        if (!domain || !email) {
            return NextResponse.json({
                error: 'Both domain and email are required'
            }, { status: 400 });
        }

        await db.init();

        // Find businesses with matching domain and no email
        const businesses = await db.getMany(
            `SELECT id, name FROM business_listings 
             WHERE domain = $1 
             AND (email IS NULL OR email = '') 
             LIMIT $2`,
            [domain, limit]
        );

        if (businesses.length === 0) {
            return NextResponse.json({
                message: `No businesses found with domain ${domain} that need email updates`,
                updated: 0
            });
        }

        // Update each business
        let updatedCount = 0;
        const updated = [];

        for (const business of businesses) {
            try {
                await emailFinder.saveEmailToDatabase(business.id, email, email);
                updatedCount++;
                updated.push({
                    id: business.id,
                    name: business.name,
                    email: email
                });
            } catch (error) {
                logger.error(`Failed to update email for business ${business.id}: ${error.message}`);
            }
        }

        return NextResponse.json({
            message: `Updated ${updatedCount} businesses with email ${email}`,
            domain,
            email,
            updated,
            updatedCount
        });
    } catch (error) {
        logger.error(`Error in batch email update: ${error.message}`);
        return NextResponse.json({
            error: 'Failed to update businesses',
            details: error.message
        }, { status: 500 });
    }
}
