import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function GET() {
    try {
        // Initialize database
        await db.init();

        // Get all unique search terms from the database
        const query = `
            SELECT DISTINCT search_term 
            FROM business_listings 
            WHERE search_term IS NOT NULL AND search_term != ''
            ORDER BY search_term ASC
        `;

        const results = await db.getMany(query);
        const searchTerms = results.map(row => row.search_term);

        logger.info(`Found ${searchTerms.length} unique search terms`);

        return NextResponse.json({ 
            success: true, 
            searchTerms 
        });
    } catch (error) {
        logger.error(`Error fetching search terms: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to fetch search terms', details: error.message },
            { status: 500 }
        );
    }
}
