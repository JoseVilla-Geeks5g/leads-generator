import { NextResponse } from 'next/server';
import exportService from '@/services/exportService';
import db from '@/services/database';
import logger from '@/services/logger';
import fs from 'fs';

export async function POST(request) {
    try {
        // Parse request body
        const body = await request.json();
        
        // Extract params
        const { 
            filter = null, 
            forceUnfiltered = false, 
            taskId = null, 
            state = null,
            columns = null, // Add support for column selection
            isRandom = false, // Support for random category leads
            dataSource = 'business_listings',  // Default to business_listings table
            excludeNullPhone = false  // Option to exclude '[null]' phone values
        } = body;

        logger.info('Export request received');
        const start = Date.now();

        // Log the data source parameter
        logger.info(`Export parameters: taskId=${taskId}, state=${state}, isRandom=${isRandom}, dataSource=${dataSource}, excludeNullPhone=${excludeNullPhone}`);

        // FIXED: Properly log filter values with explicit types for debugging
        logger.info(`Export parameters received: 
            taskId=${taskId !== undefined ? taskId : 'undefined'}, 
            state=${state !== undefined ? state : 'undefined'}, 
            filter=${filter ? JSON.stringify(filter) : 'undefined'}, 
            forceUnfiltered=${forceUnfiltered !== undefined ? forceUnfiltered : 'undefined'},
            isRandomCategoryTask=${isRandom !== undefined ? isRandom : 'undefined'}`);

        // Initialize database
        await db.init();

        // Create diagnostics object
        let diagnostics = {
            startTime: new Date().toISOString(),
            totalBusinessCount: await exportService.getTotalCount(),
            emailCount: await exportService.countBusinessesWithEmail(),
            requestParams: { taskId, state, filter, forceUnfiltered, isRandom }
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
            
            // Add the exclude null phone option if specified
            if (excludeNullPhone) {
                cleanFilter.excludeNullPhone = true;
            }
            
            // Log all filter keys for debugging
            logger.info(`Filter keys: ${Object.keys(cleanFilter).join(', ')}`);
            diagnostics.cleanFilter = cleanFilter;
        }

        let result;
        const downloadHost = process.env.NEXT_PUBLIC_APP_URL || 
                             process.env.VERCEL_URL || 
                             'http://localhost:3000';

        try {
            // Special case for random_category_leads export
            if (dataSource === 'random_category_leads') {
                logger.info('Exporting from random_category_leads table');
                
                if (cleanFilter && Object.keys(cleanFilter).length > 0) {
                    result = await exportService.exportRandomCategoryLeads(cleanFilter, columns);
                } else {
                    // No filters - export all random category leads
                    result = await exportService.exportRandomCategoryLeads({}, columns);
                }
            }
            // Regular cases - handle with existing code paths
            else if (taskId) {
                // Task-specific export - pass data source via isRandom flag
                logger.info(`Exporting data for task: ${taskId}, isRandom=${isRandom || dataSource === 'random_category_leads'}`);

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

                // Use isRandom flag or data source parameter
                const useRandomSource = isRandom || dataSource === 'random_category_leads';
                result = await exportService.exportTaskResults(taskId, columns, useRandomSource);
            } else if (state) {
                // State-specific export
                logger.info(`Exporting data for state: ${state}`);

                // Check if state has any data
                const stateCount = await exportService.getCountByState(state);
                diagnostics.stateCount = stateCount;

                result = await exportService.exportBusinessesByState(state, columns);
            } else if (forceUnfiltered) {
                // Unfiltered export (all records)
                logger.info('Using optimized unfiltered export method');
                result = await exportService.exportAllBusinessesUnfiltered(columns);
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
                    cleanFilter.hasPhone !== true && cleanFilter.hasPhone !== false &&
                    cleanFilter.hasAddress !== true && cleanFilter.hasAddress !== false &&
                    (!cleanFilter.keywords || cleanFilter.keywords.trim() === '') &&
                    (!cleanFilter.includeCategories || cleanFilter.includeCategories.length === 0) &&
                    (!cleanFilter.excludeCategories || cleanFilter.excludeCategories.length === 0) &&
                    !cleanFilter.minRating;

                if (isEmptyFilter) {
                    logger.info('Filter is effectively empty, using unfiltered export method');
                    result = await exportService.exportAllBusinessesUnfiltered(columns);
                } else {
                    result = await exportService.exportFilteredBusinesses(cleanFilter, columns);
                }
            } else {
                // No filter provided - export all
                logger.info('No filter criteria provided, exporting all businesses');

                const totalCount = await exportService.getTotalCount();
                diagnostics.totalCount = totalCount;

                result = await exportService.exportAllBusinesses(columns);
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
                downloadUrl: `${downloadHost}/api/export/download?file=${encodeURIComponent(result.filename)}`,
                diagnostics
            });
        }

        // Generate download URL
        const downloadUrl = `${downloadHost}/api/export/download?file=${encodeURIComponent(result.filename)}`;

        return NextResponse.json({
            message: 'Export completed successfully',
            filename: result.filename,
            count: result.count,
            downloadUrl,
            diagnostics
        });
    } catch (error) {
        logger.error(`Error exporting data: ${error.message}`);
        
        // Handle empty results differently
        if (error.message.includes('No businesses found')) {
            return NextResponse.json({
                warning: error.message,
                count: 0
            }, { status: 200 }); // Still return 200 with warning
        }

        return NextResponse.json(
            { error: 'Failed to export data', details: error.message },
            { status: 500 }
        );
    }
}
