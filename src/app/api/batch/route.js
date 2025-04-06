import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import db from '@/services/database';
import logger from '@/services/logger';
import { v4 as uuidv4 } from 'uuid';

// Get batch status or all batches
export async function GET(request) {
    try {
        // Initialize database if needed
        await db.init();

        // Parse query parameters
        const { searchParams } = new URL(request.url);
        const batchId = searchParams.get('id');

        if (batchId) {
            // Check in-memory status first
            const memoryStatus = scraperService.getBatchStatus();
            if (memoryStatus.batchId === batchId) {
                return NextResponse.json(memoryStatus);
            }

            // If not in memory, get from database
            const batch = await db.getOne(`
                SELECT * FROM batch_operations WHERE id = $1
            `, [batchId]);

            if (!batch) {
                return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
            }

            // Get state progress
            const stateProgress = await db.getMany(`
                SELECT * FROM batch_state_progress WHERE batch_id = $1
            `, [batchId]);

            // Get failures
            const failures = await db.getMany(`
                SELECT * FROM batch_task_failures WHERE batch_id = $1
            `, [batchId]);

            return NextResponse.json({
                ...batch,
                stateProgress,
                failures
            });
        }

        // Get all batches
        const batches = await db.getMany(`
            SELECT * FROM batch_operations ORDER BY start_time DESC
        `, []);

        return NextResponse.json(batches);
    } catch (error) {
        logger.error(`Error getting batch status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get batch status', details: error.message },
            { status: 500 }
        );
    }
}

// Start a new batch operation
export async function POST(request) {
    try {
        // Initialize database if needed
        await db.init();

        const body = await request.json();
        const { states, searchTerm, wait, maxResults } = body;

        if (scraperService.getBatchStatus().isRunning) {
            return NextResponse.json(
                { error: 'A batch operation is already running' },
                { status: 400 }
            );
        }

        if (!searchTerm) {
            return NextResponse.json(
                { error: 'Search term is required' },
                { status: 400 }
            );
        }

        // Create a batch ID
        const batchId = uuidv4();

        // Start the batch
        const options = {
            wait: wait || 5000,
            maxResults: maxResults || 100,
            searchTerm
        };

        const result = await scraperService.startBatch(states, options);

        return NextResponse.json({
            batchId: result.batchId,
            message: 'Batch operation started successfully',
            status: 'running',
            totalTasks: result.totalTasks
        });
    } catch (error) {
        logger.error(`Error starting batch operation: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to start batch operation', details: error.message },
            { status: 500 }
        );
    }
}

// Stop a running batch
export async function DELETE(request) {
    try {
        const result = await scraperService.stopBatch();
        return NextResponse.json({
            message: 'Batch operation stopped',
            ...result
        });
    } catch (error) {
        logger.error(`Error stopping batch operation: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to stop batch operation', details: error.message },
            { status: 500 }
        );
    }
}
