import { NextResponse } from 'next/server';
import { exportService } from '@/services';
import logger from '@/services/logger';
import path from 'path';
import fs from 'fs';

/**
 * API route for exporting data
 */
export async function POST(request) {
  try {
    // Ensure export directory exists
    const exportDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    
    // Parse request body to get filters
    const body = await request.json();
    const { filters = {}, format = 'excel' } = body;
    
    logger.info(`Starting export with format: ${format}, filters: ${JSON.stringify(filters)}`);
    
    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    
    // Create filename based on export type and timestamp
    const filename = filters.category 
      ? `${filters.category}_${timestamp}.${format === 'excel' ? 'xlsx' : 'csv'}`
      : `Leads_Export_${timestamp}.${format === 'excel' ? 'xlsx' : 'csv'}`;
    
    // Full path for saving the file
    const filepath = path.join(exportDir, filename);
    
    // Execute export with filters
    const result = await exportService.exportData(filters, format, filepath);
    
    logger.info(`Export completed: ${filename}, rows: ${result?.count || 0}`);
    
    // Return success with filename for download
    return NextResponse.json({ 
      success: true, 
      message: 'Export completed successfully',
      filename,
      count: result?.count || 0
    });
    
  } catch (error) {
    logger.error(`Export error: ${error.message}`);
    
    return NextResponse.json({ 
      success: false, 
      message: `Export failed: ${error.message}`
    }, { status: 500 });
  }
}
