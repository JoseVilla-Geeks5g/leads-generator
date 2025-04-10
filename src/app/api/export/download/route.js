import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import logger from '@/services/logger';

/**
 * API route for downloading exported files
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const filename = searchParams.get('filename');
        
        if (!filename) {
            logger.error('Download request missing filename parameter');
            return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
        }
        
        // Sanitize the filename to prevent path traversal
        const sanitizedFilename = path.basename(filename);
        
        // Define the exports directory (must match where files are created)
        const exportDirectory = path.join(process.cwd(), 'exports');
        const filepath = path.join(exportDirectory, sanitizedFilename);
        
        logger.info(`Download request for file: ${filepath}`);
        
        // Check if file exists
        if (!fs.existsSync(filepath)) {
            logger.error(`File not found: ${filepath}`);
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
        
        // Read file as buffer
        const fileBuffer = fs.readFileSync(filepath);
        const stats = fs.statSync(filepath);
        
        // Determine content type based on extension
        let contentType = 'application/octet-stream';
        if (sanitizedFilename.endsWith('.xlsx')) {
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (sanitizedFilename.endsWith('.csv')) {
            contentType = 'text/csv';
        }
        
        logger.info(`Serving file: ${filepath}, size: ${stats.size}, type: ${contentType}`);
        
        // Create response headers for file download
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
        headers.set('Content-Length', String(stats.size));
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        headers.set('Pragma', 'no-cache');
        headers.set('Expires', '0');
        
        // Return the file as a stream
        return new Response(fileBuffer, {
            status: 200,
            headers: headers
        });
    } catch (error) {
        logger.error(`Download error: ${error.message}`);
        return NextResponse.json({ error: 'Download failed', details: error.message }, { status: 500 });
    }
}
