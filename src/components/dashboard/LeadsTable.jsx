"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function LeadsTable() {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);
    const [totalLeads, setTotalLeads] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [hasMore, setHasMore] = useState(true);
    const [nextCursor, setNextCursor] = useState(null);
    const [columnFilters, setColumnFilters] = useState({});
    const [sortConfig, setSortConfig] = useState({ column: 'created_at', direction: 'desc' });
    const [useCursorPagination, setUseCursorPagination] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const tableRef = useRef(null); // Reference for scroll-to-top functionality
    const cacheTimeRef = useRef(null); // Tracks when data was cached
    const initialLoadDoneRef = useRef(false); // Tracks initial load status

    const pageSize = 20; // Page size

    const router = useRouter();
    const searchParams = useSearchParams();

    // Read filters from URL
    const currentState = searchParams.get('state');
    const currentCity = searchParams.get('city');
    const currentSearchTerm = searchParams.get('searchTerm');
    const hasEmail = searchParams.get('hasEmail');
    const hasWebsite = searchParams.get('hasWebsite');
    const keywords = searchParams.get('keywords');
    const includeCategories = searchParams.getAll('includeCategory');
    const excludeCategories = searchParams.getAll('excludeCategory');
    const minRating = searchParams.get('minRating');

    // Keys for cached data in localStorage
    const CACHE_KEY = useMemo(() => {
        // Create a unique cache key based on current filters
        const filterParams = JSON.stringify({
            state: currentState,
            city: currentCity,
            searchTerm: currentSearchTerm,
            hasEmail,
            hasWebsite,
            keywords,
            includeCategories,
            excludeCategories,
            minRating,
            sortBy: sortConfig.column,
            sortOrder: sortConfig.direction,
            page
        });
        return `leads_data_${btoa(filterParams).substring(0, 50)}`;
    }, [
        currentState, currentCity, currentSearchTerm, hasEmail, hasWebsite,
        keywords, includeCategories, excludeCategories, minRating,
        sortConfig.column, sortConfig.direction, page
    ]);

    const CACHE_TIME_KEY = 'leads_cache_timestamp';

    // Create a function to update the URL with filters
    const updateFilters = useCallback((filters) => {
        const params = new URLSearchParams(searchParams);

        // Update or clear each filter
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                params.set(key, value);
            } else if (params.has(key)) {
                params.delete(key);
            }
        });

        // Reset page when filters change
        setPage(1);
        setNextCursor(null);
        setUseCursorPagination(false);

        // Update URL
        router.push(`?${params.toString()}`);
    }, [searchParams, router]);

    // Load cached data on initial mount
    useEffect(() => {
        const loadCachedData = () => {
            try {
                // Check if we have cached data for these filters
                const cachedData = localStorage.getItem(CACHE_KEY);
                const cachedTimestamp = localStorage.getItem(CACHE_TIME_KEY);

                if (cachedData && cachedTimestamp) {
                    const data = JSON.parse(cachedData);
                    cacheTimeRef.current = parseInt(cachedTimestamp);

                    // Check if cache is fresh (less than 5 minutes old)
                    const now = Date.now();
                    const cacheAge = now - cacheTimeRef.current;
                    const MAX_CACHE_AGE = 5 * 60 * 1000; // 5 minutes

                    if (cacheAge < MAX_CACHE_AGE) {
                        console.log('Using cached data', data);
                        setLeads(data.businesses || []);
                        setTotalLeads(data.pagination?.total || 0);
                        setNextCursor(data.pagination?.nextCursor || null);
                        setHasMore(data.pagination?.hasMore || false);
                        setLoading(false);
                        initialLoadDoneRef.current = true;
                        return true;
                    }
                }
            } catch (err) {
                console.error('Error loading cached data:', err);
                // Clear potentially corrupted cache
                localStorage.removeItem(CACHE_KEY);
            }
            return false;
        };

        // Try to use cached data first
        const usedCache = loadCachedData();

        // If no cache was used or it was stale, fetch fresh data
        if (!usedCache) {
            fetchLeads();
        }

        // Setup automatic refresh of data every 5 minutes if tab is visible
        const refreshInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchLeads(false, true);
            }
        }, 5 * 60 * 1000);

        return () => clearInterval(refreshInterval);
    }, [CACHE_KEY]);

    // Fetch leads whenever filters or page changes
    useEffect(() => {
        // Skip the first fetch since it's handled by the initial mount effect
        if (initialLoadDoneRef.current) {
            fetchLeads();
        }
    }, [page, currentState, currentCity, currentSearchTerm,
        hasEmail, hasWebsite, sortConfig, columnFilters]);

    // Column definition for dynamic rendering and sorting
    const columns = useMemo(() => [
        { key: 'name', label: 'Business', sortable: true },
        {
            key: 'email', label: 'Email', sortable: false, filterable: true,
            filterOptions: [
                { value: 'true', label: 'Has Email' },
                { value: 'false', label: 'No Email' },
            ]
        },
        { key: 'phone', label: 'Phone', sortable: false },
        { key: 'location', label: 'Location', sortable: false },
        {
            key: 'website', label: 'Website', sortable: false, filterable: true,
            filterOptions: [
                { value: 'true', label: 'Has Website' },
                { value: 'false', label: 'No Website' },
            ]
        },
        { key: 'actions', label: 'Actions', sortable: false },
    ], []);

    const fetchLeads = async (isLoadMore = false, silentRefresh = false) => {
        try {
            // If loading more with cursor pagination, we need nextCursor
            if (isLoadMore && !nextCursor) {
                setHasMore(false);
                return;
            }

            // Set loading state (unless it's a silent refresh)
            if (!silentRefresh) {
                if (!isLoadMore) {
                    setLoading(true);
                } else {
                    setIsLoadingMore(true);
                }
            }

            // Build query string
            const params = new URLSearchParams();

            // Set limit and pagination params
            params.append('limit', pageSize.toString());

            if (useCursorPagination && nextCursor) {
                params.append('lastId', nextCursor.toString());
            } else if (!isLoadMore) {
                const offset = (page - 1) * pageSize;
                params.append('offset', offset.toString());
            }

            // Add sorting
            if (sortConfig) {
                params.append('sortBy', sortConfig.column);
                params.append('sortOrder', sortConfig.direction);
            }

            // Add filters from URL
            if (currentState) params.append('state', currentState);
            if (currentCity) params.append('city', currentCity);
            if (currentSearchTerm) params.append('searchTerm', currentSearchTerm);
            if (hasEmail) params.append('hasEmail', hasEmail);
            if (hasWebsite) params.append('hasWebsite', hasWebsite);
            if (keywords) params.append('keywords', keywords);
            if (minRating) params.append('minRating', minRating);

            // Add column filters
            Object.entries(columnFilters).forEach(([key, value]) => {
                if (value) params.append(key, value);
            });

            // Add category inclusions and exclusions
            includeCategories.forEach(cat => params.append('includeCategory', cat));
            excludeCategories.forEach(cat => params.append('excludeCategory', cat));

            // Add cache busting for silent refresh
            if (silentRefresh) {
                params.append('_cache', Date.now().toString());
            }

            // Fetch data from API
            const response = await fetch(`/api/leads?${params}`);

            if (!response.ok) {
                throw new Error('Failed to fetch leads');
            }

            const data = await response.json();

            // Handle pagination data
            if (data.pagination.nextCursor) {
                setNextCursor(data.pagination.nextCursor);
                setHasMore(data.pagination.hasMore);
                setUseCursorPagination(true);
            } else {
                setTotalLeads(data.pagination.total || 0);
            }

            // Update leads list - append if loading more, otherwise replace
            if (isLoadMore) {
                setLeads(prev => [...prev, ...data.businesses]);
            } else {
                setLeads(data.businesses || []);

                // Scroll to top of table on new search/filter (unless it's a silent refresh)
                if (tableRef.current && !silentRefresh) {
                    tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }

            // Cache the data in localStorage
            try {
                const timestamp = Date.now();
                localStorage.setItem(CACHE_KEY, JSON.stringify(data));
                localStorage.setItem(CACHE_TIME_KEY, timestamp.toString());
                cacheTimeRef.current = timestamp;
            } catch (err) {
                console.error('Error caching leads data:', err);
            }

            initialLoadDoneRef.current = true;
            console.log(`Fetched ${data.businesses?.length || 0} leads${isLoadMore ? ' (load more)' : ''}${silentRefresh ? ' (silent refresh)' : ''}`);
        } catch (err) {
            if (!silentRefresh) {
                setError(err.message);
            }
            console.error('Error fetching leads:', err);
        } finally {
            if (!silentRefresh) {
                setLoading(false);
                setIsLoadingMore(false);
            }
        }
    };

    // Load more function for infinite scroll / "Load More" button
    const loadMore = () => {
        if (isLoadingMore || !hasMore) return;
        fetchLeads(true);
    };

    // Handle sorting when a column header is clicked
    const handleSort = (column) => {
        if (!column.sortable) return;

        setSortConfig(prevSort => {
            if (prevSort.column === column.key) {
                // Toggle direction if same column
                return {
                    column: column.key,
                    direction: prevSort.direction === 'asc' ? 'desc' : 'asc'
                };
            } else {
                // Default to desc for new column
                return { column: column.key, direction: 'desc' };
            }
        });

        // Reset pagination
        setPage(1);
        setNextCursor(null);
    };

    // Handle column filter change
    const handleColumnFilter = (column, value) => {
        // Special handling for email and website filters
        if (column.key === 'email') {
            updateFilters({ hasEmail: value });
        } else if (column.key === 'website') {
            updateFilters({ hasWebsite: value });
        } else {
            setColumnFilters(prev => ({
                ...prev,
                [column.key]: value
            }));
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            updateFilters({ searchTerm: searchQuery });
        }
    };

    const clearFilters = () => {
        setSearchQuery('');
        setColumnFilters({});
        router.push('/leads');
    };

    const exportLeads = async () => {
        try {
            setIsExporting(true);

            // Show a loading message to the user for large exports
            if (totalLeads > 1000) {
                alert(`You are exporting ${totalLeads} leads. This may take a few moments to complete.`);
            }

            // FIXED: Properly handle filter values to ensure correct types are sent to API
            const exportFilters = {
                state: currentState || undefined,
                city: currentCity || undefined,
                searchTerm: currentSearchTerm || undefined,
                // Convert string booleans to actual booleans
                hasEmail: hasEmail === 'true' ? true : hasEmail === 'false' ? false : undefined,
                hasWebsite: hasWebsite === 'true' ? true : hasWebsite === 'false' ? false : undefined,
                keywords: keywords || undefined,
                includeCategories: includeCategories && includeCategories.length > 0 ? includeCategories : undefined,
                excludeCategories: excludeCategories && excludeCategories.length > 0 ? excludeCategories : undefined,
                minRating: minRating || undefined,
                // Add any column-specific filters
                ...Object.entries(columnFilters).reduce((acc, [key, value]) => {
                    if (value) acc[key] = value;
                    return acc;
                }, {})
            };

            // Clean up filter object to remove undefined values 
            const cleanFilter = Object.fromEntries(
                Object.entries(exportFilters).filter(([_, value]) => value !== undefined)
            );

            console.log('Exporting with filters:', cleanFilter);

            const response = await fetch('/api/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filter: cleanFilter,
                    // Add force unfiltered flag if no filters are present
                    forceUnfiltered: Object.keys(cleanFilter).length === 0
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to export leads');
            }

            const data = await response.json();

            // Show success notification
            console.log(`Successfully exported ${data.count} leads`);

            // Open the download in a new tab
            window.open(data.downloadUrl, '_blank');
        } catch (err) {
            console.error('Error exporting leads:', err);
            alert('Error exporting leads: ' + err.message);
        } finally {
            setIsExporting(false);
        }
    };

    // Improved optimized skeleton loader
    const renderSkeletonLoader = () => (
        <div className="animate-pulse">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                <div className="h-8 w-40 bg-gray-200 rounded"></div>
                <div className="flex gap-2">
                    <div className="h-10 w-40 bg-gray-200 rounded"></div>
                    <div className="h-10 w-24 bg-gray-200 rounded"></div>
                    <div className="h-10 w-24 bg-gray-200 rounded"></div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr>
                            {columns.map((column, index) => (
                                <th key={index} className="p-3 bg-gray-100">
                                    <div className="h-6 bg-gray-200 rounded w-full"></div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {[...Array(6)].map((_, i) => (
                            <tr key={i}>
                                {columns.map((_, j) => (
                                    <td key={j} className="p-3 border-b border-gray-100">
                                        <div className="h-5 bg-gray-200 rounded w-full"></div>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // Loading states - optimized with better skeleton loader
    if (loading && leads.length === 0) {
        return (
            <div className="card p-5">
                {renderSkeletonLoader()}
            </div>
        );
    }

    // Error state
    if (error && leads.length === 0) {
        return (
            <div className="card p-5">
                <div className="flex flex-col items-center justify-center h-64">
                    <span className="material-icons text-error text-5xl mb-2">error_outline</span>
                    <p className="text-error text-xl">Error loading leads</p>
                    <p className="text-gray-500">{error}</p>
                    <button
                        onClick={() => fetchLeads()}
                        className="mt-4 btn btn-primary px-4 py-2"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div ref={tableRef} className="card p-5 hover:shadow-md transition">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                <h2 className="text-xl font-semibold flex items-center">
                    <span className="material-icons mr-3 text-primary">format_list_bulleted</span>
                    Your Leads ({useCursorPagination ? `${leads.length}+` : totalLeads})
                </h2>

                <div className="flex flex-wrap gap-2">
                    <form onSubmit={handleSearch} className="flex">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search leads..."
                                className="pl-9 pr-4 py-2 border border-light rounded-md focus:ring-primary focus:border-primary text-sm shadow-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <span className="material-icons absolute left-3 top-2 text-gray-400 text-sm">search</span>
                        </div>

                        <button type="submit" className="btn btn-primary ml-2 px-3 py-2">
                            Search
                        </button>
                    </form>

                    {(currentState || currentCity || currentSearchTerm || hasEmail ||
                        hasWebsite || keywords || includeCategories.length > 0 ||
                        excludeCategories.length > 0 || minRating) && (
                            <button
                                onClick={clearFilters}
                                className="btn btn-outline px-3 py-2 flex items-center shadow-sm"
                            >
                                <span className="material-icons mr-1.5 text-sm">filter_alt_off</span>
                                Clear Filters
                            </button>
                        )}

                    <button
                        onClick={exportLeads}
                        className="btn btn-secondary px-3 py-2 flex items-center shadow-sm"
                        disabled={isExporting}
                    >
                        {isExporting ? (
                            <>
                                <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                                Exporting...
                            </>
                        ) : (
                            <>
                                <span className="material-icons mr-1.5 text-sm">file_download</span>
                                Export Excel
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Cache indicator */}
            {cacheTimeRef.current && (
                <div className="text-xs text-gray-500 mb-2 flex justify-end items-center">
                    <span className="material-icons text-xs mr-1">schedule</span>
                    Last updated: {new Date(cacheTimeRef.current).toLocaleTimeString()}
                    <button
                        onClick={() => fetchLeads(false, false)}
                        className="ml-2 text-primary hover:underline flex items-center"
                        title="Refresh data"
                    >
                        <span className="material-icons text-xs">refresh</span>
                        <span className="ml-1">Refresh</span>
                    </button>
                </div>
            )}

            {/* Active filters display */}
            {(currentState || currentCity || currentSearchTerm || hasEmail ||
                hasWebsite || keywords || includeCategories.length > 0 ||
                excludeCategories.length > 0 || minRating) && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {currentSearchTerm && (
                            <div className="bg-primary-light text-primary px-3 py-1 rounded-full text-sm flex items-center">
                                <span>Search: {currentSearchTerm}</span>
                                <button
                                    className="ml-2"
                                    onClick={() => updateFilters({ searchTerm: null })}
                                >
                                    <span className="material-icons text-xs">close</span>
                                </button>
                            </div>
                        )}

                        {currentState && (
                            <div className="bg-secondary-light text-secondary px-3 py-1 rounded-full text-sm flex items-center">
                                <span>State: {currentState}</span>
                                <button
                                    className="ml-2"
                                    onClick={() => updateFilters({ state: null })}
                                >
                                    <span className="material-icons text-xs">close</span>
                                </button>
                            </div>
                        )}

                        {currentCity && (
                            <div className="bg-secondary-light text-secondary px-3 py-1 rounded-full text-sm flex items-center">
                                <span>City: {currentCity}</span>
                                <button
                                    className="ml-2"
                                    onClick={() => updateFilters({ city: null })}
                                >
                                    <span className="material-icons text-xs">close</span>
                                </button>
                            </div>
                        )}

                        {hasEmail && (
                            <div className="bg-success-light text-success px-3 py-1 rounded-full text-sm flex items-center">
                                <span>{hasEmail === 'true' ? 'Has Email' : 'No Email'}</span>
                                <button
                                    className="ml-2"
                                    onClick={() => updateFilters({ hasEmail: null })}
                                >
                                    <span className="material-icons text-xs">close</span>
                                </button>
                            </div>
                        )}

                        {hasWebsite && (
                            <div className="bg-success-light text-success px-3 py-1 rounded-full text-sm flex items-center">
                                <span>{hasWebsite === 'true' ? 'Has Website' : 'No Website'}</span>
                                <button
                                    className="ml-2"
                                    onClick={() => updateFilters({ hasWebsite: null })}
                                >
                                    <span className="material-icons text-xs">close</span>
                                </button>
                            </div>
                        )}

                        {keywords && (
                            <div className="bg-primary-light text-primary px-3 py-1 rounded-full text-sm flex items-center">
                                <span>Keywords: {keywords}</span>
                                <button
                                    className="ml-2"
                                    onClick={() => updateFilters({ keywords: null })}
                                >
                                    <span className="material-icons text-xs">close</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

            <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                    <thead>
                        <tr>
                            {columns.map(column => (
                                <th key={column.key} className="px-4 py-3 bg-accent text-left font-semibold">
                                    <div className="flex flex-col">
                                        <div
                                            className={`flex items-center ${column.sortable ? 'cursor-pointer hover:text-primary' : ''}`}
                                            onClick={() => column.sortable && handleSort(column)}
                                        >
                                            {column.label}
                                            {column.sortable && (
                                                <span className="material-icons ml-1 text-sm">
                                                    {sortConfig.column === column.key
                                                        ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward')
                                                        : 'unfold_more'}
                                                </span>
                                            )}
                                        </div>

                                        {column.filterable && (
                                            <select
                                                className="mt-1 text-xs border border-light rounded p-1"
                                                value={(column.key === 'email' ? hasEmail : column.key === 'website' ? hasWebsite : columnFilters[column.key]) || ''}
                                                onChange={(e) => handleColumnFilter(column, e.target.value)}
                                            >
                                                <option value="">All</option>
                                                {column.filterOptions?.map(option => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-light">
                        {leads.map((lead) => (
                            <tr key={lead.id} className="hover:bg-accent transition">
                                <td className="px-4 py-3.5 font-medium text-primary">{lead.name}</td>
                                <td className="px-4 py-3.5">
                                    {lead.email ? (
                                        <a href={`mailto:${lead.email}`} className="text-secondary hover:underline">
                                            {lead.email}
                                        </a>
                                    ) : (
                                        <span className="text-gray-400">No email</span>
                                    )}
                                </td>
                                <td className="px-4 py-3.5">{lead.phone || '-'}</td>
                                <td className="px-4 py-3.5">
                                    <div className="flex items-center">
                                        {lead.city && (
                                            <button
                                                className="hover:underline mr-1"
                                                onClick={() => updateFilters({ city: lead.city })}
                                            >
                                                {lead.city}
                                            </button>
                                        )}
                                        {lead.city && lead.state && ', '}
                                        {lead.state && (
                                            <button
                                                className="hover:underline"
                                                onClick={() => updateFilters({ state: lead.state })}
                                            >
                                                {lead.state}
                                            </button>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3.5">
                                    {lead.website ? (
                                        <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-secondary hover:underline truncate max-w-[150px] inline-block">
                                            {lead.website}
                                        </a>
                                    ) : (
                                        <span className="text-gray-400">No website</span>
                                    )}
                                </td>
                                <td className="px-4 py-3.5">
                                    <div className="flex">
                                        <button className="p-1.5 rounded-md hover:bg-primary-light text-gray-500 hover:text-primary mr-2 transition" title="View Details">
                                            <span className="material-icons text-sm">visibility</span>
                                        </button>
                                        <button className="p-1.5 rounded-md hover:bg-secondary-light text-gray-500 hover:text-secondary transition" title="Edit">
                                            <span className="material-icons text-sm">edit</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}

                        {leads.length === 0 && (
                            <tr>
                                <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                                    No leads found. {currentState || currentCity || currentSearchTerm ? 'Try changing your filters.' : 'Start a scraping task to collect leads.'}
                                </td>
                            </tr>
                        )}

                        {isLoadingMore && (
                            <tr>
                                <td colSpan="6" className="px-4 py-4 text-center">
                                    <div className="flex justify-center">
                                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination - either standard pagination or "Load More" button */}
            {leads.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-light">
                    {!useCursorPagination ? (
                        <>
                            <div className="text-sm text-gray-500">
                                Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, totalLeads)} of {totalLeads} leads
                            </div>
                            <div className="flex gap-1">
                                <button
                                    className="p-2 border border-light rounded-md hover:bg-accent transition"
                                    disabled={page === 1}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                >
                                    <span className="material-icons text-sm">chevron_left</span>
                                </button>

                                {[...Array(Math.min(3, Math.ceil(totalLeads / pageSize)))].map((_, i) => (
                                    <button
                                        key={i}
                                        className={`p-2 min-w-[40px] ${page === i + 1 ? 'bg-primary text-white' : 'border border-light hover:bg-accent'} rounded-md transition`}
                                        onClick={() => setPage(i + 1)}
                                    >
                                        {i + 1}
                                    </button>
                                ))}

                                {Math.ceil(totalLeads / pageSize) > 3 && (
                                    <>
                                        <button className="p-2 min-w-[40px] border border-light rounded-md hover:bg-accent transition">
                                            ...
                                        </button>
                                        <button
                                            className={`p-2 min-w-[40px] ${page === Math.ceil(totalLeads / pageSize) ? 'bg-primary text-white' : 'border border-light hover:bg-accent'} rounded-md transition`}
                                            onClick={() => setPage(Math.ceil(totalLeads / pageSize))}
                                        >
                                            {Math.ceil(totalLeads / pageSize)}
                                        </button>
                                    </>
                                )}

                                <button
                                    className="p-2 border border-light rounded-md hover:bg-accent transition"
                                    disabled={page >= Math.ceil(totalLeads / pageSize)}
                                    onClick={() => setPage(p => Math.min(Math.ceil(totalLeads / pageSize), p + 1))}
                                >
                                    <span className="material-icons text-sm">chevron_right</span>
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="w-full flex justify-center">
                            {hasMore ? (
                                <button
                                    onClick={loadMore}
                                    disabled={isLoadingMore}
                                    className="btn btn-outline px-6 py-2"
                                >
                                    {isLoadingMore ? (
                                        <>
                                            <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary mr-2"></span>
                                            Loading more...
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-icons mr-1 text-sm">expand_more</span>
                                            Load More Results
                                        </>
                                    )}
                                </button>
                            ) : (
                                <span className="text-gray-500 text-sm">All results loaded</span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Mobile-friendly Quick Filters */}
            <div className="md:hidden fixed bottom-4 right-4 z-10">
                <button
                    onClick={() => document.getElementById('mobileFilters').classList.toggle('hidden')}
                    className="btn btn-primary rounded-full w-14 h-14 flex items-center justify-center shadow-lg"
                >
                    <span className="material-icons">filter_list</span>
                </button>

                <div id="mobileFilters" className="hidden absolute bottom-16 right-0 bg-white p-4 rounded-lg shadow-lg border border-light w-64">
                    <h4 className="font-medium mb-2">Quick Filters</h4>
                    <div className="space-y-2">
                        <button
                            onClick={() => updateFilters({ hasEmail: 'true' })}
                            className="btn btn-outline w-full text-left flex items-center"
                        >
                            <span className="material-icons mr-2 text-sm">email</span>
                            Has Email
                        </button>
                        <button
                            onClick={() => updateFilters({ hasWebsite: 'true' })}
                            className="btn btn-outline w-full text-left flex items-center"
                        >
                            <span className="material-icons mr-2 text-sm">language</span>
                            Has Website
                        </button>
                        <button
                            onClick={() => sortConfig.column === 'rating' && sortConfig.direction === 'desc'
                                ? setSortConfig({ column: 'rating', direction: 'asc' })
                                : setSortConfig({ column: 'rating', direction: 'desc' })}
                            className="btn btn-outline w-full text-left flex items-center"
                        >
                            <span className="material-icons mr-2 text-sm">star</span>
                            Sort by Rating
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
