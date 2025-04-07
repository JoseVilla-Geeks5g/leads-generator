'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function TaskDetailPage() {
    const params = useParams();
    const router = useRouter();
    const taskId = params.id;
    
    const [task, setTask] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshInterval, setRefreshInterval] = useState(null);
    
    // Fetch task details
    const fetchTaskDetails = async () => {
        try {
            const response = await fetch(`/api/tasks?id=${taskId}`);
            
            if (!response.ok) {
                throw new Error(`Error fetching task: ${response.statusText}`);
            }
            
            const data = await response.json();
            setTask(data);
            
            // Stop refreshing if task is completed or failed
            if (data.status === 'completed' || data.status === 'failed') {
                if (refreshInterval) {
                    clearInterval(refreshInterval);
                    setRefreshInterval(null);
                }
            }
            
            setLoading(false);
        } catch (error) {
            setError(error.message);
            setLoading(false);
            
            if (refreshInterval) {
                clearInterval(refreshInterval);
                setRefreshInterval(null);
            }
        }
    };
    
    // Setup automatic refresh
    useEffect(() => {
        fetchTaskDetails();
        
        const interval = setInterval(() => {
            fetchTaskDetails();
        }, 5000); // Refresh every 5 seconds
        
        setRefreshInterval(interval);
        
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [taskId]);
    
    // Function to check if this is a random category task
    const isRandomCategoryTask = () => {
        if (!task || !task.params) return false;
        
        try {
            const params = typeof task.params === 'string' ? JSON.parse(task.params) : task.params;
            return params.useRandomCategories === true;
        } catch (e) {
            return false;
        }
    };
    
    // Get random categories from task params
    const getRandomCategories = () => {
        if (!task || !task.params) return [];
        
        try {
            const params = typeof task.params === 'string' ? JSON.parse(task.params) : task.params;
            return params.selectedRandomCategories || [];
        } catch (e) {
            return [];
        }
    };
    
    const getStatusBadge = (status) => {
        const statusStyles = {
            pending: 'bg-yellow-100 text-yellow-800',
            running: 'bg-blue-100 text-blue-800 animate-pulse',
            completed: 'bg-green-100 text-green-800',
            failed: 'bg-red-100 text-red-800'
        };
        
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100'}`}>
                {status}
            </span>
        );
    };

    // Handle viewing leads button
    const handleViewLeads = () => {
        if (isRandomCategoryTask()) {
            // Redirect to leads page with filter for these random categories
            router.push(`/leads?taskId=${taskId}&isRandomCategoryTask=true`);
        } else {
            // Regular task - redirect to leads page with filter
            router.push(`/leads?taskId=${taskId}`);
        }
    };
    
    if (loading) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-5xl">
                <h1 className="text-2xl font-semibold mb-6">Task Details</h1>
                <div className="card p-8 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mr-3"></div>
                    <span>Loading task details...</span>
                </div>
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-5xl">
                <h1 className="text-2xl font-semibold mb-6">Task Details</h1>
                <div className="card p-8 bg-red-50 border border-red-200">
                    <h2 className="text-xl text-red-600 mb-2">Error</h2>
                    <p className="text-gray-700">{error}</p>
                    <div className="mt-4">
                        <Link href="/leads" className="btn btn-primary">
                            Go to Leads
                        </Link>
                    </div>
                </div>
            </div>
        );
    }
    
    if (!task) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-5xl">
                <h1 className="text-2xl font-semibold mb-6">Task Details</h1>
                <div className="card p-8">
                    <h2 className="text-xl mb-2">Task Not Found</h2>
                    <p className="text-gray-700">The task you're looking for doesn't exist or has been deleted.</p>
                    <div className="mt-4">
                        <Link href="/" className="btn btn-primary">
                            Go to Dashboard
                        </Link>
                    </div>
                </div>
            </div>
        );
    }
    
    const randomCategoriesShown = isRandomCategoryTask();
    const randomCategories = getRandomCategories();
    
    return (
        <div className="container mx-auto px-4 py-8 max-w-5xl">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-semibold">Task Details</h1>
                <div>
                    <Link href="/" className="btn btn-outline mr-2">
                        Back to Dashboard
                    </Link>
                    {task.status === 'completed' && (
                        <button 
                            onClick={handleViewLeads}
                            className="btn btn-primary"
                        >
                            View Leads
                        </button>
                    )}
                </div>
            </div>
            
            <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <span className="text-sm text-gray-500">Task ID:</span>
                        <h2 className="text-lg font-medium">{taskId}</h2>
                    </div>
                    <div>
                        {getStatusBadge(task.status)}
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                        <h3 className="text-sm text-gray-500 mb-1">Search Term</h3>
                        <p className="font-medium">{task.search_term || "N/A"}</p>
                    </div>
                    
                    <div>
                        <h3 className="text-sm text-gray-500 mb-1">Location</h3>
                        <p className="font-medium">{task.location || "N/A"}</p>
                    </div>
                    
                    <div>
                        <h3 className="text-sm text-gray-500 mb-1">Created At</h3>
                        <p className="font-medium">
                            {task.created_at ? new Date(task.created_at).toLocaleString() : "N/A"}
                        </p>
                    </div>
                    
                    <div>
                        <h3 className="text-sm text-gray-500 mb-1">Completed At</h3>
                        <p className="font-medium">
                            {task.completed_at ? new Date(task.completed_at).toLocaleString() : "N/A"}
                        </p>
                    </div>
                </div>
                
                <div className="mb-6">
                    <h3 className="text-sm text-gray-500 mb-1">Progress</h3>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div 
                            className={`h-2.5 rounded-full ${
                                task.status === 'completed' ? 'bg-green-600' : 
                                task.status === 'failed' ? 'bg-red-600' : 'bg-blue-600'
                            }`}
                            style={{ width: `${task.status === 'completed' ? '100' : task.progress || 0}%` }}
                        ></div>
                    </div>
                </div>
                
                <div>
                    <h3 className="text-sm text-gray-500 mb-1">Businesses Found</h3>
                    <p className="font-medium text-xl">{task.businesses_found || 0}</p>
                </div>
                
                {randomCategoriesShown && randomCategories.length > 0 && (
                    <div className="mt-6 p-4 bg-accent rounded-lg">
                        <h3 className="font-medium mb-2">Random Category Task</h3>
                        <p className="text-sm text-gray-600 mb-2">
                            This task used randomly selected categories to find leads.
                        </p>
                        <div className="mt-2">
                            <h4 className="text-sm text-gray-500">Categories:</h4>
                            <div className="flex flex-wrap gap-2 mt-1">
                                {randomCategories.map((category, index) => (
                                    <span key={index} className="bg-primary-light text-primary px-2 py-1 text-xs rounded-full">
                                        {category}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
