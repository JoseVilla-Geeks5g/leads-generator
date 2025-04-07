"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StatisticsPanel() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const router = useRouter();

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            // Try to use cached data first
            const cachedStats = localStorage.getItem('stats_cache');
            if (cachedStats) {
                const { data, timestamp } = JSON.parse(cachedStats);
                if (Date.now() - timestamp < 5 * 60 * 1000) { // 5 minute cache
                    setStats(data);
                    setLoading(false);
                    return;
                }
            }

            const response = await fetch('/api/stats');
            if (!response.ok) throw new Error('Failed to fetch statistics');

            const data = await response.json();
            setStats(data);
            setError(null);

            // Cache data
            try {
                localStorage.setItem('stats_cache', JSON.stringify({
                    data,
                    timestamp: Date.now()
                }));
            } catch (err) {
                console.error('Error caching stats:', err);
            }
        } catch (err) {
            console.error('Error fetching stats:', err);
            setError('Failed to load statistics');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="card p-5 hover:shadow-md transition">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                    <span className="material-icons mr-3 text-primary">analytics</span>
                    Statistics
                </h2>

                <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="h-14 bg-gray-200 rounded"></div>
                        <div className="h-14 bg-gray-200 rounded"></div>
                    </div>
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="h-14 bg-gray-200 rounded"></div>
                        <div className="h-14 bg-gray-200 rounded"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="card p-5 hover:shadow-md transition">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                    <span className="material-icons mr-3 text-primary">analytics</span>
                    Statistics
                </h2>

                <div className="text-center p-4">
                    <p className="text-error mb-2">{error}</p>
                    <button
                        onClick={fetchStats}
                        className="btn btn-sm btn-outline"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="card p-5 hover:shadow-md transition">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
                <span className="material-icons mr-3 text-primary">analytics</span>
                Statistics
            </h2>

            <div className="space-y-5">
                {/* Email Coverage */}
                <div>
                    <div className="flex justify-between text-sm mb-1">
                        <span>Email Coverage</span>
                        <span className="font-semibold">{stats?.emailCoverage || 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                            className="bg-primary h-2 rounded-full"
                            style={{ width: `${stats?.emailCoverage || 0}%` }}
                        ></div>
                    </div>
                </div>

                {/* Website Coverage */}
                <div>
                    <div className="flex justify-between text-sm mb-1">
                        <span>Website Coverage</span>
                        <span className="font-semibold">{stats?.websiteCoverage || 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                            className="bg-secondary h-2 rounded-full"
                            style={{ width: `${stats?.websiteCoverage || 0}%` }}
                        ></div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-accent p-3 rounded">
                        <div className="text-xs text-gray-500">Total Businesses</div>
                        <div className="text-xl font-bold">{stats?.totalBusinesses?.toLocaleString() || 0}</div>
                    </div>

                    <div className="bg-accent p-3 rounded">
                        <div className="text-xs text-gray-500">With Email</div>
                        <div className="text-xl font-bold text-primary">{stats?.totalEmails?.toLocaleString() || 0}</div>
                    </div>

                    <div className="bg-accent p-3 rounded">
                        <div className="text-xs text-gray-500">Categories</div>
                        <div className="text-xl font-bold">{stats?.totalSearchTerms?.toLocaleString() || 0}</div>
                    </div>

                    <div className="bg-accent p-3 rounded">
                        <div className="text-xs text-gray-500">States</div>
                        <div className="text-xl font-bold">{stats?.states?.length || 0}</div>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => router.push('/email-finder')}
                        className="btn btn-primary btn-sm w-full flex items-center justify-center"
                    >
                        <span className="material-icons mr-1 text-sm">search</span>
                        Find Emails
                    </button>

                    <button
                        onClick={() => router.push('/analytics')}
                        className="btn btn-outline btn-sm w-full flex items-center justify-center"
                    >
                        <span className="material-icons mr-1 text-sm">analytics</span>
                        Analytics
                    </button>
                </div>
            </div>
        </div>
    );
}
