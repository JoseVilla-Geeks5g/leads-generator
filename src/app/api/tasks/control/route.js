import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import logger from '@/services/logger';

/**
 * Control the task processor
 */
export async function POST(request) {
    try {
        const { action, enabled, apiKey } = await request.json();

        // Simple API key check for authorization
        const validApiKey = process.env.TASK_CONTROL_API_KEY || 'your-secure-api-key-here';

        if (apiKey !== validApiKey) {
            logger.warn(`Unauthorized task control attempt with invalid API key`);
            return NextResponse.json(
                { error: 'Unauthorized access' },
                { status: 401 }
            );
        }

        switch (action) {
            case 'setAutoProcessing':
                const result = scraperService.setAutoProcessing(Boolean(enabled));
                logger.info(`Auto processing ${result ? 'enabled' : 'disabled'} via API`);
                return NextResponse.json({
                    success: true,
                    autoProcessingEnabled: result
                });

            case 'status':
                return NextResponse.json({
                    autoProcessingEnabled: scraperService.isAutoProcessingEnabled(),
                    currentRunningTasks: scraperService.currentRunningTasks,
                    maxConcurrentTasks: scraperService.maxConcurrentTasks
                });

            case 'processNow':
                await scraperService.triggerTaskProcessing();
                return NextResponse.json({
                    success: true,
                    message: 'Task processing triggered'
                });

            case 'setMockDataGeneration':
                const mockDataStatus = scraperService.setMockDataGeneration(Boolean(enabled));
                logger.info(`Mock data generation ${mockDataStatus ? 'enabled' : 'disabled'} via API`);
                return NextResponse.json({
                    success: true,
                    mockDataGenerationEnabled: mockDataStatus
                });

            case 'clearMockBusinesses':
                const removedCount = await scraperService.clearMockBusinesses();
                return NextResponse.json({
                    success: true,
                    message: `Removed ${removedCount} mock business entries`,
                    count: removedCount
                });

            default:
                return NextResponse.json(
                    { error: 'Invalid action' },
                    { status: 400 }
                );
        }
    } catch (error) {
        logger.error(`Error in task control API: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to control task processor', details: error.message },
            { status: 500 }
        );
    }
}
