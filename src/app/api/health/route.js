import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function GET() {
  try {
    // Check database connection
    let dbStatus = false;
    try {
      await db.init();
      dbStatus = await db.testConnection();
    } catch (err) {
      logger.error(`Health check database error: ${err.message}`);
    }

    return NextResponse.json({
      status: 'healthy',
      database: dbStatus,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    logger.error(`Health check failed: ${error.message}`);
    return NextResponse.json(
      { status: 'error', error: error.message },
      { status: 500 }
    );
  }
}
