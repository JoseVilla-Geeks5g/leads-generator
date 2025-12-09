/**
 * Batch Service Module
 * Handles batch operations for scraping across multiple states/cities
 */

import { v4 as uuidv4 } from 'uuid';
import db from './database';
import logger from './logger';
import { ensureBrowser, scrapeBusinessesFromGoogleMaps } from './taskService';

// Batch state tracking
const batchState = {
    batchStatus: null,
    runningBatches: new Map()
};

/**
 * Get batch status
 * @param {string} batchId - Optional specific batch ID to get status for
 * @returns {Object} Current batch status
 */
function getBatchStatus(batchId = null) {
    if (!batchState.runningBatches) {
        batchState.runningBatches = new Map();
    }

    if (batchId && batchState.runningBatches.has(batchId)) {
        return batchState.runningBatches.get(batchId);
    }

    if (batchState.batchStatus) {
        return batchState.batchStatus;
    }

    return {
        isRunning: false,
        batchId: null,
        progress: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalTasks: 0
    };
}

/**
 * Get all running batches
 * @returns {Array} Array of running batch statuses
 */
function getAllRunningBatches() {
    if (!batchState.runningBatches) {
        batchState.runningBatches = new Map();
    }
    return Array.from(batchState.runningBatches.values()).filter(b => b.isRunning);
}

/**
 * Start a batch operation across multiple states
 * @param {Array} states - States to process (null for all)
 * @param {Object} options - Batch options
 * @returns {Promise<Object>} Batch info
 */
async function startBatch(states = null, options = {}) {
    if (!batchState.runningBatches) {
        batchState.runningBatches = new Map();
    }

    if (batchState.batchStatus?.isRunning) {
        logger.info('Another batch operation is already running, starting new batch anyway');
    }

    try {
        logger.info(`Starting batch for states: ${JSON.stringify(states)}`);
        await ensureBrowser();

        const batchId = options.batchId || uuidv4();
        const searchTerm = options.searchTerm || 'business';
        const wait = options.wait || 5000;
        const maxResults = options.maxResults || 100;
        const taskList = options.taskList || [];

        let statesArray = states;
        if (!statesArray || statesArray.length === 0) {
            const statesResult = await db.getMany(`
                SELECT DISTINCT state FROM business_listings WHERE state IS NOT NULL
                UNION
                SELECT unnest(ARRAY['CA','NY','TX','FL','IL','PA','OH','GA','NC','MI'])
                ORDER BY 1
            `);
            statesArray = statesResult.map(row => row.state);
        }

        await db.query(`
            INSERT INTO batch_operations
            (id, start_time, status, total_tasks, states)
            VALUES ($1, NOW(), $2, $3, $4)
        `, [batchId, 'running', taskList.length || statesArray.length, JSON.stringify(statesArray)]);

        const batchStatusObj = {
            isRunning: true,
            batchId,
            progress: 0,
            completedTasks: 0,
            failedTasks: 0,
            totalTasks: taskList.length || statesArray.length,
            currentState: null,
            currentCity: null,
            options: {
                searchTerm,
                wait,
                maxResults,
                contactLimit: options.maxResults || maxResults
            },
            taskList
        };

        batchState.batchStatus = batchStatusObj;
        batchState.runningBatches.set(batchId, batchStatusObj);

        logger.info(`Batch ${batchId} initialized with ${batchStatusObj.totalTasks} tasks`);

        processBatch(batchId, statesArray, {
            searchTerm,
            wait,
            maxResults,
            taskList
        }).catch(error => {
            logger.error(`Background batch processing error: ${error.message}`);
        });

        return {
            batchId,
            totalTasks: batchStatusObj.totalTasks
        };
    } catch (error) {
        logger.error(`Error starting batch: ${error.message}`);
        throw error;
    }
}

/**
 * Process a batch of states
 * @param {string} batchId - Batch ID
 * @param {Array} states - States to process
 * @param {Object} options - Processing options
 */
async function processBatch(batchId, states, options) {
    const getStatus = () => {
        if (batchState.runningBatches && batchState.runningBatches.has(batchId)) {
            return batchState.runningBatches.get(batchId);
        }
        return batchState.batchStatus;
    };

    try {
        for (const state of states) {
            const currentBatchStatus = getStatus();
            if (!currentBatchStatus?.isRunning) {
                logger.info(`Batch ${batchId} was stopped`);
                break;
            }

            currentBatchStatus.currentState = state;

            const taskList = options.taskList ? options.taskList.filter(task => task.state === state) : [];

            if (taskList.length === 0) {
                logger.info(`No cities found for state ${state}, skipping...`);
                continue;
            }

            await db.query(`
                INSERT INTO batch_state_progress
                (batch_id, state, total_cities, completed_cities, failed_cities, last_updated)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (batch_id, state)
                DO UPDATE SET
                  total_cities = $3,
                  last_updated = NOW()
            `, [
                batchId,
                state,
                taskList.length,
                0,
                0
            ]);

            for (const task of taskList) {
                const status = getStatus();
                if (!status?.isRunning) {
                    break;
                }

                const { city, searchTerm } = task;
                status.currentCity = city;

                try {
                    const taskId = uuidv4();
                    logger.info(`Processing city task: ${searchTerm} with ID ${taskId}`);

                    await db.query(`
                        INSERT INTO scraping_tasks
                        (id, search_term, status, created_at, location, params)
                        VALUES ($1, $2, $3, NOW(), $4, $5)
                    `, [
                        taskId,
                        searchTerm,
                        'running',
                        `${city}, ${state}`,
                        JSON.stringify({ batchId, state, city })
                    ]);

                    logger.info(`Actually scraping Google Maps for: ${searchTerm}`);
                    const businesses = await scrapeBusinessesFromGoogleMaps(taskId, options.searchTerm || 'Digital Marketing Agency', `${city}, ${state}`);

                    await db.query(`
                        UPDATE scraping_tasks
                        SET status = 'completed', completed_at = NOW(), businesses_found = $1
                        WHERE id = $2
                    `, [businesses || 0, taskId]);

                    const statusToUpdate = getStatus();
                    statusToUpdate.completedTasks += 1;
                    statusToUpdate.progress = (statusToUpdate.completedTasks / statusToUpdate.totalTasks) * 100;

                    await db.query(`
                        UPDATE batch_state_progress
                        SET completed_cities = completed_cities + 1, last_updated = NOW()
                        WHERE batch_id = $1 AND state = $2
                    `, [batchId, state]);

                    logger.info(`Completed city scraping: ${city}, ${state} - found ${businesses || 0} businesses`);

                    if (getStatus()?.isRunning) {
                        const waitTime = options.wait || 5000;
                        logger.info(`Waiting ${waitTime/1000} seconds before next city...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                } catch (error) {
                    logger.error(`Error processing city ${city} in state ${state}: ${error.message}`);
                    const statusToUpdate = getStatus();
                    statusToUpdate.failedTasks += 1;
                    statusToUpdate.progress = ((statusToUpdate.completedTasks + statusToUpdate.failedTasks) / statusToUpdate.totalTasks) * 100;

                    await db.query(`
                        UPDATE batch_state_progress
                        SET failed_cities = failed_cities + 1, last_updated = NOW()
                        WHERE batch_id = $1 AND state = $2
                    `, [batchId, state]);

                    await db.query(`
                        INSERT INTO batch_task_failures
                        (batch_id, state, city, error_message, failure_time)
                        VALUES ($1, $2, $3, $4, NOW())
                    `, [batchId, state, city, error.message]);
                }
            }
        }

        const finalStatus = getStatus();
        await db.query(`
            UPDATE batch_operations
            SET status = $1, end_time = NOW(), completed_tasks = $2, failed_tasks = $3
            WHERE id = $4
        `, [
            'completed',
            finalStatus.completedTasks,
            finalStatus.failedTasks,
            batchId
        ]);

        logger.info(`Batch ${batchId} completed. ${finalStatus.completedTasks} tasks completed, ${finalStatus.failedTasks} failed`);
        finalStatus.isRunning = false;

        if (batchState.runningBatches) {
            batchState.runningBatches.delete(batchId);
        }

        if (batchState.batchStatus?.batchId === batchId) {
            batchState.batchStatus = null;
        }
    } catch (error) {
        logger.error(`Batch processing error: ${error.message}`);

        const failedStatus = getStatus();
        await db.query(`
            UPDATE batch_operations
            SET status = 'failed', end_time = NOW(), completed_tasks = $1, failed_tasks = $2
            WHERE id = $3
        `, [
            failedStatus?.completedTasks || 0,
            failedStatus?.failedTasks || 1,
            batchId
        ]);

        if (batchState.runningBatches) {
            batchState.runningBatches.delete(batchId);
        }

        if (batchState.batchStatus?.batchId === batchId) {
            batchState.batchStatus = null;
        }
    }
}

/**
 * Stop running batch
 * @param {string} batchIdToStop - Optional specific batch ID to stop
 * @returns {Promise<Object>} Batch results
 */
async function stopBatch(batchIdToStop = null) {
    let batchToStop = null;

    if (batchIdToStop && batchState.runningBatches?.has(batchIdToStop)) {
        batchToStop = batchState.runningBatches.get(batchIdToStop);
    } else if (batchState.batchStatus?.isRunning) {
        batchToStop = batchState.batchStatus;
    }

    if (!batchToStop?.isRunning) {
        throw new Error('No batch is currently running');
    }

    const batchId = batchToStop.batchId;
    const completedTasks = batchToStop.completedTasks;
    const failedTasks = batchToStop.failedTasks;

    await db.query(`
        UPDATE batch_operations
        SET status = 'stopped', end_time = NOW(), completed_tasks = $1, failed_tasks = $2
        WHERE id = $3
    `, [completedTasks, failedTasks, batchId]);

    batchToStop.isRunning = false;

    if (batchState.runningBatches) {
        batchState.runningBatches.delete(batchId);
    }

    if (batchState.batchStatus?.batchId === batchId) {
        batchState.batchStatus.isRunning = false;
    }

    logger.info(`Batch ${batchId} manually stopped`);

    return {
        batchId,
        completedTasks,
        failedTasks,
        status: 'stopped'
    };
}

export {
    batchState,
    getBatchStatus,
    getAllRunningBatches,
    startBatch,
    processBatch,
    stopBatch
};

export default {
    batchState,
    getBatchStatus,
    getAllRunningBatches,
    startBatch,
    processBatch,
    stopBatch
};
