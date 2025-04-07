import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import db from '@/services/database';
import logger from '@/services/logger';

export async function GET() {
    try {
        // Return current mock data status
        const isMockEnabled = scraperService.isMockDataGenerationEnabled();

        // Get count of mock businesses
        await db.init();
        const mockCount = await db.getOne(`
            SELECT COUNT(*) as count 
            FROM business_listings 
            WHERE name LIKE '%Business %'
        `);

        return NextResponse.json({
            mockDataEnabled: isMockEnabled,
            mockBusinessCount: parseInt(mockCount?.count || '0')
        });
    } catch (error) {
        logger.error(`Error getting mock data status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get mock data status', details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { action } = body;

        switch (action) {
            case 'enable':
                scraperService.setMockDataGeneration(true);
                return NextResponse.json({
                    success: true,
                    mockDataEnabled: true
                });

            case 'disable':
                scraperService.setMockDataGeneration(false);
                return NextResponse.json({
                    success: true,
                    mockDataEnabled: false
                });

            case 'clear':
                const count = await scraperService.clearMockBusinesses();
                return NextResponse.json({
                    success: true,
                    message: `Removed ${count} mock business entries`,
                    count
                });

            default:
                return NextResponse.json(
                    { error: 'Invalid action. Use "enable", "disable", or "clear"' },
                    { status: 400 }
                );
        }
    } catch (error) {
        logger.error(`Error managing mock data: ${error.message}`);
        return NextResponse.json(
            { error: 'Mock data operation failed', details: error.message },
            { status: 500 }
        );
    }
}
