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

        // Generate a unique export ID for tracking progress
        const exportId = `export-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Log the data source parameter
        logger.info(`Export parameters: taskId=${taskId}, state=${state}, isRandom=${isRandom}, dataSource=${dataSource}, excludeNullPhone=${excludeNullPhone}`);

        // Properly log filter values with explicit types for debugging
        logger.info(`Export parameters received: 
            taskId=${taskId !== undefined ? taskId : 'undefined'}, 
            state=${state !== undefined ? state : 'undefined'}, 
            filter=${filter ? JSON.stringify(filter) : 'undefined'}, 
            forceUnfiltered=${forceUnfiltered !== undefined ? forceUnfiltered : 'undefined'},
            isRandomCategoryTask=${isRandom !== undefined ? isRandom : 'undefined'},
            dataSource=${dataSource}`);

        // Initialize database
        await db.init();

        // Create diagnostics object
        let diagnostics = {
            startTime: new Date().toISOString(),
            totalBusinessCount: await exportService.getTotalCount(),
            emailCount: await exportService.countBusinessesWithEmail(),
            requestParams: { taskId, state, filter, forceUnfiltered, isRandom }
        };

        // Clean filter to ensure no null values 
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
        // ALWAYS use the production URL for downloads in the API response
        const downloadHost = 'https://leads-generator-8en5.onrender.com';

        try {
            // For large exports, return immediately with the exportId and let client poll for progress
            const isLargeExport = true; // We'll handle all exports as potentially large
            
            if (isLargeExport) {
                // Start the export in the background
                setImmediate(async () => {
                    try {
                        let exportResult;
                        
                        // Handle data source selection - in the background
                        if (dataSource === 'random_category_leads') {
                            logger.info('Exporting from random_category_leads table');
                            
                            try {
                                // Force Node.js garbage collection if available
                                if (global.gc) {
                                    logger.info('Running garbage collection before export');
                                    global.gc();
                                }
                                
                                if (cleanFilter && Object.keys(cleanFilter).length > 0) {
                                    exportResult = await exportService.exportRandomCategoryLeads(cleanFilter, columns);
                                } else {
                                    // No filters - export all random category leads
                                    exportResult = await exportService.exportRandomCategoryLeads({}, columns);
                                }
                                
                                // Run garbage collection again after export
                                if (global.gc) {
                                    logger.info('Running garbage collection after export');
                                    global.gc();
                                }
                            } catch (memoryError) {
                                // Handle memory error
                                logger.error(`Memory limit reached during export: ${memoryError.message}`);
                                return;
                            }
                        } 
                        else if (dataSource === 'all') {
                            // similar pattern for other export types
                        }
                        // other export types
                        
                        // Now that we have the result, update the exportId status
                        if (exportResult) {
                            // Update the status with the file info for download
                            const status = exportService.getExportStatus(exportId);
                            exportService.activeExports.set(exportId, {
                                ...status,
                                progress: 100,
                                status: 'completed',
                                downloadUrl: `${downloadHost}/api/export/download?file=${encodeURIComponent(exportResult.filename)}`,
                                count: exportResult.count,
                                fileSize: exportResult.fileSize,
                                isMultiFile: exportResult.isMultiFile,
                                files: exportResult.files
                            });
                        }
                    } catch (error) {
                        logger.error(`Background export error: ${error.message}`);
                        // Update export status to show error
                        exportService.activeExports.set(exportId, {
                            progress: 100,
                            status: 'error',
                            error: error.message
                        });
                    }
                });
                
                // Return immediately with the exportId so client can check progress
                return NextResponse.json({
                    message: 'Export started. Check progress using the export status endpoint.',
                    exportId,
                    status: 'processing'
                });
            } else {
                // existing synchronous export code (use only for very small exports)
            }
        } catch (error) {
            // existing error handling
        }

        // existing response code (for small synchronous exports only)
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
