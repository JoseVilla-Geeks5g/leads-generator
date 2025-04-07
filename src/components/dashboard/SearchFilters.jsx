"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SearchableSelect from '@/components/controls/SearchableSelect';

export default function SearchFilters() {
    // Enhanced search configuration
    const [category, setCategory] = useState('');
    const [location, setLocation] = useState('');
    const [searchRadius, setSearchRadius] = useState(10);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [excludedCategories, setExcludedCategories] = useState([]);
    // Update the contact limit default and range
    const [contactLimit, setContactLimit] = useState(5000);
    const [advancedMode, setAdvancedMode] = useState(false);
    const [keywordsInput, setKeywordsInput] = useState('');
    const [availableCategories, setAvailableCategories] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lastSearch, setLastSearch] = useState(null);

    // New options
    const [useRandomCategories, setUseRandomCategories] = useState(false);
    const [randomCategoryCount, setRandomCategoryCount] = useState(5);
    const [searchMode, setSearchMode] = useState('specific'); // 'specific', 'random'

    const router = useRouter();

    const dataOptions = {
        'Contact Info': ['Phone Numbers', 'Email Addresses', 'Physical Address', 'Website'],
        'Business Details': ['Opening Hours', 'Ratings', 'Reviews', 'Images', 'Social Profiles']
    };

    const [selectedData, setSelectedData] = useState({
        'Phone Numbers': true,
        'Email Addresses': true,
        'Physical Address': true,
        'Website': true,
        'Opening Hours': true,
        'Ratings': true,
        'Reviews': false,
        'Images': false,
        'Social Profiles': true
    });

    const categoryInputRef = useRef(null);
    const searchCacheRef = useRef({});

    // Try to load previous search parameters from localStorage
    useEffect(() => {
        try {
            const savedSearch = localStorage.getItem('last_search');
            if (savedSearch) {
                const searchData = JSON.parse(savedSearch);
                if (searchData) {
                    setLastSearch(searchData);

                    // Auto-fill last search if user wants to
                    const autoFill = confirm("Do you want to load your last search parameters?");
                    if (autoFill) {
                        setCategory(searchData.category || '');
                        setLocation(searchData.location || '');
                        setSearchRadius(searchData.searchRadius || 10);
                        setSelectedCategories(searchData.selectedCategories || []);
                        setExcludedCategories(searchData.excludedCategories || []);
                        setContactLimit(searchData.contactLimit || 100);
                        setKeywordsInput(searchData.keywords || '');
                        setSearchMode(searchData.searchMode || 'specific');
                        setRandomCategoryCount(searchData.randomCategoryCount || 5);
                    }
                }
            }
        } catch (error) {
            console.error("Error loading previous search", error);
        }
    }, []);

    // Fetch categories on component mount
    useEffect(() => {
        fetchAllCategories();
    }, []);

    // Debounced category search
    const debounceCategorySearch = useCallback((searchTerm, callback) => {
        clearTimeout(debounceCategorySearch.timer);
        debounceCategorySearch.timer = setTimeout(() => {
            callback(searchTerm);
        }, 300);
    }, []);

    // Fetch all categories from database
    const fetchAllCategories = async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/categories?limit=500');

            if (response.ok) {
                const data = await response.json();
                setAvailableCategories(data.categories || []);
            }
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Fetch categories with caching for better performance
    const fetchCategoriesDebounced = useCallback((query) => {
        // Cache results to avoid unnecessary API calls
        if (searchCacheRef.current[query]) {
            setAvailableCategories(searchCacheRef.current[query]);
            return;
        }

        debounceCategorySearch(query, async (searchTerm) => {
            try {
                const response = await fetch(`/api/categories?query=${encodeURIComponent(searchTerm)}`);

                if (response.ok) {
                    const data = await response.json();
                    setAvailableCategories(data.categories || []);

                    // Cache results for future use
                    searchCacheRef.current[searchTerm] = data.categories;
                }
            } catch (error) {
                console.error('Error fetching categories:', error);
            }
        });
    }, [debounceCategorySearch]);

    const addCategory = (category) => {
        if (category && !selectedCategories.includes(category)) {
            setSelectedCategories([...selectedCategories, category]);
            setCategory('');

            if (categoryInputRef.current) {
                categoryInputRef.current.focus();
            }
        }
    };

    const removeCategory = (cat) => {
        setSelectedCategories(selectedCategories.filter(c => c !== cat));
    };

    const addExcludedCategory = (category) => {
        if (category && !excludedCategories.includes(category)) {
            setExcludedCategories([...excludedCategories, category]);
        }
    };

    const removeExcludedCategory = (cat) => {
        setExcludedCategories(excludedCategories.filter(c => c !== cat));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate based on search mode
        if (searchMode === 'specific' && !category && selectedCategories.length === 0) {
            alert('Please enter at least one category or business type');
            return;
        }

        if (!location) {
            alert('Please enter a location');
            return;
        }

        setIsLoading(true);

        try {
            // Save search parameters to localStorage for future use
            const searchParams = {
                category,
                location,
                searchRadius,
                selectedCategories,
                excludedCategories,
                contactLimit,
                keywords: keywordsInput,
                searchMode,
                randomCategoryCount,
                timestamp: new Date().toISOString()
            };

            localStorage.setItem('last_search', JSON.stringify(searchParams));
            setLastSearch(searchParams);

            // Create the task
            const response = await fetch('/api/tasks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    searchTerm: searchMode === 'specific' ? (category || selectedCategories[0]) : null,
                    location,
                    radius: searchRadius,
                    limit: contactLimit,
                    includeCategories: searchMode === 'specific' ? selectedCategories : [],
                    excludeCategories,
                    keywords: keywordsInput,
                    useRandomCategories: searchMode === 'random',
                    randomCategoryCount: searchMode === 'random' ? randomCategoryCount : 0,
                    dataToExtract: Object.entries(selectedData)
                        .filter(([_, selected]) => selected)
                        .map(([name, _]) => name.toLowerCase().replace(/\s+/g, '_'))
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to start scraping task');
            }

            const result = await response.json();

            // Redirect to task monitoring page
            router.push(`/tasks/${result.taskId}`);

        } catch (error) {
            console.error('Error starting scraping task:', error);
            alert(`Error starting task: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const clearForm = () => {
        setCategory('');
        setLocation('');
        setSearchRadius(10);
        setSelectedCategories([]);
        setExcludedCategories([]);
        setKeywordsInput('');
        setContactLimit(100);
        setSearchMode('specific');
        setRandomCategoryCount(5);

        // Reset data extraction options
        setSelectedData({
            'Phone Numbers': true,
            'Email Addresses': true,
            'Physical Address': true,
            'Website': true,
            'Opening Hours': true,
            'Ratings': true,
            'Reviews': false,
            'Images': false,
            'Social Profiles': true
        });
    };

    return (
        <div className="card p-5 hover:shadow-md transition">
            <h2 className="text-xl font-semibold mb-5 flex items-center">
                <span className="material-icons mr-3 text-primary">search</span>
                Search Google Maps Data
                <button
                    onClick={() => setAdvancedMode(!advancedMode)}
                    className="ml-auto text-sm flex items-center text-primary bg-primary-light px-3 py-1 rounded-full"
                >
                    {advancedMode ? 'Simple Mode' : 'Advanced Mode'}
                    <span className="material-icons ml-1 text-sm">
                        {advancedMode ? 'expand_less' : 'expand_more'}
                    </span>
                </button>
            </h2>

            <form onSubmit={handleSubmit}>
                {/* Search Mode Tabs */}
                <div className="mb-6 border-b border-light">
                    <div className="flex">
                        <button
                            type="button"
                            className={`py-2 px-4 font-medium text-sm border-b-2 ${searchMode === 'specific'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-gray-500 hover:text-primary'}`}
                            onClick={() => setSearchMode('specific')}
                        >
                            Specific Search
                        </button>
                        <button
                            type="button"
                            className={`py-2 px-4 font-medium text-sm border-b-2 ${searchMode === 'random'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-gray-500 hover:text-primary'}`}
                            onClick={() => setSearchMode('random')}
                        >
                            Random Categories
                        </button>
                    </div>
                </div>

                {searchMode === 'specific' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                        <div>
                            <label className="block text-sm font-medium mb-2">Business Category</label>
                            <SearchableSelect
                                placeholder="e.g. restaurants, lawyers, dentists..."
                                value={category}
                                onChange={setCategory}
                                onSelect={(selectedCategory) => {
                                    setCategory(selectedCategory);
                                    if (selectedCategory && !selectedCategories.includes(selectedCategory)) {
                                        addCategory(selectedCategory);
                                    }
                                }}
                                apiUrl="/api/categories"
                            />

                            {/* Selected Categories */}
                            {selectedCategories.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
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
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">Location</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="e.g. New York, San Francisco..."
                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                />
                                <span className="material-icons absolute left-3 top-3 text-gray-400">location_on</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                        <div>
                            <label className="block text-sm font-medium mb-2">Random Category Settings</label>
                            <div className="bg-accent p-4 rounded-lg">
                                <div className="flex justify-between text-sm font-medium mb-2">
                                    <span>Number of random categories</span>
                                    <span className="text-primary font-semibold">{randomCategoryCount}</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="20"
                                    step="1"
                                    className="w-full accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                    value={randomCategoryCount}
                                    onChange={(e) => setRandomCategoryCount(parseInt(e.target.value))}
                                />
                                <div className="flex justify-between text-xs text-gray-500 mt-1">
                                    <span>1</span>
                                    <span>10</span>
                                    <span>20</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    The system will randomly select {randomCategoryCount} categories from the database
                                    for scraping, excluding any categories you've specified to exclude.
                                </p>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Location</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="e.g. New York, San Francisco..."
                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                />
                                <span className="material-icons absolute left-3 top-3 text-gray-400">location_on</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Excluded Categories - available in both modes */}
                <div className="mb-5">
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
                                {availableCategories
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
                    <p className="text-xs text-gray-500 mt-1">
                        These categories will be excluded from your search results
                    </p>
                </div>

                {advancedMode && (
                    <>
                        {/* Keywords Input */}
                        <div className="mb-5">
                            <label className="block text-sm font-medium mb-2">Keywords (comma separated)</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="e.g. organic, vegan, 24-hour, open late..."
                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                    value={keywordsInput}
                                    onChange={(e) => setKeywordsInput(e.target.value)}
                                />
                                <span className="material-icons absolute left-3 top-3 text-gray-400">text_fields</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Add specific keywords to narrow your search (e.g., "organic, vegan, takeout")
                            </p>
                        </div>
                    </>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4 mb-6">
                    <div>
                        <div className="flex justify-between text-sm font-medium mb-2">
                            <span>Radius (miles)</span>
                            <span className="text-primary font-semibold">{searchRadius} miles</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="50"
                            step="1"
                            className="w-full accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                            value={searchRadius}
                            onChange={(e) => setSearchRadius(parseInt(e.target.value))}
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>1</span>
                            <span>25</span>
                            <span>50</span>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between text-sm font-medium mb-2">
                            <span>Contact Limit Per Category</span>
                            <span className="text-primary font-semibold">{contactLimit}</span>
                        </div>
                        <input
                            type="range"
                            min="1000"
                            max="50000"
                            step="1000"
                            className="w-full accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                            value={contactLimit}
                            onChange={(e) => setContactLimit(parseInt(e.target.value))}
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>1k</span>
                            <span>25k</span>
                            <span>50k</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Maximum number of contacts to gather per category
                        </p>
                    </div>
                </div>

                <div className="mb-6">
                    <h3 className="text-sm font-medium mb-3">Data to Extract</h3>

                    {Object.entries(dataOptions).map(([group, options]) => (
                        <div key={group} className="mb-4">
                            <p className="text-xs text-gray-500 mb-2">{group}</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {options.map(option => (
                                    <label
                                        key={option}
                                        className={`flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${selectedData[option] ? 'bg-primary-light' : 'bg-accent'
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="mr-2 accent-primary h-4 w-4"
                                            checked={selectedData[option] || false}
                                            onChange={() => setSelectedData(prev => ({
                                                ...prev,
                                                [option]: !prev[option]
                                            }))}
                                        />
                                        <span className="text-sm">{option}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 pt-4 border-t border-light">
                    {lastSearch && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span className="material-icons text-sm">history</span>
                            Last search: {new Date(lastSearch.timestamp).toLocaleString()}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={clearForm}
                            className="btn btn-outline px-5 py-2.5"
                        >
                            Clear All
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="btn btn-primary px-5 py-2.5 flex items-center shadow-md hover:shadow-lg"
                        >
                            {isLoading ? (
                                <>
                                    <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <span className="material-icons mr-2">bolt</span>
                                    Start Scraping
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
