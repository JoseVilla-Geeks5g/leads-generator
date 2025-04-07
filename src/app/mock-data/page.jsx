"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MockDataPage() {
    const [status, setStatus] = useState({ mockDataEnabled: false, mockBusinessCount: 0 });
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const router = useRouter();

    // Fetch current status
    useEffect(() => {
        fetchStatus();
    }, []);

    const fetchStatus = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/mock-data');
            const data = await response.json();
            setStatus(data);
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to load status: ' + error.message });
        } finally {
            setLoading(false);
        }
    };

    const performAction = async (action) => {
        try {
            setActionLoading(true);
            setMessage(null);

            const response = await fetch('/api/mock-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });

            const data = await response.json();

            if (response.ok) {
                setMessage({
                    type: 'success',
                    text: data.message || `${action} completed successfully`
                });
                fetchStatus(); // Refresh status
            } else {
                setMessage({ type: 'error', text: data.error || 'Action failed' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error: ' + error.message });
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-2xl mx-auto">
            <div className="mb-6 flex justify-between items-center">
                <h1 className="text-2xl font-bold">Mock Data Controls</h1>
                <button
                    onClick={() => router.push('/')}
                    className="btn btn-outline"
                >
                    Back to Dashboard
                </button>
            </div>

            {loading ? (
                <div className="p-4 bg-gray-100 rounded text-center">Loading status...</div>
            ) : (
                <div className="card p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Current Status</h2>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-gray-100 p-4 rounded">
                            <p className="text-sm text-gray-500">Mock Generation</p>
                            <p className={`font-bold ${status.mockDataEnabled ? 'text-green-600' : 'text-red-600'}`}>
                                {status.mockDataEnabled ? 'Enabled' : 'Disabled'}
                            </p>
                        </div>

                        <div className="bg-gray-100 p-4 rounded">
                            <p className="text-sm text-gray-500">Mock Businesses</p>
                            <p className="font-bold">{status.mockBusinessCount}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => performAction('enable')}
                            disabled={status.mockDataEnabled || actionLoading}
                            className="btn btn-primary"
                        >
                            Enable Mock Data
                        </button>

                        <button
                            onClick={() => performAction('disable')}
                            disabled={!status.mockDataEnabled || actionLoading}
                            className="btn btn-secondary"
                        >
                            Disable Mock Data
                        </button>

                        <button
                            onClick={() => {
                                if (confirm(`Are you sure you want to delete all ${status.mockBusinessCount} mock businesses?`)) {
                                    performAction('clear');
                                }
                            }}
                            disabled={status.mockBusinessCount === 0 || actionLoading}
                            className="btn btn-error"
                        >
                            Clear Mock Data
                        </button>
                    </div>
                </div>
            )}

            {message && (
                <div className={`p-4 rounded ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {message.text}
                </div>
            )}

            <div className="mt-8 text-sm text-gray-500">
                <h3 className="font-medium mb-2">About Mock Data</h3>
                <p className="mb-2">
                    Mock data generation creates simulated businesses when tasks are run.
                    This is useful for testing but can clutter your database.
                </p>
                <p>
                    Use the controls above to manage mock data generation and clean up
                    any existing mock businesses from your database.
                </p>
            </div>
        </div>
    );
}
