"use client";

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import LeadsTable from '@/components/dashboard/LeadsTable';

export default function LeadsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // FIXED: Initialize with empty strings instead of null values
    const [filters, setFilters] = useState({
        state: searchParams.get('state') || '',
        city: searchParams.get('city') || '',
        hasEmail: searchParams.get('hasEmail') || '',
        hasWebsite: searchParams.get('hasWebsite') || ''
    });

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const applyFilters = (e) => {
        e.preventDefault();

        // Build the query string with only non-empty filters
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });

        // Navigate with the new filters
        router.push(`/leads${params.toString() ? `?${params.toString()}` : ''}`);
    };

    const clearFilters = () => {
        setFilters({
            state: '',
            city: '',
            hasEmail: '',
            hasWebsite: ''
        });
        router.push('/leads');
    };

    const exportLeads = async () => {
        try {
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    forceUnfiltered: true // FIXED: Use forceUnfiltered for full export
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to export leads');
            }

            const data = await response.json();
            window.open(data.downloadUrl, '_blank');
        } catch (err) {
            alert('Error exporting leads: ' + err.message);
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
                                <h1 className="text-3xl font-bold mb-1">Lead Explorer</h1>
                                <p className="text-gray-500">Search, filter and export your business leads</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button
                                    onClick={exportLeads}
                                    className="btn btn-primary flex items-center px-4 py-2.5 shadow-md hover:shadow-lg"
                                >
                                    <span className="material-icons mr-2 text-sm">file_download</span>
                                    Export All
                                </button>
                            </div>
                        </div>

                        <div className="mb-6">
                            <div className="card p-5 hover:shadow-md transition">
                                <h2 className="text-xl font-semibold mb-5 flex items-center">
                                    <span className="material-icons mr-3 text-primary">filter_list</span>
                                    Filter Leads
                                </h2>

                                <form onSubmit={applyFilters} className="space-y-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">State</label>
                                            <div className="relative">
                                                <select
                                                    name="state"
                                                    value={filters.state}
                                                    onChange={handleFilterChange}
                                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                >
                                                    <option value="">All States</option>
                                                    <option value="NY">New York</option>
                                                    <option value="CA">California</option>
                                                    <option value="TX">Texas</option>
                                                    <option value="FL">Florida</option>
                                                    <option value="IL">Illinois</option>
                                                    <option value="NJ">New Jersey</option>
                                                    <option value="WA">Washington</option>
                                                </select>
                                                <span className="material-icons absolute left-3 top-3 text-gray-400">location_on</span>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">City</label>
                                            <div className="relative">
                                                <select
                                                    name="city"
                                                    value={filters.city}
                                                    onChange={handleFilterChange}
                                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                >
                                                    <option value="">All Cities</option>
                                                    <option value="New York">New York</option>
                                                    <option value="San Francisco">San Francisco</option>
                                                    <option value="Chicago">Chicago</option>
                                                    <option value="Miami">Miami</option>
                                                    <option value="Seattle">Seattle</option>
                                                    <option value="Austin">Austin</option>
                                                    <option value="Gotham">Gotham</option>
                                                </select>
                                                <span className="material-icons absolute left-3 top-3 text-gray-400">location_city</span>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Has Email</label>
                                            <div className="relative">
                                                <select
                                                    name="hasEmail"
                                                    value={filters.hasEmail}
                                                    onChange={handleFilterChange}
                                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                >
                                                    <option value="">All</option>
                                                    <option value="true">Yes</option>
                                                    <option value="false">No</option>
                                                </select>
                                                <span className="material-icons absolute left-3 top-3 text-gray-400">email</span>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Has Website</label>
                                            <div className="relative">
                                                <select
                                                    name="hasWebsite"
                                                    value={filters.hasWebsite}
                                                    onChange={handleFilterChange}
                                                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                >
                                                    <option value="">All</option>
                                                    <option value="true">Yes</option>
                                                    <option value="false">No</option>
                                                </select>
                                                <span className="material-icons absolute left-3 top-3 text-gray-400">language</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-light">
                                        <button
                                            type="button"
                                            onClick={clearFilters}
                                            className="btn btn-outline px-5 py-2.5"
                                        >
                                            Clear Filters
                                        </button>
                                        <button
                                            type="submit"
                                            className="btn btn-primary px-5 py-2.5 shadow-md hover:shadow-lg"
                                        >
                                            <span className="material-icons mr-2">filter_list</span>
                                            Apply Filters
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <div className="mb-6">
                            <LeadsTable />
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
