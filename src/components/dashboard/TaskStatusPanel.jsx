"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Helper to format date
const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(date);
};

// Helper to get status color
const getStatusColor = (status) => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'running':
      return 'bg-blue-100 text-blue-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

// Helper to calculate progress percentage
const getProgressPercentage = (task) => {
  if (!task) return 0;
  
  if (task.status === 'completed') return 100;
  if (task.status === 'running') {
    // If it's a random category task, base progress on categories completed
    if (task.params) {
      try {
        const params = typeof task.params === 'string' 
          ? JSON.parse(task.params) 
          : task.params;
        
        if (params.categoriesCompleted && params.totalCategories) {
          return Math.min(100, Math.round((params.categoriesCompleted / params.totalCategories) * 100));
        }
      } catch (e) {
        console.error('Failed to parse task params:', e);
      }
    }
    // Default to indeterminate progress animation
    return 30;
  }
  return 0;
};

const TaskStatusPanel = ({ taskId, isRandomCategoryTask }) => {
  const [taskStatus, setTaskStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const router = useRouter();
  
  useEffect(() => {
    // Function to fetch task status
    const fetchTaskStatus = async () => {
      if (!taskId) return;
      
      try {
        setLoading(true);
        const response = await fetch(`/api/tasks?id=${taskId}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch task status: ${response.statusText}`);
        }
        
        const data = await response.json();
        setTaskStatus(data);
      } catch (err) {
        console.error('Error fetching task status:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    // Initial fetch
    fetchTaskStatus();
    
    // Set up polling interval
    const intervalId = setInterval(fetchTaskStatus, 5000);
    
    // Clean up interval on unmount
    return () => clearInterval(intervalId);
  }, [taskId]);

  // Extract categories count for random category tasks
  const getCategoriesInfo = () => {
    if (!isRandomCategoryTask || !taskStatus?.params) return null;
    
    try {
      // Parse params if it's a string
      const params = typeof taskStatus.params === 'string' 
        ? JSON.parse(taskStatus.params) 
        : taskStatus.params;
      
      // Get the categories count and completed count
      const categoriesCount = params.selectedRandomCategories?.length || 0;
      const categoriesCompleted = params.categoriesCompleted || 0;
      
      return { categoriesCount, categoriesCompleted };
    } catch (error) {
      console.error('Error parsing task params:', error);
      return null;
    }
  };

  // Handle export click
  const handleExport = () => {
    setShowExportModal(true);
  };

  // Handle view leads click
  const handleViewLeads = () => {
    router.push(`/leads?taskId=${taskId}${isRandomCategoryTask ? '&isRandom=true' : ''}`);
  };

  // Use a consistent card layout with specific height and proper spacing
  return (
    <div className="bg-white shadow-md rounded-lg p-4 md:p-6 flex flex-col h-full">
      <h3 className="text-xl font-bold mb-4">Task Status</h3>
      
      {loading && (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-2">Loading task status...</span>
        </div>
      )}
      
      {error && !loading && (
        <div className="text-red-500">
          <p>Error: {error}</p>
          <button 
            className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      )}
      
      {!loading && !error && taskStatus && (
        <div className="flex-1 flex flex-col">
          <div className="flex justify-between mb-3 items-center">
            <span className="font-medium">Status:</span>
            <span className={`px-2 py-1 rounded text-sm ${getStatusColor(taskStatus.status)}`}>
              {taskStatus.status.charAt(0).toUpperCase() + taskStatus.status.slice(1)}
            </span>
          </div>
          
          <div className="flex justify-between mb-3">
            <span className="font-medium">Search Term:</span>
            <span className="text-gray-700">{taskStatus.search_term}</span>
          </div>
          
          {/* Add Categories Info for Random Category Tasks */}
          {isRandomCategoryTask && getCategoriesInfo() && (
            <div className="flex justify-between mb-3">
              <span className="font-medium">Categories:</span>
              <span className="text-gray-700">{getCategoriesInfo().categoriesCompleted || 0} / {getCategoriesInfo().categoriesCount} processed</span>
            </div>
          )}
          
          <div className="flex justify-between mb-3">
            <span className="font-medium">Businesses Found:</span>
            <span className="text-gray-700">{taskStatus.businesses_found || 0}</span>
          </div>
          
          {taskStatus.created_at && (
            <div className="flex justify-between mb-3">
              <span className="font-medium">Created:</span>
              <span className="text-gray-700">{formatDate(taskStatus.created_at)}</span>
            </div>
          )}
          
          {taskStatus.completed_at && (
            <div className="flex justify-between mb-3">
              <span className="font-medium">Completed:</span>
              <span className="text-gray-700">{formatDate(taskStatus.completed_at)}</span>
            </div>
          )}
          
          {/* Add progress bar for running tasks */}
          {taskStatus.status === 'running' && (
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full animate-pulse transition-all duration-500" 
                  style={{ width: `${getProgressPercentage(taskStatus)}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-500 mt-1 text-right">
                {isRandomCategoryTask && getCategoriesInfo() 
                  ? `Processing categories: ${getCategoriesInfo().categoriesCompleted || 0}/${getCategoriesInfo().categoriesCount}`
                  : 'Processing...'}
              </p>
            </div>
          )}
          
          {/* Add action buttons */}
          <div className="mt-auto pt-4 grid grid-cols-2 gap-3">
            {taskStatus.status === 'completed' && (
              <button 
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded flex items-center justify-center gap-2 transition-colors"
                onClick={handleExport}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Export
              </button>
            )}
            
            <button 
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center justify-center gap-2 transition-colors"
              onClick={handleViewLeads}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
              View Leads
            </button>
          </div>
        </div>
      )}
      
      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-xl font-semibold mb-4">Export Data</h3>
            <p className="mb-4">Choose your export format:</p>
            
            <div className="flex flex-col gap-3">
              <button 
                className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 flex items-center justify-center gap-2"
                onClick={() => {
                  window.open(`/api/export/download?taskId=${taskId}&format=excel${isRandomCategoryTask ? '&isRandom=true' : ''}`, '_blank');
                  setShowExportModal(false);
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Excel (.xlsx)
              </button>
              
              <button 
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center justify-center gap-2"
                onClick={() => {
                  window.open(`/api/export/download?taskId=${taskId}&format=csv${isRandomCategoryTask ? '&isRandom=true' : ''}`, '_blank');
                  setShowExportModal(false);
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                CSV
              </button>
            </div>
            
            <button 
              className="w-full mt-4 border border-gray-300 py-2 px-4 rounded hover:bg-gray-100 transition-colors"
              onClick={() => setShowExportModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskStatusPanel;
