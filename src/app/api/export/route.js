import { NextResponse } from 'next/server';
import exportService from '@/services/exportService';
import db from '@/services/database';
import logger from '@/services/logger';
import fs from 'fs';

export async function POST(request) {
    try {
        logger.info('Export request received');
        const start = Date.now();

        const body = await request.json();
        const { taskId, state, filter, forceUnfiltered, isRandomCategoryTask } = body;

        // FIXED: Properly log filter values with explicit types for debugging
        logger.info(`Export parameters received: 
            taskId=${taskId !== undefined ? taskId : 'undefined'}, 
            state=${state !== undefined ? state : 'undefined'}, 
            filter=${filter ? JSON.stringify(filter) : 'undefined'}, 
            forceUnfiltered=${forceUnfiltered !== undefined ? forceUnfiltered : 'undefined'},
            isRandomCategoryTask=${isRandomCategoryTask !== undefined ? isRandomCategoryTask : 'undefined'}`);

        // Initialize database
        await db.init();

        // Create diagnostics object
        let diagnostics = {
            startTime: new Date().toISOString(),
            totalBusinessCount: await exportService.getTotalCount(),
            emailCount: await exportService.countBusinessesWithEmail(),
            requestParams: { taskId, state, filter, forceUnfiltered, isRandomCategoryTask }
        };

        // FIXED: Clean filter to ensure no null values 
        let cleanFilter;
        if (filter) {
            cleanFilter = {};
            Object.entries(filter).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    // Handle boolean strings explicitly
                    if (value === 'true') cleanFilter[key] = true;
                    else if (value === 'false') cleanFilter[key] = false;
                    else cleanFilter[key] = value;
                }
            });
            diagnostics.cleanFilter = cleanFilter;
        }

        let result;
        try {
            if (taskId) {
                // Export task results - check if it's a random category task
                logger.info(`Exporting data for task: ${taskId}, isRandomCategoryTask=${isRandomCategoryTask}`);

                // Verify task exists before exporting
                const task = await exportService.getTaskById(taskId);
                diagnostics.task = task ? {
                    id: task.id,
                    search_term: task.search_term,
                    status: task.status
                } : null;

                if (!task) {
                    return NextResponse.json(
                        {
                            warning: 'Task not found. Please verify the task ID.',
                            diagnostics
                        },
                        { status: 404 }
                    );
                }

                // Check if this is a random category task
                const isRandom = isRandomCategoryTask || await exportService.isRandomCategoryTask(taskId);
                
                if (isRandom) {
                    result = await exportService.exportRandomCategoryTaskResults(taskId);
                } else {
                    result = await exportService.exportTaskResults(taskId);
                }
            } else if (state) {
                // Export by state
                logger.info(`Exporting data for state: ${state}`);

                // Check if state has any data
                const stateCount = await exportService.getCountByState(state);
                diagnostics.stateCount = stateCount;

                result = await exportService.exportBusinessesByState(state);
            } else if (forceUnfiltered === true) {
                // FIXED: Always use optimized unfiltered export for full exports
                logger.info('Using optimized unfiltered export method');
                result = await exportService.exportAllBusinessesUnfiltered();
            } else if (cleanFilter && Object.keys(cleanFilter).length > 0) {
                // FIXED: Use clean filter for filtered exports
                logger.info(`Exporting filtered data with cleaned filters: ${JSON.stringify(cleanFilter)}`);

                // Count records before export
                const preCount = await exportService.getFilteredCount(cleanFilter);
                diagnostics.preCount = preCount;
                logger.info(`Pre-export count for filter: ${preCount} records`);

                // Check if filter is effectively empty
                const isEmptyFilter = !cleanFilter.state && !cleanFilter.city && !cleanFilter.searchTerm &&
                    cleanFilter.hasEmail !== true && cleanFilter.hasEmail !== false &&
                    cleanFilter.hasWebsite !== true && cleanFilter.hasWebsite !== false &&
                    (!cleanFilter.keywords || cleanFilter.keywords.trim() === '') &&
                    (!cleanFilter.includeCategories || cleanFilter.includeCategories.length === 0) &&
                    (!cleanFilter.excludeCategories || cleanFilter.excludeCategories.length === 0) &&
                    !cleanFilter.minRating;

                if (isEmptyFilter) {
                    logger.info('Filter is effectively empty, using unfiltered export method');
                    result = await exportService.exportAllBusinessesUnfiltered();
                } else {
                    result = await exportService.exportFilteredBusinesses(cleanFilter);
                }
            } else {
                // No filter provided - export all
                logger.info('No filter criteria provided, exporting all businesses');

                const totalCount = await exportService.getTotalCount();
                diagnostics.totalCount = totalCount;

                result = await exportService.exportAllBusinesses();
            }
        } catch (error) {
            // Check if this is a "no data" error
            if (error.message && error.message.includes("No businesses found")) {
                logger.warn(`No data found for export: ${error.message}`);
                return NextResponse.json(
                    {
                        warning: 'No records found matching your criteria. Try with different filters.',
                        details: error.message,
                        diagnostics
                    },
                    { status: 404 }
                );
            }
            throw error; // Re-throw any other errors
        }

        const duration = Date.now() - start;
        logger.info(`Export completed in ${duration}ms. File: ${result.filename}, Records: ${result.count}`);

        // FIXED: Verify the file was actually created and has content
        if (result.filepath) {
            try {
                const stats = fs.statSync(result.filepath);
                diagnostics.fileSize = stats.size;
                diagnostics.fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

                // Warn if file is suspiciously small
                if (stats.size < 1000 && result.count > 0) {
                    logger.warn(`Warning: Exported file is suspiciously small: ${stats.size} bytes for ${result.count} records`);
                }
            } catch (err) {
                logger.error(`Error checking exported file: ${err.message}`);
            }
        }

        // Add duration to diagnostics
        diagnostics.durationMs = duration;
        diagnostics.endTime = new Date().toISOString();

        // If result is empty but we have a file with headers
        if (result.isEmpty) {
            return NextResponse.json({
                message: 'Export completed but no records were found matching your criteria',
                filename: result.filename,
                count: 0,
                downloadUrl: `/api/export/download?file=${encodeURIComponent(result.filename)}`,
                diagnostics
            });
        }

        return NextResponse.json({
            message: 'Export completed successfully',
            filename: result.filename,
            count: result.count,
            downloadUrl: `/api/export/download?file=${encodeURIComponent(result.filename)}`,
            diagnostics
        });
    } catch (error) {
        logger.error(`Error exporting data: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to export data', details: error.message },
            { status: 500 }
        );
    }
}
