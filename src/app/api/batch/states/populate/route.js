import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

/**
 * API endpoint to populate the city_data table
 */
export async function GET() {
  try {
    // Initialize database if needed
    await db.init();
    
    // Check if table exists and populate it
    await db.ensureCityDataTable();
    
    // Force population of city data
    const count = await db.populateCityData();
    
    return NextResponse.json({
      success: true,
      message: `Successfully populated city_data table with ${count} cities`,
      count
    });
  } catch (error) {
    logger.error(`Error populating city data: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to populate city data', details: error.message },
      { status: 500 }
    );
  }
}
