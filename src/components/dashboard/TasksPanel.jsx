"use client";

import React, { useState, useEffect } from 'react';

export default function TasksPanel() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newTask, setNewTask] = useState('');
    const [creatingTask, setCreatingTask] = useState(false);

    useEffect(() => {
        fetchTasks();
        // Poll for task updates every 10 seconds
        const interval = setInterval(fetchTasks, 10000);
        return () => clearInterval(interval);
    }, []);

    const fetchTasks = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/tasks');

            if (!response.ok) {
                throw new Error('Failed to fetch tasks');
            }

            const data = await response.json();
            setTasks(data);
        } catch (err) {
            console.error('Error fetching tasks:', err);
        } finally {
            setLoading(false);
        }
    };

    const createTask = async (e) => {
        e.preventDefault();
        if (!newTask.trim()) return;

        try {
            setCreatingTask(true);
            const response = await fetch('/api/tasks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ searchTerm: newTask }),
            });

            if (!response.ok) {
                throw new Error('Failed to create task');
            }

            const data = await response.json();
            setNewTask('');
            fetchTasks();
        } catch (err) {
            alert('Error creating task: ' + err.message);
        } finally {
            setCreatingTask(false);
        }
    };

    const getStatusClass = (status) => {
        switch (status) {
            case 'completed': return 'bg-success-light text-success';
            case 'running': return 'bg-primary-light text-primary';
            case 'failed': return 'bg-error-light text-error';
            default: return 'bg-gray-100 text-gray-500';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed': return 'check_circle';
            case 'running': return 'pending';
            case 'failed': return 'error';
            default: return 'hourglass_empty';
        }
    };

    return (
        <div className="card p-5 hover:shadow-md transition">
            <h2 className="text-xl font-semibold mb-5 flex items-center">
                <span className="material-icons mr-3 text-primary">assignment</span>
                Scraping Tasks
            </h2>

            <form onSubmit={createTask} className="mb-6">
                <div className="flex flex-col sm:flex-col gap-3">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            value={newTask}
                            onChange={(e) => setNewTask(e.target.value)}
                            placeholder="e.g. 'Restaurants in New York'"
                            className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                        />
                        <span className="material-icons absolute left-3 top-3 text-gray-400">search</span>
                    </div>

                    <button
                        type="submit"
                        disabled={creatingTask || !newTask.trim()}
                        className="btn btn-primary px-5 py-3 shadow-md hover:shadow-lg"
                    >
                        {creatingTask ? (
                            <>
                                <span className="animate-spin material-icons mr-2">refresh</span>
                                Creating...
                            </>
                        ) : (
                            <>
                                <span className="material-icons mr-2">add</span>
                                New Task
                            </>
                        )}
                    </button>
                </div>
            </form>

            <div className="space-y-3 mb-4">
                <h3 className="text-sm font-medium text-gray-500">Recent Tasks</h3>
                {loading && tasks.length === 0 ? (
                    <div className="animate-pulse space-y-3">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-100 rounded-lg"></div>
                        ))}
                    </div>
                ) : tasks.length > 0 ? (
                    tasks.slice(0, 5).map(task => (
                        <div key={task.id} className="p-4 rounded-lg bg-accent hover:shadow-sm transition">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="font-medium">{task.search_term}</div>
                                    <div className="mt-1 flex items-center text-sm">
                                        <span className={`px-2 py-0.5 rounded-full ${getStatusClass(task.status)} mr-2 text-xs`}>
                                            {task.status}
                                        </span>
                                        <span className="text-gray-500 text-xs">
                                            {new Date(task.created_at).toLocaleString()} •
                                            {task.businesses_found} businesses
                                        </span>
                                    </div>
                                </div>
                                <span className={`material-icons ${task.status === 'completed' ? 'text-success' : task.status === 'failed' ? 'text-error' : 'text-primary'}`}>
                                    {getStatusIcon(task.status)}
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="p-8 text-center text-gray-500 border border-dashed border-gray-200 rounded-lg">
                        <span className="material-icons text-4xl mb-2">assignment</span>
                        <p>No tasks yet. Create your first task.</p>
                    </div>
                )}
            </div>

            {tasks.length > 5 && (
                <div className="text-center">
                    <button className="btn btn-outline px-4 py-2 text-sm">
                        View All Tasks
                    </button>
                </div>
            )}
        </div>
    );
}
