import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

/**
 * API endpoint to test database operations for email storage
 */
export async function GET() {
    try {
        // Initialize database
        await db.init();

        // Test connection
        const connected = await db.testConnection();

        if (!connected) {
            return NextResponse.json({
                success: false,
                error: 'Database connection failed'
            }, { status: 500 });
        }

        // Check if business_listings table exists
        const tableResult = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'business_listings'
            )
        `);

        const tableExists = tableResult.exists;

        if (!tableExists) {
            return NextResponse.json({
                success: false,
                error: 'business_listings table does not exist'
            }, { status: 500 });
        }

        // Check if email column exists
        const columnResult = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'business_listings'
                AND column_name = 'email'
            )
        `);

        const emailColumnExists = columnResult.exists;

        if (!emailColumnExists) {
            return NextResponse.json({
                success: false,
                error: 'email column does not exist in business_listings table'
            }, { status: 500 });
        }

        // Test write operation by creating a test record
        const testName = 'TEST_RECORD_' + Date.now();
        const insertResult = await db.query(`
            INSERT INTO business_listings 
            (name, search_term, created_at, updated_at) 
            VALUES ($1, 'test_search', NOW(), NOW()) 
            RETURNING id
        `, [testName]);

        if (!insertResult || insertResult.rows.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'Failed to create test record'
            }, { status: 500 });
        }

        const testId = insertResult.rows[0].id;

        // Test update operation for email
        const testEmail = `test${Date.now()}@example.com`;
        const updateResult = await db.query(`
            UPDATE business_listings
            SET email = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, email
        `, [testEmail, testId]);

        const updateSuccess = updateResult && updateResult.rowCount > 0;

        // Delete test record
        await db.query(`DELETE FROM business_listings WHERE id = $1`, [testId]);

        return NextResponse.json({
            success: true,
            connected,
            tableExists,
            emailColumnExists,
            insertSuccess: true,
            updateSuccess,
            testId,
            testEmail
        });
    } catch (error) {
        logger.error(`Database test error: ${error.message}`);
        return NextResponse.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}

/**
 * API endpoint to test inserting an email for a specific business ID
 */
export async function POST(request) {
    try {
        const { businessId, email } = await request.json();

        if (!businessId || !email) {
            return NextResponse.json({
                success: false,
                error: 'businessId and email are required'
            }, { status: 400 });
        }

        // Initialize database
        await db.init();

        // First check if the business exists
        const checkResult = await db.getOne(`
            SELECT id, name FROM business_listings WHERE id = $1
        `, [businessId]);

        if (!checkResult) {
            return NextResponse.json({
                success: false,
                error: `No business found with ID ${businessId}`
            }, { status: 404 });
        }

        // Update the email
        const updateResult = await db.query(`
            UPDATE business_listings
            SET email = $1, 
                notes = CASE 
                    WHEN notes IS NULL OR notes = '' THEN 'Test email update'
                    ELSE notes || ' | Test email update' 
                END,
                updated_at = NOW()
            WHERE id = $2
            RETURNING id, name, email
        `, [email, businessId]);

        if (updateResult && updateResult.rowCount > 0) {
            return NextResponse.json({
                success: true,
                message: `Successfully updated email for business ID ${businessId}`,
                business: updateResult.rows[0]
            });
        } else {
            return NextResponse.json({
                success: false,
                error: `Failed to update email for business ID ${businessId}`,
                rowCount: updateResult?.rowCount || 0
            }, { status: 500 });
        }
    } catch (error) {
        logger.error(`Test email update error: ${error.message}`);
        return NextResponse.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}
