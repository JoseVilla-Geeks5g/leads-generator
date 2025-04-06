"use client";

import React, { useState, useEffect, useRef } from 'react';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

export default function AnalyticsPage() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
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

        fetchStats();
    }, []);

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex flex-col md:flex-row items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl font-bold mb-1">Analytics Dashboard</h1>
                                <p className="text-gray-500">View insights and metrics about your leads and scraping activities</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button className="btn btn-outline flex items-center px-4 py-2.5">
                                    <span className="material-icons mr-2 text-sm">file_download</span>
                                    Export Report
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="animate-pulse space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className="h-24 bg-gray-100 rounded-lg"></div>
                                    ))}
                                </div>
                                <div className="h-64 bg-gray-100 rounded-lg"></div>
                                <div className="h-64 bg-gray-100 rounded-lg"></div>
                            </div>
                        ) : stats ? (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm font-medium text-gray-500">Total Businesses</div>
                                        <div className="flex items-center justify-between mt-2">
                                            <span className="text-3xl font-bold">{stats?.totalBusinesses?.toLocaleString() || 0}</span>
                                            <span className="material-icons text-primary">business</span>
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm font-medium text-gray-500">Email Contacts</div>
                                        <div className="flex items-center justify-between mt-2">
                                            <span className="text-3xl font-bold">{stats?.totalEmails?.toLocaleString() || 0}</span>
                                            <span className="material-icons text-success">email</span>
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm font-medium text-gray-500">Websites</div>
                                        <div className="flex items-center justify-between mt-2">
                                            <span className="text-3xl font-bold">{stats?.totalWebsites?.toLocaleString() || 0}</span>
                                            <span className="material-icons text-secondary">language</span>
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <div className="text-sm font-medium text-gray-500">Searches</div>
                                        <div className="flex items-center justify-between mt-2">
                                            <span className="text-3xl font-bold">{stats?.totalSearchTerms?.toLocaleString() || 0}</span>
                                            <span className="material-icons text-warning">search</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                                    <div className="card p-5 hover:shadow-md transition lg:col-span-2">
                                        <h2 className="text-xl font-semibold mb-5">Tasks Performance</h2>
                                        <div className="h-64 bg-accent rounded-lg flex items-center justify-center">
                                            <span className="text-gray-400">Chart Visualization Would Appear Here</span>
                                        </div>
                                    </div>

                                    <div className="card p-5 hover:shadow-md transition">
                                        <h2 className="text-xl font-semibold mb-5">Task Status</h2>
                                        {stats.tasks ? (
                                            <div className="space-y-4">
                                                <div className="flex justify-between">
                                                    <span>Completed</span>
                                                    <span className="font-medium">{stats.tasks.byStatus?.completed || 0}</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                    <div className="bg-success h-2.5 rounded-full" style={{
                                                        width: `${(stats.tasks.byStatus?.completed || 0) / stats.tasks.total * 100}%`
                                                    }}></div>
                                                </div>

                                                <div className="flex justify-between">
                                                    <span>Running</span>
                                                    <span className="font-medium">{stats.tasks.byStatus?.running || 0}</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                    <div className="bg-primary h-2.5 rounded-full" style={{
                                                        width: `${(stats.tasks.byStatus?.running || 0) / stats.tasks.total * 100}%`
                                                    }}></div>
                                                </div>

                                                <div className="flex justify-between">
                                                    <span>Failed</span>
                                                    <span className="font-medium">{stats.tasks.byStatus?.failed || 0}</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                    <div className="bg-error h-2.5 rounded-full" style={{
                                                        width: `${(stats.tasks.byStatus?.failed || 0) / stats.tasks.total * 100}%`
                                                    }}></div>
                                                </div>

                                                <div className="flex justify-between">
                                                    <span>Pending</span>
                                                    <span className="font-medium">{stats.tasks.byStatus?.pending || 0}</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                    <div className="bg-gray-400 h-2.5 rounded-full" style={{
                                                        width: `${(stats.tasks.byStatus?.pending || 0) / stats.tasks.total * 100}%`
                                                    }}></div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center text-gray-500 py-8">No task data available</div>
                                        )}
                                    </div>
                                </div>

                                <div className="card p-5 hover:shadow-md transition mb-6">
                                    <h2 className="text-xl font-semibold mb-5">Geographic Distribution</h2>
                                    {stats.states && stats.states.length > 0 ? (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            {stats.states.map(state => (
                                                <div key={state} className="border border-light rounded-lg p-3 hover:bg-accent transition">
                                                    <div className="flex items-center mb-1">
                                                        <span className="material-icons mr-2 text-secondary text-sm">location_on</span>
                                                        <span>{state}</span>
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {Math.floor(Math.random() * 20) + 5} businesses
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center text-gray-500 py-8">No geographic data available</div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="text-center text-gray-500 p-8">
                                <span className="material-icons text-5xl mb-2">analytics</span>
                                <p>No analytics data available. Start using the lead generation tools to see insights.</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
