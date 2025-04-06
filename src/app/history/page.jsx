"use client";

import React, { useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

export default function HistoryPage() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTasks = async () => {
            try {
                setLoading(true);
                const response = await fetch('/api/tasks');

                if (response.ok) {
                    const data = await response.json();
                    setTasks(data);
                } else {
                    console.error('Error fetching tasks');
                }
            } catch (error) {
                console.error('Error:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTasks();
    }, []);

    const getStatusClass = (status) => {
        switch (status) {
            case 'completed': return 'bg-success-light text-success';
            case 'running': return 'bg-primary-light text-primary';
            case 'failed': return 'bg-error-light text-error';
            case 'pending': return 'bg-gray-100 text-gray-500';
            default: return 'bg-gray-100 text-gray-500';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed': return 'check_circle';
            case 'running': return 'pending';
            case 'failed': return 'error';
            case 'pending': return 'hourglass_empty';
            default: return 'hourglass_empty';
        }
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
                                <h1 className="text-3xl font-bold mb-1">Task History</h1>
                                <p className="text-gray-500">View all your previous and current scraping tasks</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button className="btn btn-outline flex items-center px-4 py-2.5">
                                    <span className="material-icons mr-2 text-sm">filter_list</span>
                                    Filter
                                </button>
                            </div>
                        </div>

                        <div className="card p-5 mb-6">
                            <h2 className="text-xl font-semibold mb-5 flex items-center">
                                <span className="material-icons mr-3 text-primary">history</span>
                                All Tasks
                            </h2>

                            {loading ? (
                                <div className="animate-pulse space-y-4">
                                    {[...Array(5)].map((_, i) => (
                                        <div key={i} className="h-20 bg-gray-100 rounded-lg"></div>
                                    ))}
                                </div>
                            ) : tasks.length > 0 ? (
                                <div className="space-y-4">
                                    {tasks.map((task) => (
                                        <div key={task.id} className="border border-light rounded-lg p-4 hover:shadow-sm transition">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <div className="font-medium text-lg">{task.search_term}</div>
                                                    <div className="flex items-center mt-2 space-x-4 text-sm text-gray-500">
                                                        <div className="flex items-center">
                                                            <span className="material-icons text-sm mr-1">calendar_today</span>
                                                            {new Date(task.created_at).toLocaleDateString()}
                                                        </div>
                                                        <div className="flex items-center">
                                                            <span className="material-icons text-sm mr-1">schedule</span>
                                                            {new Date(task.created_at).toLocaleTimeString()}
                                                        </div>
                                                        <div className="flex items-center">
                                                            <span className="material-icons text-sm mr-1">business</span>
                                                            {task.businesses_found} businesses
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-end">
                                                    <span className={`px-2.5 py-1 rounded-full ${getStatusClass(task.status)} text-xs font-medium`}>
                                                        {task.status}
                                                    </span>
                                                    <div className="mt-2 flex space-x-2">
                                                        <button
                                                            className="p-1.5 rounded-md hover:bg-primary-light text-gray-500 hover:text-primary transition"
                                                            title="View Details"
                                                        >
                                                            <span className="material-icons text-sm">visibility</span>
                                                        </button>
                                                        <button
                                                            className="p-1.5 rounded-md hover:bg-secondary-light text-gray-500 hover:text-secondary transition"
                                                            title="Download Results"
                                                        >
                                                            <span className="material-icons text-sm">file_download</span>
                                                        </button>
                                                        <button
                                                            className="p-1.5 rounded-md hover:bg-error-light text-gray-500 hover:text-error transition"
                                                            title="Delete Task"
                                                        >
                                                            <span className="material-icons text-sm">delete</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-gray-500 border border-dashed border-gray-200 rounded-lg">
                                    <span className="material-icons text-4xl mb-2">history</span>
                                    <p>No tasks found. Create a task to get started.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
