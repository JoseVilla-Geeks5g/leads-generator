import { NextResponse } from 'next/server';
import scraperService from '@/services/scraperService';
import db from '@/services/database';
import logger from '@/services/logger';
import { v4 as uuidv4 } from 'uuid';

// Get batch status or all batches
export async function GET(request) {
    try {
        // Initialize database if needed
        await db.init();

        // Parse query parameters
        const { searchParams } = new URL(request.url);
        const batchId = searchParams.get('id');

        if (batchId) {
            // Check in-memory status first
            const memoryStatus = scraperService.getBatchStatus();
            if (memoryStatus.batchId === batchId) {
                return NextResponse.json(memoryStatus);
            }

            // If not in memory, get from database
            const batch = await db.getOne(`
                SELECT * FROM batch_operations WHERE id = $1
            `, [batchId]);

            if (!batch) {
                return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
            }

            // Get state progress
            const stateProgress = await db.getMany(`
                SELECT * FROM batch_state_progress WHERE batch_id = $1
            `, [batchId]).catch(err => {
                logger.error(`Error getting state progress: ${err.message}`);
                return [];
            });

            // Get failures
            const failures = await db.getMany(`
                SELECT * FROM batch_task_failures WHERE batch_id = $1
            `, [batchId]).catch(err => {
                logger.error(`Error getting failures: ${err.message}`);
                return [];
            });

            // Check if scraping_tasks table has the task_id column
            const hasTaskId = await db.getOne(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'scraping_tasks' AND column_name = 'task_id'
                ) as exists
            `).catch(() => ({ exists: false }));
            
            // Get search term info safely based on column existence
            let searchTermInfo = { searchTerm: null };
            
            if (hasTaskId && hasTaskId.exists) {
                // If task_id column exists, use it in the query
                searchTermInfo = await db.getOne(`
                    SELECT DISTINCT search_term as "searchTerm" 
                    FROM scraping_tasks 
                    WHERE task_id = $1 OR params::text LIKE $2
                `, [batchId, `%${batchId}%`]).catch(() => ({ searchTerm: null }));
            } else {
                // Otherwise use a simpler query without task_id
                searchTermInfo = await db.getOne(`
                    SELECT DISTINCT search_term as "searchTerm" 
                    FROM scraping_tasks 
                    WHERE id = $1 OR params::text LIKE $2
                `, [batchId, `%${batchId}%`]).catch(() => ({ searchTerm: null }));
            }

            const enhancedBatch = {
                ...batch,
                stateProgress: stateProgress || [],
                failures: failures || [],
                searchTerm: searchTermInfo?.searchTerm || null
            };

            return NextResponse.json(enhancedBatch);
        }

        // Get all batches with search terms safely
        const hasTaskId = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'scraping_tasks' AND column_name = 'task_id'
            ) as exists
        `).catch(() => ({ exists: false }));
        
        let batches = [];
        
        if (hasTaskId && hasTaskId.exists) {
            // If task_id exists, use it in the query
            batches = await db.getMany(`
                SELECT 
                    b.*, 
                    (SELECT search_term FROM scraping_tasks 
                     WHERE task_id = b.id OR params::text LIKE '%' || b.id || '%' 
                     LIMIT 1) as "searchTerm"
                FROM batch_operations b
                ORDER BY start_time DESC
            `, []);
        } else {
            // Otherwise use a simpler query
            batches = await db.getMany(`
                SELECT 
                    b.*,
                    (SELECT search_term FROM scraping_tasks 
                     WHERE params::text LIKE '%' || b.id || '%' 
                     LIMIT 1) as "searchTerm"
                FROM batch_operations b
                ORDER BY start_time DESC
            `, []);
        }

        return NextResponse.json(batches);
    } catch (error) {
        logger.error(`Error getting batch status: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get batch status', details: error.message },
            { status: 500 }
        );
    }
}

// Start a new batch operation
export async function POST(request) {
    try {
        // Initialize database if needed
        await db.init();
        
        logger.info('Starting batch operation...');

        // Ensure all tables exist
        await ensureBatchOperationsTable();
        await ensureKeywordSearchTable();

        let body;
        try {
            body = await request.json();
            logger.info(`Received batch request with body: ${JSON.stringify(body)}`);
        } catch (parseError) {
            logger.error(`Error parsing request JSON: ${parseError.message}`);
            return NextResponse.json(
                { error: 'Invalid JSON in request body' },
                { status: 400 }
            );
        }

        const { states, searchTerm, wait, maxResults, topCitiesPerState = 10 } = body;

        // Validate required parameters
        if (!searchTerm) {
            logger.error('Search term is required');
            return NextResponse.json(
                { error: 'Search term is required' },
                { status: 400 }
            );
        }

        if (!states || !Array.isArray(states) || states.length === 0) {
            logger.error('At least one state must be selected');
            return NextResponse.json(
                { error: 'At least one state must be selected' },
                { status: 400 }
            );
        }

        // Log current batch status (but allow multiple batches to run)
        const batchStatus = scraperService.getBatchStatus();
        logger.info(`Current batch status: ${JSON.stringify(batchStatus)}`);

        // Note: We now allow multiple batches to run concurrently
        if (batchStatus.isRunning) {
            logger.info('A batch is already running, but allowing new batch to start');
        }

        // Create a batch ID
        const batchId = uuidv4();
        logger.info(`Generated batch ID: ${batchId}`);

        // Prepare cities for each state
        const batchTasks = [];
        let totalTasks = 0;
        
        // For each state, get the top cities
        for (const stateCode of states) {
            try {
                logger.info(`Getting top cities for state ${stateCode}`);
                const topCities = await db.getTopCitiesForState(stateCode, topCitiesPerState);
                
                totalTasks += topCities.length;
                
                // Add each city to the task list
                for (const cityData of topCities) {
                    batchTasks.push({
                        state: stateCode,
                        city: cityData.city,
                        searchTerm: `${searchTerm} in ${cityData.city}, ${stateCode}`
                    });
                }
                
                logger.info(`Added ${topCities.length} cities for state ${stateCode}`);
            } catch (error) {
                logger.error(`Error getting top cities for state ${stateCode}: ${error.message}`);
                // Continue with other states even if one fails
            }
        }
        
        if (batchTasks.length === 0) {
            logger.error('No cities found for the selected states');
            return NextResponse.json(
                { error: 'No cities found for the selected states' },
                { status: 400 }
            );
        }
        
        logger.info(`Created ${batchTasks.length} batch tasks for ${states.length} states`);
        
        // Store batch tasks for processing
        await storeTasksForBatch(batchId, batchTasks);
        
        // Start the batch with enhanced options
        const options = {
            batchId,
            wait: wait || 5000,
            maxResults: maxResults || 100,
            searchTerm,
            taskList: batchTasks
        };

        logger.info(`Starting batch with options: ${JSON.stringify(options)}`);
        let result;
        
        try {
            result = await scraperService.startBatch(states, options);
            logger.info(`Batch started successfully: ${JSON.stringify(result)}`);
        } catch (scraperError) {
            logger.error(`Scraper service error: ${scraperError.message}`);
            return NextResponse.json(
                { error: `Failed to start scraper service: ${scraperError.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({
            batchId: result.batchId || batchId,
            message: 'State-based batch operation started successfully',
            status: 'running',
            totalTasks: batchTasks.length,
            states: states
        });
    } catch (error) {
        logger.error(`Error starting batch operation: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to start batch operation', details: error.message },
            { status: 500 }
        );
    }
}

// Stop a running batch
export async function DELETE(request) {
    try {
        const result = await scraperService.stopBatch();
        return NextResponse.json({
            message: 'Batch operation stopped',
            ...result
        });
    } catch (error) {
        logger.error(`Error stopping batch operation: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to stop batch operation', details: error.message },
            { status: 500 }
        );
    }
}

/**
 * Ensure the batch_operations table exists
 */
async function ensureBatchOperationsTable() {
    try {
        // Check if table exists
        const tableExists = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'batch_operations'
            ) as exists
        `);

        if (!tableExists || !tableExists.exists) {
            logger.info('Creating batch_operations table');
            
            await db.query(`
                CREATE TABLE batch_operations (
                    id VARCHAR(36) PRIMARY KEY,
                    start_time TIMESTAMP NOT NULL DEFAULT NOW(),
                    end_time TIMESTAMP,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    total_tasks INTEGER NOT NULL DEFAULT 0,
                    completed_tasks INTEGER NOT NULL DEFAULT 0,
                    failed_tasks INTEGER NOT NULL DEFAULT 0,
                    states JSONB,
                    options JSONB
                )
            `);
            
            await db.query(`
                CREATE INDEX idx_batch_operations_status ON batch_operations(status);
            `);
            
            logger.info('batch_operations table created successfully');
        }
        
        // Check if batch_state_progress table exists
        const stateProgressExists = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'batch_state_progress'
            ) as exists
        `);
        
        if (!stateProgressExists || !stateProgressExists.exists) {
            logger.info('Creating batch_state_progress table');
            
            await db.query(`
                CREATE TABLE batch_state_progress (
                    id SERIAL PRIMARY KEY,
                    batch_id VARCHAR(36) NOT NULL REFERENCES batch_operations(id),
                    state VARCHAR(2) NOT NULL,
                    total_cities INTEGER NOT NULL DEFAULT 0,
                    completed_cities INTEGER NOT NULL DEFAULT 0,
                    failed_cities INTEGER NOT NULL DEFAULT 0,
                    last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
                    UNIQUE(batch_id, state)
                )
            `);
            
            logger.info('batch_state_progress table created successfully');
        }
        
        // Check if batch_task_failures table exists
        const taskFailuresExists = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'batch_task_failures'
            ) as exists
        `);
        
        if (!taskFailuresExists || !taskFailuresExists.exists) {
            logger.info('Creating batch_task_failures table');
            
            await db.query(`
                CREATE TABLE batch_task_failures (
                    id SERIAL PRIMARY KEY,
                    batch_id VARCHAR(36) NOT NULL REFERENCES batch_operations(id),
                    state VARCHAR(2) NOT NULL,
                    city VARCHAR(100),
                    error_message TEXT,
                    failure_time TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `);
            
            logger.info('batch_task_failures table created successfully');
        }
        
        return true;
    } catch (error) {
        logger.error(`Error ensuring batch tables: ${error.message}`);
        throw error;
    }
}

/**
 * Ensure the keyword_search_results table exists
 */
async function ensureKeywordSearchTable() {
    try {
        // Check if table exists
        const tableExists = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'keyword_search_results'
            ) as exists
        `);

        if (!tableExists || !tableExists.exists) {
            logger.info('Creating keyword_search_results table');

            await db.query(`
                CREATE TABLE keyword_search_results (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    address TEXT,
                    city VARCHAR(100),
                    state VARCHAR(100),
                    country VARCHAR(100),
                    postal_code VARCHAR(20),
                    phone VARCHAR(50),
                    email VARCHAR(255),
                    website VARCHAR(255),
                    domain VARCHAR(255),
                    rating NUMERIC(3,1),
                    keyword VARCHAR(255) NOT NULL,
                    search_location VARCHAR(255),
                    batch_id VARCHAR(36),
                    task_id VARCHAR(36),
                    business_type VARCHAR(100),
                    owner_name VARCHAR(255),
                    verified BOOLEAN DEFAULT FALSE,
                    contacted BOOLEAN DEFAULT FALSE,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Create helpful indexes
            await db.query(`
                CREATE INDEX idx_keyword_search_results_keyword ON keyword_search_results(keyword);
                CREATE INDEX idx_keyword_search_results_state ON keyword_search_results(state);
                CREATE INDEX idx_keyword_search_results_city ON keyword_search_results(city);
                CREATE INDEX idx_keyword_search_results_batch_id ON keyword_search_results(batch_id);
            `);

            logger.info('keyword_search_results table created successfully');
        }
    } catch (error) {
        logger.error(`Error ensuring keyword_search_results table: ${error.message}`);
        throw error;
    }
}

/**
 * Store batch tasks in the database for tracking
 */
async function storeTasksForBatch(batchId, tasks) {
    try {
        // Create batch_tasks table if it doesn't exist
        const tableExists = await db.getOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'batch_tasks'
            ) as exists
        `);

        if (!tableExists || !tableExists.exists) {
            logger.info('Creating batch_tasks table');
            
            await db.query(`
                CREATE TABLE batch_tasks (
                    id SERIAL PRIMARY KEY,
                    batch_id VARCHAR(36) NOT NULL,
                    state VARCHAR(2) NOT NULL,
                    city VARCHAR(100) NOT NULL,
                    search_term TEXT NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT NOW(),
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    businesses_found INTEGER DEFAULT 0,
                    error_message TEXT
                )
            `);
            
            await db.query(`
                CREATE INDEX idx_batch_tasks_batch_id ON batch_tasks(batch_id);
                CREATE INDEX idx_batch_tasks_status ON batch_tasks(status);
            `);
        }
        
        // Insert all tasks for this batch
        if (tasks.length > 0) {
            const values = tasks.map(task => 
                `('${batchId}', '${task.state}', '${task.city.replace(/'/g, "''")}', '${task.searchTerm.replace(/'/g, "''")}')`
            ).join(',');
            
            await db.query(`
                INSERT INTO batch_tasks (batch_id, state, city, search_term)
                VALUES ${values}
            `);
            
            logger.info(`Stored ${tasks.length} tasks for batch ${batchId}`);
        }
        
        return true;
    } catch (error) {
        logger.error(`Error storing batch tasks: ${error.message}`);
        throw error;
    }
}
