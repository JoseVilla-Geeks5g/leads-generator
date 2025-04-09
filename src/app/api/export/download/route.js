import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import logger from '@/services/logger';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const filename = searchParams.get('file');
        
        if (!filename) {
            return new NextResponse('File parameter is required', { status: 400 });
        }

        // Security check - prevent path traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return new NextResponse('Invalid filename', { status: 400 });
        }

        // Get the file path - make sure this is the correct directory
        const exportDirectory = path.resolve(process.cwd(), 'exports');
        const filePath = path.join(exportDirectory, filename);
        
        logger.info(`Attempting to download file: ${filePath}`);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            logger.error(`File not found: ${filePath}`);
            return new NextResponse('File not found', { status: 404 });
        }

        // Get file info
        const stats = fs.statSync(filePath);
        logger.info(`File exists, size: ${stats.size} bytes`);

        // Read the file
        const fileBuffer = fs.readFileSync(filePath);

        // Determine content type based on file extension
        let contentType = 'application/octet-stream';
        if (filename.endsWith('.xlsx')) {
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (filename.endsWith('.csv')) {
            contentType = 'text/csv';
        }

        // Fix: Create a direct file download response
        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': stats.size.toString()
            }
        });
    } catch (error) {
        logger.error(`Error downloading file: ${error.message}`);
        return new NextResponse(`Error downloading file: ${error.message}`, { status: 500 });
    }
}
