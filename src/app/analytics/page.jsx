"use client";

import React, { useState, useEffect, useRef } from 'react';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

export default function AnalyticsPage() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('all'); // all, withEmail, withWebsite
    const [systemStatus, setSystemStatus] = useState(null);
    const [exportHistory, setExportHistory] = useState([]);
    const hasFetchedRef = useRef(false);

    useEffect(() => {
        // Only fetch once per page load
        if (hasFetchedRef.current) return;

        const fetchStats = async () => {
            // Try to use cached data first if available
            try {
                const cachedData = localStorage.getItem('stats_cache');
                if (cachedData) {
                    const { data, timestamp } = JSON.parse(cachedData);
                    // Use cache if less than 1 hour old
                    if (Date.now() - timestamp < 60 * 60 * 1000) {
                        setStats(data);
                        setLoading(false);
                        return;
                    }
                }
            } catch (err) {
                console.error('Error reading cached stats:', err);
            }

            try {
                setLoading(true);
                const response = await fetch('/api/stats');

                if (response.ok) {
                    const data = await response.json();
                    setStats(data);

                    // Cache the data for other components to use
                    try {
                        localStorage.setItem('stats_cache', JSON.stringify({
                            data,
                            timestamp: Date.now()
                        }));
                    } catch (err) {
                        console.error('Error caching stats:', err);
                    }
                } else {
                    console.error('Error fetching statistics');
                }
            } catch (error) {
                console.error('Error:', error);
            } finally {
                setLoading(false);
                hasFetchedRef.current = true;
            }
        };

        const fetchSystemStatus = async () => {
            try {
                const response = await fetch('/api/status?type=system');
                if (response.ok) {
                    const data = await response.json();
                    setSystemStatus(data);
                }
            } catch (err) {
                console.error('Error fetching system status:', err);
            }
        };

        const fetchExportHistory = async () => {
            try {
                const response = await fetch('/api/status?type=storage');
                if (response.ok) {
                    const data = await response.json();
                    setExportHistory(data.files || []);
                }
            } catch (err) {
                console.error('Error fetching export history:', err);
            }
        };

        fetchStats();
        fetchSystemStatus();
        fetchExportHistory();
    }, []);

    // Function to create state-by-state bar chart
    const renderStateChart = () => {
        if (!stats || !stats.stateData || stats.stateData.length === 0) {
            return <div className="p-8 text-center text-gray-500">No state data available</div>;
        }

        // Find the max value for scaling
        const maxCount = Math.max(...stats.stateData.map(s => s.count));

        return (
            <div className="overflow-x-auto">
                <div className="min-w-[600px] h-[300px] flex items-end space-x-2">
                    {stats.stateData.map(state => (
                        <div key={state.state} className="flex flex-col items-center">
                            <div
                                className="w-12 bg-primary-light hover:bg-primary transition-colors cursor-pointer rounded-t"
                                style={{ height: `${(state.count / maxCount) * 270}px` }}
                                title={`${state.state}: ${state.count.toLocaleString()} businesses`}
                            >
                                <div className="h-full w-full flex items-center justify-center text-primary font-bold">
                                    {Math.round((state.count / stats.totalBusinesses) * 100)}%
                                </div>
                            </div>
                            <div className="text-xs mt-2 font-medium">{state.state}</div>
                            <div className="text-xs text-gray-500">{state.count.toLocaleString()}</div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // Function to create email coverage visualization
    const renderEmailCoverage = () => {
        if (!stats) return null;

        return (
            <div className="flex items-center">
                <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                        className="bg-primary h-4 rounded-full"
                        style={{ width: `${stats.emailCoverage}%` }}
                    ></div>
                </div>
                <span className="ml-4 font-bold">{stats.emailCoverage}%</span>
            </div>
        );
    };

    // Function to create website coverage visualization
    const renderWebsiteCoverage = () => {
        if (!stats) return null;

        return (
            <div className="flex items-center">
                <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                        className="bg-secondary h-4 rounded-full"
                        style={{ width: `${stats.websiteCoverage}%` }}
                    ></div>
                </div>
                <span className="ml-4 font-bold">{stats.websiteCoverage}%</span>
            </div>
        );
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
                                <h1 className="text-3xl font-bold mb-1">Analytics</h1>
                                <p className="text-gray-500">Explore your lead data insights</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button
                                    onClick={() => setFilter('all')}
                                    className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline'} px-3 py-2`}
                                >
                                    All Data
                                </button>
                                <button
                                    onClick={() => setFilter('withEmail')}
                                    className={`btn ${filter === 'withEmail' ? 'btn-primary' : 'btn-outline'} px-3 py-2`}
                                >
                                    With Email
                                </button>
                                <button
                                    onClick={() => setFilter('withWebsite')}
                                    className={`btn ${filter === 'withWebsite' ? 'btn-primary' : 'btn-outline'} px-3 py-2`}
                                >
                                    With Website
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="animate-pulse space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className="h-32 bg-gray-200 rounded"></div>
                                    ))}
                                </div>
                                <div className="h-80 bg-gray-200 rounded mt-6"></div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                                    {[...Array(2)].map((_, i) => (
                                        <div key={i} className="h-60 bg-gray-200 rounded"></div>
                                    ))}
                                </div>
                            </div>
                        ) : error ? (
                            <div className="bg-error-light text-error p-4 rounded">
                                <p className="font-medium">Error loading analytics</p>
                                <p>{error}</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-2 btn btn-sm btn-error"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Stats Overview */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm text-gray-500 mb-1">Total Businesses</div>
                                        <div className="text-3xl font-bold text-primary mb-2">
                                            {stats?.totalBusinesses?.toLocaleString() || 0}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            From {stats?.totalSearchTerms?.toLocaleString() || 0} different categories
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm text-gray-500 mb-1">With Email</div>
                                        <div className="text-3xl font-bold text-primary mb-2">
                                            {stats?.totalEmails?.toLocaleString() || 0}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {stats?.emailCoverage || 0}% email coverage
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm text-gray-500 mb-1">With Website</div>
                                        <div className="text-3xl font-bold text-primary mb-2">
                                            {stats?.totalWebsites?.toLocaleString() || 0}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {stats?.websiteCoverage || 0}% website coverage
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm text-gray-500 mb-1">States</div>
                                        <div className="text-3xl font-bold text-primary mb-2">
                                            {stats?.states?.length || 0}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            Geographic coverage across USA
                                        </div>
                                    </div>
                                </div>

                                {/* State Distribution */}
                                <div className="card p-5 hover:shadow-md transition mb-6">
                                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                                        <span className="material-icons mr-3 text-primary">place</span>
                                        Business Distribution by State
                                    </h2>

                                    {renderStateChart()}
                                </div>

                                {/* Email & Website Coverage */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                    <div className="card p-5 hover:shadow-md transition">
                                        <h2 className="text-xl font-semibold mb-4 flex items-center">
                                            <span className="material-icons mr-3 text-primary">email</span>
                                            Email Coverage
                                        </h2>

                                        {renderEmailCoverage()}

                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <div className="bg-accent p-3 rounded">
                                                <div className="text-sm text-gray-500">With Email</div>
                                                <div className="text-2xl font-bold text-primary">
                                                    {stats?.totalEmails?.toLocaleString() || 0}
                                                </div>
                                            </div>
                                            <div className="bg-accent p-3 rounded">
                                                <div className="text-sm text-gray-500">Without Email</div>
                                                <div className="text-2xl font-bold text-gray-500">
                                                    {stats ? (stats.totalBusinesses - stats.totalEmails).toLocaleString() : 0}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <h2 className="text-xl font-semibold mb-4 flex items-center">
                                            <span className="material-icons mr-3 text-primary">language</span>
                                            Website Coverage
                                        </h2>

                                        {renderWebsiteCoverage()}

                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <div className="bg-accent p-3 rounded">
                                                <div className="text-sm text-gray-500">With Website</div>
                                                <div className="text-2xl font-bold text-secondary">
                                                    {stats?.totalWebsites?.toLocaleString() || 0}
                                                </div>
                                            </div>
                                            <div className="bg-accent p-3 rounded">
                                                <div className="text-sm text-gray-500">Without Website</div>
                                                <div className="text-2xl font-bold text-gray-500">
                                                    {stats ? (stats.totalBusinesses - stats.totalWebsites).toLocaleString() : 0}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Tasks Summary */}
                                <div className="card p-5 hover:shadow-md transition mb-6">
                                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                                        <span className="material-icons mr-3 text-primary">task_alt</span>
                                        Tasks Summary
                                    </h2>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-accent p-4 rounded">
                                            <div className="text-sm text-gray-500">Total Tasks</div>
                                            <div className="text-2xl font-bold">
                                                {stats?.tasks?.total || 0}
                                            </div>
                                        </div>

                                        <div className="bg-success-light p-4 rounded">
                                            <div className="text-sm text-gray-500">Completed</div>
                                            <div className="text-2xl font-bold text-success">
                                                {stats?.tasks?.byStatus?.completed || 0}
                                            </div>
                                        </div>

                                        <div className="bg-primary-light p-4 rounded">
                                            <div className="text-sm text-gray-500">Running</div>
                                            <div className="text-2xl font-bold text-primary">
                                                {stats?.tasks?.byStatus?.running || 0}
                                            </div>
                                        </div>

                                        <div className="bg-error-light p-4 rounded">
                                            <div className="text-sm text-gray-500">Failed</div>
                                            <div className="text-2xl font-bold text-error">
                                                {stats?.tasks?.byStatus?.failed || 0}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Export Options & History */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                    <div className="card p-5 hover:shadow-md transition">
                                        <h2 className="text-xl font-semibold mb-4 flex items-center">
                                            <span className="material-icons mr-3 text-primary">file_download</span>
                                            Export Options
                                        </h2>

                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => window.location.href = '/export'}
                                                className="p-4 bg-accent hover:bg-primary-light transition rounded flex flex-col items-center justify-center"
                                            >
                                                <span className="material-icons mb-2 text-2xl text-primary">download</span>
                                                <span className="font-medium">Advanced Export</span>
                                                <span className="text-xs text-gray-500 text-center mt-1">
                                                    Customize filters & options
                                                </span>
                                            </button>

                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const response = await fetch('/api/export', {
                                                            method: 'POST',
                                                            headers: {
                                                                'Content-Type': 'application/json',
                                                            },
                                                            body: JSON.stringify({ forceUnfiltered: true }),
                                                        });

                                                        if (response.ok) {
                                                            const data = await response.json();
                                                            window.open(data.downloadUrl, '_blank');
                                                        }
                                                    } catch (err) {
                                                        console.error('Export error:', err);
                                                        alert('Export failed: ' + err.message);
                                                    }
                                                }}
                                                className="p-4 bg-accent hover:bg-primary-light transition rounded flex flex-col items-center justify-center"
                                            >
                                                <span className="material-icons mb-2 text-2xl text-primary">article</span>
                                                <span className="font-medium">Quick Export</span>
                                                <span className="text-xs text-gray-500 text-center mt-1">
                                                    Export all leads to Excel
                                                </span>
                                            </button>

                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const response = await fetch('/api/export', {
                                                            method: 'POST',
                                                            headers: {
                                                                'Content-Type': 'application/json',
                                                            },
                                                            body: JSON.stringify({
                                                                filter: { hasEmail: true }
                                                            }),
                                                        });

                                                        if (response.ok) {
                                                            const data = await response.json();
                                                            window.open(data.downloadUrl, '_blank');
                                                        }
                                                    } catch (err) {
                                                        console.error('Export error:', err);
                                                        alert('Export failed: ' + err.message);
                                                    }
                                                }}
                                                className="p-4 bg-accent hover:bg-primary-light transition rounded flex flex-col items-center justify-center"
                                            >
                                                <span className="material-icons mb-2 text-2xl text-primary">email</span>
                                                <span className="font-medium">Email Leads Only</span>
                                                <span className="text-xs text-gray-500 text-center mt-1">
                                                    Export contacts with emails
                                                </span>
                                            </button>

                                            <button
                                                onClick={() => window.location.href = '/email-finder'}
                                                className="p-4 bg-accent hover:bg-primary-light transition rounded flex flex-col items-center justify-center"
                                            >
                                                <span className="material-icons mb-2 text-2xl text-primary">search</span>
                                                <span className="font-medium">Find Emails</span>
                                                <span className="text-xs text-gray-500 text-center mt-1">
                                                    Run email finder tool
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <h2 className="text-xl font-semibold mb-4 flex items-center">
                                            <span className="material-icons mr-3 text-primary">history</span>
                                            Recent Exports
                                        </h2>

                                        {exportHistory.length > 0 ? (
                                            <div className="overflow-y-auto max-h-60">
                                                <table className="w-full text-sm">
                                                    <thead className="text-left bg-accent rounded">
                                                        <tr>
                                                            <th className="p-2">Filename</th>
                                                            <th className="p-2">Date</th>
                                                            <th className="p-2">Size</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {exportHistory.map((file, index) => (
                                                            <tr key={index} className="border-b border-light">
                                                                <td className="p-2 text-primary">
                                                                    {file.name.length > 30 ? file.name.substring(0, 30) + '...' : file.name}
                                                                </td>
                                                                <td className="p-2">{new Date(file.created).toLocaleDateString()}</td>
                                                                <td className="p-2">{file.sizeFormatted}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 text-gray-500">
                                                <span className="material-icons text-3xl mb-2">info</span>
                                                <p>No export history found</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* System Status */}
                                {systemStatus && (
                                    <div className="card p-5 hover:shadow-md transition mb-6">
                                        <h2 className="text-xl font-semibold mb-4 flex items-center">
                                            <span className="material-icons mr-3 text-primary">memory</span>
                                            System Status
                                        </h2>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="bg-accent p-4 rounded">
                                                <div className="text-sm text-gray-500 mb-2">Database</div>
                                                <div className={`flex items-center ${systemStatus.database.connected ? 'text-success' : 'text-error'}`}>
                                                    <span className="material-icons mr-2">
                                                        {systemStatus.database.connected ? 'check_circle' : 'error'}
                                                    </span>
                                                    <span className="font-medium">
                                                        {systemStatus.database.connected ? 'Connected' : 'Disconnected'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    Size: {systemStatus.database.size}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Active connections: {systemStatus.database.connections}
                                                </div>
                                            </div>

                                            <div className="bg-accent p-4 rounded">
                                                <div className="text-sm text-gray-500 mb-2">Scraper Service</div>
                                                <div className={`flex items-center ${systemStatus.scraperService.initialized ? 'text-success' : 'text-gray-500'}`}>
                                                    <span className="material-icons mr-2">
                                                        {systemStatus.scraperService.initialized ? 'check_circle' : 'pending'}
                                                    </span>
                                                    <span className="font-medium">
                                                        {systemStatus.scraperService.initialized ? 'Ready' : 'Not Initialized'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    Tasks: {systemStatus.scraperService.taskCount}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Running tasks: {systemStatus.scraperService.runningTasks}
                                                </div>
                                            </div>

                                            <div className="bg-accent p-4 rounded">
                                                <div className="text-sm text-gray-500 mb-2">Export Service</div>
                                                <div className="flex items-center text-success">
                                                    <span className="material-icons mr-2">check_circle</span>
                                                    <span className="font-medium">Ready</span>
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    Directory: {systemStatus.exportService.directory.split('/').pop()}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Updated: {new Date(systemStatus.timestamp).toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
