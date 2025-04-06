"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function TaskStatusPanel() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        running: 0,
        pending: 0,
        completed: 0,
        failed: 0,
        totalContacts: 0,
        progress: 0,
    });
    const router = useRouter();

    // Refs to prevent excessive fetching
    const isMountedRef = useRef(true);
    const dataFetchedRef = useRef(false);
    const lastFetchTimeRef = useRef(0);

    // Cache tasks in localStorage to avoid unnecessary fetches
    const CACHE_KEY = 'task_status_data';
    const CACHE_TIMEOUT = 30000; // 30 seconds

    // Fetch with better caching and throttling
    const fetchTasks = useCallback(async (force = false) => {
        // Don't fetch if component is unmounted
        if (!isMountedRef.current) return;

        // Throttle API calls - don't allow more than one call every 5 seconds
        const now = Date.now();
        if (!force && now - lastFetchTimeRef.current < 5000) {
            return;
        }

        // Check cache first unless forced refresh
        if (!force) {
            try {
                const cachedData = localStorage.getItem(CACHE_KEY);
                if (cachedData) {
                    const { data, timestamp } = JSON.parse(cachedData);
                    if (now - timestamp < CACHE_TIMEOUT) {
                        setTasks(data.tasks);
                        setStats(data.stats);
                        setLoading(false);
                        return;
                    }
                }
            } catch (err) {
                console.error('Error reading cache:', err);
            }
        }

        try {
            setLoading(true);
            lastFetchTimeRef.current = now;

            const response = await fetch('/api/tasks');

            if (!response.ok) {
                throw new Error('Failed to fetch tasks');
            }

            const data = await response.json();

            // Only set state if component is still mounted
            if (isMountedRef.current) {
                // Filter out any testing data if it exists
                const filteredTasks = data.filter(task =>
                    !task.search_term?.includes('Business') ||
                    !(/Business \d+$/.test(task.search_term))
                );

                // Calculate statistics
                const runningTasks = filteredTasks.filter(task => task.status === 'running');
                const pendingTasks = filteredTasks.filter(task => task.status === 'pending');
                const completedTasks = filteredTasks.filter(task => task.status === 'completed');
                const failedTasks = filteredTasks.filter(task => task.status === 'failed');

                const totalContacts = filteredTasks.reduce((sum, task) =>
                    sum + (task.businesses_found || 0), 0);

                // Calculate overall progress
                const totalTasks = filteredTasks.length;
                const finishedTasks = completedTasks.length + failedTasks.length;
                const progress = totalTasks > 0 ? Math.round((finishedTasks / totalTasks) * 100) : 0;

                const newStats = {
                    running: runningTasks.length,
                    pending: pendingTasks.length,
                    completed: completedTasks.length,
                    failed: failedTasks.length,
                    totalContacts,
                    progress
                };

                setTasks(filteredTasks);
                setStats(newStats);

                // Cache the result
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        data: {
                            tasks: filteredTasks,
                            stats: newStats
                        },
                        timestamp: now
                    }));
                } catch (err) {
                    console.error('Error caching task data:', err);
                }

                dataFetchedRef.current = true;
            }
        } catch (err) {
            console.error('Error fetching tasks:', err);
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    }, []);

    // Fetch tasks on component mount
    useEffect(() => {
        // Try to load from cache first
        try {
            const cachedData = localStorage.getItem(CACHE_KEY);
            if (cachedData) {
                const { data, timestamp } = JSON.parse(cachedData);
                if (Date.now() - timestamp < CACHE_TIMEOUT) {
                    setTasks(data.tasks);
                    setStats(data.stats);
                    setLoading(false);
                    dataFetchedRef.current = true;

                    // Still fetch fresh data in background after a short delay
                    setTimeout(() => fetchTasks(true), 1000);
                    return;
                }
            }
        } catch (err) {
            console.error('Error loading cached task data:', err);
        }

        // Fetch fresh data if no cache
        fetchTasks(true);

        // Use a higher interval to reduce resource usage (30 seconds)
        const interval = setInterval(() => fetchTasks(), 30000);

        // Clean up on unmount
        return () => {
            isMountedRef.current = false;
            clearInterval(interval);
        };
    }, [fetchTasks]);

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed': return 'check_circle';
            case 'running': return 'pending';
            case 'failed': return 'error';
            default: return 'hourglass_empty';
        }
    };

    const getStatusClass = (status) => {
        switch (status) {
            case 'completed': return 'text-success';
            case 'running': return 'text-primary';
            case 'failed': return 'text-error';
            default: return 'text-gray-400';
        }
    };

    // Show loading skeleton while data is being fetched
    if (loading && !dataFetchedRef.current) {
        return (
            <div className="card p-5 hover:shadow-md transition mb-6">
                <div className="animate-pulse">
                    <div className="h-8 bg-gray-200 w-60 mb-6 rounded"></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-20 bg-gray-200 rounded-lg"></div>
                        ))}
                    </div>
                    <div className="h-6 bg-gray-200 w-full rounded mb-2"></div>
                    <div className="h-4 bg-gray-200 w-full rounded"></div>
                </div>
            </div>
        );
    }

    // Return task status panel
    return (
        <div className="card p-5 hover:shadow-md transition mb-6">
            <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-semibold flex items-center">
                    <span className="material-icons mr-3 text-primary">assignment</span>
                    Live Task Status
                </h2>

                <button
                    onClick={() => fetchTasks(true)}
                    className="text-primary hover:underline flex items-center text-sm"
                    title="Refresh data"
                >
                    <span className="material-icons text-sm mr-1">refresh</span>
                    Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-primary-light rounded-lg p-4">
                    <div className="text-sm font-medium text-primary">Running</div>
                    <div className="text-2xl font-bold text-primary mt-1">
                        {stats.running}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">tasks in progress</div>
                </div>

                <div className="bg-warning-light rounded-lg p-4">
                    <div className="text-sm font-medium text-warning">Pending</div>
                    <div className="text-2xl font-bold text-warning mt-1">
                        {stats.pending}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">tasks waiting</div>
                </div>

                <div className="bg-success-light rounded-lg p-4">
                    <div className="text-sm font-medium text-success">Completed</div>
                    <div className="text-2xl font-bold text-success mt-1">
                        {stats.completed}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">tasks finished successfully</div>
                </div>

                <div className="bg-error-light rounded-lg p-4">
                    <div className="text-sm font-medium text-error">Failed</div>
                    <div className="text-2xl font-bold text-error mt-1">
                        {stats.failed}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">tasks with errors</div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between mb-4">
                <div>
                    <div className="text-lg font-semibold text-secondary mb-1">Total Leads</div>
                    <div className="flex items-center">
                        <span className="material-icons mr-2 text-secondary">people</span>
                        <span className="text-2xl font-bold">{stats.totalContacts}</span>
                    </div>
                </div>

                <div>
                    <div className="text-lg font-semibold text-primary mb-1">Tasks Progress</div>
                    <div className="flex items-center">
                        <span className="text-2xl font-bold">{stats.progress}%</span>
                        <div className="ml-3 bg-gray-200 rounded-full w-32 h-3">
                            <div
                                className="bg-primary h-3 rounded-full"
                                style={{ width: `${stats.progress}%` }}
                            ></div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6">
                <h3 className="text-sm font-medium mb-3 text-gray-500">Recent Activity</h3>
                {tasks.length > 0 ? (
                    <div className="space-y-3">
                        {tasks.slice(0, 3).map(task => (
                            <div key={task.id} className="flex items-center">
                                <span className={`material-icons mr-2 ${getStatusClass(task.status)}`}>
                                    {getStatusIcon(task.status)}
                                </span>
                                <div className="flex-1">
                                    <div className="font-medium">{task.search_term}</div>
                                    <div className="text-xs text-gray-500">
                                        {task.status === 'completed' &&
                                            `${task.businesses_found} leads found`
                                        }
                                        {task.status === 'running' &&
                                            'In progress'
                                        }
                                        {task.status === 'pending' &&
                                            'Waiting to start'
                                        }
                                        {task.status === 'failed' &&
                                            'Task failed'
                                        }
                                    </div>
                                </div>
                                <button
                                    onClick={() => router.push(`/tasks/${task.id}`)}
                                    className="p-1.5 rounded-md hover:bg-primary-light text-gray-500 hover:text-primary transition"
                                    title="View Details"
                                >
                                    <span className="material-icons text-sm">visibility</span>
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-4 text-gray-500 bg-accent rounded-lg">
                        No recent tasks. Start a search to generate leads.
                    </div>
                )}
            </div>
        </div>
    );
}
