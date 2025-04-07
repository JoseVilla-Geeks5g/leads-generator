import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function GET() {
    try {
        // Initialize the database first
        await db.init();

        // Test basic connection
        const connected = await db.testConnection();

        // Additional checks
        let tableChecks = {};
        let columnChecks = {};
        let testWrite = false;

        if (connected) {
            // Check tables
            const tables = ['business_listings', 'businesses', 'scraping_tasks'];
            for (const table of tables) {
                const result = await db.getOne(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )`, [table]);
                tableChecks[table] = result.exists;
            }

            // Check critical columns
            const columns = [
                { table: 'business_listings', column: 'email' },
                { table: 'business_listings', column: 'id' },
                { table: 'business_listings', column: 'website' }
            ];

            for (const { table, column } of columns) {
                const result = await db.getOne(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_name = $1
            AND column_name = $2
          )`, [table, column]);
                columnChecks[`${table}.${column}`] = result.exists;
            }

            // Test write capability
            try {
                // Insert test record
                const insertResult = await db.query(`
          INSERT INTO business_listings (name, search_term, created_at, updated_at) 
          VALUES ('__DB_TEST__', '__DB_TEST__', NOW(), NOW()) 
          RETURNING id`);

                if (insertResult.rows.length > 0) {
                    const testId = insertResult.rows[0].id;

                    // Clean up test record
                    await db.query(`DELETE FROM business_listings WHERE id = $1`, [testId]);
                    testWrite = true;
                }
            } catch (error) {
                logger.error(`Database write test failed: ${error.message}`);
                testWrite = false;
            }
        }

        return NextResponse.json({
            connected,
            tables: tableChecks,
            columns: columnChecks,
            writeTest: testWrite,
            time: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Database status check error: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to check database status', details: error.message },
            { status: 500 }
        );
    }
}
