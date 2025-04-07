import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import exportService from '@/services/exportService';
import db from '@/services/database';
import logger from '@/services/logger';
import fs from 'fs';
import path from 'path';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');

        await db.init();

        switch (type) {
            case 'batch':
                // Get batch operation status
                const batchStatus = scraperService.getBatchStatus();
                return NextResponse.json(batchStatus);

            case 'email':
                // Get email finder status
                const emailStatus = scraperService.getEmailFinderStatus();
                return NextResponse.json(emailStatus);

            case 'storage':
                // Get storage statistics
                const exportDir = path.join(process.cwd(), 'exports');
                let files = [];
                let totalSize = 0;

                try {
                    if (fs.existsSync(exportDir)) {
                        const fileList = fs.readdirSync(exportDir);

                        for (const file of fileList) {
                            if (file.endsWith('.xlsx') || file.endsWith('.csv')) {
                                const filePath = path.join(exportDir, file);
                                const stats = fs.statSync(filePath);

                                if (stats.isFile()) {
                                    totalSize += stats.size;
                                    files.push({
                                        name: file,
                                        size: stats.size,
                                        created: stats.birthtime,
                                        sizeFormatted: formatFileSize(stats.size)
                                    });
                                }
                            }
                        }
                    }
                } catch (err) {
                    logger.error('Error reading export directory:', err);
                }

                return NextResponse.json({
                    files: files.sort((a, b) => b.created - a.created).slice(0, 10),
                    totalFiles: files.length,
                    totalSize,
                    totalSizeFormatted: formatFileSize(totalSize)
                });

            case 'system':
                // Get system status
                const dbStatus = await db.testConnection();
                const dbStats = await db.getOne(`
          SELECT
            pg_size_pretty(pg_database_size(current_database())) as db_size,
            (SELECT COUNT(*) FROM pg_stat_activity) as connections
        `);

                return NextResponse.json({
                    database: {
                        connected: dbStatus,
                        size: dbStats?.db_size || 'Unknown',
                        connections: dbStats?.connections || 0
                    },
                    exportService: {
                        ready: true,
                        directory: path.join(process.cwd(), 'exports')
                    },
                    scraperService: {
                        initialized: scraperService.initialized,
                        taskCount: scraperService.tasks.size,
                        runningTasks: scraperService.currentRunningTasks
                    },
                    timestamp: new Date().toISOString()
                });

            default:
                // Get overall system status summary
                return NextResponse.json({
                    database: await db.testConnection(),
                    emailFinder: scraperService.getEmailFinderStatus(),
                    batchProcess: scraperService.getBatchStatus(),
                    lastExport: await getLastExport(),
                    timestamp: new Date().toISOString()
                });
        }
    } catch (error) {
        logger.error(`Error getting status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get status', details: error.message },
            { status: 500 }
        );
    }
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get information about the last export
async function getLastExport() {
    try {
        const exportDir = path.join(process.cwd(), 'exports');

        if (!fs.existsSync(exportDir)) {
            return null;
        }

        const files = fs.readdirSync(exportDir)
            .filter(file => file.endsWith('.xlsx'))
            .map(file => {
                const stats = fs.statSync(path.join(exportDir, file));
                return {
                    filename: file,
                    created: stats.birthtime,
                    size: stats.size
                };
            })
            .sort((a, b) => b.created - a.created);

        if (files.length === 0) {
            return null;
        }

        return {
            filename: files[0].filename,
            timestamp: files[0].created,
            size: formatFileSize(files[0].size)
        };
    } catch (error) {
        logger.error(`Error getting last export info: ${error.message}`);
        return null;
    }
}
