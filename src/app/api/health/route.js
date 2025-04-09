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

    // Include system information
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Verify exports directory
    let exportsDir = false;
    try {
      const fs = require('fs');
      const path = require('path');
      const exportPath = path.resolve(process.cwd(), 'exports');
      if (!fs.existsSync(exportPath)) {
        fs.mkdirSync(exportPath, { recursive: true });
      }
      exportsDir = true;
    } catch (err) {
      logger.error(`Health check exports directory error: ${err.message}`);
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      database: dbStatus,
      exportsDirectory: exportsDir,
      system: {
        memoryUsage: {
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
        },
        uptime: `${Math.round(uptime / 60)} minutes`
      }
    });
  } catch (error) {
    logger.error(`Health check failed: ${error.message}`);
    return NextResponse.json(
      { status: 'error', error: error.message },
      { status: 500 }
    );
  }
}
