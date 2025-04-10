import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exportService } from '@/services';
import logger from '@/services/logger';

// Use promisify to convert fs functions to promise-based
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

/**
 * API route for downloading exported files
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const filename = searchParams.get('filename');
        
        if (!filename) {
            return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
        }
        
        // Ensure the filename is sanitized to prevent path traversal
        const sanitizedFilename = path.basename(filename);
        
        // Get the export directory and construct the full filepath
        const exportDirectory = exportService.exportDirectory;
        const filepath = path.join(exportDirectory || process.cwd(), 'exports', sanitizedFilename);
        
        logger.info(`Download request for file: ${filepath}`);
        
        try {
            // Check if file exists and get its size
            const stats = await stat(filepath);
            
            if (!stats.isFile()) {
                logger.error(`Requested path is not a file: ${filepath}`);
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }
            
            // Read the file into memory
            const fileBuffer = await readFile(filepath);
            
            // Determine content type based on file extension
            let contentType = 'application/octet-stream'; // Default binary
            
            if (sanitizedFilename.endsWith('.xlsx')) {
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            } else if (sanitizedFilename.endsWith('.csv')) {
                contentType = 'text/csv';
            }
            
            logger.info(`Serving file: ${filepath}, size: ${stats.size}, type: ${contentType}`);
            
            // Create response with proper headers for file download
            const response = new NextResponse(fileBuffer, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
                    'Content-Length': String(stats.size),
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });
            
            return response;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.error(`File not found: ${filepath}`);
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }
            
            logger.error(`Error reading file: ${error.message}`);
            throw error;
        }
    } catch (error) {
        logger.error(`Download error: ${error.message}`);
        return NextResponse.json({ error: 'Download failed' }, { status: 500 });
    }
}
