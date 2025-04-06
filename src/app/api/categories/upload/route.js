import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function POST(request) {
    try {
        // Initialize database if needed
        await db.init();

        // Parse form data (CSV file)
        const formData = await request.formData();
        const csvFile = formData.get('csvFile');

        if (!csvFile) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Validate file type - accept various CSV mime types
        const validTypes = [
            'text/csv',
            'application/csv',
            'application/vnd.ms-excel',
            'text/plain',
            'text/x-csv',
            'application/x-csv'
        ];

        if (!validTypes.includes(csvFile.type)) {
            return NextResponse.json(
                { error: `Invalid file type: ${csvFile.type}. Please upload a CSV file.` },
                { status: 400 }
            );
        }

        // Get file content as text
        const csvText = await csvFile.text();

        if (!csvText || csvText.trim() === '') {
            return NextResponse.json(
                { error: 'CSV file is empty' },
                { status: 400 }
            );
        }

        // Parse CSV content - handling multiple formats
        // Split by newlines first, then parse each line which could be comma or semicolon separated
        const lines = csvText.split(/[\r\n]+/).filter(line => line.trim() !== '');

        // Extract categories, handling different separators and quoting styles
        const categories = [];
        const seen = new Set(); // Track duplicates within the file itself

        for (const line of lines) {
            // Try comma-separated first, then semicolon if needed
            let items;
            if (line.includes(',')) {
                items = line.split(',');
            } else if (line.includes(';')) {
                items = line.split(';');
            } else {
                // If no separator, treat the whole line as one category
                items = [line];
            }

            // Process each item in the line
            for (let item of items) {
                // Clean up quotes and whitespace
                item = item.replace(/^["'](.*)["']$/, '$1').trim();

                // Skip empty items and deduplicate
                if (item && !seen.has(item.toLowerCase())) {
                    categories.push(item);
                    seen.add(item.toLowerCase());
                }
            }
        }

        if (categories.length === 0) {
            return NextResponse.json(
                { error: 'No valid categories found in the CSV file' },
                { status: 400 }
            );
        }

        // Insert categories into database with batch processing for efficiency
        const batchSize = 100;
        const result = { added: 0, duplicates: 0 };

        // Process in batches to avoid overwhelming the database
        for (let i = 0; i < categories.length; i += batchSize) {
            const batch = categories.slice(i, i + batchSize);

            // Use a transaction for better performance and reliability
            try {
                await db.query('BEGIN');

                for (const category of batch) {
                    // Try to insert, tracking if it was added or was a duplicate
                    const res = await db.query(`
                        INSERT INTO categories (name)
                        VALUES ($1)
                        ON CONFLICT (name) DO NOTHING
                        RETURNING name
                    `, [category]);

                    if (res.rowCount > 0) {
                        result.added++;
                    } else {
                        result.duplicates++;
                    }
                }

                await db.query('COMMIT');
            } catch (err) {
                await db.query('ROLLBACK');
                logger.error(`Error processing batch: ${err.message}`);
                throw err;
            }
        }

        logger.info(`CSV import complete: Added ${result.added} categories, ${result.duplicates} duplicates skipped`);

        return NextResponse.json({
            message: `Added ${result.added} categories. ${result.duplicates} were duplicates.`,
            added: result.added,
            duplicates: result.duplicates,
            total: categories.length
        });
    } catch (error) {
        logger.error(`Error uploading CSV file: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to process CSV file', details: error.message },
            { status: 500 }
        );
    }
}
