import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';
import os from 'os';

export async function GET() {
    try {
        const status = {
            server: {
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                os: {
                    platform: os.platform(),
                    release: os.release(),
                    hostname: os.hostname(),
                    cpus: os.cpus().length,
                    freeMemory: os.freemem(),
                    totalMemory: os.totalmem()
                },
                env: process.env.NODE_ENV || 'development'
            },
            database: {
                connected: false,
                initialized: false,
                error: null
            }
        };

        // Test database connection
        try {
            const connected = await db.testConnection();
            status.database.connected = connected;

            // Try to test the initialization
            try {
                await db.init();
                status.database.initialized = true;
            } catch (initError) {
                status.database.error = `Initialization error: ${initError.message}`;
                logger.error(`Database initialization error: ${initError.message}`);
            }
        } catch (dbError) {
            status.database.error = `Connection error: ${dbError.message}`;
            logger.error(`Database connection error: ${dbError.message}`);
        }

        return NextResponse.json(status);
    } catch (error) {
        logger.error(`Error getting system status: ${error.message}`);
        return NextResponse.json(
            {
                error: 'Failed to get system status',
                details: error.message,
                timestamp: new Date().toISOString()
            },
            { status: 500 }
        );
    }
}
