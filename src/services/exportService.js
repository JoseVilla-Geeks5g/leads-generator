import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import db from './database';
import logger from './logger';

class ExportService {
    constructor() {
        this.exportDirectory = typeof window === 'undefined'
            ? path.resolve(process.cwd(), 'exports')
            : null;

        // Create exports directory if on server
        if (this.exportDirectory && typeof window === 'undefined') {
            try {
                if (!fs.existsSync(this.exportDirectory)) {
                    fs.mkdirSync(this.exportDirectory, { recursive: true });
                }
            } catch (err) {
                console.error('Failed to create export directory:', err);
            }
        }
    }

    async exportTaskResults(taskId) {
        try {
            // Get task information
            const task = await db.getOne('SELECT * FROM scraping_tasks WHERE id = $1', [taskId]);

            if (!task) {
                throw new Error('Task not found');
            }

            // Get businesses for this task - no limit to get all
            // FIXED: Removed potential restrictions in query
            const businesses = await db.getMany(
                'SELECT * FROM business_listings WHERE task_id = $1 ORDER BY name',
                [taskId]
            );

            if (businesses.length === 0) {
                throw new Error('No businesses found for this task');
            }

            const filename = `${task.search_term.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            // Create Excel file
            await this.createExcelFile(businesses, filepath);

            return {
                filename,
                filepath,
                count: businesses.length
            };
        } catch (error) {
            logger.error(`Error exporting task results: ${error.message}`);
            throw error;
        }
    }

    async exportAllBusinesses() {
        try {
            // FIXED: Use direct query without intermediate view to avoid timeouts
            logger.info("Starting export of ALL businesses - this may take time for large datasets");

            // Instead of loading all at once, use chunking for massive datasets
            const totalCount = await this.getTotalCount();
            logger.info(`Total business count: ${totalCount}`);

            if (totalCount === 0) {
                throw new Error('No businesses found in the database');
            }

            const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const filename = `All_Businesses_${dateTime}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            // FIXED: Use a more efficient approach for large datasets
            const chunkSize = 1000; // Process 1000 records at a time
            const totalChunks = Math.ceil(totalCount / chunkSize);

            // Create workbook once upfront
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Business Leads');
            this.setupExcelWorksheet(worksheet);

            // Process chunks
            let processedCount = 0;

            for (let i = 0; i < totalChunks; i++) {
                const offset = i * chunkSize;
                logger.info(`Processing chunk ${i + 1}/${totalChunks} (offset: ${offset}, limit: ${chunkSize})`);

                // Get this chunk of businesses
                const businesses = await db.getMany(
                    'SELECT * FROM business_listings ORDER BY id LIMIT $1 OFFSET $2',
                    [chunkSize, offset]
                );

                // Add rows to worksheet
                this.addBusinessRowsToWorksheet(worksheet, businesses);
                processedCount += businesses.length;

                logger.info(`Added ${businesses.length} rows (total: ${processedCount}/${totalCount})`);

                // Allow GC to clean up
                if (global.gc) global.gc();
            }

            // Apply formatting and save once at the end
            this.finalizeExcelWorksheet(worksheet, processedCount);
            await workbook.xlsx.writeFile(filepath);

            logger.info(`Excel file with ${processedCount} records created at: ${filepath}`);

            return {
                filename,
                filepath,
                count: processedCount
            };
        } catch (error) {
            logger.error(`Error exporting all businesses: ${error.message}`);
            throw error;
        }
    }

    async exportBusinessesByState(state) {
        try {
            // Get businesses for the state - no limit
            // FIXED: More specific query to ensure we get all records for the state
            const businesses = await db.getMany(
                'SELECT * FROM business_listings WHERE UPPER(state) = UPPER($1)',
                [state]
            );

            if (businesses.length === 0) {
                throw new Error(`No businesses found for state: ${state}`);
            }

            const filename = `${state}_Businesses_${new Date().toISOString().split('T')[0]}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            await this.createExcelFile(businesses, filepath);

            return {
                filename,
                filepath,
                count: businesses.length
            };
        } catch (error) {
            logger.error(`Error exporting businesses for state: ${error.message}`);
            throw error;
        }
    }

    async exportFilteredBusinesses(filter = {}) {
        try {
            // FIXED: Clean up filter object and log it clearly
            const cleanFilter = {};
            Object.entries(filter).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    cleanFilter[key] = value;
                }
            });

            logger.info(`Building export query with clean filters: ${JSON.stringify(cleanFilter)}`);

            // Build query
            let query = 'SELECT * FROM business_listings WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            // Add each filter condition if specified
            if (cleanFilter.state) {
                query += ` AND state = $${paramIndex++}`;
                params.push(cleanFilter.state);
                logger.info(`Adding state filter: ${cleanFilter.state}`);
            }

            if (cleanFilter.city) {
                query += ` AND city = $${paramIndex++}`;
                params.push(cleanFilter.city);
                logger.info(`Adding city filter: ${cleanFilter.city}`);
            }

            if (cleanFilter.searchTerm) {
                query += ` AND (search_term ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
                params.push(`%${cleanFilter.searchTerm}%`);
                paramIndex++;
                logger.info(`Adding search term filter: ${cleanFilter.searchTerm}`);
            }

            // FIXED: More explicit handling of boolean values for hasEmail and hasWebsite
            const hasEmailFilter = typeof cleanFilter.hasEmail === 'string'
                ? cleanFilter.hasEmail === 'true'
                : cleanFilter.hasEmail;

            const hasWebsiteFilter = typeof cleanFilter.hasWebsite === 'string'
                ? cleanFilter.hasWebsite === 'true'
                : cleanFilter.hasWebsite;

            // Apply email filter if present
            if (hasEmailFilter === true) {
                query += ' AND email IS NOT NULL AND email != \'\'';
                logger.info('Adding filter: Has Email (true)');
            } else if (hasEmailFilter === false) {
                query += ' AND (email IS NULL OR email = \'\')';
                logger.info('Adding filter: No Email (false)');
            }

            // Apply website filter if present
            if (hasWebsiteFilter === true) {
                query += ' AND website IS NOT NULL AND website != \'\'';
                logger.info('Adding filter: Has Website (true)');
            } else if (hasWebsiteFilter === false) {
                query += ' AND (website IS NULL OR website = \'\')';
                logger.info('Adding filter: No Website (false)');
            }

            // Handle keywords filtering
            if (cleanFilter.keywords) {
                const keywordsArray = cleanFilter.keywords.split(',').map(k => k.trim()).filter(k => k);
                if (keywordsArray.length > 0) {
                    query += ' AND (';
                    const keywordConditions = keywordsArray.map(keyword => {
                        params.push(`%${keyword}%`);
                        return `name ILIKE $${paramIndex++} OR search_term ILIKE $${paramIndex - 1}`;
                    });
                    query += keywordConditions.join(' OR ') + ')';
                }
            }

            // Handle category inclusions/exclusions
            if (cleanFilter.includeCategories && cleanFilter.includeCategories.length > 0) {
                query += ' AND (';
                const conditions = cleanFilter.includeCategories.map((category, idx) => {
                    params.push(`%${category}%`);
                    return `search_term ILIKE $${paramIndex++}`;
                });
                query += conditions.join(' OR ') + ')';
            }

            if (cleanFilter.excludeCategories && cleanFilter.excludeCategories.length > 0) {
                cleanFilter.excludeCategories.forEach((category) => {
                    params.push(`%${category}%`);
                    query += ` AND search_term NOT ILIKE $${paramIndex++}`;
                });
            }

            if (cleanFilter.minRating) {
                query += ` AND rating >= $${paramIndex++}`;
                params.push(parseFloat(cleanFilter.minRating));
            }

            // FIXED: No LIMIT to get all records
            query += ' ORDER BY name';

            logger.info(`Final export query: ${query.substring(0, 200)}... with ${params.length} parameters`);

            // Execute the query with a timeout increase for large datasets
            console.time('Export query execution');
            const businesses = await db.getMany(query, params);
            console.timeEnd('Export query execution');

            // Perform count validation
            logger.info(`Query returned ${businesses.length} businesses`);

            // Check email data integrity
            const emailCount = businesses.filter(b => b.email && b.email.trim() !== '').length;
            logger.info(`Email validation: Found ${emailCount} records with valid emails out of ${businesses.length} total records`);

            // Log sample data for debugging
            if (businesses.length > 0) {
                const sample = businesses.slice(0, 2);
                logger.info(`Sample data: ${JSON.stringify(sample.map(b => ({
                    id: b.id,
                    name: b.name,
                    email: b.email || 'No email',
                    hasEmail: !!b.email,
                    website: b.website || 'No website',
                    hasWebsite: !!b.website
                })))}`);
            }

            // Check if any businesses were found
            if (businesses.length === 0) {
                // Create an empty file with headers instead of throwing error
                logger.info(`No businesses found matching filter criteria. Creating empty file with headers.`);

                const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
                const filename = `Empty_Export_${dateTime}.xlsx`;
                const filepath = path.join(this.exportDirectory || '.', filename);

                // Create Excel file with just headers
                await this.createEmptyExcelFile(filepath);

                return {
                    filename,
                    filepath,
                    count: 0,
                    isEmpty: true
                };
            }

            logger.info(`Found ${businesses.length} businesses for export, processing export file...`);

            const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const filename = `Filtered_Businesses_${dateTime}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            // FIXED: Enhanced Excel file creation with better email handling
            await this.createExcelFile(businesses, filepath);

            return {
                filename,
                filepath,
                count: businesses.length
            };
        } catch (error) {
            logger.error(`Error exporting filtered businesses: ${error.message}`);
            throw error;
        }
    }

    // FIXED: Setup worksheet separately for better reuse
    setupExcelWorksheet(worksheet) {
        // Define columns with headings and widths - ensure all needed columns are defined
        worksheet.columns = [
            { header: 'Business Name', key: 'name', width: 30 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Phone', key: 'phone', width: 20 },
            { header: 'Website', key: 'website', width: 30 },
            { header: 'Address', key: 'address', width: 30 },
            { header: 'City', key: 'city', width: 20 },
            { header: 'State', key: 'state', width: 10 },
            { header: 'Country', key: 'country', width: 15 },
            { header: 'Category', key: 'search_term', width: 20 },
            { header: 'Rating', key: 'rating', width: 10 },
            { header: 'Created', key: 'created_at', width: 20 }
        ];

        // Style the header row
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F46E5' } // Primary color
        };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    }

    // FIXED: Add rows in batches
    addBusinessRowsToWorksheet(worksheet, businesses) {
        let emailsAdded = 0;
        let emailsMissing = 0;

        for (const business of businesses) {
            try {
                // FIXED: More explicit handling of email field
                const email = business.email !== null && business.email !== undefined ? business.email : '';

                // Track email statistics for debugging
                if (email && email.trim() !== '') {
                    emailsAdded++;
                } else {
                    emailsMissing++;
                }

                // FIXED: Explicitly map all properties with proper defaults
                const row = worksheet.addRow({
                    name: business.name || '',
                    email: email, // FIXED: Direct use of the email field
                    phone: business.phone || '',
                    website: business.website || '',
                    address: business.address || '',
                    city: business.city || '',
                    state: business.state || '',
                    country: business.country || '',
                    search_term: business.search_term || '',
                    rating: business.rating || '',
                    created_at: business.created_at ? new Date(business.created_at).toLocaleString() : ''
                });

                // Add alternating row colors
                if (row.number % 2 === 0) {
                    row.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF9F9F9' }
                    };
                }
            } catch (err) {
                logger.error(`Error adding row: ${err.message}`);
            }
        }

        // Log email stats for this batch
        logger.info(`Batch stats - Added emails: ${emailsAdded}, Missing emails: ${emailsMissing}`);
    }

    // FIXED: Finalize the worksheet
    finalizeExcelWorksheet(worksheet, totalRows) {
        // Apply filter to all columns
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: worksheet.columns.length }
        };

        // Freeze the top row
        worksheet.views = [
            { state: 'frozen', ySplit: 1 }
        ];

        // Add borders to all cells
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });
    }

    // Create professional Excel file with formatting
    async createExcelFile(businesses, filepath) {
        try {
            if (typeof window !== 'undefined') {
                // In browser environment, we can't write files
                return filepath;
            }

            logger.info(`Starting Excel file creation with ${businesses.length} records at ${filepath}`);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Business Leads');

            // Setup worksheet columns and header style
            this.setupExcelWorksheet(worksheet);

            // FIXED: Track email statistics for all records
            let totalEmailCount = 0;

            // Pre-scan data to check email fields - helps diagnose issues
            for (const business of businesses) {
                if (business.email && business.email.trim() !== '') {
                    totalEmailCount++;
                }
            }

            logger.info(`Email statistics: ${totalEmailCount} out of ${businesses.length} records have emails (${((totalEmailCount / businesses.length) * 100).toFixed(1)}%)`);

            // Process data in chunks to prevent memory issues with large datasets
            const CHUNK_SIZE = 500; // Smaller chunks to prevent memory issues
            const totalChunks = Math.ceil(businesses.length / CHUNK_SIZE);

            logger.info(`Processing ${businesses.length} records in ${totalChunks} chunks of ${CHUNK_SIZE} records each`);

            let totalRowsAdded = 0;

            // Process in chunks with more frequent release of memory
            for (let i = 0; i < totalChunks; i++) {
                const startIdx = i * CHUNK_SIZE;
                const endIdx = Math.min((i + 1) * CHUNK_SIZE, businesses.length);
                const chunk = businesses.slice(startIdx, endIdx);

                logger.info(`Processing chunk ${i + 1}/${totalChunks}: records ${startIdx + 1} to ${endIdx} (${chunk.length} records)`);

                // Add this chunk of data to the worksheet
                this.addBusinessRowsToWorksheet(worksheet, chunk);
                totalRowsAdded += chunk.length;

                // Log progress
                if (i % 2 === 0 || i === totalChunks - 1) {
                    logger.info(`Progress: ${Math.round((totalRowsAdded / businesses.length) * 100)}% complete (${totalRowsAdded}/${businesses.length} records)`);
                }

                // Release memory after each chunk
                if (global.gc) global.gc();
            }

            // Finalize the worksheet with formatting
            this.finalizeExcelWorksheet(worksheet, totalRowsAdded);

            // Write file with error handling
            try {
                logger.info(`Writing Excel file to disk: ${filepath} with ${totalRowsAdded} records`);

                // Set workbook properties for better compatibility
                workbook.creator = 'Lead Generator';
                workbook.lastModifiedBy = 'Lead Generator';
                workbook.created = new Date();
                workbook.modified = new Date();

                // FIXED: Use buffered writing for better performance with large files
                await workbook.xlsx.writeFile(filepath, {
                    filename: filepath,
                    useStyles: true,
                    useSharedStrings: true
                });

                // Verify file was created and has content
                const stats = fs.statSync(filepath);
                const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                logger.info(`Excel file created successfully: ${filepath}, size: ${stats.size} bytes (${fileSizeMB} MB)`);

                return filepath;
            } catch (writeError) {
                logger.error(`Error writing Excel file to disk: ${writeError.message}`);
                throw writeError;
            }
        } catch (error) {
            logger.error(`Error creating Excel file: ${error.message}`);
            throw error;
        }
    }

    // New method to create an empty Excel file with just headers
    async createEmptyExcelFile(filepath) {
        if (typeof window !== 'undefined') {
            // In browser environment, we can't write files
            return filepath;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Business Leads');

        // Define columns with headings and widths
        worksheet.columns = [
            { header: 'Business Name', key: 'name', width: 30 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Phone', key: 'phone', width: 20 },
            { header: 'Website', key: 'website', width: 30 },
            { header: 'Address', key: 'address', width: 30 },
            { header: 'City', key: 'city', width: 20 },
            { header: 'State', key: 'state', width: 10 },
            { header: 'Country', key: 'country', width: 15 },
            { header: 'Category', key: 'search_term', width: 20 },
            { header: 'Rating', key: 'rating', width: 10 },
            { header: 'Created', key: 'created_at', width: 20 }
        ];

        // Style the header row
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F46E5' } // Primary color
        };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Add auto-filter
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: worksheet.columns.length }
        };

        // Add a note about no records found
        worksheet.addRow([
            'No records found matching the filter criteria',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            new Date().toLocaleString()
        ]);

        // Format the note row
        const noteRow = worksheet.getRow(2);
        noteRow.font = { italic: true, color: { argb: 'FF888888' } };
        noteRow.alignment = { horizontal: 'left' };

        // Write file
        await workbook.xlsx.writeFile(filepath);
        logger.info(`Empty Excel file created: ${filepath}`);

        return filepath;
    }

    // FIXED: More efficient unfiltered export - this is a separate method specifically for exporting ALL data
    async exportAllBusinessesUnfiltered() {
        try {
            logger.info("Starting optimized unfiltered export of ALL businesses");

            // Get total count for planning
            const totalCount = await this.getTotalCount();

            if (totalCount === 0) {
                throw new Error('No businesses found in the database');
            }

            logger.info(`Preparing to export ${totalCount} total business records`);

            const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const filename = `Complete_Dataset_${dateTime}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            // FIXED: Direct stream processing from database to Excel for large datasets
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Business Leads');
            this.setupExcelWorksheet(worksheet);

            // Use chunks to avoid memory issues
            const CHUNK_SIZE = 2000; // Larger chunks for faster processing when no filtering
            const totalChunks = Math.ceil(totalCount / CHUNK_SIZE);

            logger.info(`Processing ${totalCount} records in ${totalChunks} chunks of ${CHUNK_SIZE} records`);

            let processedCount = 0;
            let emailCount = 0;

            for (let i = 0; i < totalChunks; i++) {
                const offset = i * CHUNK_SIZE;
                logger.info(`Processing chunk ${i + 1}/${totalChunks} (offset: ${offset})`);

                // FIXED: More efficient query with explicit column selection
                const businesses = await db.getMany(
                    `SELECT id, name, email, phone, website, address, city, state, country, 
                    search_term, rating, created_at FROM business_listings 
                    ORDER BY id LIMIT $1 OFFSET $2`,
                    [CHUNK_SIZE, offset]
                );

                // Count emails in this batch
                const batchEmailCount = businesses.filter(b => b.email && b.email.trim() !== '').length;
                emailCount += batchEmailCount;

                // Add rows
                this.addBusinessRowsToWorksheet(worksheet, businesses);
                processedCount += businesses.length;

                logger.info(`Progress: ${Math.round((processedCount / totalCount) * 100)}% complete (${processedCount}/${totalCount}), Emails in batch: ${batchEmailCount}`);

                // Clear memory
                if (global.gc) global.gc();
            }

            // Finalize and save
            this.finalizeExcelWorksheet(worksheet, processedCount);
            await workbook.xlsx.writeFile(filepath);

            logger.info(`Export complete: ${processedCount} records processed, ${emailCount} with emails (${((emailCount / processedCount) * 100).toFixed(1)}%)`);

            return {
                filename,
                filepath,
                count: processedCount
            };
        } catch (error) {
            logger.error(`Error in unfiltered export: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get task by ID
     * @param {string} taskId - Task ID
     * @returns {Object|null} Task object or null if not found
     */
    async getTaskById(taskId) {
        try {
            const task = await db.getOne('SELECT * FROM scraping_tasks WHERE id = $1', [taskId]);
            return task;
        } catch (error) {
            logger.error(`Error getting task by ID: ${error.message}`);
            return null;
        }
    }

    /**
     * Get count by state
     * @param {string} state - State code
     * @returns {number} Number of businesses in state
     */
    async getCountByState(state) {
        try {
            const result = await db.getOne('SELECT COUNT(*) FROM business_listings WHERE state = $1', [state]);
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error getting count by state: ${error.message}`);
            return 0;
        }
    }

    /**
     * Get total count of businesses
     * @returns {number} Total number of businesses
     */
    async getTotalCount() {
        try {
            const result = await db.getOne('SELECT COUNT(*) FROM business_listings');
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error getting total count: ${error.message}`);
            return 0;
        }
    }

    /**
     * Get filtered count
     * @param {Object} filter - Filter criteria
     * @returns {number} Number of filtered businesses
     */
    async getFilteredCount(filter = {}) {
        try {
            // Build query based on filters - similar to exportFilteredBusinesses but for COUNT
            let query = 'SELECT COUNT(*) FROM business_listings WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            if (filter.state) {
                query += ` AND state = $${paramIndex++}`;
                params.push(filter.state);
            }

            if (filter.city) {
                query += ` AND city = $${paramIndex++}`;
                params.push(filter.city);
            }

            if (filter.searchTerm) {
                query += ` AND (search_term ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
                params.push(`%${filter.searchTerm}%`);
                paramIndex++;
            }

            // FIXED: Better handling of boolean/string types for hasEmail and hasWebsite
            if (filter.hasEmail === true || filter.hasEmail === 'true') {
                query += ' AND email IS NOT NULL AND email != \'\'';
            } else if (filter.hasEmail === false || filter.hasEmail === 'false') {
                query += ' AND (email IS NULL OR email = \'\')';
            }

            if (filter.hasWebsite === true || filter.hasWebsite === 'true') {
                query += ' AND website IS NOT NULL AND website != \'\'';
            } else if (filter.hasWebsite === false || filter.hasWebsite === 'false') {
                query += ' AND (website IS NULL OR website = \'\')';
            }

            logger.info(`Executing filtered count query: ${query} with ${params.length} parameters`);

            // Execute query 
            const result = await db.getOne(query, params);
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error getting filtered count: ${error.message}`);
            return 0;
        }
    }

    /**
     * Count businesses with email
     * @returns {Promise<number>} Count of businesses with email
     */
    async countBusinessesWithEmail() {
        try {
            const result = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error counting businesses with email: ${error.message}`);
            return 0;
        }
    }
}

// Create a singleton instance
const exportService = new ExportService();

// Export the service
export default exportService;
