"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import SearchableSelect from '@/components/controls/SearchableSelect';

export default function ExportPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [categories, setCategories] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [excludedCategories, setExcludedCategories] = useState([]);
    const [states, setStates] = useState([]);
    const [stats, setStats] = useState(null);
    const [exportInProgress, setExportInProgress] = useState(false);
    const [lastExportResult, setLastExportResult] = useState(null);
    const [fetchingEstimate, setFetchingEstimate] = useState(false);
    const [exportEstimate, setExportEstimate] = useState(null);
    const router = useRouter();

    // Export options
    const [exportOptions, setExportOptions] = useState({
        type: 'all', // all, filtered, category, state, random
        hasEmail: null, // true, false, null (any)
        hasWebsite: null, // true, false, null (any)
        category: '',
        state: '',
        city: '',
        format: 'xlsx', // xlsx, csv
        minRating: null,
        contactLimit: 200, // Default is 200 per category
        randomEnabled: false,
        randomCategoryCount: 5,
        keywordsInput: ''
    });

    // Fetch categories, states and stats on component mount
    useEffect(() => {
        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                // Get categories
                const categoriesResponse = await fetch('/api/categories?limit=300');
                if (categoriesResponse.ok) {
                    const data = await categoriesResponse.json();
                    setCategories(data.categories || []);
                }

                // Get stats which includes states
                const statsResponse = await fetch('/api/stats');
                if (statsResponse.ok) {
                    const data = await statsResponse.json();
                    setStats(data);
                    if (data.states && Array.isArray(data.states)) {
                        setStates(data.states.sort());
                    }
                }
            } catch (error) {
                console.error('Error fetching data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialData();
    }, []);

    const addCategory = (category) => {
        if (!selectedCategories.includes(category)) {
            setSelectedCategories([...selectedCategories, category]);
        }
        setExportOptions(prev => ({ ...prev, category: '' }));
    };

    const removeCategory = (category) => {
        setSelectedCategories(selectedCategories.filter(c => c !== category));
    };

    const addExcludedCategory = (category) => {
        if (!excludedCategories.includes(category)) {
            setExcludedCategories([...excludedCategories, category]);
        }
    };

    const removeExcludedCategory = (category) => {
        setExcludedCategories(excludedCategories.filter(c => c !== category));
    };

    const handleOptionChange = (field, value) => {
        setExportOptions(prev => ({ ...prev, [field]: value }));
        // Reset the export estimate when options change
        setExportEstimate(null);
    };

    // Estimate how many records will be exported
    const estimateExport = useCallback(async () => {
        setFetchingEstimate(true);
        try {
            // Build the request body based on the current options
            const requestBody = buildExportRequest();

            // Call the check endpoint to get a count
            const response = await fetch('/api/export/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error('Failed to estimate export size');
            }

            const data = await response.json();
            setExportEstimate(data);
        } catch (error) {
            console.error('Error estimating export:', error);
            setExportEstimate({ error: error.message, count: 0 });
        } finally {
            setFetchingEstimate(false);
        }
    }, [exportOptions, selectedCategories, excludedCategories]);

    // Debounced estimate function
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!isLoading) {
                estimateExport();
            }
        }, 800);

        return () => clearTimeout(timer);
    }, [estimateExport, isLoading, exportOptions, selectedCategories, excludedCategories]);

    // Build the export request body based on current options
    const buildExportRequest = () => {
        const filter = {};

        // Add state if selected
        if (exportOptions.type === 'state' && exportOptions.state) {
            return { state: exportOptions.state };
        }

        // Add task ID if selected
        if (exportOptions.type === 'task' && exportOptions.taskId) {
            return { taskId: exportOptions.taskId };
        }

        // For random categories
        if (exportOptions.type === 'random' && exportOptions.randomEnabled) {
            return {
                randomCategories: true,
                randomCategoryCount: exportOptions.randomCategoryCount,
                excludeCategories: excludedCategories,
                filter: {
                    hasEmail: exportOptions.hasEmail,
                    hasWebsite: exportOptions.hasWebsite,
                    state: exportOptions.state || undefined,
                    city: exportOptions.city || undefined,
                    minRating: exportOptions.minRating ? parseFloat(exportOptions.minRating) : undefined,
                    keywords: exportOptions.keywordsInput || undefined
                }
            };
        }

        // Add category filter options
        if (exportOptions.type === 'category') {
            if (selectedCategories.length > 0) {
                filter.includeCategories = selectedCategories;
            }

            if (excludedCategories.length > 0) {
                filter.excludeCategories = excludedCategories;
            }

            if (exportOptions.category && !selectedCategories.includes(exportOptions.category)) {
                filter.searchTerm = exportOptions.category;
            }
        }

        // Add email/website filters
        if (exportOptions.hasEmail !== null) {
            filter.hasEmail = exportOptions.hasEmail;
        }

        if (exportOptions.hasWebsite !== null) {
            filter.hasWebsite = exportOptions.hasWebsite;
        }

        // Add state/city filters
        if (exportOptions.state) {
            filter.state = exportOptions.state;
        }

        if (exportOptions.city) {
            filter.city = exportOptions.city;
        }

        // Add rating filter
        if (exportOptions.minRating) {
            filter.minRating = parseFloat(exportOptions.minRating);
        }

        // Add keyword filtering
        if (exportOptions.keywordsInput) {
            filter.keywords = exportOptions.keywordsInput;
        }

        // Force unfiltered for "all" type or if there are no filters
        const forceUnfiltered = exportOptions.type === 'all';

        if (Object.keys(filter).length === 0 && !forceUnfiltered) {
            return { forceUnfiltered: true };
        }

        return {
            filter: Object.keys(filter).length > 0 ? filter : null,
            forceUnfiltered
        };
    };

    const startExport = async () => {
        try {
            setExportInProgress(true);
            setLastExportResult(null);

            // Ask for confirmation if the export is large
            if (exportEstimate && exportEstimate.count > 1000) {
                if (!confirm(`You are about to export ${exportEstimate.count} records. This might take a while. Continue?`)) {
                    setExportInProgress(false);
                    return;
                }
            }

            // Build the request
            const requestBody = buildExportRequest();

            // Make the API request
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.warning || 'Failed to export data');
            }

            const data = await response.json();

            // Store result for UI
            setLastExportResult({
                success: true,
                count: data.count,
                filename: data.filename,
                downloadUrl: data.downloadUrl,
                timestamp: new Date().toISOString()
            });

            // Open the download in a new tab
            window.open(data.downloadUrl, '_blank');

        } catch (error) {
            console.error('Export error:', error);
            setLastExportResult({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        } finally {
            setExportInProgress(false);
        }
    };

    const resetOptions = () => {
        setExportOptions({
            type: 'all',
            hasEmail: null,
            hasWebsite: null,
            category: '',
            state: '',
            city: '',
            format: 'xlsx',
            minRating: null,
            contactLimit: 200,
            randomEnabled: false,
            randomCategoryCount: 5,
            keywordsInput: ''
        });
        setSelectedCategories([]);
        setExcludedCategories([]);
        setLastExportResult(null);
        setExportEstimate(null);
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
                                <h1 className="text-3xl font-bold mb-1">Export Leads</h1>
                                <p className="text-gray-500">Create custom exports of your business leads</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button
                                    onClick={() => router.push('/leads')}
                                    className="btn btn-outline flex items-center px-4 py-2.5"
                                >
                                    <span className="material-icons mr-2 text-sm">arrow_back</span>
                                    Back to Leads
                                </button>

                                <button
                                    onClick={resetOptions}
                                    className="btn btn-outline flex items-center px-4 py-2.5"
                                >
                                    <span className="material-icons mr-2 text-sm">refresh</span>
                                    Reset Options
                                </button>
                            </div>
                        </div>

                        {/* Stats Panel */}
                        {stats && (
                            <div className="mb-6">
                                <div className="card p-4 bg-accent">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div>
                                            <div className="text-sm text-gray-500">Total Businesses</div>
                                            <div className="text-2xl font-bold">{stats.totalBusinesses?.toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div className="text-sm text-gray-500">With Emails</div>
                                            <div className="text-2xl font-bold text-primary">
                                                {stats.totalEmails?.toLocaleString()}
                                                <span className="text-sm ml-2">({stats.emailCoverage}%)</span>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-sm text-gray-500">With Websites</div>
                                            <div className="text-2xl font-bold text-secondary">
                                                {stats.totalWebsites?.toLocaleString()}
                                                <span className="text-sm ml-2">({stats.websiteCoverage}%)</span>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-sm text-gray-500">Categories</div>
                                            <div className="text-2xl font-bold">{stats.totalSearchTerms?.toLocaleString()}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                            {/* Export Options Panel */}
                            <div className="lg:col-span-2">
                                <div className="card p-5 hover:shadow-md transition">
                                    <h2 className="text-xl font-semibold mb-5 flex items-center">
                                        <span className="material-icons mr-3 text-primary">format_list_bulleted</span>
                                        Export Options
                                    </h2>

                                    {/* Export Type Selection */}
                                    <div className="mb-6">
                                        <label className="block text-sm font-medium mb-3">Export Type</label>
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                            <label className={`flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.type === 'all' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                <input
                                                    type="radio"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={exportOptions.type === 'all'}
                                                    onChange={() => handleOptionChange('type', 'all')}
                                                />
                                                <span className="text-sm">All Leads</span>
                                            </label>

                                            <label className={`flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.type === 'category' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                <input
                                                    type="radio"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={exportOptions.type === 'category'}
                                                    onChange={() => handleOptionChange('type', 'category')}
                                                />
                                                <span className="text-sm">By Category</span>
                                            </label>

                                            <label className={`flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.type === 'state' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                <input
                                                    type="radio"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={exportOptions.type === 'state'}
                                                    onChange={() => handleOptionChange('type', 'state')}
                                                />
                                                <span className="text-sm">By State</span>
                                            </label>

                                            <label className={`flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.type === 'random' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                <input
                                                    type="radio"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={exportOptions.type === 'random'}
                                                    onChange={() => handleOptionChange('type', 'random')}
                                                />
                                                <span className="text-sm">Random Categories</span>
                                            </label>

                                            <label className={`flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.type === 'task' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                <input
                                                    type="radio"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={exportOptions.type === 'task'}
                                                    onChange={() => handleOptionChange('type', 'task')}
                                                />
                                                <span className="text-sm">By Task</span>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Type-specific settings */}
                                    {exportOptions.type === 'category' && (
                                        <div className="mb-6">
                                            <label className="block text-sm font-medium mb-2">Select Categories</label>
                                            <div className="flex gap-2 mb-3">
                                                <div className="relative flex-1">
                                                    <SearchableSelect
                                                        placeholder="Search categories..."
                                                        value={exportOptions.category}
                                                        onChange={(value) => handleOptionChange('category', value)}
                                                        onSelect={(value) => {
                                                            if (value && !selectedCategories.includes(value)) {
                                                                addCategory(value);
                                                            }
                                                        }}
                                                        apiUrl="/api/categories"
                                                        minSearchLength={1}
                                                        maxItems={30}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-primary px-4 py-2"
                                                    onClick={() => {
                                                        if (exportOptions.category && !selectedCategories.includes(exportOptions.category)) {
                                                            addCategory(exportOptions.category);
                                                        }
                                                    }}
                                                >
                                                    Add
                                                </button>
                                            </div>

                                            {/* Selected Categories List */}
                                            {selectedCategories.length > 0 && (
                                                <div className="mb-3">
                                                    <div className="text-sm font-medium text-gray-700 mb-2">Selected Categories:</div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {selectedCategories.map(cat => (
                                                            <div key={cat} className="bg-primary-light text-primary px-3 py-1 rounded-full text-sm flex items-center">
                                                                <span>{cat}</span>
                                                                <button
                                                                    type="button"
                                                                    className="ml-2"
                                                                    onClick={() => removeCategory(cat)}
                                                                >
                                                                    <span className="material-icons text-xs">close</span>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {exportOptions.type === 'state' && (
                                        <div className="mb-6">
                                            <label className="block text-sm font-medium mb-2">Select State</label>
                                            <div className="relative">
                                                <select
                                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                    value={exportOptions.state || ''}
                                                    onChange={(e) => handleOptionChange('state', e.target.value)}
                                                >
                                                    <option value="">Choose a state...</option>
                                                    {states.map(state => (
                                                        <option key={state} value={state}>{state}</option>
                                                    ))}
                                                </select>
                                                <span className="material-icons absolute left-3 top-3 text-gray-400">map</span>
                                            </div>
                                        </div>
                                    )}

                                    {exportOptions.type === 'task' && (
                                        <div className="mb-6">
                                            <label className="block text-sm font-medium mb-2">Enter Task ID</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    placeholder="Task ID e.g., 49a1d5b3-6a7c..."
                                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                    value={exportOptions.taskId || ''}
                                                    onChange={(e) => handleOptionChange('taskId', e.target.value)}
                                                />
                                                <span className="material-icons absolute left-3 top-3 text-gray-400">task</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Task ID can be found in the URL when viewing a task.
                                            </p>
                                        </div>
                                    )}

                                    {exportOptions.type === 'random' && (
                                        <div className="mb-6">
                                            <div className="bg-accent p-4 rounded-lg mb-4">
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className="text-sm font-medium">Number of random categories</label>
                                                    <span className="text-primary font-semibold">{exportOptions.randomCategoryCount}</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="20"
                                                    step="1"
                                                    className="w-full accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                                    value={exportOptions.randomCategoryCount}
                                                    onChange={(e) => handleOptionChange('randomCategoryCount', parseInt(e.target.value))}
                                                />
                                                <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                    <span>1</span>
                                                    <span>10</span>
                                                    <span>20</span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-2">
                                                    The system will randomly select {exportOptions.randomCategoryCount} categories
                                                    from the database for exporting, excluding any categories specified below.
                                                </p>
                                            </div>

                                            {/* Exclude Categories for Random Mode */}
                                            <div className="mb-4">
                                                <label className="block text-sm font-medium mb-2">Exclude Categories</label>
                                                <div className="flex gap-2">
                                                    <div className="relative flex-1">
                                                        <select
                                                            className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                            value=""
                                                            onChange={(e) => {
                                                                if (e.target.value) {
                                                                    addExcludedCategory(e.target.value);
                                                                    e.target.value = '';
                                                                }
                                                            }}
                                                        >
                                                            <option value="">Choose categories to exclude...</option>
                                                            {categories
                                                                .filter(cat => !excludedCategories.includes(cat))
                                                                .map(cat => (
                                                                    <option key={cat} value={cat}>{cat}</option>
                                                                ))
                                                            }
                                                        </select>
                                                        <span className="material-icons absolute left-3 top-3 text-gray-400">block</span>
                                                    </div>
                                                </div>

                                                {/* Excluded Categories Tags */}
                                                {excludedCategories.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {excludedCategories.map(cat => (
                                                            <div key={cat} className="bg-error-light text-error px-3 py-1 rounded-full text-sm flex items-center">
                                                                <span>{cat}</span>
                                                                <button
                                                                    type="button"
                                                                    className="ml-2"
                                                                    onClick={() => removeExcludedCategory(cat)}
                                                                >
                                                                    <span className="material-icons text-xs">close</span>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="mb-4">
                                                <div className="flex justify-between text-sm font-medium mb-2">
                                                    <span>Contact Limit Per Category</span>
                                                    <span className="text-primary font-semibold">
                                                        {exportOptions.contactLimit >= 1000
                                                            ? `${(exportOptions.contactLimit / 1000).toFixed(0)}k`
                                                            : exportOptions.contactLimit}
                                                    </span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="1000"
                                                    max="50000"
                                                    step="1000"
                                                    className="w-full accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                                    value={exportOptions.contactLimit}
                                                    onChange={(e) => handleOptionChange('contactLimit', parseInt(e.target.value))}
                                                />
                                                <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                    <span>1k</span>
                                                    <span>25k</span>
                                                    <span>50k</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Additional Filters */}
                                    <div className="mb-6">
                                        <h3 className="text-md font-medium mb-4 border-b border-light pb-2">Additional Filters</h3>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                                            {/* Email Filter */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Email Status</label>
                                                <div className="relative">
                                                    <select
                                                        className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                        value={exportOptions.hasEmail === null ? '' : exportOptions.hasEmail.toString()}
                                                        onChange={(e) => {
                                                            if (e.target.value === '') {
                                                                handleOptionChange('hasEmail', null);
                                                            } else {
                                                                handleOptionChange('hasEmail', e.target.value === 'true');
                                                            }
                                                        }}
                                                    >
                                                        <option value="">All (with or without email)</option>
                                                        <option value="true">Has Email Address</option>
                                                        <option value="false">No Email Address</option>
                                                    </select>
                                                    <span className="material-icons absolute left-3 top-3 text-gray-400">email</span>
                                                </div>
                                            </div>

                                            {/* Website Filter */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Website Status</label>
                                                <div className="relative">
                                                    <select
                                                        className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                        value={exportOptions.hasWebsite === null ? '' : exportOptions.hasWebsite.toString()}
                                                        onChange={(e) => {
                                                            if (e.target.value === '') {
                                                                handleOptionChange('hasWebsite', null);
                                                            } else {
                                                                handleOptionChange('hasWebsite', e.target.value === 'true');
                                                            }
                                                        }}
                                                    >
                                                        <option value="">All (with or without website)</option>
                                                        <option value="true">Has Website</option>
                                                        <option value="false">No Website</option>
                                                    </select>
                                                    <span className="material-icons absolute left-3 top-3 text-gray-400">language</span>
                                                </div>
                                            </div>

                                            {/* City Filter */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">City</label>
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        placeholder="Filter by city..."
                                                        className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                        value={exportOptions.city || ''}
                                                        onChange={(e) => handleOptionChange('city', e.target.value)}
                                                    />
                                                    <span className="material-icons absolute left-3 top-3 text-gray-400">location_city</span>
                                                </div>
                                            </div>

                                            {/* State Filter */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">State</label>
                                                <div className="relative">
                                                    <select
                                                        className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                        value={exportOptions.state || ''}
                                                        onChange={(e) => handleOptionChange('state', e.target.value)}
                                                    >
                                                        <option value="">All States</option>
                                                        {states.map(state => (
                                                            <option key={state} value={state}>{state}</option>
                                                        ))}
                                                    </select>
                                                    <span className="material-icons absolute left-3 top-3 text-gray-400">map</span>
                                                </div>
                                            </div>

                                            {/* Minimum Rating Filter */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Minimum Rating</label>
                                                <div className="relative">
                                                    <select
                                                        className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                        value={exportOptions.minRating || ''}
                                                        onChange={(e) => handleOptionChange('minRating', e.target.value)}
                                                    >
                                                        <option value="">Any Rating</option>
                                                        <option value="4.5">4.5+ stars</option>
                                                        <option value="4">4+ stars</option>
                                                        <option value="3.5">3.5+ stars</option>
                                                        <option value="3">3+ stars</option>
                                                    </select>
                                                    <span className="material-icons absolute left-3 top-3 text-gray-400">star</span>
                                                </div>
                                            </div>

                                            {/* Keywords Input */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Keywords (comma separated)</label>
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        placeholder="organic, vegan, 24-hour..."
                                                        className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                        value={exportOptions.keywordsInput || ''}
                                                        onChange={(e) => handleOptionChange('keywordsInput', e.target.value)}
                                                    />
                                                    <span className="material-icons absolute left-3 top-3 text-gray-400">text_fields</span>
                                                </div>
                                            </div>

                                            {/* Format Selection */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Export Format</label>
                                                <div className="flex gap-3">
                                                    <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.format === 'xlsx' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                        <input
                                                            type="radio"
                                                            className="mr-2 accent-primary h-4 w-4"
                                                            checked={exportOptions.format === 'xlsx'}
                                                            onChange={() => handleOptionChange('format', 'xlsx')}
                                                        />
                                                        <span className="text-sm">Excel (XLSX)</span>
                                                    </label>

                                                    <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportOptions.format === 'csv' ? 'bg-primary-light' : 'bg-accent'}`}>
                                                        <input
                                                            type="radio"
                                                            className="mr-2 accent-primary h-4 w-4"
                                                            checked={exportOptions.format === 'csv'}
                                                            onChange={() => handleOptionChange('format', 'csv')}
                                                            disabled={true}
                                                        />
                                                        <span className="text-sm opacity-50">CSV (Coming soon)</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Export Button */}
                                    <div className="flex flex-col md:flex-row justify-between items-center pt-4 border-t border-light">
                                        <div className="text-sm text-gray-500 mb-4 md:mb-0">
                                            {exportEstimate && (
                                                <div className="flex items-center">
                                                    {fetchingEstimate ? (
                                                        <div className="flex items-center">
                                                            <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary mr-2"></span>
                                                            Estimating...
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <span className="material-icons mr-2 text-sm">analytics</span>
                                                            Expected records: <span className="font-bold">{exportEstimate.count?.toLocaleString() || 0}</span>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <button
                                            onClick={startExport}
                                            disabled={exportInProgress || (exportEstimate && exportEstimate.count === 0)}
                                            className="btn btn-primary px-6 py-2.5 flex items-center shadow-md hover:shadow-lg"
                                        >
                                            {exportInProgress ? (
                                                <>
                                                    <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                                                    Exporting...
                                                </>
                                            ) : (
                                                <>
                                                    <span className="material-icons mr-2">download</span>
                                                    Export Data
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Results and Information Panel */}
                            <div>
                                {/* Export Summary */}
                                <div className="card p-5 hover:shadow-md transition mb-6">
                                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                                        <span className="material-icons mr-3 text-primary">summarize</span>
                                        Export Summary
                                    </h2>

                                    {lastExportResult ? (
                                        <div className={`p-4 rounded-lg ${lastExportResult.success ? 'bg-success-light' : 'bg-error-light'}`}>
                                            {lastExportResult.success ? (
                                                <>
                                                    <div className="flex items-center text-success font-medium">
                                                        <span className="material-icons mr-2">check_circle</span>
                                                        Export Successful
                                                    </div>
                                                    <div className="mt-2 text-sm text-gray-700">
                                                        <div><span className="font-medium">Records:</span> {lastExportResult.count?.toLocaleString()}</div>
                                                        <div><span className="font-medium">File:</span> {lastExportResult.filename}</div>
                                                        <div><span className="font-medium">Time:</span> {new Date(lastExportResult.timestamp).toLocaleString()}</div>
                                                    </div>
                                                    <div className="mt-3">
                                                        <a
                                                            href={lastExportResult.downloadUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="btn btn-outline px-4 py-2 text-sm flex items-center w-full justify-center"
                                                        >
                                                            <span className="material-icons mr-2 text-sm">file_download</span>
                                                            Download Again
                                                        </a>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex items-center text-error font-medium">
                                                        <span className="material-icons mr-2">error</span>
                                                        Export Failed
                                                    </div>
                                                    <div className="mt-2 text-sm">
                                                        {lastExportResult.error}
                                                    </div>
                                                    <div className="mt-3">
                                                        <button
                                                            onClick={startExport}
                                                            className="btn btn-outline px-4 py-2 text-sm flex items-center w-full justify-center"
                                                            disabled={exportInProgress}
                                                        >
                                                            <span className="material-icons mr-2 text-sm">refresh</span>
                                                            Try Again
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-gray-500 text-sm p-4 bg-accent rounded-lg">
                                            <div className="flex items-center">
                                                <span className="material-icons mr-2">info</span>
                                                Configure export options and click "Export Data" to begin.
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Export Tips */}
                                <div className="card p-5 hover:shadow-md transition">
                                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                                        <span className="material-icons mr-3 text-primary">tips_and_updates</span>
                                        Export Tips
                                    </h2>

                                    <div className="space-y-4 text-sm">
                                        <div className="flex">
                                            <span className="material-icons text-primary mr-3">lightbulb</span>
                                            <div>
                                                <p className="font-medium">Export with Emails</p>
                                                <p className="text-gray-500">Select "Has Email Address" to export only records with emails for immediate outreach.</p>
                                            </div>
                                        </div>

                                        <div className="flex">
                                            <span className="material-icons text-primary mr-3">lightbulb</span>
                                            <div>
                                                <p className="font-medium">Export by State</p>
                                                <p className="text-gray-500">State-specific exports work well for targeted regional campaigns.</p>
                                            </div>
                                        </div>

                                        <div className="flex">
                                            <span className="material-icons text-primary mr-3">lightbulb</span>
                                            <div>
                                                <p className="font-medium">Random Categories</p>
                                                <p className="text-gray-500">Use random categories mode to discover new lead opportunities.</p>
                                            </div>
                                        </div>

                                        <div className="flex">
                                            <span className="material-icons text-primary mr-3">lightbulb</span>
                                            <div>
                                                <p className="font-medium">Large Exports</p>
                                                <p className="text-gray-500">For exports with over 10,000 records, consider using multiple smaller exports.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
