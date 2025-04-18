import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import db from './database';
import logger from './logger';
import { Worker } from 'worker_threads';
import os from 'os';

//! Performance configuration - tuned for 0.5 CPU environment
const PERFORMANCE_CONFIG = {
    CHUNK_SIZE: 5000,                 // Number of records to process per chunk
    MAX_PARALLEL_CHUNKS: 2,           // Maximum parallel chunks for 0.5 CPU
    BUFFER_SIZE: 5000,                // Maximum records to keep in memory at once
    WORKER_THREADS: Math.max(1, Math.min(2, Math.floor(os.cpus().length / 2))),  // Use up to 2 worker threads
    EXCEL_OPTIMIZATION: {
        useStyles: true,
        useSharedStrings: false,      // Disable for memory efficiency
        compression: true             // Enable compression for smaller file size
    },
    PROGRESS_INTERVAL: 5              // How often to log progress (percentage)
};

//? Override some parameters for Render.com environment
if (process.env.RENDER) {
    PERFORMANCE_CONFIG.MAX_PARALLEL_CHUNKS = 2;  // Limited concurrency on Render
    PERFORMANCE_CONFIG.WORKER_THREADS = 1;       // Limited to one worker on free tier
}

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
        
        this.activeExports = new Map();
        this.formatters = this.initializeFormatters();

        //? Track export metrics for performance tuning
        this.metrics = {
            lastExportDuration: 0,
            lastExportRecordCount: 0,
            averageRecordsPerSecond: 0,
            completedExports: 0
        };
    }

    //? Initialize data formatters for export
    initializeFormatters() {
        return {
            phoneNumber: (phone) => {
                if (!phone) return '';
                if (phone === '[null]') return '';
                
                //? Remove all non-numeric characters
                const digitsOnly = phone.replace(/\D/g, '');
                
                //? Format based on length
                if (digitsOnly.length === 10) {
                    return `(${digitsOnly.substring(0, 3)}) ${digitsOnly.substring(3, 6)}-${digitsOnly.substring(6)}`;
                } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
                    return `(${digitsOnly.substring(1, 4)}) ${digitsOnly.substring(4, 7)}-${digitsOnly.substring(7)}`;
                }
                
                //? If we can't format it properly, return the original
                return phone;
            },
            
            columnHeader: (header) => {
                if (!header) return '';
                
                //? Handle snake_case headers (convert to Title Case)
                if (header.includes('_')) {
                    return header
                        .split('_')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                }
                
                //? Handle camelCase headers
                return header
                    //? Insert a space before all caps
                    .replace(/([A-Z])/g, ' $1')
                    //? Uppercase the first character
                    .replace(/^./, str => str.toUpperCase())
                    .trim();
            }
        };
    }

    /**
     * * Format a phone number for display
     * @param {string} phone - Raw phone number
     * @returns {string} Formatted phone number
     */
    formatPhoneNumber(phone) {
        return this.formatters.phoneNumber(phone);
    }
    
    /**
     * * Format column header for display in exported files
     * @param {string} header - Raw column name
     * @returns {string} Formatted column header
     */
    formatColumnHeader(header) {
        return this.formatters.columnHeader(header);
    }

    /**
     * * Get the count of total businesses
     * @returns {Promise<number>} Total count
     */
    async getTotalCount() {
        try {
            const result = await db.getOne('SELECT COUNT(*) as count FROM business_listings');
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error getting total count: ${error.message}`);
            return 0;
        }
    }

    //? Get count of business listings that have an email
    async countBusinessesWithEmail() {
        try {
            const result = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE email IS NOT NULL AND email != \'\'');
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error counting businesses with email: ${error.message}`);
            return 0;
        }
    }

    //? Get count of businesses matching a filter
    async getFilteredCount(filter) {
        try {
            let query = 'SELECT COUNT(*) FROM business_listings WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            //? Apply filters
            if (filter.state) {
                query += ` AND state = $${paramIndex++}`;
                params.push(filter.state);
            }
            
            if (filter.city) {
                query += ` AND city ILIKE $${paramIndex++}`;
                params.push(`%${filter.city}%`);
            }
            
            //? ... other filter conditions

            logger.info(`Executing filtered count query: ${query} with ${params.length} parameters`);
            const result = await db.getOne(query, params);
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error getting filtered count: ${error.message}`);
            return 0;
        }
    }

    //? Get count of businesses in a given state
    async getCountByState(state) {
        try {
            const result = await db.getOne('SELECT COUNT(*) as count FROM business_listings WHERE state = $1', [state]);
            return parseInt(result?.count || '0');
        } catch (error) {
            logger.error(`Error getting count by state: ${error.message}`);
            return 0;
        }
    }

    //? Get task by ID
    async getTaskById(taskId) {
        try {
            return await db.getOne('SELECT * FROM scraping_tasks WHERE id = $1', [taskId]);
        } catch (error) {
            logger.error(`Error getting task by ID: ${error.message}`);
            return null;
        }
    }

    /**
     * * Export filtered businesses from random_category_leads table with optimized performance
     * @param {Object} filter - Filter criteria
     * @param {Array} columns - Selected columns
     * @returns {Object} Export result
     */
    async exportRandomCategoryLeads(filter = {}, columns = null) {
        const exportId = `random-${Date.now()}`;
        this.activeExports.set(exportId, { progress: 0, status: 'starting' });
        const startTime = Date.now();
        
        try {
            //? Create filename and filepath first
            const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            // Always use .xlsx extension for Excel format
            const filename = `Random_Category_Leads_${dateTime}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            //! Build optimized query with indexes
            let baseQuery = `
                SELECT 
                    id, name, email, phone, website, domain, address, city, 
                    state, postal_code, country, category, rating, 
                    search_term, search_date, task_id, business_type, 
                    owner_name, verified, contacted, notes, 
                    created_at, updated_at
                FROM random_category_leads 
                WHERE 1=1`;
                
            const baseParams = [];
            let paramIndex = 1;

            //? Add filter conditions with parameter binding
            if (filter.state) {
                baseQuery += ` AND state = $${paramIndex++}`;
                baseParams.push(filter.state);
                logger.info(`Adding state filter for random category leads: ${filter.state}`);
            }

            // IMPROVED: Better city filter for random_category_leads using ILIKE with wildcards
            if (filter.city) {
                baseQuery += ` AND city ILIKE $${paramIndex++}`;
                baseParams.push(`%${filter.city}%`); // Using wildcards for better matching
                logger.info(`Adding city filter for random category leads: "${filter.city}" (using partial match)`);
            }
            
            // ADDED: Improved category filtering - In random_category_leads, the field is called 'category'
            if (filter.category) {
                baseQuery += ` AND category ILIKE $${paramIndex++}`;
                baseParams.push(`%${filter.category}%`);
                logger.info(`Adding category filter for random category leads: "${filter.category}"`);
            }
            
            if (filter.searchTerm) {
                baseQuery += ` AND category = $${paramIndex++}`;
                baseParams.push(filter.searchTerm);
                logger.info(`Adding category filter for random category leads: ${filter.searchTerm}`);
            }

            // Email filter - explicitly log what's happening for debugging
            if (filter.hasEmail === true) {
                baseQuery += ` AND email IS NOT NULL AND email != ''`;
                logger.info('Adding filter for random category leads: Has Email (true)');
            } else if (filter.hasEmail === false) {
                baseQuery += ` AND (email IS NULL OR email = '')`;
                logger.info('Adding filter for random category leads: No Email (false)');
            }

            // Website filter with clearer logging
            if (filter.hasWebsite === true) {
                baseQuery += ` AND website IS NOT NULL AND website != ''`;
                logger.info('Adding filter for random category leads: Has Website (true)');
            } else if (filter.hasWebsite === false) {
                baseQuery += ` AND (website IS NULL OR website = '')`;
                logger.info('Adding filter for random category leads: No Website (false)');
            }

            // Phone filter with better handling of null/empty values
            if (filter.hasPhone === true) {
                baseQuery += ` AND phone IS NOT NULL AND phone != '' AND phone != '[null]'`;
                logger.info('Adding filter for random category leads: Has Phone (true)');
            } else if (filter.hasPhone === false) {
                baseQuery += ` AND (phone IS NULL OR phone = '' OR phone = '[null]')`;
                logger.info('Adding filter for random category leads: No Phone (false)');
            } else if (filter.excludeNullPhone === true) {
                baseQuery += ` AND phone != '[null]'`;
                logger.info('Adding filter for random category leads: Exclude [null] Phone Values');
            }

            // Address filter with proper handling of empty strings
            if (filter.hasAddress === true) {
                baseQuery += ` AND address IS NOT NULL AND address != ''`;
                logger.info('Adding filter for random category leads: Has Address (true)');
            } else if (filter.hasAddress === false) {
                baseQuery += ` AND (address IS NULL OR address = '')`;
                logger.info('Adding filter for random category leads: No Address (false)');
            }

            // FIXED: Add support for more filtering options
            
            // Category filters
            if (filter.includeCategories && filter.includeCategories.length > 0) {
                const placeholders = filter.includeCategories.map((_, idx) => `$${paramIndex + idx}`).join(',');
                baseQuery += ` AND category IN (${placeholders})`;
                baseParams.push(...filter.includeCategories);
                paramIndex += filter.includeCategories.length;
                logger.info(`Adding include categories filter for random category leads: ${filter.includeCategories.join(', ')}`);
            }

            if (filter.excludeCategories && filter.excludeCategories.length > 0) {
                const placeholders = filter.excludeCategories.map((_, idx) => `$${paramIndex + idx}`).join(',');
                baseQuery += ` AND category NOT IN (${placeholders})`;
                baseParams.push(...filter.excludeCategories);
                paramIndex += filter.excludeCategories.length;
                logger.info(`Adding exclude categories filter for random category leads: ${filter.excludeCategories.join(', ')}`);
            }

            // Rating filter
            if (filter.minRating) {
                baseQuery += ` AND rating >= $${paramIndex++}`;
                baseParams.push(parseFloat(filter.minRating));
                logger.info(`Adding min rating filter for random category leads: ${filter.minRating}`);
            }

            // Keywords filter
            if (filter.keywords) {
                const keywords = filter.keywords.split(',').map(k => k.trim()).filter(Boolean);
                if (keywords.length > 0) {
                    baseQuery += ' AND (';
                    const conditions = [];
                    for (const keyword of keywords) {
                        conditions.push(`(name ILIKE $${paramIndex} OR category ILIKE $${paramIndex})`);
                        baseParams.push(`%${keyword}%`);
                        paramIndex++;
                    }
                    baseQuery += conditions.join(' OR ') + ')';
                    logger.info(`Adding keywords filter for random category leads: ${keywords.join(', ')}`);
                }
            }

            // CRITICAL: Always add ORDER BY clause before LIMIT/OFFSET
            baseQuery += ' ORDER BY name';

            // Log the query for debugging
            logger.info(`Export query for random category leads: ${baseQuery.replace(/\s+/g, ' ').substring(0, 200)}... with ${baseParams.length} parameters`);

            // Get total count using the same WHERE conditions
            const countQueryBase = `SELECT COUNT(*) FROM random_category_leads WHERE 1=1`;
            const whereClause = baseQuery.split('WHERE 1=1')[1].split('ORDER BY')[0];
            const countQuery = countQueryBase + whereClause;

            const countResult = await db.getOne(countQuery, baseParams);
            const totalCount = parseInt(countResult?.count || '0');
            
            logger.info(`Count query for random category leads returned ${totalCount} records`);
            this.activeExports.set(exportId, { progress: 1, status: 'counting', totalCount });

            if (totalCount === 0) {
                logger.warn(`No random category leads found matching filter criteria`);
                return {
                    filename: 'No_Results.xlsx',
                    filepath: '',
                    count: 0,
                    isEmpty: true
                };
            }

            // Continue with the export process using the current implementation
            // ... existing export code continues ...

            return await this.exportRandomCategoryLeadsToExcelFile(
                baseQuery, 
                baseParams, 
                totalCount, 
                columns, 
                filepath,
                filename,
                exportId
            );
        } catch (error) {
            logger.error(`Error exporting random category leads: ${error.message}`);
            this.activeExports.set(exportId, { progress: 100, status: 'error', error: error.message });
            throw error;
        }
    }

    /**
     * * Highly optimized function to export data to Excel file with minimal memory usage
     */
    async exportRandomCategoryLeadsToExcelFile(query, params, totalCount, columns, filepath, filename, exportId, partProgress = null) {
        //? Set up headers to use
        const defaultColumns = [
            'name', 'email', 'phone', 'website', 'address', 'city', 
            'state', 'postal_code', 'category', 'rating'
        ];

        const headersToUse = columns && columns.length > 0 ? columns : defaultColumns;
        
        //? Create workbook with optimized options for memory efficiency
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Leads Generator';
        workbook.created = new Date();
        
        //? Use options to reduce memory usage
        workbook.properties.date1904 = false;
        
        const worksheet = workbook.addWorksheet('Leads', {
            properties: {
                defaultColWidth: 15,
                filterMode: false,
                showGridLines: true
            }
        });
        
        //? IMPROVED: Add headers with better formatting
        worksheet.columns = headersToUse.map(header => ({
            header: this.formatColumnHeader(header),
            key: header,
            width: this.getColumnWidth(header)
        }));

        //? Apply header styling - make it more distinct
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FF000000' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' }
        };
        headerRow.alignment = { horizontal: 'center' };

        //! CRITICAL OPTIMIZATION: Use smaller, more frequent chunks
        const CHUNK_SIZE = PERFORMANCE_CONFIG.CHUNK_SIZE;
        const totalChunks = Math.ceil(totalCount / CHUNK_SIZE);
        
        logger.info(`Processing ${totalCount} records in ${totalChunks} chunks`);
        
        //? Update progress tracking
        if (exportId) {
            const progressInfo = {
                totalCount,
                totalChunks,
                chunkSize: CHUNK_SIZE,
                status: 'processing-chunks'
            };
            if (partProgress) {
                progressInfo.partProgress = partProgress;
            }
            this.activeExports.set(exportId, { progress: 10, ...progressInfo });
        }
        
        let processedCount = 0;
        let lastLoggedPercentage = -1;
        let startProcessingTime = Date.now();

        //=================================
        // Process data in chunks using pagination
        //=================================
        for (let offset = 0; offset < totalCount; offset += CHUNK_SIZE) {
            //? Force garbage collection before processing large chunks
            if (global.gc && offset % (CHUNK_SIZE * 5) === 0) {
                global.gc();
            }
            
            //? Calculate current progress percentage
            const currentChunk = Math.floor(offset / CHUNK_SIZE);
            let percentage = Math.floor((offset / totalCount) * 100);
            
            //? Update progress tracking
            if (exportId) {
                const progress = 10 + ((offset / totalCount) * 85);
                this.activeExports.set(exportId, { 
                    ...this.activeExports.get(exportId),
                    progress,
                    currentChunk,
                    processedCount
                });
            }
            
            //? Prepare the paginated query
            const paginatedQuery = `${query} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`;
            const chunkRecords = await db.getMany(paginatedQuery, params);
            
            if (chunkRecords.length === 0) {
                break; // No more records
            }
            
            //? Optimize memory usage by creating rows directly
            const rowsToAdd = chunkRecords.map(record => {
                const rowData = {};
                
                for (const column of headersToUse) {
                    if (column === 'phone') {
                        //! FIXED: Ensure phone formatting works properly
                        if (record[column] === '[null]' || !record[column]) {
                            rowData[column] = ''; // Replace '[null]' with empty string
                        } else {
                            // Store original phone
                            rowData[column] = record[column];
                            
                            // Format phone number if that column is requested
                            if (headersToUse.includes('formattedPhone')) {
                                rowData['formattedPhone'] = this.formatPhoneNumber(record[column]);
                            }
                        }
                    } else {
                        rowData[column] = record[column] || '';
                    }
                }
                
                return rowData;
            });
            
            //? Add all rows at once (more efficient)
            worksheet.addRows(rowsToAdd);
            
            //? Clear references to help GC
            rowsToAdd.length = 0;
            
            //? Update progress
            processedCount += chunkRecords.length;
            percentage = Math.floor((processedCount / totalCount) * 100);
            
            //? Only log every few percent to reduce log spam
            if (percentage >= lastLoggedPercentage + PERFORMANCE_CONFIG.PROGRESS_INTERVAL) {
                const elapsedSeconds = (Date.now() - startProcessingTime) / 1000;
                const recordsPerSecond = Math.round(processedCount / elapsedSeconds);
                
                logger.info(`Processed ${processedCount}/${totalCount} records (${percentage}%), ${recordsPerSecond} records/sec`);
                lastLoggedPercentage = percentage;
            }
        }
        
        //? Update progress before saving
        if (exportId) {
            this.activeExports.set(exportId, { 
                ...this.activeExports.get(exportId),
                progress: 95, 
                status: 'saving-file',
                processedCount 
            });
        }

        try {
            //? IMPROVED: Better Excel options to ensure compatibility
            const options = { 
                filename: filepath,
                useStyles: true,
                useSharedStrings: true
            };
            
            // Save workbook to file with optimized options
            await workbook.xlsx.writeFile(filepath);
            
            logger.info(`Excel file created successfully: ${filepath}, records: ${processedCount}`);
            
            // Return success result with format info included
            return {
                filename,
                filepath,
                count: processedCount,
                format: 'excel',  // Explicitly set format
                extension: 'xlsx' // Add explicit extension information
            };
        } catch (error) {
            logger.error(`Error saving Excel file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get appropriate width for a column based on content type
     */
    getColumnWidth(columnName) {
        // Set column widths based on expected content
        switch(columnName) {
            case 'name':
                return 30;
            case 'address':
                return 35;
            case 'email':
                return 28;
            case 'phone':
            case 'formattedPhone':
                return 18;
            case 'website':
            case 'domain':
                return 30;
            case 'category':
                return 25;
            case 'state':
                return 10;
            case 'postal_code':
                return 12;
            case 'notes':
                return 40;
            default:
                return 15;
        }
    }

    /**
     * * Get the status of an active export
     * @param {string} exportId - Export ID
     * @returns {Object|null} Export status info or null if not found
     */
    getExportStatus(exportId) {
        return this.activeExports.get(exportId) || null;
    }

    /**
     * * Get all active exports
     * @returns {Array} List of active exports
     */
    getAllActiveExports() {
        return Array.from(this.activeExports.entries()).map(([id, status]) => ({
            id,
            ...status
        }));
    }

    /**
     * * Get export performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.metrics,
            activeExports: this.activeExports.size,
            configuration: PERFORMANCE_CONFIG
        };
    }

    /**
     * Export task results with proper handling of random category data
     * @param {string} taskId - Task ID
     * @param {Array} columns - Selected columns
     * @param {boolean} isRandom - Whether this is a random category task
     * @returns {Object} Export result
     */
    async exportTaskResults(taskId, columns = null, isRandom = false) {
        try {
            // Get task information
            const task = await db.getOne('SELECT * FROM scraping_tasks WHERE id = $1', [taskId]);

            if (!task) {
                throw new Error('Task not found');
            }

            // Check if this is a random category task
            let isRandomTask = isRandom;
            if (!isRandomTask) {
                isRandomTask = await this.isRandomCategoryTask(taskId);
            }
            
            logger.info(`Exporting task ${taskId}, isRandomTask: ${isRandomTask}`);

            let businesses = [];
            const exportSource = isRandomTask ? 'random_category_leads' : 'business_listings';
            
            // Get businesses from the appropriate table based on task type
            logger.info(`Fetching data from ${exportSource} table for task ${taskId}`);
            businesses = await db.getMany(
                `SELECT * FROM ${exportSource} WHERE task_id = $1 ORDER BY name`,
                [taskId]
            );
            
            if (businesses.length === 0) {
                // If no businesses found in the primary source, try the other table
                const fallbackSource = isRandomTask ? 'business_listings' : 'random_category_leads';
                logger.info(`No businesses found. Attempting fallback to ${fallbackSource} table`);
                
                businesses = await db.getMany(
                    `SELECT * FROM ${fallbackSource} WHERE task_id = $1 ORDER BY name`,
                    [taskId]
                );
            }

            if (businesses.length === 0) {
                throw new Error('No businesses found for this task');
            }

            logger.info(`Found ${businesses.length} businesses for export from task ${taskId}`);

            // Build task name with search term for file name
            const searchTerm = task.search_term.replace(/[^a-zA-Z0-9]/g, '_');
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `${searchTerm}_${timestamp}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            // Create Excel file with selected columns
            await this.createExcelFile(businesses, filepath, columns);

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

    async exportFilteredBusinesses(filter = {}, columns = null) {
        try {
            // Clean up filter object and log it clearly
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

            // FIXED: Use ILIKE for city filtering to allow partial matches
            if (cleanFilter.city) {
                query += ` AND city ILIKE $${paramIndex++}`;
                params.push(`%${cleanFilter.city}%`); // Use wildcards for partial matching
                logger.info(`Adding city filter: ${cleanFilter.city} (using partial match)`);
            }

            // ADDED: Filtering by category - In business_listings, categories are stored in the search_term field
            if (cleanFilter.category) {
                query += ` AND search_term ILIKE $${paramIndex++}`;
                params.push(`%${cleanFilter.category}%`);
                logger.info(`Adding category filter: ${cleanFilter.category} (using search_term field)`);
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

            // Phone filter 
            if (cleanFilter.hasPhone === true) {
                query += ` AND phone IS NOT NULL AND phone != '' AND phone != '[null]'`;
                logger.info('Adding filter: Has Phone (true)');
            } else if (cleanFilter.hasPhone === false) {
                query += ` AND (phone IS NULL OR phone = '' OR phone = '[null]')`;
                logger.info('Adding filter: No Phone (false)');
            } else if (cleanFilter.excludeNullPhone === true) {
                query += ` AND (phone != '[null]' OR phone IS NULL)`;
                logger.info('Adding filter: Exclude [null] Phone Values');
            }

            // Address filter
            if (cleanFilter.hasAddress === true) {
                query += ` AND address IS NOT NULL AND address != ''`;
                logger.info('Adding filter: Has Address (true)');
            } else if (cleanFilter.hasAddress === false) {
                query += ` AND (address IS NULL OR address = '')`;
                logger.info('Adding filter: No Address (false)');
            }

            // ORDER BY for consistent results
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

            // Use new method with column selection
            await this.createExcelFile(businesses, filepath, columns);

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

    /**
     * Create Excel file with selected columns and formatted data
     * @param {Array} businesses - Business data
     * @param {string} filepath - Path to save Excel file
     * @param {Array} selectedColumns - Columns to include
     * @returns {string} Path to created file
     */
    async createExcelFile(businesses, filepath, selectedColumns = null) {
        try {
            if (typeof window !== 'undefined') {
                // In browser environment, we can't write files
                return filepath;
            }

            logger.info(`Starting Excel file creation with ${businesses.length} records at ${filepath}`);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Business Leads');

            // Define all possible columns
            const allColumns = [
                { header: 'Business Name', key: 'name', width: 30 },
                { header: 'Email', key: 'email', width: 30 },
                { header: 'Phone', key: 'phone', width: 20 },
                { header: 'Formatted Phone', key: 'formattedPhone', width: 20 },
                { header: 'Website', key: 'website', width: 30 },
                { header: 'Address', key: 'address', width: 30 },
                { header: 'City', key: 'city', width: 20 },
                { header: 'State', key: 'state', width: 10 },
                { header: 'Country', key: 'country', width: 15 },
                { header: 'Postal Code', key: 'postal_code', width: 15 },
                { header: 'Category', key: 'category', width: 20 },
                { header: 'Search Term', key: 'search_term', width: 20 },
                { header: 'Rating', key: 'rating', width: 10 },
                { header: 'Notes', key: 'notes', width: 30 },
                { header: 'Created', key: 'created_at', width: 20 }
            ];
            
            // Filter columns based on selection or use all
            const columnsToUse = selectedColumns ? 
                allColumns.filter(col => selectedColumns.includes(col.key)) : 
                allColumns;
                
            // Assign columns to worksheet
            worksheet.columns = columnsToUse;

            // Style the header row
            worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4F46E5' } // Primary color
            };
            worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

            // Process data in chunks for large datasets
            const CHUNK_SIZE = 3000;
            const totalChunks = Math.ceil(businesses.length / CHUNK_SIZE);
            
            logger.info(`Processing ${businesses.length} records in ${totalChunks} chunks`);
            
            let totalRowsAdded = 0;
            let emailsAdded = 0;
            let phonesFormatted = 0;
            let invalidPhones = 0;
            
            for (let i = 0; i < totalChunks; i++) {
                const startIdx = i * CHUNK_SIZE;
                const endIdx = Math.min((i + 1) * CHUNK_SIZE, businesses.length);
                const chunk = businesses.slice(startIdx, endIdx);
                
                // Add rows with proper data and formatting
                for (const business of chunk) {
                    try {
                        // Make sure we're not processing a '[null]' phone value
                        const rawPhone = business.phone === '[null]' ? '' : business.phone;
                        
                        // Format the phone number
                        const formattedPhone = this.formatPhoneNumber(rawPhone);
                        if (formattedPhone) phonesFormatted++;
                        if (rawPhone && !formattedPhone) invalidPhones++;
                        
                        // Track email statistics
                        if (business.email && business.email.trim() !== '') emailsAdded++;
                        
                        // For random category leads, use category field instead of search_term if available
                        const category = business.category || business.search_term || '';
                        
                        // Create row data object with all possible fields
                        const rowData = {
                            name: business.name || '',
                            email: business.email || '',
                            phone: rawPhone || '', // Use cleaned phone value
                            formattedPhone: formattedPhone, // Add the formatted phone
                            website: business.website || '',
                            address: business.address || '',
                            city: business.city || '',
                            state: business.state || '',
                            country: business.country || '',
                            postal_code: business.postal_code || '',
                            category: category, // Use category field with fallback
                            search_term: business.search_term || '',
                            rating: business.rating || '',
                            notes: business.notes || '',
                            created_at: business.created_at ? new Date(business.created_at).toLocaleString() : ''
                        };
                        
                        // Add row to worksheet (will only include columns that were specified)
                        const row = worksheet.addRow(rowData);
                        
                        // Add alternating row colors
                        if (row.number % 2 === 0) {
                            row.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFF9F9F9' }
                            };
                        }
                    } catch (error) {
                        logger.error(`Error processing record: ${error.message}`);
                    }
                }
                
                totalRowsAdded += chunk.length;
                if (i % 5 === 0 || i === totalChunks - 1) {
                    logger.info(`Processed ${totalRowsAdded}/${businesses.length} records (${Math.round((totalRowsAdded / businesses.length) * 100)}%)`);
                }
                
                // Release memory
                if (global.gc) global.gc();
            }

            // Add filter to all columns
            worksheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: columnsToUse.length }
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

            // Write file
            await workbook.xlsx.writeFile(filepath);
            
            const stats = fs.statSync(filepath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            logger.info(`Excel file created successfully: ${filepath}, size: ${fileSizeMB} MB, records: ${totalRowsAdded}, emails: ${emailsAdded}, formatted phones: ${phonesFormatted}, invalid phones: ${invalidPhones}`);

            return filepath;
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

    /**
     * Format phone number to standard format (12065551234)
     * @param {string} phone - Raw phone number
     * @returns {string} Formatted phone number
     */
    formatPhoneNumber(phone) {
        // If phone is null, undefined, '[null]' or empty string, return empty string
        if (!phone || phone === '[null]') return '';
        
        try {
            // Remove all non-numeric characters
            let cleaned = phone.replace(/\D/g, '');
            
            // Handle US country code case
            if (cleaned.length === 10) {
                // Add US country code (1) for 10-digit numbers
                cleaned = '1' + cleaned;
            } else if (cleaned.length > 11) {
                // If number is longer than 11 digits, truncate to 11 (country code + 10-digit number)
                cleaned = cleaned.substring(0, 11);
            } else if (cleaned.length < 10 && cleaned.length > 0) {
                // If number is too short but not empty, log as potentially invalid
                logger.debug(`Potentially invalid phone number: ${phone} -> ${cleaned}`);
            }
            
            return cleaned;
        } catch (error) {
            logger.error(`Error formatting phone number: ${error.message}`);
            // Return original cleaned string if there's an error
            return phone ? phone.replace(/\D/g, '') : '';
        }
    }

    /**
     * Export filtered businesses from random_category_leads table
     * @param {Object} filter - Filter criteria
     * @param {Array} columns - Selected columns
     * @returns {Object} Export result
     */
    async exportRandomCategoryLeads(filter = {}, columns = null) {
        try {
            // Create filename and filepath first
            const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const filename = `Random_Category_Leads_${dateTime}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            //! Build base query for random_category_leads table with explicit column selection
            let baseQuery = `
                SELECT 
                    id, name, email, phone, website, domain, address, city, 
                    state, postal_code, country, category, rating, 
                    search_term, search_date, task_id, business_type, 
                    owner_name, verified, contacted, notes, 
                    created_at, updated_at
                FROM random_category_leads 
                WHERE 1=1`;
                
            const baseParams = [];
            let paramIndex = 1;

            // Add each filter condition
            if (filter.state) {
                baseQuery += ` AND state = $${paramIndex}`;
                baseParams.push(filter.state);
                paramIndex++;
            }

            //! FIX: Add proper city filter handling with ILIKE
            if (filter.city) {
                baseQuery += ` AND city ILIKE $${paramIndex}`;
                baseParams.push(`%${filter.city}%`); // Use ILIKE with wildcards for better matching
                logger.info(`Adding city filter for "${filter.city}"`);
            }

            // ...existing filter conditions...

            //! CRITICAL FIX: Always add ORDER BY clause before LIMIT and OFFSET
            baseQuery += ` ORDER BY name`;

            // Log the query for debugging
            logger.info(`Export query: ${baseQuery.replace(/\s+/g, ' ')}`);
            logger.info(`Export parameters: ${baseParams.join(', ')}`);

            // First get the total count for progress tracking
            const countQueryBase = `SELECT COUNT(*) FROM random_category_leads WHERE 1=1`;
            const whereClause = baseQuery.split('WHERE 1=1')[1].split('ORDER BY')[0];
            const countQuery = countQueryBase + whereClause;

            const countResult = await db.getOne(countQuery, baseParams);
            const totalCount = parseInt(countResult?.count || '0');
            
            logger.info(`Count query returned ${totalCount} records`);

            if (totalCount === 0) {
                logger.warn(`No random category leads found matching filter criteria`);
                return {
                    filename: 'No_Results.xlsx',
                    filepath: '',
                    count: 0,
                    isEmpty: true
                };
            }

            //? Check if CSV should be used for very large datasets
            const USE_CSV_THRESHOLD = 100000;
            let shouldUseCsv = totalCount > USE_CSV_THRESHOLD;
            
            if (shouldUseCsv) {
                logger.info(`Dataset size (${totalCount}) exceeds Excel threshold (${USE_CSV_THRESHOLD}), using CSV format`);
                return await this.exportRandomCategoryLeadsAsCsv(baseQuery, baseParams, totalCount, columns, dateTime);
            }

            //=================================
            // Split large exports into multiple files if needed
            //=================================
            const MAX_RECORDS_PER_FILE = 50000;
            if (totalCount > MAX_RECORDS_PER_FILE) {
                const numFiles = Math.ceil(totalCount / MAX_RECORDS_PER_FILE);
                logger.info(`Large dataset detected (${totalCount} records). Splitting into ${numFiles} files.`);
                
                const results = [];
                for (let fileIndex = 0; fileIndex < numFiles; fileIndex++) {
                    const startRecord = fileIndex * MAX_RECORDS_PER_FILE;
                    const endRecord = Math.min(startRecord + MAX_RECORDS_PER_FILE, totalCount);
                    logger.info(`Creating file ${fileIndex + 1}/${numFiles} with records ${startRecord + 1}-${endRecord}`);
                    
                    //! Create a paginated query for this file with proper ORDER BY clause
                    const paginatedQuery = `${baseQuery} LIMIT ${MAX_RECORDS_PER_FILE} OFFSET ${startRecord}`;
                    
                    // Generate unique filename for this part
                    const partFilename = `Random_Category_Leads_${dateTime}_part${fileIndex + 1}of${numFiles}.xlsx`;
                    const partFilepath = path.join(this.exportDirectory || '.', partFilename);
                    
                    // Export this chunk as a separate file
                    const partResult = await this.exportRandomCategoryLeadsToExcelFile(
                        paginatedQuery, 
                        baseParams, 
                        endRecord - startRecord, 
                        columns, 
                        partFilepath,
                        partFilename
                    );
                    
                    results.push(partResult);
                }
                
                // Return information about all files
                return {
                    filename: results.map(r => r.filename),
                    filepath: results.map(r => r.filepath),
                    count: totalCount,
                    isMultiFile: true,
                    files: results
                };
            }

            // For single file export, ensure ORDER BY is added to the base query
            logger.info(`Starting Excel file creation with ${totalCount} records at ${filepath}`);
            
            // Call the refactored method for Excel export
            return await this.exportRandomCategoryLeadsToExcelFile(
                baseQuery, 
                baseParams, 
                totalCount, 
                columns, 
                filepath,
                filename
            );
        } catch (error) {
            logger.error(`Error exporting random category leads: ${error.message}`);
            throw error;
        }
    }

    /**
     * Optimized function to export data to Excel file with minimal memory usage
     * @param {string} query - The SQL query to execute
     * @param {Array} params - Query parameters
     * @param {number} totalCount - Total number of records
     * @param {Array} columns - Columns to include
     * @param {string} filepath - Path to save file
     * @param {string} filename - File name
     * @returns {Object} Export result
     */
    async exportRandomCategoryLeadsToExcelFile(query, params, totalCount, columns, filepath, filename) {
        // Define headers - either use selected columns or default set
        const defaultColumns = [
            'name', 'email', 'phone', 'website', 'address', 'city', 
            'state', 'postal_code', 'category', 'rating'
        ];

        const headersToUse = columns && columns.length > 0 ? columns : defaultColumns;
        
        //? Create workbook with optimized options for memory efficiency
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Leads Generator';
        workbook.created = new Date();
        
        //? Use options to reduce memory usage
        workbook.properties.date1904 = false;
        
        const worksheet = workbook.addWorksheet('Leads', {
            //? These options help reduce memory usage
            properties: {
                defaultColWidth: 15,
                filterMode: false,
                showGridLines: true
            }
        });
        
        // Add headers with formatting
        worksheet.columns = headersToUse.map(header => ({
            header: this.formatColumnHeader(header),
            key: header,
            width: 18
        }));

        // Apply header styling
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' }
        };

        //! CRITICAL FIX: Use drastically smaller chunk size for memory efficiency
        const CHUNK_SIZE = 500; 
        const totalChunks = Math.ceil(totalCount / CHUNK_SIZE);
        
        logger.info(`Processing ${totalCount} records in ${totalChunks} chunks`);
        
        let processedCount = 0;
        let lastLoggedPercentage = -1;

        //? Pre-allocate memory for the worksheet rows
        worksheet.startRow = 1; // Set the starting row for writing data

        //=================================
        // Process data in chunks using pagination
        //=================================
        for (let offset = 0; offset < totalCount; offset += CHUNK_SIZE) {
            //? Force garbage collection before each chunk if available
            if (global.gc) {
                global.gc();
            }
            
            // Query for this chunk with pagination
            const paginatedQuery = `${query} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`;
            const chunkRecords = await db.getMany(paginatedQuery, params);
            
            if (chunkRecords.length === 0) {
                break; // No more records
            }
            
            //? Use reduced object copies to save memory
            const rowsToAdd = [];
            
            // Add rows to worksheet - only include necessary columns
            for (const record of chunkRecords) {
                // Create a minimal row object with only required properties
                const rowData = {};
                
                for (const column of headersToUse) {
                    if (column === 'phone' && record[column] === '[null]') {
                        rowData[column] = ''; // Replace '[null]' with empty string
                    } else {
                        rowData[column] = record[column] || '';
                    }
                }
                rowsToAdd.push(rowData);
            }
            
            //? Add all rows at once (more efficient)
            if (rowsToAdd.length > 0) {
                worksheet.addRows(rowsToAdd);
            }
            
            //? Clear references to help GC
            rowsToAdd.length = 0;
            
            // Update progress
            processedCount += chunkRecords.length;
            const percentage = Math.floor((processedCount / totalCount) * 100);
            
            // Only log every 10% to reduce log spam
            if (percentage >= lastLoggedPercentage + 10) {
                logger.info(`Processed ${processedCount}/${totalCount} records (${percentage}%)`);
                lastLoggedPercentage = percentage;
            }
            
            //? Add a small delay to free up the event loop
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        try {
            //? Use manual optimization to reduce memory during save
            const options = { 
                useStyles: true,
                useSharedStrings: false, // Disable shared strings to reduce memory
            };
            
            // Save workbook to file with optimized options
            await workbook.xlsx.writeFile(filepath, options);
        } catch (error) {
            logger.error(`Error saving Excel file: ${error.message}`);
            throw error;
        }

        // Get file size for logging
        const stats = fs.statSync(filepath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        logger.info(`Excel file created successfully: ${filepath}, size: ${fileSizeMB} MB, records: ${processedCount}`);
        
        //? Force a garbage collection after saving
        if (global.gc) {
            global.gc();
        }

        return {
            filename,
            filepath,
            count: processedCount
        };
    }

    /**
     * Export data as CSV file (much more memory efficient for very large datasets)
     * @param {string} query - The SQL query to execute
     * @param {Array} params - Query parameters
     * @param {number} totalCount - Total number of records
     * @param {Array} columns - Columns to include
     * @param {string} dateTime - DateTime string for filename
     * @returns {Object} Export result
     */
    async exportRandomCategoryLeadsAsCsv(query, params, totalCount, columns, dateTime) {
        try {
            // Create filename and filepath
            const filename = `Random_Category_Leads_${dateTime}.csv`;
            const filepath = path.join(this.exportDirectory || '.', filename);
            
            // Define headers - either use selected columns or default set
            const defaultColumns = [
                'name', 'email', 'phone', 'website', 'address', 'city', 
                'state', 'postal_code', 'category', 'rating'
            ];

            const headersToUse = columns && columns.length > 0 ? columns : defaultColumns;
            
            // Create a write stream for the CSV file
            const writeStream = fs.createWriteStream(filepath);
            
            // Use the fast-csv library for streaming CSV generation
            const csvStream = require('fast-csv').format({ headers: true });
            csvStream.pipe(writeStream);
            
            // Write column headers first
            const headerRow = {};
            headersToUse.forEach(col => {
                headerRow[col] = this.formatColumnHeader(col);
            });
            csvStream.write(headerRow);
            
            // Process data in even smaller chunks for CSV
            const CHUNK_SIZE = 1000;
            const totalChunks = Math.ceil(totalCount / CHUNK_SIZE);
            
            logger.info(`Processing ${totalCount} records in ${totalChunks} CSV chunks`);
            
            let processedCount = 0;
            let lastLoggedPercentage = -1;
            
            // Process each chunk
            for (let offset = 0; offset < totalCount; offset += CHUNK_SIZE) {
                // Query for this chunk with pagination
                const paginatedQuery = `${query} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`;
                const chunkRecords = await db.getMany(paginatedQuery, params);
                
                if (chunkRecords.length === 0) {
                    break; // No more records
                }
                
                // Process each record
                for (const record of chunkRecords) {
                    // Create a CSV row with only selected columns
                    const rowData = {};
                    for (const column of headersToUse) {
                        if (column === 'phone' && record[column] === '[null]') {
                            rowData[column] = ''; // Replace '[null]' with empty string  
                        } else {
                            rowData[column] = record[column] || '';
                        }
                    }
                    
                    // Write row to CSV stream
                    csvStream.write(rowData);
                }
                
                // Update progress
                processedCount += chunkRecords.length;
                const percentage = Math.floor((processedCount / totalCount) * 100);
                
                // Log progress every 10%
                if (percentage >= lastLoggedPercentage + 10) {
                    logger.info(`Processed ${processedCount}/${totalCount} CSV records (${percentage}%)`);
                    lastLoggedPercentage = percentage;
                }
                
                // Force GC after each chunk
                if (global.gc) {
                    global.gc();
                }
                
                // Small delay to free up event loop
                await new Promise(resolve => setTimeout(resolve, 5));
            }
            
            // Close streams and complete the CSV write
            return new Promise((resolve, reject) => {
                csvStream.end();
                writeStream.on('finish', () => {
                    // Get file size for logging
                    const stats = fs.statSync(filepath);
                    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                    
                    logger.info(`CSV file created successfully: ${filepath}, size: ${fileSizeMB} MB, records: ${processedCount}`);
                    
                    resolve({
                        filename,
                        filepath,
                        count: processedCount,
                        format: 'csv'
                    });
                });
                
                writeStream.on('error', (err) => {
                    logger.error(`Error writing CSV file: ${err.message}`);
                    reject(err);
                });
            });
        } catch (error) {
            logger.error(`Error exporting as CSV: ${error.message}`);
            throw error;
        }
    }

    /**
     * Format column header for display in exported files
     * @param {string} header - Raw column name
     * @returns {string} Formatted column header
     */
    formatColumnHeader(header) {
        if (!header) return '';
        
        // Handle snake_case headers (convert to Title Case)
        if (header.includes('_')) {
            return header
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
        
        // Handle camelCase headers
        return header
            // Insert a space before all caps
            .replace(/([A-Z])/g, ' $1')
            // Uppercase the first character
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    /**
     * Export data from combined sources (both business_listings and random_category_leads)
     * @param {Object} filter - Filter criteria
     * @param {Array} columns - Selected columns
     * @returns {Object} Export result
     */
    async exportCombinedSources(filter = {}, columns = null) {
        try {
            // Create filename and filepath first
            const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const filename = `Combined_Leads_${dateTime}.xlsx`;
            const filepath = path.join(this.exportDirectory || '.', filename);

            // Build base queries for both tables with the same filter conditions
            let businessListingsQuery = `
                SELECT 
                    id, name, email, phone, website, domain, address, city, 
                    state, postal_code, country, search_term as category, rating, 
                    task_id, created_at, updated_at,
                    'business_listings' as source_table
                FROM business_listings 
                WHERE 1=1`;
                
            let randomCategoryLeadsQuery = `
                SELECT 
                    id, name, email, phone, website, domain, address, city, 
                    state, postal_code, country, category, rating, 
                    task_id, created_at, updated_at,
                    'random_category_leads' as source_table
                FROM random_category_leads 
                WHERE 1=1`;
                
            const baseParams = [];
            let paramIndex = 1;

            // Add each filter condition to both queries
            // For state
            if (filter.state) {
                businessListingsQuery += ` AND state = $${paramIndex}`;
                randomCategoryLeadsQuery += ` AND state = $${paramIndex}`;
                baseParams.push(filter.state);
                paramIndex++;
            }

            // For city
            if (filter.city) {
                businessListingsQuery += ` AND city ILIKE $${paramIndex}`;
                randomCategoryLeadsQuery += ` AND city ILIKE $${paramIndex}`;
                baseParams.push(`%${filter.city}%`);
                paramIndex++;
            }

            // For search term/category
            if (filter.searchTerm) {
                businessListingsQuery += ` AND search_term = $${paramIndex}`;
                randomCategoryLeadsQuery += ` AND category = $${paramIndex}`;
                baseParams.push(filter.searchTerm);
                paramIndex++;
            }

            // Email filter
            if (filter.hasEmail === true) {
                businessListingsQuery += ` AND email IS NOT NULL AND email != ''`;
                randomCategoryLeadsQuery += ` AND email IS NOT NULL AND email != ''`;
            } else if (filter.hasEmail === false) {
                businessListingsQuery += ` AND (email IS NULL OR email = '')`;
                randomCategoryLeadsQuery += ` AND (email IS NULL OR email = '')`;
            }

            // Website filter - FIXED
            if (filter.hasWebsite === true) {
                businessListingsQuery += ` AND website IS NOT NULL AND website != ''`;
                randomCategoryLeadsQuery += ` AND website IS NOT NULL AND website != ''`;
            } else if (filter.hasWebsite === false) {
                businessListingsQuery += ` AND (website IS NULL OR website = '')`;
                randomCategoryLeadsQuery += ` AND (website IS NULL OR website = '')`;
            }

            // Phone filter
            if (filter.hasPhone === true) {
                businessListingsQuery += ` AND phone IS NOT NULL AND phone != '' AND phone != '[null]'`;
                randomCategoryLeadsQuery += ` AND phone IS NOT NULL AND phone != '' AND phone != '[null]'`;
            } else if (filter.hasPhone === false) {
                businessListingsQuery += ` AND (phone IS NULL OR phone = '' OR phone = '[null]')`;
                randomCategoryLeadsQuery += ` AND (phone IS NULL OR phone = '' OR phone = '[null]')`;
            } else if (filter.excludeNullPhone === true) {
                businessListingsQuery += ` AND phone != '[null]'`;
                randomCategoryLeadsQuery += ` AND phone != '[null]'`;
            }

            // Address filter - FIXED
            if (filter.hasAddress === true) {
                businessListingsQuery += ` AND address IS NOT NULL AND address != ''`;
                randomCategoryLeadsQuery += ` AND address IS NOT NULL AND address != ''`;
            } else if (filter.hasAddress === false) {
                businessListingsQuery += ` AND (address IS NULL OR address = '')`;
                randomCategoryLeadsQuery += ` AND (address IS NULL OR address = '')`;
            }

            // Combine queries with UNION ALL
            const combinedQuery = `
                (${businessListingsQuery})
                UNION ALL
                (${randomCategoryLeadsQuery})
                ORDER BY name
            `;

            // Log the query for debugging
            logger.info(`Combined export query created`);
            
            // Get total count for progress tracking
            const countQuery = `
                SELECT COUNT(*) as total FROM (
                    ${combinedQuery}
                ) as combined_data
            `;
            
            const countResult = await db.getOne(countQuery, baseParams);
            const totalCount = parseInt(countResult?.total || '0');
            
            logger.info(`Combined count query returned ${totalCount} records`);

            if (totalCount === 0) {
                logger.warn(`No records found matching filter criteria from combined sources`);
                return {
                    filename: 'No_Results.xlsx',
                    filepath: '',
                    count: 0,
                    isEmpty: true
                };
            }

            // Create workbook with streaming approach for large datasets
            logger.info(`Starting combined Excel file creation with ${totalCount} records at ${filepath}`);
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Combined Leads');

            // Define headers - either use selected columns or default set
            const defaultColumns = [
                'name', 'email', 'phone', 'website', 'address', 'city', 
                'state', 'postal_code', 'category', 'rating', 'source_table'
            ];

            const headersToUse = columns && columns.length > 0 ? columns : defaultColumns;
            
            // Add headers with formatting
            worksheet.columns = headersToUse.map(header => ({
                header: this.formatColumnHeader(header),
                key: header,
                width: 20
            }));

            // Apply header styling
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD3D3D3' }
            };

            // Process data in chunks to avoid memory issues
            const CHUNK_SIZE = 10000;
            const totalChunks = Math.ceil(totalCount / CHUNK_SIZE);
            
            logger.info(`Processing ${totalCount} records in ${totalChunks} chunks`);
            
            let processedCount = 0;
            let lastLoggedPercentage = -1;

            // Process data in chunks using pagination
            for (let offset = 0; offset < totalCount; offset += CHUNK_SIZE) {
                // Query for this chunk with pagination - Use the explicitly selected columns query
                const paginatedQuery = `
                    ${combinedQuery} 
                    LIMIT ${CHUNK_SIZE} OFFSET ${offset}
                `;
                
                const chunkRecords = await db.getMany(paginatedQuery, baseParams);

                // Add rows to worksheet
                for (const record of chunkRecords) {
                    // Pick only the fields we want to include in the export
                    const rowData = {};
                    for (const column of headersToUse) {
                        rowData[column] = record[column] || '';
                        
                        // Special handling for phone numbers
                        if (column === 'phone' && record[column]) {
                            // Format phone if it's not '[null]'
                            if (record[column] !== '[null]') {
                                rowData[column] = record[column]; // Already formatted
                            } else {
                                rowData[column] = ''; // Replace '[null]' with empty string
                            }
                        }
                    }
                    worksheet.addRow(rowData);
                }
                
                // Force garbage collection between chunks
                if (global.gc) {
                    global.gc();
                }
                
                // Update progress
                processedCount += chunkRecords.length;
                const percentage = Math.floor((processedCount / totalCount) * 100);
                
                if (percentage > lastLoggedPercentage + 7) {
                    logger.info(`Processed ${processedCount}/${totalCount} records (${percentage}%)`);
                    lastLoggedPercentage = percentage;
                }
            }

            // Save workbook to file
            await workbook.xlsx.writeFile(filepath);

            // Get file size for logging
            const stats = fs.statSync(filepath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            logger.info(`Combined Excel file created successfully: ${filepath}, size: ${fileSizeMB} MB, records: ${processedCount}`);

            return {
                filename,
                filepath,
                count: processedCount
            };
        } catch (error) {
            logger.error(`Error exporting combined sources: ${error.message}`);
            throw error;
        }
    }

    /**
     * Export data based on filters
     * @param {Object} filters - Filters to apply
     * @param {string} format - Export format (excel or csv)
     * @param {string} filepath - Path to save the file
     * @returns {Object} Export result
     */
    async exportData(filters, format = 'excel', filepath) {
      try {
        // Set up filter conditions for the query
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;
        
        // Apply category filter
        if (filters.category) {
          conditions.push(`category = $${paramIndex}`);
          queryParams.push(filters.category);
          paramIndex++;
        }
        
        // Apply location filters
        if (filters.city) {
          conditions.push(`city = $${paramIndex}`);
          queryParams.push(filters.city);
          paramIndex++;
        }
        
        if (filters.state) {
          conditions.push(`state = $${paramIndex}`);
          queryParams.push(filters.state);
          paramIndex++;
        }
        
        // Apply date range filters
        if (filters.startDate) {
          conditions.push(`created_at >= $${paramIndex}`);
          queryParams.push(filters.startDate);
          paramIndex++;
        }
        
        if (filters.endDate) {
          conditions.push(`created_at <= $${paramIndex}`);
          queryParams.push(filters.endDate);
          paramIndex++;
        }
        
        // Apply email filter
        if (filters.hasEmail !== undefined) {
          if (filters.hasEmail) {
            conditions.push(`email IS NOT NULL AND email != ''`);
          } else {
            conditions.push(`(email IS NULL OR email = '')`);
          }
        }
        
        // Apply website filter
        if (filters.hasWebsite !== undefined) {
          if (filters.hasWebsite) {
            conditions.push(`website IS NOT NULL AND website != ''`);
          } else {
            conditions.push(`(website IS NULL OR website = '')`);
          }
        }
        
        // Apply task filter
        if (filters.taskId) {
          conditions.push(`task_id = $${paramIndex}`);
          queryParams.push(filters.taskId);
          paramIndex++;
        }
        
        // Build the WHERE clause
        const whereClause = conditions.length > 0 
          ? `WHERE ${conditions.join(' AND ')}` 
          : '';
        
        // Determine which table to query
        const tableName = filters.useRandomCategoryTable 
          ? 'random_category_leads' 
          : 'business_listings';
        
        // Build the full query
        const query = `
          SELECT 
            name, email, phone, 
            CASE 
              WHEN phone IS NOT NULL AND phone != '' THEN phone 
              ELSE NULL 
            END as "formattedPhone",
            website, address, city, state, country, postal_code, 
            rating, search_term, domain
          FROM ${tableName}
          ${whereClause}
          ORDER BY name
        `;
        
        // Execute the query
        const db = require('./database').default;
        const results = await db.getMany(query, queryParams);
        
        if (format === 'excel') {
          return this.exportToExcelFile(results, filepath);
        } else {
          return this.exportToCsvFile(results, filepath);
        }
      } catch (error) {
        logger.error(`Export error: ${error.message}`);
        throw error;
      }
    }

    /**
     * Export data to Excel file
     * @param {Array} data - Data to export
     * @param {string} filepath - Path to save the file
     */
    async exportToExcelFile(data, filepath) {
      const Excel = require('exceljs');
      const workbook = new Excel.Workbook();
      const worksheet = workbook.addWorksheet('Leads');
      
      // Add headers
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        worksheet.addRow(headers);
      }
      
      // Add data rows
      data.forEach(row => {
        const values = Object.values(row).map(val => val || '');
        worksheet.addRow(values);
      });
      
      // Style headers
      worksheet.getRow(1).font = { bold: true };
      
      // Save workbook
      await workbook.xlsx.writeFile(filepath);
      console.log(`Excel file saved to ${filepath}`);
      
      return { count: data.length };
    }

    /**
     * Export data to CSV file
     * @param {Array} data - Data to export
     * @param {string} filepath - Path to save the file
     */
    async exportToCsvFile(data, filepath) {
      const fs = require('fs');
      const path = require('path');
      
      // Create directory if it doesn't exist
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Generate CSV content
      let csvContent = '';
      
      // Add headers
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        csvContent += headers.join(',') + '\n';
      }
      
      // Add data rows
      data.forEach(row => {
        const values = Object.values(row).map(val => {
          // Handle values that need escaping
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        });
        csvContent += values.join(',') + '\n';
      });
      
      // Write to file
      fs.writeFileSync(filepath, csvContent, 'utf8');
      console.log(`CSV file saved to ${filepath}`);
      
      return { count: data.length };
    }

    /**
 * Export all businesses unfiltered from random_category_leads table
 * @returns {Promise<Object>} Export result
 */
async exportAllRandomCategoryLeadsUnfiltered() {
    try {
        logger.info("Starting optimized unfiltered export of ALL random category leads");

        // Get total count for planning
        const totalCount = await db.getOne('SELECT COUNT(*) as count FROM random_category_leads');
        const count = parseInt(totalCount?.count || '0');

        if (count === 0) {
            throw new Error('No records found in the random_category_leads table');
        }

        logger.info(`Preparing to export ${count} total random category leads records`);

        const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const filename = `Complete_Random_Categories_${dateTime}.xlsx`;
        const filepath = path.join(this.exportDirectory || '.', filename);

        // Direct stream processing for large datasets
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Random Category Leads');
        
        // Set up columns
        worksheet.columns = [
            { header: 'Business Name', key: 'name', width: 30 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Phone', key: 'phone', width: 20 },
            { header: 'Formatted Phone', key: 'formattedPhone', width: 20 },
            { header: 'Website', key: 'website', width: 30 },
            { header: 'Address', key: 'address', width: 30 },
            { header: 'City', key: 'city', width: 20 },
            { header: 'State', key: 'state', width: 10 },
            { header: 'Country', key: 'country', width: 15 },
            { header: 'Postal Code', key: 'postal_code', width: 15 },
            { header: 'Category', key: 'category', width: 20 },
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

        // Use chunks to avoid memory issues
        const CHUNK_SIZE = 2000;
        const totalChunks = Math.ceil(count / CHUNK_SIZE);

        logger.info(`Processing ${count} records in ${totalChunks} chunks of ${CHUNK_SIZE} records`);

        let processedCount = 0;
        let emailCount = 0;

        for (let i = 0; i < totalChunks; i++) {
            const offset = i * CHUNK_SIZE;
            logger.info(`Processing chunk ${i + 1}/${totalChunks} (offset: ${offset})`);

            // More efficient query with explicit column selection
            const businesses = await db.getMany(
                `SELECT id, name, email, phone, website, address, city, state, country, 
                postal_code, category, rating, created_at FROM random_category_leads 
                ORDER BY id LIMIT $1 OFFSET $2`,
                [CHUNK_SIZE, offset]
            );

            // Count emails in this batch
            const batchEmailCount = businesses.filter(b => b.email && b.email.trim() !== '').length;
            emailCount += batchEmailCount;

            // Add rows to worksheet
            for (const business of businesses) {
                const formattedPhone = this.formatPhoneNumber(business.phone || '');
                
                worksheet.addRow({
                    name: business.name || '',
                    email: business.email || '',
                    phone: business.phone || '',
                    formattedPhone: formattedPhone,
                    website: business.website || '',
                    address: business.address || '',
                    city: business.city || '',
                    state: business.state || '',
                    country: business.country || '',
                    postal_code: business.postal_code || '',
                    category: business.category || '',
                    rating: business.rating || '',
                    created_at: business.created_at ? new Date(business.created_at).toLocaleString() : ''
                });
            }
            
            processedCount += businesses.length;
            
            logger.info(`Progress: ${Math.round((processedCount / count) * 100)}% complete (${processedCount}/${count}), Emails in batch: ${batchEmailCount}`);

            // Clear memory
            if (global.gc) global.gc();
        }

        // Finalize and save
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: worksheet.columns.length }
        };

        worksheet.views = [{ state: 'frozen', ySplit: 1 }];

        await workbook.xlsx.writeFile(filepath);

        logger.info(`Export complete: ${processedCount} records processed, ${emailCount} with emails (${((emailCount / processedCount) * 100).toFixed(1)}%)`);

        return {
            filename,
            filepath,
            count: processedCount
        };
    } catch (error) {
        logger.error(`Error in unfiltered random category export: ${error.message}`);
        throw error;
    }
}

}  // End of ExportService classss

// Create singleton instance// Create and export the singleton instance in one statement
const exportService = new ExportService();
// Export using CommonJS syntax
module.exports = exportService;
