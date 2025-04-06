"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function StatisticsPanel() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [cacheTime, setCacheTime] = useState(null);

    // Much longer cache lifetime - 1 hour instead of 5 minutes
    const CACHE_LIFETIME = 60 * 60 * 1000; // 1 hour

    // Static flag to prevent duplicate fetches across renders
    const hasFetched = React.useRef(false);

    useEffect(() => {
        // Only fetch once per page load
        if (hasFetched.current) return;

        const fetchStats = async () => {
            try {
                // Try to load from localStorage first
                const cachedData = localStorage.getItem('stats_cache');
                if (cachedData) {
                    try {
                        const { data, timestamp } = JSON.parse(cachedData);

                        // Use cache if less than cache lifetime
                        if (Date.now() - timestamp < CACHE_LIFETIME) {
                            setStats(data);
                            setCacheTime(timestamp);
                            setLoading(false);
                            return;
                        }
                    } catch (err) {
                        console.error('Error parsing cached stats:', err);
                    }
                }

                // If no valid cache, fetch new data
                setLoading(true);
                const response = await fetch('/api/stats');

                if (!response.ok) {
                    throw new Error('Failed to fetch statistics');
                }

                const data = await response.json();

                // Don't update if we just got a loading status
                if (data.status === 'loading') {
                    setLoading(false);
                    return;
                }

                // Cache the stats
                setStats(data);
                const now = Date.now();
                setCacheTime(now);

                // Store in localStorage for persistent caching
                try {
                    localStorage.setItem('stats_cache', JSON.stringify({
                        data,
                        timestamp: now
                    }));
                } catch (err) {
                    console.error('Error caching stats data:', err);
                }
            } catch (err) {
                console.error('Error fetching statistics:', err);
            } finally {
                setLoading(false);
                hasFetched.current = true;
            }
        };

        fetchStats();

        // No interval refreshes - only manual refresh will update stats
    }, []);

    const refreshStats = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/stats?refresh=true');

            if (!response.ok) {
                throw new Error('Failed to refresh statistics');
            }

            const data = await response.json();
            setStats(data);

            const now = Date.now();
            setCacheTime(now);

            // Update localStorage cache
            try {
                localStorage.setItem('stats_cache', JSON.stringify({
                    data,
                    timestamp: now
                }));
            } catch (err) {
                console.error('Error updating stats cache:', err);
            }
        } catch (err) {
            console.error('Error refreshing statistics:', err);
        } finally {
            setLoading(false);
        }
    };

    // Improved skeleton loader with dimensions matching real content
    const renderSkeletonLoader = () => (
        <div className="animate-pulse space-y-4">
            {/* Stat cards skeleton */}
            <div className="grid grid-cols-2 gap-4">
                <div className="h-24 bg-gray-100 rounded-lg"></div>
                <div className="h-24 bg-gray-100 rounded-lg"></div>
                <div className="h-24 bg-gray-100 rounded-lg"></div>
                <div className="h-24 bg-gray-100 rounded-lg"></div>
            </div>

            {/* Task breakdown skeleton */}
            <div className="h-16 bg-gray-100 rounded-lg mt-6"></div>

            {/* Geographic distribution skeleton */}
            <div className="h-20 bg-gray-100 rounded-lg mt-6"></div>
        </div>
    );

    // Only the refresh button behavior changes
    return (
        <div className="card p-5 hover:shadow-md transition h-full">
            <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-semibold flex items-center">
                    <span className="material-icons mr-3 text-primary">insights</span>
                    System Statistics
                </h2>

                {cacheTime && (
                    <div className="flex items-center text-xs text-gray-500">
                        <span className="material-icons text-xs mr-1">schedule</span>
                        <div className="whitespace-nowrap">
                            {new Date(cacheTime).toLocaleTimeString()}
                        </div>
                        <button
                            onClick={refreshStats}
                            className="ml-2 text-primary hover:underline flex items-center"
                            title="Refresh statistics"
                        >
                            <span className="material-icons text-xs">refresh</span>
                        </button>
                    </div>
                )}
            </div>

            {loading && !stats ? renderSkeletonLoader() : (
                <>
                    {/* These remain unchanged */}
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-primary-light rounded-lg p-4">
                            <div className="text-sm font-medium text-primary">Total Businesses</div>
                            <div className="flex items-center mt-1">
                                <span className="text-3xl font-bold text-primary">{stats?.totalBusinesses?.toLocaleString() || 0}</span>
                            </div>
                        </div>

                        <div className="bg-success-light rounded-lg p-4">
                            <div className="text-sm font-medium text-success">Email Contacts</div>
                            <div className="flex justify-between items-center mt-1">
                                <span className="text-3xl font-bold text-success">{stats?.totalEmails?.toLocaleString() || 0}</span>
                                <span className="text-xs bg-white px-2 py-0.5 rounded-full text-success font-medium">
                                    {stats?.emailCoverage || 0}%
                                </span>
                            </div>
                        </div>

                        <div className="bg-secondary-light rounded-lg p-4">
                            <div className="text-sm font-medium text-secondary">Websites</div>
                            <div className="flex justify-between items-center mt-1">
                                <span className="text-3xl font-bold text-secondary">{stats?.totalWebsites?.toLocaleString() || 0}</span>
                                <span className="text-xs bg-white px-2 py-0.5 rounded-full text-secondary font-medium">
                                    {stats?.websiteCoverage || 0}%
                                </span>
                            </div>
                        </div>

                        <div className="bg-warning-light rounded-lg p-4">
                            <div className="text-sm font-medium text-warning">Total Searches</div>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-3xl font-bold text-warning">{stats?.totalSearchTerms?.toLocaleString() || 0}</span>
                                <Link href="/history" className="text-xs bg-white px-2 py-0.5 rounded-full text-warning font-medium hover:bg-warning hover:text-white transition-colors">
                                    View All
                                </Link>
                            </div>
                        </div>
                    </div>

                    {stats?.tasks && (
                        <>
                            <h3 className="text-sm font-medium mb-3 text-gray-500">Task Breakdown</h3>
                            <div className="bg-accent rounded-lg p-4 mb-6">
                                <div className="grid grid-cols-4 gap-2 text-center">
                                    <div>
                                        <div className="text-xs text-gray-500">Total</div>
                                        <div className="font-bold">{stats.tasks.total}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-success">Completed</div>
                                        <div className="font-bold text-success">{stats.tasks.byStatus?.completed || 0}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-primary">Running</div>
                                        <div className="font-bold text-primary">{stats.tasks.byStatus?.running || 0}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-error">Failed</div>
                                        <div className="font-bold text-error">{stats.tasks.byStatus?.failed || 0}</div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {stats?.states?.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium mb-3 text-gray-500">Geographic Distribution</h3>
                            <div className="flex flex-wrap gap-2">
                                {stats.stateData?.slice(0, 5).map(stateInfo => (
                                    <Link
                                        href={`/leads?state=${stateInfo.state}`}
                                        key={stateInfo.state}
                                        className="px-3 py-1.5 bg-secondary-light text-secondary text-xs rounded-full flex items-center hover:bg-secondary hover:text-white transition-colors"
                                    >
                                        <span className="material-icons text-xs mr-1">location_on</span>
                                        {stateInfo.state}
                                        <span className="ml-1 bg-white text-secondary text-[10px] px-1.5 rounded-full">
                                            {stateInfo.count}
                                        </span>
                                    </Link>
                                ))}

                                {stats.states.length > 5 && (
                                    <Link
                                        href="/analytics"
                                        className="px-3 py-1.5 bg-gray-100 text-gray-500 text-xs rounded-full hover:bg-gray-200 transition-colors"
                                    >
                                        +{stats.states.length - 5} more
                                    </Link>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
