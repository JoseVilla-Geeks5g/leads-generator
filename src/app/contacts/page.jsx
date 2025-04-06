"use client";

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

export default function ContactsPage() {
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [countries, setCountries] = useState([]);
    const [states, setStates] = useState([]);
    const [totalContacts, setTotalContacts] = useState(0);
    const [page, setPage] = useState(1);

    const router = useRouter();
    const searchParams = useSearchParams();

    // Read URL parameters
    const currentCountry = searchParams.get('country') || '';
    const currentState = searchParams.get('state') || '';
    const currentSortBy = searchParams.get('sortBy') || 'name';
    const currentSortOrder = searchParams.get('sortOrder') || 'asc';
    const hasEmail = searchParams.get('hasEmail') || '';
    const pageSize = 50;

    // Fetch contacts when parameters change
    useEffect(() => {
        fetchContacts();
    }, [page, currentCountry, currentState, currentSortBy, currentSortOrder, hasEmail]);

    const fetchContacts = async () => {
        try {
            setLoading(true);
            setError(null);

            // Build query string
            const params = new URLSearchParams();
            if (currentCountry) params.append('country', currentCountry);
            if (currentState) params.append('state', currentState);
            if (currentSortBy) params.append('sortBy', currentSortBy);
            if (currentSortOrder) params.append('sortOrder', currentSortOrder);
            if (hasEmail) params.append('hasEmail', hasEmail);

            // Add pagination
            const offset = (page - 1) * pageSize;
            params.append('limit', pageSize.toString());
            params.append('offset', offset.toString());

            const response = await fetch(`/api/contacts?${params.toString()}`);

            if (!response.ok) {
                throw new Error('Failed to fetch contacts');
            }

            const data = await response.json();

            setContacts(data.contacts || []);
            setTotalContacts(data.total || 0);

            // Set filter options
            if (data.filters) {
                setCountries(data.filters.countries || []);
                setStates(data.filters.states || []);
            }
        } catch (error) {
            console.error('Error fetching contacts:', error);
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const updateFilters = (filters) => {
        const params = new URLSearchParams(searchParams);

        // Update or clear each filter
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                params.set(key, value);
            } else if (params.has(key)) {
                params.delete(key);
            }
        });

        // Reset to first page when filters change
        setPage(1);

        // Update URL
        router.push(`/contacts?${params.toString()}`);
    };

    const handleSortChange = (column) => {
        let newOrder = 'asc';

        // If already sorting by this column, toggle direction
        if (currentSortBy === column) {
            newOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
        }

        updateFilters({
            sortBy: column,
            sortOrder: newOrder
        });
    };

    const renderSortIcon = (column) => {
        if (currentSortBy !== column) return <span className="material-icons text-xs">unfold_more</span>;

        return currentSortOrder === 'asc' ?
            <span className="material-icons text-xs">arrow_upward</span> :
            <span className="material-icons text-xs">arrow_downward</span>;
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
                                <h1 className="text-3xl font-bold mb-1">Contacts</h1>
                                <p className="text-gray-500">Manage your business contacts and relationships</p>
                            </div>
                            <div className="flex items-center mt-4 md:mt-0 space-x-4">
                                <button className="btn btn-outline flex items-center px-4 py-2.5">
                                    <span className="material-icons mr-2 text-sm">upload</span>
                                    Import
                                </button>
                                <button className="btn btn-primary flex items-center px-4 py-2.5 shadow-md hover:shadow-lg">
                                    <span className="material-icons mr-2 text-sm">add</span>
                                    Add Contact
                                </button>
                            </div>
                        </div>

                        <div className="card p-5 mb-6">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                                <h2 className="text-xl font-semibold flex items-center">
                                    <span className="material-icons mr-3 text-primary">people</span>
                                    Contacts ({totalContacts})
                                </h2>

                                <div className="flex flex-wrap gap-2">
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Search contacts..."
                                            className="pl-9 pr-4 py-2 border border-light rounded-md focus:ring-primary focus:border-primary text-sm shadow-sm"
                                        />
                                        <span className="material-icons absolute left-3 top-2 text-gray-400 text-sm">search</span>
                                    </div>

                                    <select
                                        className="border border-light rounded-md px-3 py-2 focus:ring-primary focus:border-primary text-sm shadow-sm"
                                        value={currentCountry}
                                        onChange={e => updateFilters({ country: e.target.value })}
                                    >
                                        <option value="">All Countries</option>
                                        {countries.map(country => (
                                            <option key={country} value={country}>{country}</option>
                                        ))}
                                    </select>

                                    <select
                                        className="border border-light rounded-md px-3 py-2 focus:ring-primary focus:border-primary text-sm shadow-sm"
                                        value={currentState}
                                        onChange={e => updateFilters({ state: e.target.value })}
                                    >
                                        <option value="">All States</option>
                                        {states.map(state => (
                                            <option key={state} value={state}>{state}</option>
                                        ))}
                                    </select>

                                    <select
                                        className="border border-light rounded-md px-3 py-2 focus:ring-primary focus:border-primary text-sm shadow-sm"
                                        value={hasEmail}
                                        onChange={e => updateFilters({ hasEmail: e.target.value })}
                                    >
                                        <option value="">All Contacts</option>
                                        <option value="true">Has Email</option>
                                        <option value="false">No Email</option>
                                    </select>
                                </div>
                            </div>

                            {error && (
                                <div className="p-4 mb-4 text-error bg-error-light rounded-md">
                                    <p>{error}</p>
                                    <button
                                        className="underline mt-2"
                                        onClick={fetchContacts}
                                    >
                                        Retry
                                    </button>
                                </div>
                            )}

                            {loading && contacts.length === 0 ? (
                                <div className="animate-pulse space-y-4">
                                    {[...Array(5)].map((_, i) => (
                                        <div key={i} className="h-16 bg-gray-100 rounded-md"></div>
                                    ))}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr>
                                                <th
                                                    className="px-4 py-3 bg-accent rounded-tl-md text-left font-semibold cursor-pointer hover:bg-accent-dark"
                                                    onClick={() => handleSortChange('name')}
                                                >
                                                    <div className="flex items-center">
                                                        Name {renderSortIcon('name')}
                                                    </div>
                                                </th>
                                                <th
                                                    className="px-4 py-3 bg-accent text-left font-semibold cursor-pointer hover:bg-accent-dark"
                                                    onClick={() => handleSortChange('email')}
                                                >
                                                    <div className="flex items-center">
                                                        Email {renderSortIcon('email')}
                                                    </div>
                                                </th>
                                                <th
                                                    className="px-4 py-3 bg-accent text-left font-semibold cursor-pointer hover:bg-accent-dark"
                                                    onClick={() => handleSortChange('company')}
                                                >
                                                    <div className="flex items-center">
                                                        Company {renderSortIcon('company')}
                                                    </div>
                                                </th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Position</th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Phone</th>
                                                <th
                                                    className="px-4 py-3 bg-accent text-left font-semibold cursor-pointer hover:bg-accent-dark"
                                                    onClick={() => handleSortChange('state')}
                                                >
                                                    <div className="flex items-center">
                                                        State {renderSortIcon('state')}
                                                    </div>
                                                </th>
                                                <th className="px-4 py-3 bg-accent text-left font-semibold">Status</th>
                                                <th className="px-4 py-3 bg-accent rounded-tr-md text-left font-semibold">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-light">
                                            {contacts.map((contact) => (
                                                <tr key={contact.id} className="hover:bg-accent transition">
                                                    <td className="px-4 py-3.5 font-medium text-primary">{contact.name}</td>
                                                    <td className="px-4 py-3.5">
                                                        {contact.email ? (
                                                            <a href={`mailto:${contact.email}`} className="text-secondary hover:underline">
                                                                {contact.email}
                                                            </a>
                                                        ) : (
                                                            <span className="text-gray-400">No email</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3.5">{contact.company}</td>
                                                    <td className="px-4 py-3.5">{contact.position || '-'}</td>
                                                    <td className="px-4 py-3.5">{contact.phone || '-'}</td>
                                                    <td className="px-4 py-3.5">
                                                        {contact.state ? (
                                                            <button
                                                                onClick={() => updateFilters({ state: contact.state })}
                                                                className="hover:underline"
                                                            >
                                                                {contact.state}
                                                            </button>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3.5">
                                                        <StatusBadge status={contact.status} />
                                                    </td>
                                                    <td className="px-4 py-3.5">
                                                        <div className="flex">
                                                            <button className="p-1.5 rounded-md hover:bg-primary-light text-gray-500 hover:text-primary mr-2 transition" title="View Details">
                                                                <span className="material-icons text-sm">visibility</span>
                                                            </button>
                                                            <button className="p-1.5 rounded-md hover:bg-secondary-light text-gray-500 hover:text-secondary transition" title="Edit">
                                                                <span className="material-icons text-sm">edit</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}

                                            {contacts.length === 0 && !loading && (
                                                <tr>
                                                    <td colSpan="8" className="px-4 py-8 text-center text-gray-500">
                                                        No contacts found. Try different filter options.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Pagination */}
                            {totalContacts > 0 && (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-light mt-4">
                                    <div className="text-sm text-gray-500">
                                        Showing {Math.min(((page - 1) * pageSize) + 1, totalContacts)} to {Math.min(page * pageSize, totalContacts)} of {totalContacts} contacts
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            className="p-2 border border-light rounded-md hover:bg-accent transition"
                                            disabled={page === 1}
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                        >
                                            <span className="material-icons text-sm">chevron_left</span>
                                        </button>

                                        {Array.from({ length: Math.min(3, Math.ceil(totalContacts / pageSize)) }).map((_, i) => (
                                            <button
                                                key={i}
                                                className={`p-2 min-w-[40px] ${page === i + 1 ? 'bg-primary text-white' : 'border border-light hover:bg-accent'} rounded-md transition`}
                                                onClick={() => setPage(i + 1)}
                                            >
                                                {i + 1}
                                            </button>
                                        ))}

                                        {Math.ceil(totalContacts / pageSize) > 3 && (
                                            <>
                                                <button className="p-2 min-w-[40px] border border-light rounded-md hover:bg-accent transition">
                                                    ...
                                                </button>
                                                <button
                                                    className={`p-2 min-w-[40px] ${page === Math.ceil(totalContacts / pageSize) ? 'bg-primary text-white' : 'border border-light hover:bg-accent'} rounded-md transition`}
                                                    onClick={() => setPage(Math.ceil(totalContacts / pageSize))}
                                                >
                                                    {Math.ceil(totalContacts / pageSize)}
                                                </button>
                                            </>
                                        )}

                                        <button
                                            className="p-2 border border-light rounded-md hover:bg-accent transition"
                                            disabled={page >= Math.ceil(totalContacts / pageSize)}
                                            onClick={() => setPage(p => Math.min(Math.ceil(totalContacts / pageSize), p + 1))}
                                        >
                                            <span className="material-icons text-sm">chevron_right</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

function StatusBadge({ status }) {
    let bgColor = '';
    let textColor = '';

    switch (status) {
        case 'Lead':
            bgColor = 'bg-primary-light';
            textColor = 'text-primary';
            break;
        case 'Customer':
            bgColor = 'bg-success-light';
            textColor = 'text-success';
            break;
        case 'Prospect':
            bgColor = 'bg-secondary-light';
            textColor = 'text-secondary';
            break;
        default:
            bgColor = 'bg-gray-100';
            textColor = 'text-gray-700';
    }

    return (
        <span className={`px-2.5 py-1 ${bgColor} ${textColor} rounded-full text-xs font-medium`}>
            {status}
        </span>
    );
}
