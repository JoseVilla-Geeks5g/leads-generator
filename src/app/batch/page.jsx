"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

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
    const [availableStates, setAvailableStates] = useState([]);
    const [stateDetails, setStateDetails] = useState({});
    const [showCities, setShowCities] = useState(false);
    const [databaseError, setDatabaseError] = useState(null);
    const [isSettingUpDatabase, setIsSettingUpDatabase] = useState(false);
    const [citiesLoaded, setCitiesLoaded] = useState(true);
    const [isPopulatingCities, setIsPopulatingCities] = useState(false);
    const router = useRouter();

    // List of US states with their 2-letter codes
    const statesList = [
        {code: 'AL', name: 'Alabama'},
        {code: 'AK', name: 'Alaska'},
        {code: 'AZ', name: 'Arizona'},
        {code: 'AR', name: 'Arkansas'},
        {code: 'CA', name: 'California'},
        {code: 'CO', name: 'Colorado'},
        {code: 'CT', name: 'Connecticut'},
        {code: 'DE', name: 'Delaware'},
        {code: 'FL', name: 'Florida'},
        {code: 'GA', name: 'Georgia'},
        {code: 'HI', name: 'Hawaii'},
        {code: 'ID', name: 'Idaho'},
        {code: 'IL', name: 'Illinois'},
        {code: 'IN', name: 'Indiana'},
        {code: 'IA', name: 'Iowa'},
        {code: 'KS', name: 'Kansas'},
        {code: 'KY', name: 'Kentucky'},
        {code: 'LA', name: 'Louisiana'},
        {code: 'ME', name: 'Maine'},
        {code: 'MD', name: 'Maryland'},
        {code: 'MA', name: 'Massachusetts'},
        {code: 'MI', name: 'Michigan'},
        {code: 'MN', name: 'Minnesota'},
        {code: 'MS', name: 'Mississippi'},
        {code: 'MO', name: 'Missouri'},
        {code: 'MT', name: 'Montana'},
        {code: 'NE', name: 'Nebraska'},
        {code: 'NV', name: 'Nevada'},
        {code: 'NH', name: 'New Hampshire'},
        {code: 'NJ', name: 'New Jersey'},
        {code: 'NM', name: 'New Mexico'},
        {code: 'NY', name: 'New York'},
        {code: 'NC', name: 'North Carolina'},
        {code: 'ND', name: 'North Dakota'},
        {code: 'OH', name: 'Ohio'},
        {code: 'OK', name: 'Oklahoma'},
        {code: 'OR', name: 'Oregon'},
        {code: 'PA', name: 'Pennsylvania'},
        {code: 'RI', name: 'Rhode Island'},
        {code: 'SC', name: 'South Carolina'},
        {code: 'SD', name: 'South Dakota'},
        {code: 'TN', name: 'Tennessee'},
        {code: 'TX', name: 'Texas'},
        {code: 'UT', name: 'Utah'},
        {code: 'VT', name: 'Vermont'},
        {code: 'VA', name: 'Virginia'},
        {code: 'WA', name: 'Washington'},
        {code: 'WV', name: 'West Virginia'},
        {code: 'WI', name: 'Wisconsin'},
        {code: 'WY', name: 'Wyoming'}
    ];

    useEffect(() => {
        // Initialize system, fetch batches, and check for active batch
        initializeSystem();
        fetchBatches();
        setAvailableStates(statesList);
        fetchStateDetails();
        checkActiveBatch();

        // Clean up interval on component unmount
        return () => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        };
    }, []);

    const initializeSystem = async () => {
        try {
            setLoading(true);
            
            // Use the API to check database status instead of direct db access
            const dbResponse = await fetch('/api/database/status');
            
            if (!dbResponse.ok) {
                throw new Error('Database connection failed');
            }
            
            // Then check if city data is loaded
            const citiesResponse = await fetch('/api/batch/states');
            
            if (citiesResponse.ok) {
                const data = await citiesResponse.json();
                setStateDetails(data);
                
                // Check if we have city data
                const anyState = Object.keys(data)[0];
                if (anyState && (!data[anyState]?.cities || data[anyState].cities.length === 0)) {
                    setCitiesLoaded(false);
                }
            } else {
                // If API fails, create database tables
                await setupDatabase();
            }
        } catch (error) {
            console.error('System initialization error:', error);
            setDatabaseError('System initialization failed. Try using the Setup Database button.');
        } finally {
            setLoading(false);
        }
    };

    const setupDatabase = async () => {
        try {
            setIsSettingUpDatabase(true);
            
            // Create an API route to setup database tables
            const response = await fetch('/api/database/setup');
            
            if (response.ok) {
                const result = await response.json();
                
                if (result.success) {
                    setDatabaseError(null);
                    // Now check if city data exists
                    await populateCityData();
                    // Reload page data
                    fetchBatches();
                    fetchStateDetails();
                    alert("Database setup completed successfully!");
                } else {
                    setDatabaseError(`Setup completed with errors: ${result.errors.join(', ')}`);
                }
            } else {
                const error = await response.text();
                setDatabaseError(`Database setup failed: ${error}`);
            }
        } catch (error) {
            setDatabaseError(`Error setting up database: ${error.message}`);
        } finally {
            setIsSettingUpDatabase(false);
        }
    };

    const fetchStateDetails = async () => {
        try {
            const response = await fetch('/api/batch/states');
            
            if (response.ok) {
                const data = await response.json();
                setStateDetails(data);
                
                // Check if we have city data
                const anyState = Object.keys(data)[0];
                if (anyState && (!data[anyState]?.cities || data[anyState].cities.length === 0)) {
                    setCitiesLoaded(false);
                } else {
                    setCitiesLoaded(true);
                }
            } else {
                // Handle database structure errors
                const error = await response.text();
                if (error.includes('does not exist')) {
                    setDatabaseError('Database tables missing. Click "Setup Database" to fix.');
                }
                setCitiesLoaded(false);
            }
        } catch (error) {
            console.error('Error fetching state details:', error);
            if (error.message?.includes('does not exist')) {
                setDatabaseError('Database tables missing. Click "Setup Database" to fix.');
            }
            setCitiesLoaded(false);
        }
    };

    const populateCityData = async () => {
        try {
            setIsPopulatingCities(true);
            const response = await fetch('/api/batch/states/populate');
            
            if (response.ok) {
                const result = await response.json();
                alert(`Successfully populated city data: ${result.count} cities added.`);
                setCitiesLoaded(true);
                
                // Refresh state details
                fetchStateDetails();
            } else {
                alert('Failed to populate city data.');
            }
        } catch (error) {
            console.error('Error populating city data:', error);
            alert(`Error populating city data: ${error.message}`);
        } finally {
            setIsPopulatingCities(false);
        }
    };

    const fetchBatches = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/batch');

            if (response.ok) {
                const data = await response.json();
                setBatches(data || []);
                
                // Check for any running batch
                const runningBatch = data?.find(batch => batch.status === 'running');
                if (runningBatch) {
                    setIsRunning(true);
                    setActiveBatch(runningBatch);
                    startPolling(runningBatch.id);
                }
            } else {
                console.error('Failed to fetch batches');
            }
        } catch (error) {
            console.error('Error fetching batches:', error);
        } finally {
            setLoading(false);
        }
    };

    const checkActiveBatch = async () => {
        try {
            const response = await fetch('/api/batch');

            if (response.ok) {
                const data = await response.json();
                
                // Check for active batch
                const runningBatch = data?.find(batch => batch.status === 'running');
                
                if (runningBatch) {
                    setIsRunning(true);
                    setActiveBatch(runningBatch);
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
                
                // Calculate progress
                if (data.total_tasks > 0) {
                    const progress = ((data.completed_tasks + data.failed_tasks) / data.total_tasks) * 100;
                    setBatchProgress(progress);
                }
                
                // Stop polling if batch is complete or stopped
                if (['completed', 'failed', 'stopped'].includes(data.status)) {
                    setIsRunning(false);
                    stopPolling();
                    fetchBatches(); // Refresh list of batches
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
            const stateToAdd = availableStates[selectedStateIndex].code;
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
        setSelectedStates(availableStates.map(state => state.code));
    };

    const clearAllStates = () => {
        setSelectedStates([]);
    };

    const startBatch = async () => {
        if (!searchTerm) {
            alert('Please enter a search term');
            return;
        }

        if (selectedStates.length === 0) {
            alert('Please select at least one state');
            return;
        }

        try {
            setIsStarting(true);

            // Log request details for debugging purposes
            console.log(`Starting batch with search term: ${searchTerm}`);
            console.log(`Selected states: ${selectedStates.join(', ')}`);
            console.log(`Wait time: ${waitTime} seconds, Max results: ${maxResults}`);

            const response = await fetch('/api/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    searchTerm,
                    states: selectedStates,
                    wait: waitTime * 1000,
                    maxResults,
                    topCitiesPerState: 10 // Always use top 10 cities per state
                })
            });

            if (!response.ok) {
                // Try to get error details from the response
                let errorMessage;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorData.details || `Error ${response.status}: ${response.statusText}`;
                } catch {
                    errorMessage = `Error ${response.status}: ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();

            setIsRunning(true);
            setActiveBatch({
                id: data.batchId,
                status: 'running',
                totalTasks: data.totalTasks || selectedStates.length * 10,
                completedTasks: 0,
                failedTasks: 0,
                searchTerm
            });

            setBatchProgress(0);
            startPolling(data.batchId);
            
            console.log("Batch started successfully:", data);
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

            if (response.ok) {
                stopPolling();
                setIsRunning(false);
                fetchBatches();
            } else {
                alert('Failed to stop batch');
            }
        } catch (error) {
            console.error('Error stopping batch:', error);
        }
    };

    // Render the page UI
    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex flex-col md:flex-row items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl font-bold mb-1">State-Based Batch Scraping</h1>
                                <p className="text-gray-500">Search for businesses in the top 10 cities of each selected state</p>
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

                        {databaseError && (
                            <div className="card p-6 mb-6 bg-error-light border-2 border-error">
                                <h2 className="text-xl font-semibold mb-3 text-error flex items-center">
                                    <span className="material-icons mr-2">warning</span>
                                    Database Setup Required
                                </h2>
                                <p className="mb-4">{databaseError}</p>
                                <button
                                    onClick={setupDatabase}
                                    disabled={isSettingUpDatabase}
                                    className="btn btn-primary"
                                >
                                    {isSettingUpDatabase ? (
                                        <>
                                            <span className="animate-spin material-icons mr-2">refresh</span>
                                            Setting Up Database...
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-icons mr-2">build</span>
                                            Setup Database
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {!citiesLoaded && !databaseError && (
                            <div className="card p-6 mb-6 bg-warning-light border-2 border-warning">
                                <h2 className="text-xl font-semibold mb-3 text-warning flex items-center">
                                    <span className="material-icons mr-2">info</span>
                                    City Data Required
                                </h2>
                                <p className="mb-4">The city data needs to be populated before you can use state-based searching.</p>
                                <button
                                    onClick={populateCityData}
                                    disabled={isPopulatingCities}
                                    className="btn btn-primary"
                                >
                                    {isPopulatingCities ? (
                                        <>
                                            <span className="animate-spin material-icons mr-2">refresh</span>
                                            Populating City Data...
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-icons mr-2">map</span>
                                            Populate City Data
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {isRunning && activeBatch && (
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
                                        <p>Currently processing: <strong>{activeBatch.searchTerm} in {activeBatch.currentCity}, {activeBatch.currentState}</strong></p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="card p-6 mb-6">
                                <h2 className="text-xl font-semibold mb-5 flex items-center">
                                    <span className="material-icons mr-3 text-primary">batch_prediction</span>
                                    Create State-Based Batch
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
                                        <p className="text-xs text-gray-500 mt-1">This keyword will be searched in the top 10 cities of each selected state</p>
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
                                                {availableStates.map((state, index) => (
                                                    <option key={state.code} value={index}>
                                                        {state.name} ({state.code})
                                                    </option>
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
                                            {selectedStates.map(stateCode => {
                                                const stateName = statesList.find(s => s.code === stateCode)?.name || stateCode;
                                                return (
                                                    <div key={stateCode} className="bg-secondary-light text-secondary px-3 py-1.5 rounded-full text-sm flex items-center">
                                                        <span>{stateName} ({stateCode})</span>
                                                        <button
                                                            className="ml-2"
                                                            onClick={() => removeState(stateCode)}
                                                        >
                                                            <span className="material-icons text-xs">close</span>
                                                        </button>
                                                    </div>
                                                );
                                            })}

                                            {selectedStates.length === 0 && (
                                                <div className="text-sm text-gray-500">Select states to process. At least one state is required.</div>
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
                                            <button
                                                onClick={() => setShowCities(!showCities)}
                                                className="text-sm text-primary hover:underline ml-auto"
                                            >
                                                {showCities ? 'Hide City List' : 'Show City List'}
                                            </button>
                                        </div>
                                        
                                        {/* City list preview */}
                                        {showCities && selectedStates.length > 0 && (
                                            <div className="mt-4 p-4 border border-dashed border-light rounded-md">
                                                <h3 className="text-sm font-semibold mb-2">Top 10 Cities to Process:</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {selectedStates.map(stateCode => {
                                                        const stateName = statesList.find(s => s.code === stateCode)?.name || stateCode;
                                                        return (
                                                            <div key={stateCode} className="mb-3">
                                                                <div className="font-medium text-sm">{stateName} ({stateCode})</div>
                                                                <ol className="list-decimal text-xs text-gray-600 pl-5 pt-1">
                                                                    {stateDetails[stateCode]?.cities?.slice(0, 10).map(city => (
                                                                        <li key={city}>{city}</li>
                                                                    ))}
                                                                </ol>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
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
                                            disabled={isStarting || !searchTerm || selectedStates.length === 0 || !citiesLoaded || databaseError}
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
                                            This will search for businesses in the 10 most populated cities of each selected state
                                        </p>
                                    </div>
                                </div>
                            </div>

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
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Search Term</th>
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
                                                    <td className="px-4 py-3.5">{batch.searchTerm || "Unknown"}</td>
                                                    <td className="px-4 py-3.5">{new Date(batch.start_time).toLocaleString()}</td>
                                                    <td className="px-4 py-3.5">
                                                        {batch.end_time
                                                            ? new Date(batch.end_time).toLocaleString()
                                                            : '-'
                                                        }
                                                    </td>
                                                    <td className="px-4 py-3.5">
                                                        {(batch.completed_tasks || 0) + (batch.failed_tasks || 0)}/{batch.total_tasks || 0}
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
