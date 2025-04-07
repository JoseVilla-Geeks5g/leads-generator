import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import logger from '@/services/logger';

export async function GET() {
    try {
        // Get current email finder status
        const status = scraperService.getEmailFinderStatus();

        // Add server timestamp for sync verification
        return NextResponse.json({
            ...status,
            serverTime: new Date().toISOString(),
            serverTimeMs: Date.now()
        });
    } catch (error) {
        logger.error(`Error getting email finder status: ${error.message}`);
        return NextResponse.json(
            {
                error: 'Failed to get email finder status',
                details: error.message,
                isRunning: false // Default to not running on error
            },
            { status: 500 }
        );
    }
}
