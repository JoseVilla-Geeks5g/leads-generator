import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

/**
 * API endpoint to check database status
 */
export async function GET() {
  try {
    // Initialize database connection
    await db.init();
    
    // Test connection
    const connected = await db.testConnection();
    
    if (!connected) {
      return NextResponse.json(
        { status: 'error', message: 'Database connection failed' },
        { status: 500 }
      );
    }
    
    // Get database stats
    const businessCount = await db.getCount('business_listings');
    const taskCount = await db.getCount('scraping_tasks');
    
    return NextResponse.json({
      status: 'connected',
      stats: {
        businesses: businessCount,
        tasks: taskCount
      }
    });
  } catch (error) {
    logger.error(`Database status check failed: ${error.message}`);
    return NextResponse.json(
      { status: 'error', message: error.message },
      { status: 500 }
    );
  }
}
