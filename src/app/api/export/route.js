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
    
    // Parse request body
    const body = await request.json();
    const { filter, columns, forceUnfiltered, dataSource, excludeNullPhone } = body;
    
    logger.info(`Starting export with dataSource: ${dataSource}, forceUnfiltered: ${forceUnfiltered}, filters: ${JSON.stringify(filter || {})}`);
    
    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    
    // Create unique export ID
    const exportId = `export-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    // Process based on data source type
    let result;
    
    try {
      // FIXED: Don't completely ignore filters when forceUnfiltered is true
      // Instead, apply filters if they exist (this is the key change)
      if (dataSource === 'all') {
        // Handle combined sources export
        logger.info('Exporting combined data from all sources');
        result = await exportService.exportCombinedSources(filter, columns);
      } else if (dataSource === 'random_category_leads') {
        // Handle random category leads export with all filter options
        logger.info('Exporting filtered data from random_category_leads table');
        const filterWithOptions = { ...filter, excludeNullPhone };

        // Use either filtered or unfiltered export based on whether filters exist
        if (forceUnfiltered && !hasFilters(filter)) {
          logger.info('No filters detected - using unfiltered export for random_category_leads');
          result = await exportService.exportAllRandomCategoryLeadsUnfiltered();
        } else {
          // Even when forceUnfiltered is true, still apply any filters that were set
          logger.info(`Applying filters to random_category_leads export: ${JSON.stringify(filterWithOptions)}`);
          result = await exportService.exportRandomCategoryLeads(filterWithOptions, columns);
        }
      } else {
        // Default to filtered business listings export
        logger.info('Exporting filtered data from business_listings table');
        
        // Use either filtered or unfiltered export based on whether filters exist
        if (forceUnfiltered && !hasFilters(filter)) {
          logger.info('No filters detected - using unfiltered export for business_listings');
          result = await exportService.exportAllBusinessesUnfiltered();
        } else {
          // Even when forceUnfiltered is true, still apply any filters that were set
          logger.info(`Applying filters to business_listings export: ${JSON.stringify(filter)}`);
          result = await exportService.exportFilteredBusinesses(filter, columns);
        }
      }
      
      // Verify file was created
      if (result.filepath && !fs.existsSync(result.filepath)) {
        throw new Error('Export file was not created');
      }
      
      // Get the base URL for download
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://leads-generator-8en5.onrender.com';
      const downloadUrl = `${baseUrl}/api/export/download?filename=${encodeURIComponent(result.filename)}`;
      
      // Return success response
      return NextResponse.json({ 
        success: true, 
        message: 'Export completed successfully',
        filename: result.filename,
        downloadUrl,
        filesize: result.filepath ? fs.statSync(result.filepath).size : 0,
        count: result.count || 0,
        exportId,
        status: 'completed'
      });
      
    } catch (error) {
      logger.error(`Export processing error: ${error.message}`);
      
      return NextResponse.json({ 
        success: false, 
        error: `Export processing failed: ${error.message}`,
        status: 'error'
      }, { status: 500 });
    }
    
  } catch (error) {
    logger.error(`Export request error: ${error.message}`);
    
    return NextResponse.json({ 
      success: false, 
      error: `Export failed: ${error.message}`,
      status: 'error'
    }, { status: 500 });
  }
}

// Helper function to check if there are any actual filters set
function hasFilters(filter) {
  if (!filter) return false;
  
  // Look for any non-null filter values that would actually filter the data
  return Object.entries(filter).some(([key, value]) => {
    return value !== null && value !== undefined && value !== '';
  });
}
