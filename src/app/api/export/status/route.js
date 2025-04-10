import { NextResponse } from 'next/server';
import exportService from '@/services/exportService';
import logger from '@/services/logger';

/**
 * Get status of exports
 * @route GET /api/export/status
 */
export async function GET(request) {
    try {
        // Parse query parameters
        const { searchParams } = new URL(request.url);
        const exportId = searchParams.get('id');
        
        // If specific export ID is requested
        if (exportId) {
            const status = exportService.getExportStatus(exportId);
            
            if (!status) {
                return NextResponse.json({ 
                    error: 'Export not found' 
                }, { status: 404 });
            }
            
            return NextResponse.json(status);
        }
        
        // Otherwise return all active exports
        const activeExports = exportService.getAllActiveExports();
        const metrics = exportService.getPerformanceMetrics();
        
        return NextResponse.json({
            activeExports,
            metrics,
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Error getting export status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get export status', details: error.message },
            { status: 500 }
        );
    }
}
