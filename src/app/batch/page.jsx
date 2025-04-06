"use client";

import React, { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

export default function BatchPage() {
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeBatch, setActiveBatch] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStates, setSelectedStates] = useState([]);
    const [waitTime, setWaitTime] = useState(10);
    const [maxResults, setMaxResults] = useState(100);
    const [isRunning, setIsRunning] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [stateOptions, setStateOptions] = useState([]);
    const [selectedStateIndex, setSelectedStateIndex] = useState(-1);
    const [refreshInterval, setRefreshInterval] = useState(null);
    const [batchProgress, setBatchProgress] = useState(0);

    // List of US states
    const statesList = [
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
    ];

    useEffect(() => {
        fetchBatches();
        fetchStates();

        // Check if there's an active batch running
        checkActiveBatch();

        return () => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        };
    }, []);

    const fetchBatches = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/batch');

            if (response.ok) {
                const data = await response.json();
                setBatches(data);
            }
        } catch (error) {
            console.error('Error fetching batches:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchStates = async () => {
        try {
            const response = await fetch('/api/stats');

            if (response.ok) {
                const data = await response.json();
                if (data.states && data.states.length > 0) {
                    setStateOptions(data.states);
                } else {
                    setStateOptions(statesList);
                }
            }
        } catch (error) {
            console.error('Error fetching states:', error);
            setStateOptions(statesList);
        }
    };

    const checkActiveBatch = async () => {
        try {
            const response = await fetch('/api/batch');

            if (response.ok) {
                const data = await response.json();

                // Find any running batch
                const runningBatch = data.find(batch => batch.status === 'running');

                if (runningBatch) {
                    await getBatchStatus(runningBatch.id);
                    setIsRunning(true);
                    startPolling(runningBatch.id);
                }
            }
        } catch (error) {
            console.error('Error checking active batch:', error);
        }
    };

    const getBatchStatus = async (batchId) => {
        try {
            const response = await fetch(`/api/batch?id=${batchId}`);

            if (response.ok) {
                const data = await response.json();
                setActiveBatch(data);

                if (data.totalTasks > 0) {
                    const progress = ((data.completedTasks + data.failedTasks) / data.totalTasks) * 100;
                    setBatchProgress(progress);
                }

                // If the batch is no longer running, stop polling
                if (data.status !== 'running') {
                    setIsRunning(false);
                    stopPolling();
                    await fetchBatches();
                }
            }
        } catch (error) {
            console.error('Error getting batch status:', error);
        }
    };

    const startPolling = (batchId) => {
        if (refreshInterval) {
            clearInterval(refreshInterval);
        }

        const interval = setInterval(() => {
            getBatchStatus(batchId);
        }, 3000);

        setRefreshInterval(interval);
    };

    const stopPolling = () => {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            setRefreshInterval(null);
        }
    };

    const addState = () => {
        if (selectedStateIndex >= 0) {
            const stateToAdd = stateOptions[selectedStateIndex];
            if (!selectedStates.includes(stateToAdd)) {
                setSelectedStates([...selectedStates, stateToAdd]);
            }
            setSelectedStateIndex(-1);
        }
    };

    const removeState = (state) => {
        setSelectedStates(selectedStates.filter(s => s !== state));
    };

    const selectAllStates = () => {
        setSelectedStates([...stateOptions]);
    };

    const clearAllStates = () => {
        setSelectedStates([]);
    };

    const startBatch = async () => {
        if (!searchTerm) {
            alert('Please enter a search term');
            return;
        }

        try {
            setIsStarting(true);

            const response = await fetch('/api/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    searchTerm,
                    states: selectedStates.length > 0 ? selectedStates : null,
                    wait: waitTime * 1000, // Convert to milliseconds
                    maxResults
                })
            });

            if (!response.ok) {
                throw new Error('Failed to start batch');
            }

            const data = await response.json();

            setIsRunning(true);
            setActiveBatch({
                id: data.batchId,
                status: 'running',
                totalTasks: data.totalTasks,
                completedTasks: 0,
                failedTasks: 0
            });

            setBatchProgress(0);
            startPolling(data.batchId);
        } catch (error) {
            console.error('Error starting batch:', error);
            alert(`Error starting batch: ${error.message}`);
        } finally {
            setIsStarting(false);
        }
    };

    const stopBatch = async () => {
        if (!confirm('Are you sure you want to stop the current batch?')) {
            return;
        }

        try {
            const response = await fetch('/api/batch', {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to stop batch');
            }

            setIsRunning(false);
            stopPolling();
            await fetchBatches();
        } catch (error) {
            console.error('Error stopping batch:', error);
            alert(`Error stopping batch: ${error.message}`);
        }
    };

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex flex-col md:flex-row items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl font-bold mb-1">Batch Processing</h1>
                                <p className="text-gray-500">Process multiple scraping tasks across states or regions</p>
                            </div>

                            {isRunning && (
                                <button
                                    onClick={stopBatch}
                                    className="btn btn-error px-4 py-2.5 shadow-md hover:shadow-lg"
                                >
                                    <span className="material-icons mr-2 text-sm">stop</span>
                                    Stop Batch
                                </button>
                            )}
                        </div>

                        {isRunning && activeBatch ? (
                            <div className="card p-6 mb-6">
                                <h2 className="text-xl font-semibold mb-5 flex items-center">
                                    <span className="material-icons mr-3 text-primary animate-pulse">pending</span>
                                    Active Batch Process
                                </h2>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                    <div className="card p-4 bg-primary-light">
                                        <div className="text-sm font-medium text-gray-600">Batch ID</div>
                                        <div className="text-xl font-semibold text-primary mt-1">{activeBatch.id?.substring(0, 8)}...</div>
                                    </div>

                                    <div className="card p-4 bg-secondary-light">
                                        <div className="text-sm font-medium text-gray-600">Total Tasks</div>
                                        <div className="text-xl font-semibold text-secondary mt-1">{activeBatch.totalTasks || 0}</div>
                                    </div>

                                    <div className="card p-4 bg-success-light">
                                        <div className="text-sm font-medium text-gray-600">Completed</div>
                                        <div className="text-xl font-semibold text-success mt-1">
                                            {activeBatch.completedTasks || 0}
                                            <span className="text-sm ml-1 text-gray-500">
                                                ({activeBatch.failedTasks || 0} failed)
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-6">
                                    <div className="flex justify-between mb-2">
                                        <span className="text-sm font-medium">Progress</span>
                                        <span className="text-sm font-medium">{batchProgress.toFixed(0)}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                                        <div
                                            className="bg-primary h-2.5 rounded-full"
                                            style={{ width: `${batchProgress}%` }}
                                        ></div>
                                    </div>
                                </div>

                                {activeBatch.currentState && activeBatch.currentCity && (
                                    <div className="text-center py-3 px-4 bg-accent rounded-md">
                                        <p>Currently processing: <strong>{activeBatch.currentCity}, {activeBatch.currentState}</strong></p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="card p-6 mb-6">
                                <h2 className="text-xl font-semibold mb-5 flex items-center">
                                    <span className="material-icons mr-3 text-primary">batch_prediction</span>
                                    Create Batch Process
                                </h2>

                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium mb-2">Search Term</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Dentists, Restaurants, Law Firms..."
                                            className="w-full p-3 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">This term will be used for all searches in the batch</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">States to Process</label>

                                        <div className="flex gap-3 items-center mb-3">
                                            <select
                                                className="flex-1 p-3 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={selectedStateIndex}
                                                onChange={e => setSelectedStateIndex(parseInt(e.target.value))}
                                            >
                                                <option value="-1">Select a state...</option>
                                                {stateOptions.map((state, index) => (
                                                    <option key={state} value={index}>{state}</option>
                                                ))}
                                            </select>

                                            <button
                                                onClick={addState}
                                                disabled={selectedStateIndex < 0}
                                                className="btn btn-primary py-3 px-4"
                                            >
                                                Add
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap gap-2 mb-3">
                                            {selectedStates.map(state => (
                                                <div key={state} className="bg-secondary-light text-secondary px-3 py-1.5 rounded-full text-sm flex items-center">
                                                    <span>{state}</span>
                                                    <button
                                                        className="ml-2"
                                                        onClick={() => removeState(state)}
                                                    >
                                                        <span className="material-icons text-xs">close</span>
                                                    </button>
                                                </div>
                                            ))}

                                            {selectedStates.length === 0 && (
                                                <div className="text-sm text-gray-500">No states selected. If none are selected, all states will be processed.</div>
                                            )}
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={selectAllStates}
                                                className="text-sm text-secondary hover:underline"
                                            >
                                                Select All
                                            </button>
                                            <button
                                                onClick={clearAllStates}
                                                className="text-sm text-gray-500 hover:underline"
                                            >
                                                Clear All
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Wait Time Between Tasks (seconds)</label>
                                            <input
                                                type="range"
                                                min="5"
                                                max="60"
                                                value={waitTime}
                                                onChange={e => setWaitTime(parseInt(e.target.value))}
                                                className="w-full accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                            />
                                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                <span>5s</span>
                                                <span className="font-medium text-primary">{waitTime}s</span>
                                                <span>60s</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">Longer wait times are safer but slower</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Max Results Per City</label>
                                            <input
                                                type="number"
                                                value={maxResults}
                                                onChange={e => setMaxResults(parseInt(e.target.value))}
                                                min="10"
                                                max="500"
                                                className="w-full p-3 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Maximum number of results to collect per city</p>
                                        </div>
                                    </div>

                                    <div className="pt-6 border-t border-light">
                                        <button
                                            onClick={startBatch}
                                            disabled={isStarting || !searchTerm}
                                            className="btn btn-primary px-6 py-3 shadow-md hover:shadow-lg"
                                        >
                                            {isStarting ? (
                                                <>
                                                    <span className="animate-spin material-icons mr-2">refresh</span>
                                                    Starting...
                                                </>
                                            ) : (
                                                <>
                                                    <span className="material-icons mr-2">play_arrow</span>
                                                    Start Batch
                                                </>
                                            )}
                                        </button>
                                        <p className="text-sm text-gray-500 mt-4">
                                            <span className="material-icons text-xs text-warning align-middle mr-1">warning</span>
                                            Batch processing may take a long time depending on the number of states selected
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="card p-6">
                            <h2 className="text-xl font-semibold mb-5 flex items-center">
                                <span className="material-icons mr-3 text-secondary">history</span>
                                Batch History
                            </h2>

                            {loading ? (
                                <div className="animate-pulse space-y-4">
                                    {[...Array(3)].map((_, i) => (
                                        <div key={i} className="h-20 bg-gray-100 rounded-lg"></div>
                                    ))}
                                </div>
                            ) : batches.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">ID</th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Start Time</th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">End Time</th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Tasks</th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-light">
                                            {batches.map(batch => (
                                                <tr key={batch.id} className="hover:bg-accent transition">
                                                    <td className="px-4 py-3.5 font-medium text-primary">{batch.id.substring(0, 8)}...</td>
                                                    <td className="px-4 py-3.5">{new Date(batch.start_time).toLocaleString()}</td>
                                                    <td className="px-4 py-3.5">
                                                        {batch.end_time
                                                            ? new Date(batch.end_time).toLocaleString()
                                                            : '-'
                                                        }
                                                    </td>
                                                    <td className="px-4 py-3.5">
                                                        {batch.completed_tasks + batch.failed_tasks}/{batch.total_tasks}
                                                    </td>
                                                    <td className="px-4 py-3.5">
                                                        <StatusBadge status={batch.status} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="p-8 text-center text-gray-500 border border-dashed border-gray-200 rounded-lg">
                                    <span className="material-icons text-4xl mb-2">history</span>
                                    <p>No batch operations found. Start a batch to see history.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

function StatusBadge({ status }) {
    let bgColor = '';
    let textColor = '';

    switch (status) {
        case 'completed':
            bgColor = 'bg-success-light';
            textColor = 'text-success';
            break;
        case 'running':
            bgColor = 'bg-primary-light';
            textColor = 'text-primary';
            break;
        case 'failed':
            bgColor = 'bg-error-light';
            textColor = 'text-error';
            break;
        case 'stopped':
            bgColor = 'bg-warning-light';
            textColor = 'text-warning';
            break;
        default:
            bgColor = 'bg-gray-100';
            textColor = 'text-gray-700';
    }

    return (
        <span className={`px-2.5 py-1 ${bgColor} ${textColor} rounded-full text-xs font-medium`}>
            {status}
        </span>
    );
}
