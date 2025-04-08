"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import TasksPanel from '@/components/dashboard/TasksPanel';
import StatisticsPanel from '@/components/dashboard/StatisticsPanel';
import SearchFilters from '@/components/dashboard/SearchFilters';
import TaskStatusPanel from '@/components/dashboard/TaskStatusPanel';

export default function HomePage() {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex flex-col md:flex-row items-center justify-between mb-8">
                            <div>
                                <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
                                <p className="text-gray-500">Lead generation and scraping tool</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button
                                    onClick={() => router.push('/export')}
                                    className="btn btn-secondary flex items-center px-4 py-2.5 shadow-sm hover:shadow-md"
                                >
                                    <span className="material-icons mr-2 text-sm">download</span>
                                    Export Data
                                </button>
                                <button
                                    onClick={() => router.push('/leads')}
                                    className="btn btn-primary flex items-center px-4 py-2.5 shadow-md hover:shadow-lg"
                                >
                                    <span className="material-icons mr-2 text-sm">business</span>
                                    View Leads
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
                            <div className="lg:col-span-3">
                                <SearchFilters />
                            </div>
                            <div className="lg:col-span-1">
                                <StatisticsPanel />
                                <TasksPanel />
                            </div>
                            <div className="lg:col-span-3">
                                {/* <TaskStatusPanel /> */}
                            </div>

                        </div>

                        
                    </div>
                </main>
            </div>
        </div>
    );
}
