'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TaskStatusPanel from '@/components/dashboard/TaskStatusPanel';
import LeadsTable from '@/components/dashboard/LeadsTable';

export default function TaskStatusPage() {
  const params = useParams();
  const taskId = params.id;
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRandomCategoryTask, setIsRandomCategoryTask] = useState(false);

  useEffect(() => {
    // Fetch task data to determine if it's a random category task
    const fetchTask = async () => {
      try {
        const response = await fetch(`/api/tasks?id=${taskId}`);
        if (response.ok) {
          const data = await response.json();
          setTask(data);
          
          // Check if this is a random category task based on params
          if (data.params) {
            try {
              const params = typeof data.params === 'string' ? JSON.parse(data.params) : data.params;
              setIsRandomCategoryTask(params.useRandomCategories === true);
            } catch (e) {
              console.error('Error parsing task params:', e);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching task data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href="/dashboard">
          <button className="flex items-center text-sm mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
        </Link>
        <h1 className="text-2xl font-bold">Task Details</h1>
        <p className="text-gray-600">View status and results for task ID: {taskId}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task status panel - Left Column */}
        <div>
          <TaskStatusPanel 
            taskId={taskId} 
            isRandomCategoryTask={isRandomCategoryTask}
          />
        </div>
        
        {/* Leads table - Right Column */}
        <div>
          <LeadsTable 
            taskId={taskId} 
            isRandomCategoryTask={isRandomCategoryTask}
          />
        </div>
      </div>
    </div>
  );
}
