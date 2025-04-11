"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

export default function EmailFinderPage() {
    const [stats, setStats] = useState(null);
    const [status, setStatus] = useState({
        isRunning: false,
        processed: 0,
        emailsFound: 0,
        queueLength: 0
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [processingOptions, setProcessingOptions] = useState({
        limit: 5000,         // Increased default to 5000
        onlyWithWebsite: true,
        skipContacted: true,
        concurrency: 3,      // How many sites to process concurrently
        maxDepth: 2,         // How deep to crawl on sites
        timeout: 30000,      // 30 seconds timeout per site
        useSearchEngines: true, // NEW: Use search engines as last resort
        searchEngine: 'google'  // NEW: Default search engine
    });
    const [selectedBusinesses, setSelectedBusinesses] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [statusUpdateTimer, setStatusUpdateTimer] = useState(null);
    const router = useRouter();
    const [message, setMessage] = useState(null);

    // Domain search states
    const [domainToSearch, setDomainToSearch] = useState('');
    const [domainSearchResult, setDomainSearchResult] = useState(null);
    const [isDomainSearching, setIsDomainSearching] = useState(false);
    const [domainSearchError, setDomainSearchError] = useState(null);

    // Add new states for advanced filtering
    const [searchTermOptions, setSearchTermOptions] = useState([]);
    const [isLoadingSearchTerms, setIsLoadingSearchTerms] = useState(false);
    const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);

    // Calculate percentage complete
    const percentComplete = useMemo(() => {
        if (!status.isRunning || status.queueLength === 0) return 0;
        return Math.min(100, Math.round((status.processed / (status.processed + status.queueLength)) * 100));
    }, [status]);

    // Fetch status and stats on component mount and set up more robust polling
    useEffect(() => {
        let statusTimer = null;

        // Initial fetch of both stats and status
        const initialize = async () => {
            setLoading(true);

            // First check if the email finder is actually running in the backend
            await fetchStatus();

            // Then fetch the stats
            await fetchStats();

            setLoading(false);
        };

        initialize();

        // Set up polling that continues regardless of navigation/reload
        const startStatusPolling = () => {
            if (statusTimer) clearInterval(statusTimer);

            // Poll every 2 seconds
            statusTimer = setInterval(fetchStatus, 2000);
        };

        // Start polling immediately
        startStatusPolling();

        // Cleanup timers when component unmounts
        return () => {
            if (statusTimer) clearInterval(statusTimer);
        };
    }, []);

    // Add new effect to fetch available search terms
    useEffect(() => {
        const fetchSearchTerms = async () => {
            try {
                setIsLoadingSearchTerms(true);
                const response = await fetch('/api/search-terms');
                
                if (response.ok) {
                    const data = await response.json();
                    setSearchTermOptions(data.searchTerms || []);
                }
            } catch (error) {
                console.error('Error fetching search terms:', error);
            } finally {
                setIsLoadingSearchTerms(false);
            }
        };

        fetchSearchTerms();
    }, []);

    // Fetch stats from the API
    const fetchStats = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/email-finder/stats');

            if (!response.ok) {
                throw new Error('Failed to fetch statistics');
            }

            const data = await response.json();
            setStats(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching stats:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Fetch current email finder status - enhanced to handle errors better
    const fetchStatus = async () => {
        try {
            const response = await fetch('/api/email-finder/status');

            if (!response.ok) {
                throw new Error('Failed to fetch email finder status');
            }

            const data = await response.json();

            // If the server indicates it's running and our UI doesn't reflect that, update UI
            if (data.isRunning && !status.isRunning) {
                console.info("Backend email finder is running but UI shows stopped - syncing state");
            }

            // Always update with server state - this ensures UI is in sync
            setStatus(data);

            // If it was running and now it's not, refresh stats
            if (status.isRunning && !data.isRunning) {
                fetchStats();
            }

            return data;
        } catch (err) {
            console.error('Error fetching email finder status:', err);
            return status; // Return current status on error to avoid UI disruption
        }
    };

    // Start the email finder process - IMPROVED
    const startEmailFinder = async () => {
        try {
            setMessage(null); // Clear any existing messages

            const response = await fetch('/api/email-finder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'start',
                    ...processingOptions
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to start email finder');
            }

            const data = await response.json();

            // Update UI to match server state
            setStatus({
                isRunning: true,
                queueLength: data.queueSize,
                processed: 0,
                emailsFound: 0
            });

            setMessage({
                type: 'success',
                text: `Processing ${data.queueSize} businesses for emails`
            });

            // Force immediate status check after starting
            setTimeout(fetchStatus, 500);
        } catch (error) {
            console.error('Error starting email finder:', error);
            setMessage({
                type: 'error',
                text: error.message
            });
        }
    };

    // Add function to start email finder with search term filter
    const startFilteredEmailFinder = async () => {
        try {
            setMessage(null); // Clear any existing messages

            const response = await fetch('/api/email-finder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'filter', // Use the new 'filter' action
                    ...processingOptions,
                    hasWebsite: true, // Always use websites for email finding
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to start email finder');
            }

            const data = await response.json();

            // Update UI to match server state
            setStatus({
                isRunning: true,
                queueLength: data.queueSize,
                processed: 0,
                emailsFound: 0
            });

            setMessage({
                type: 'success',
                text: `Processing ${data.queueSize} businesses for emails using filters`
            });

            // Force immediate status check after starting
            setTimeout(fetchStatus, 500);
        } catch (error) {
            console.error('Error starting filtered email finder:', error);
            setMessage({
                type: 'error',
                text: error.message
            });
        }
    };

    // Stop the email finder process
    const stopEmailFinder = async () => {
        try {
            const response = await fetch('/api/email-finder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'stop'
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to stop email finder');
            }

            const data = await response.json();
            setStatus({
                ...status,
                isRunning: false
            });

            // Refresh stats
            fetchStats();

            // Show alert
            alert(`Email finder stopped after processing ${data.processed} businesses. ${data.emailsFound} emails found.`);
        } catch (error) {
            console.error('Error stopping email finder:', error);
            alert(`Error: ${error.message}`);
        }
    };

    // Search for businesses by name
    const searchBusinesses = async (e) => {
        e.preventDefault();

        if (!searchQuery) {
            return;
        }

        try {
            setIsSearching(true);

            // Search API endpoint
            const response = await fetch(`/api/leads?search=${encodeURIComponent(searchQuery)}&hasEmail=false&hasWebsite=true&limit=20`);

            if (!response.ok) {
                throw new Error('Search failed');
            }

            const data = await response.json();
            setSearchResults(data.contacts || []);
        } catch (error) {
            console.error('Search error:', error);
            alert(`Search error: ${error.message}`);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    // Toggle business selection
    const toggleBusinessSelection = (business) => {
        if (selectedBusinesses.find(b => b.id === business.id)) {
            setSelectedBusinesses(selectedBusinesses.filter(b => b.id !== business.id));
        } else {
            setSelectedBusinesses([...selectedBusinesses, business]);
        }
    };

    // Process selected businesses
    const processSelectedBusinesses = async () => {
        if (selectedBusinesses.length === 0) {
            alert('Please select at least one business');
            return;
        }

        try {
            const response = await fetch('/api/email-finder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'specific',
                    businessIds: selectedBusinesses.map(b => b.id)
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to start email finder for selected businesses');
            }

            const data = await response.json();
            setStatus({
                ...status,
                isRunning: true,
                queueLength: data.queueSize,
                processed: 0,
                emailsFound: 0
            });

            // Clear selections
            setSelectedBusinesses([]);
            setSearchResults([]);
            setSearchQuery('');

            // Show alert
            alert(`Started processing ${data.queueSize} selected businesses for email discovery`);
        } catch (error) {
            console.error('Error processing selected businesses:', error);
            alert(`Error: ${error.message}`);
        }
    };

    // Handle option changes
    const handleOptionChange = (key, value) => {
        setProcessingOptions({
            ...processingOptions,
            [key]: value
        });
    };

    // Find email for a specific domain
    const findEmailForDomain = async (e) => {
        e.preventDefault();

        if (!domainToSearch) {
            return;
        }

        setIsDomainSearching(true);
        setDomainSearchError(null);
        setDomainSearchResult(null);

        try {
            // Format the domain if needed
            let formattedDomain = domainToSearch.trim().toLowerCase();

            // Add protocol if missing
            if (!formattedDomain.startsWith('http')) {
                formattedDomain = 'https://' + formattedDomain;
            }

            // Call API to find email
            const response = await fetch('/api/email-finder/domain-search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    domain: formattedDomain,
                    useSearchEngines: processingOptions.useSearchEngines,
                    searchEngine: processingOptions.searchEngine
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to search domain');
            }

            setDomainSearchResult(data);
        } catch (error) {
            console.error('Error finding email for domain:', error);
            setDomainSearchError(error.message);
        } finally {
            setIsDomainSearching(false);
        }
    };

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-7xl mx-auto">
                        {/* Page Header */}
                        <div className="flex flex-col md:flex-row items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl font-bold mb-1">Email Finder</h1>
                                <p className="text-gray-500">Find missing email addresses for your business leads</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button
                                    onClick={() => router.push('/leads?hasEmail=false&hasWebsite=true')}
                                    className="btn btn-outline flex items-center px-4 py-2.5"
                                >
                                    <span className="material-icons mr-2 text-sm">visibility</span>
                                    View Missing Emails
                                </button>

                                {!status.isRunning ? (
                                    <button
                                        onClick={startEmailFinder}
                                        disabled={loading}
                                        className="btn btn-primary flex items-center px-4 py-2.5 shadow-md hover:shadow-lg"
                                    >
                                        <span className="material-icons mr-2 text-sm">search</span>
                                        Start Email Finder
                                    </button>
                                ) : (
                                    <button
                                        onClick={stopEmailFinder}
                                        className="btn btn-error flex items-center px-4 py-2.5 shadow-md hover:shadow-lg"
                                    >
                                        <span className="material-icons mr-2 text-sm">stop</span>
                                        Stop Email Finder
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Display status messages */}
                        {message && (
                            <div className={`mb-4 p-4 rounded-md ${message.type === 'error' ?
                                'bg-error-light text-error' :
                                'bg-success-light text-success'
                                }`}>
                                {message.text}
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                            {/* Email Stats Panel */}
                            <div className="lg:col-span-2">
                                <div className="card p-5 hover:shadow-md transition">
                                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                                        <span className="material-icons mr-3 text-primary">analytics</span>
                                        Email Coverage Statistics
                                    </h2>

                                    {loading ? (
                                        <div className="animate-pulse space-y-4">
                                            <div className="h-10 bg-gray-200 rounded-md w-full"></div>
                                            <div className="grid grid-cols-3 gap-4">
                                                {[...Array(3)].map((_, i) => (
                                                    <div key={i} className="h-24 bg-gray-200 rounded-md"></div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : error ? (
                                        <div className="bg-error-light text-error p-4 rounded">
                                            <p>Error loading statistics: {error}</p>
                                            <button
                                                onClick={fetchStats}
                                                className="mt-2 btn btn-sm btn-error"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Email Coverage Progress */}
                                            <div className="mb-6">
                                                <div className="flex justify-between text-sm mb-2">
                                                    <span>Email Coverage</span>
                                                    <span className="font-semibold">{stats?.successRate || 0}%</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-4">
                                                    <div
                                                        className="bg-primary h-4 rounded-full transition-all duration-500 ease-in-out"
                                                        style={{ width: `${stats?.successRate || 0}%` }}
                                                    ></div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                                                <div className="bg-accent p-4 rounded-md">
                                                    <div className="text-sm text-gray-500 mb-1">Missing Emails</div>
                                                    <div className="text-2xl font-bold text-primary">
                                                        {stats?.withoutEmail?.toLocaleString() || 0}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        Businesses without email addresses
                                                    </div>
                                                </div>

                                                <div className="bg-accent p-4 rounded-md">
                                                    <div className="text-sm text-gray-500 mb-1">With Website</div>
                                                    <div className="text-2xl font-bold text-secondary">
                                                        {stats?.withWebsiteNoEmail?.toLocaleString() || 0}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        Missing emails but have websites
                                                    </div>
                                                </div>

                                                <div className="bg-accent p-4 rounded-md">
                                                    <div className="text-sm text-gray-500 mb-1">Discovery Potential</div>
                                                    <div className="text-2xl font-bold text-success">
                                                        {stats?.potential?.toLocaleString() || 0}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        Potential emails to discover
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Common Domains */}
                                            {stats?.domainDistribution && stats.domainDistribution.length > 0 && (
                                                <div>
                                                    <h3 className="text-md font-medium mb-3">Common Website Domains</h3>
                                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                                                        {stats.domainDistribution.map((domain, index) => (
                                                            <div key={index} className="bg-primary-light p-2 rounded text-center">
                                                                <div className="font-medium truncate">{domain.domain}</div>
                                                                <div className="text-xs text-gray-600">{domain.count}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Email Finder Settings Panel */}
                            <div className="lg:col-span-1">
                                <div className="card p-5 hover:shadow-md transition">
                                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                                        <span className="material-icons mr-3 text-primary">settings</span>
                                        Email Finder Settings
                                    </h2>

                                    <div className="space-y-4">
                                        {/* NEW: Search Term Selector */}
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Search Term Filter</label>
                                            <select
                                                className="w-full p-2 border border-light rounded-md"
                                                value={processingOptions.searchTerm || ''}
                                                onChange={(e) => handleOptionChange('searchTerm', e.target.value || null)}
                                                disabled={status.isRunning || isLoadingSearchTerms}
                                            >
                                                <option value="">All Search Terms</option>
                                                {searchTermOptions.map((term, index) => (
                                                    <option key={index} value={term}>
                                                        {term}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Filter businesses by their search term (e.g., "Digital Marketing Agency")
                                            </p>
                                        </div>

                                        {/* NEW: Toggle Advanced Filters button */}
                                        <button 
                                            onClick={() => setAdvancedFilterVisible(!advancedFilterVisible)}
                                            className="btn btn-outline btn-sm w-full flex items-center justify-center"
                                            disabled={status.isRunning}
                                        >
                                            <span className="material-icons mr-2 text-sm">
                                                {advancedFilterVisible ? 'expand_less' : 'expand_more'}
                                            </span>
                                            {advancedFilterVisible ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
                                        </button>

                                        {/* Advanced Filters Section - conditionally visible */}
                                        {advancedFilterVisible && (
                                            <>
                                                {/* State Filter */}
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">State</label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g., CA, NY, TX"
                                                        className="w-full p-2 border border-light rounded-md"
                                                        value={processingOptions.state || ''}
                                                        onChange={(e) => handleOptionChange('state', e.target.value || null)}
                                                        disabled={status.isRunning}
                                                    />
                                                </div>

                                                {/* City Filter */}
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">City</label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g., Los Angeles"
                                                        className="w-full p-2 border border-light rounded-md"
                                                        value={processingOptions.city || ''}
                                                        onChange={(e) => handleOptionChange('city', e.target.value || null)}
                                                        disabled={status.isRunning}
                                                    />
                                                </div>

                                                {/* Min Rating */}
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">Minimum Rating</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="5"
                                                        step="0.1"
                                                        placeholder="e.g., 4.0"
                                                        className="w-full p-2 border border-light rounded-md"
                                                        value={processingOptions.minRating || ''}
                                                        onChange={(e) => handleOptionChange('minRating', e.target.value || null)}
                                                        disabled={status.isRunning}
                                                    />
                                                </div>
                                            </>
                                        )}

                                        {/* Process Limit */}
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Process Limit</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min="10"
                                                    max="50000"
                                                    step="100"
                                                    disabled={status.isRunning}
                                                    className="flex-1 accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                                    value={processingOptions.limit}
                                                    onChange={(e) => handleOptionChange('limit', parseInt(e.target.value))}
                                                />
                                                <span className="font-semibold w-20 text-center">
                                                    {processingOptions.limit >= 1000
                                                        ? `${(processingOptions.limit / 1000).toFixed(1)}k`
                                                        : processingOptions.limit}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Maximum number of businesses to process (up to 50k)
                                            </p>
                                        </div>

                                        {/* Add concurrency control */}
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Concurrency</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="10"
                                                    step="1"
                                                    disabled={status.isRunning}
                                                    className="flex-1 accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                                    value={processingOptions.concurrency}
                                                    onChange={(e) => handleOptionChange('concurrency', parseInt(e.target.value))}
                                                />
                                                <span className="font-semibold w-20 text-center">
                                                    {processingOptions.concurrency}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Number of websites to process simultaneously
                                            </p>
                                        </div>

                                        {/* Add page depth control */}
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Page Depth</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="3"
                                                    step="1"
                                                    disabled={status.isRunning}
                                                    className="flex-1 accent-primary h-2 rounded-lg appearance-none bg-gray-200"
                                                    value={processingOptions.maxDepth}
                                                    onChange={(e) => handleOptionChange('maxDepth', parseInt(e.target.value))}
                                                />
                                                <span className="font-semibold w-20 text-center">
                                                    {processingOptions.maxDepth}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                How deep to search in each website (more pages = slower)
                                            </p>
                                        </div>

                                        <div className="flex flex-col gap-3">
                                            <label className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={processingOptions.onlyWithWebsite}
                                                    onChange={(e) => handleOptionChange('onlyWithWebsite', e.target.checked)}
                                                    disabled={status.isRunning}
                                                />
                                                <span>Only process leads with website</span>
                                            </label>

                                            <label className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    className="mr-2 accent-primary h-4 w-4"
                                                    checked={processingOptions.skipContacted}
                                                    onChange={(e) => handleOptionChange('skipContacted', e.target.checked)}
                                                    disabled={status.isRunning}
                                                />
                                                <span>Skip already contacted leads</span>
                                            </label>
                                        </div>

                                        {/* Add search engine controls */}
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Search Engine Discovery</label>
                                            <div className="flex items-center gap-2 mb-2">
                                                <input
                                                    type="checkbox"
                                                    id="useSearchEngines"
                                                    checked={processingOptions.useSearchEngines}
                                                    disabled={status.isRunning}
                                                    onChange={(e) => handleOptionChange('useSearchEngines', e.target.checked)}
                                                    className="mr-2 accent-primary h-4 w-4"
                                                />
                                                <label htmlFor="useSearchEngines">Use search engines as last resort</label>
                                            </div>

                                            {processingOptions.useSearchEngines && (
                                                <div className="ml-6 mt-2">
                                                    <label className="block text-sm font-medium mb-2">Search Engine</label>
                                                    <select
                                                        value={processingOptions.searchEngine}
                                                        onChange={(e) => handleOptionChange('searchEngine', e.target.value)}
                                                        disabled={status.isRunning}
                                                        className="w-full p-2 border border-light rounded-md"
                                                    >
                                                        <option value="google">Google</option>
                                                        <option value="bing">Bing</option>
                                                        <option value="duckduckgo">DuckDuckGo</option>
                                                    </select>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Search engine to use for finding emails when direct extraction fails
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Add a new button for filtered processing */}
                                    {!!processingOptions.searchTerm && (
                                        <div className="mt-6">
                                            <button
                                                onClick={startFilteredEmailFinder}
                                                disabled={status.isRunning}
                                                className="btn btn-primary w-full flex items-center justify-center"
                                            >
                                                <span className="material-icons mr-2">filter_list</span>
                                                Find Emails for "{processingOptions.searchTerm}"
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Status Panel - only shown when running */}
                                {status.isRunning && (
                                    <div className="card p-5 hover:shadow-md transition mt-6">
                                        <h2 className="text-lg font-semibold mb-4 flex items-center">
                                            <span className="material-icons mr-3 text-primary">pending</span>
                                            Email Finder Running
                                        </h2>

                                        <div className="space-y-4">
                                            <div>
                                                <div className="flex justify-between text-sm mb-2">
                                                    <span>Progress</span>
                                                    <span className="font-semibold">{percentComplete}%</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-4">
                                                    <div
                                                        className="bg-primary h-4 rounded-full transition-all"
                                                        style={{ width: `${percentComplete}%` }}
                                                    ></div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="bg-accent p-2 rounded">
                                                    <div className="text-xs text-gray-500">Processed</div>
                                                    <div className="font-semibold">{status.processed}</div>
                                                </div>
                                                <div className="bg-accent p-2 rounded">
                                                    <div className="text-xs text-gray-500">Emails Found</div>
                                                    <div className="font-semibold">{status.emailsFound}</div>
                                                </div>
                                            </div>

                                            <button
                                                onClick={stopEmailFinder}
                                                className="btn btn-error w-full"
                                            >
                                                <span className="material-icons mr-2">stop</span>
                                                Stop Processing
                                            </button>

                                            {/* Add last checked timestamp */}
                                            <div className="text-xs text-gray-500 text-center">
                                                Status last updated: {new Date().toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* NEW: Domain Email Search Panel */}
                        <div className="card p-5 hover:shadow-md transition mb-6">
                            <h2 className="text-xl font-semibold mb-4 flex items-center">
                                <span className="material-icons mr-3 text-primary">travel_explore</span>
                                Find Email by Domain
                            </h2>

                            <form onSubmit={findEmailForDomain} className="mb-4">
                                <div className="flex flex-col md:flex-row gap-3">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            placeholder="Enter domain (e.g., spirit.com)"
                                            className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                            value={domainToSearch}
                                            onChange={(e) => setDomainToSearch(e.target.value)}
                                            disabled={isDomainSearching}
                                        />
                                        <span className="material-icons absolute left-3 top-3 text-gray-400">language</span>
                                    </div>
                                    <button
                                        type="submit"
                                        className="btn btn-primary px-4 md:w-auto w-full"
                                        disabled={isDomainSearching || !domainToSearch}
                                    >
                                        {isDomainSearching ? (
                                            <>
                                                <span className="animate-spin mr-2">
                                                    <span className="material-icons">refresh</span>
                                                </span>
                                                Searching...
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-icons mr-2">search</span>
                                                Find Email
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>

                            {/* Domain search results */}
                            {domainSearchResult && (
                                <div className="mt-4 p-4 bg-accent rounded-md">
                                    <h3 className="font-medium mb-2">Search Results for {domainSearchResult.domain}</h3>

                                    {domainSearchResult.email ? (
                                        <div className="flex items-center">
                                            <span className="material-icons text-success mr-2">check_circle</span>
                                            <div>
                                                <p className="font-semibold">{domainSearchResult.email}</p>
                                                <p className="text-xs text-gray-500">
                                                    Found from: {domainSearchResult.source || 'Website scan'}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center">
                                            <span className="material-icons text-error mr-2">error</span>
                                            <p>No email found for this domain.</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {domainSearchError && (
                                <div className="mt-4 p-4 bg-error-light text-error rounded-md">
                                    <div className="flex items-center">
                                        <span className="material-icons mr-2">error</span>
                                        <p>{domainSearchError}</p>
                                    </div>
                                </div>
                            )}

                            <div className="mt-4 text-sm text-gray-500">
                                <p>
                                    Enter a domain name to quickly find an email address associated with it.
                                    The tool will scan the website and use the same enhanced discovery techniques
                                    as the batch email finder.
                                </p>
                            </div>
                        </div>

                        {/* Search and Process Panel */}
                        <div className="card p-5 hover:shadow-md transition mb-6">
                            <h2 className="text-xl font-semibold mb-4 flex items-center">
                                <span className="material-icons mr-3 text-primary">search</span>
                                Find Emails for Specific Businesses
                            </h2>

                            <form onSubmit={searchBusinesses} className="mb-4">
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            placeholder="Search for businesses by name..."
                                            className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <span className="material-icons absolute left-3 top-3 text-gray-400">search</span>
                                    </div>
                                    <button
                                        type="submit"
                                        className="btn btn-primary px-4"
                                        disabled={isSearching || !searchQuery}
                                    >
                                        {isSearching ? 'Searching...' : 'Search'}
                                    </button>
                                </div>
                            </form>

                            {searchResults.length > 0 && (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                            <thead className="bg-accent">
                                                <tr>
                                                    <th className="p-2 w-12">
                                                        <input
                                                            type="checkbox"
                                                            className="accent-primary h-4 w-4"
                                                            checked={selectedBusinesses.length === searchResults.length && searchResults.length > 0}
                                                            onChange={() => {
                                                                if (selectedBusinesses.length === searchResults.length) {
                                                                    setSelectedBusinesses([]);
                                                                } else {
                                                                    setSelectedBusinesses([...searchResults]);
                                                                }
                                                            }}
                                                        />
                                                    </th>
                                                    <th className="p-2 text-left">Business Name</th>
                                                    <th className="p-2 text-left">Website</th>
                                                    <th className="p-2 text-left">Location</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {searchResults.map(business => (
                                                    <tr key={business.id} className="border-b border-light">
                                                        <td className="p-2">
                                                            <input
                                                                type="checkbox"
                                                                className="accent-primary h-4 w-4"
                                                                checked={selectedBusinesses.some(b => b.id === business.id)}
                                                                onChange={() => toggleBusinessSelection(business)}
                                                            />
                                                        </td>
                                                        <td className="p-2">{business.name}</td>
                                                        <td className="p-2">
                                                            {business.website ? (
                                                                <a
                                                                    href={business.website}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary hover:underline"
                                                                >
                                                                    {business.website.replace(/(^\w+:|^)\/\//, '').substring(0, 30)}
                                                                    {business.website.length > 30 ? '...' : ''}
                                                                </a>
                                                            ) : (
                                                                <span className="text-gray-400">No website</span>
                                                            )}
                                                        </td>
                                                        <td className="p-2">{business.city}, {business.state}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="flex justify-between items-center mt-4">
                                        <div className="text-sm text-gray-500">
                                            {selectedBusinesses.length} of {searchResults.length} businesses selected
                                        </div>
                                        <button
                                            onClick={processSelectedBusinesses}
                                            disabled={selectedBusinesses.length === 0 || status.isRunning}
                                            className="btn btn-primary"
                                        >
                                            <span className="material-icons mr-2 text-sm">email</span>
                                            Find Emails for Selected
                                        </button>
                                    </div>
                                </>
                            )}

                            {searchQuery && searchResults.length === 0 && !isSearching && (
                                <div className="text-center py-8 text-gray-500">
                                    <span className="material-icons text-3xl mb-2">search_off</span>
                                    <p>No businesses found matching your search</p>
                                </div>
                            )}
                        </div>

                        {/* How it Works Panel */}
                        <div className="card p-5 hover:shadow-md transition">
                            <h2 className="text-xl font-semibold mb-4 flex items-center">
                                <span className="material-icons mr-3 text-primary">help_outline</span>
                                How Email Finder Works
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="flex flex-col items-center text-center p-4">
                                    <span className="material-icons text-4xl text-primary mb-3">language</span>
                                    <h3 className="font-medium mb-2">1. Website Analysis</h3>
                                    <p className="text-sm text-gray-500">
                                        Our system visits each business website to analyze its content and structure.
                                    </p>
                                </div>

                                <div className="flex flex-col items-center text-center p-4">
                                    <span className="material-icons text-4xl text-primary mb-3">travel_explore</span>
                                    <h3 className="font-medium mb-2">2. Email Discovery</h3>
                                    <p className="text-sm text-gray-500">
                                        We search for contact information across the website, including contact pages.
                                    </p>
                                </div>

                                <div className="flex flex-col items-center text-center p-4">
                                    <span className="material-icons text-4xl text-primary mb-3">verified</span>
                                    <h3 className="font-medium mb-2">3. Verification</h3>
                                    <p className="text-sm text-gray-500">
                                        Discovered emails are verified for proper format before being added to your database.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-light">
                                <p className="text-sm text-gray-500">
                                    <span className="font-medium">Note:</span> Email discovery respects robots.txt files
                                    and implements proper rate limiting to ensure ethical web scraping practices.
                                    The success rate of email discovery varies based on how businesses display their contact information.
                                </p>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
