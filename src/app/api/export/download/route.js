import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import logger from '@/services/logger';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('file');

    if (!filename) {
        return NextResponse.json({ error: 'No file specified' }, { status: 400 });
    }

    // Make sure it's a safe filename
    if (filename.includes('..') || filename.includes('/')) {
        return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), 'exports', filename);

    logger.info(`File download requested: ${filename}`);

    // Check if the file exists
    try {
        const stats = fs.statSync(filePath);

        if (!stats.isFile()) {
            logger.error(`Requested file is not a file: ${filePath}`);
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        logger.info(`File download started: ${filename}, size: ${stats.size} bytes`);

        // FIXED: Use streaming for large files instead of loading into memory
        const fileStream = fs.createReadStream(filePath);

        // Create a streaming response
        const response = new NextResponse(fileStream);

        // Set file headers
        response.headers.set('Content-Disposition', `attachment; filename=${encodeURIComponent(filename)}`);
        response.headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        response.headers.set('Content-Length', stats.size.toString());

        // Add cache control headers to prevent caching of sensitive data
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');

        return response;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.error(`File not found: ${filePath}`);
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        logger.error(`Error accessing export file: ${error.message}`);
        return NextResponse.json({ error: 'Failed to access export file' }, { status: 500 });
    }
}
