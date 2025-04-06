import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import logger from '@/services/logger';

// Get email finder status
export async function GET() {
    try {
        const status = scraperService.getEmailFinderStatus();
        return NextResponse.json(status);
    } catch (error) {
        logger.error(`Error getting email finder status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get email finder status', details: error.message },
            { status: 500 }
        );
    }
}

// Start email finder operation
export async function POST(request) {
    try {
        const body = await request.json();
        const { businessIds, domain, searchDepth = 1 } = body;

        let result;

        if (businessIds && Array.isArray(businessIds)) {
            result = await scraperService.processBusinesses(businessIds, {
                searchDepth,
                domain
            });
        } else {
            result = await scraperService.processAllPendingBusinesses({
                searchDepth,
                domain,
                limit: 100
            });
        }

        return NextResponse.json({
            message: 'Email finder started',
            businessesProcessing: result
        });
    } catch (error) {
        logger.error(`Error starting email finder: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to start email finder', details: error.message },
            { status: 500 }
        );
    }
}

// Stop email finder operation
export async function DELETE() {
    try {
        const result = await scraperService.stopEmailFinder();
        return NextResponse.json({
            message: 'Email finder stopped',
            ...result
        });
    } catch (error) {
        logger.error(`Error stopping email finder: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to stop email finder', details: error.message },
            { status: 500 }
        );
    }
}
