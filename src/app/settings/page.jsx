"use client";

import React, { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import CategoryUploader from '@/components/settings/CategoryUploader';

export default function SettingsPage() {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/settings');

            if (!response.ok) {
                throw new Error('Failed to fetch settings');
            }

            const data = await response.json();
            setSettings(data);
        } catch (error) {
            console.error('Error fetching settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (section, key, value) => {
        setSettings(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    };

    const saveSettings = async () => {
        try {
            setSaving(true);
            setMessage(null);

            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            if (!response.ok) {
                throw new Error('Failed to save settings');
            }

            setMessage({ type: 'success', text: 'Settings saved successfully' });
        } catch (error) {
            console.error('Error saving settings:', error);
            setMessage({ type: 'error', text: `Error: ${error.message}` });
        } finally {
            setSaving(false);

            // Clear message after 3 seconds
            setTimeout(() => {
                setMessage(null);
            }, 3000);
        }
    };

    const resetSettings = async () => {
        if (!confirm('Are you sure you want to reset all settings to default values?')) {
            return;
        }

        try {
            setLoading(true);
            setMessage(null);

            const response = await fetch('/api/settings', {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to reset settings');
            }

            const data = await response.json();
            setSettings(data.settings);
            setMessage({ type: 'success', text: 'Settings reset to defaults' });
        } catch (error) {
            console.error('Error resetting settings:', error);
            setMessage({ type: 'error', text: `Error: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    if (loading && !settings) {
        return (
            <div className="flex h-screen bg-background overflow-hidden">
                <Sidebar />
                <div className="flex flex-col flex-1 overflow-hidden">
                    <Header />
                    <main className="flex-1 overflow-y-auto p-6">
                        <div className="max-w-4xl mx-auto">
                            <h1 className="text-3xl font-bold mb-8">Settings</h1>
                            <div className="animate-pulse space-y-6">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="h-40 bg-gray-100 rounded-lg"></div>
                                ))}
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-4xl mx-auto">
                        <div className="flex justify-between items-center mb-8">
                            <h1 className="text-3xl font-bold">Settings</h1>

                            <div className="flex gap-3">
                                <button
                                    onClick={resetSettings}
                                    className="btn btn-outline px-4 py-2.5"
                                >
                                    Reset to Default
                                </button>
                                <button
                                    onClick={saveSettings}
                                    className="btn btn-primary px-4 py-2.5 shadow-md hover:shadow-lg"
                                    disabled={saving}
                                >
                                    {saving ? (
                                        <>
                                            <span className="animate-spin material-icons mr-2 text-sm">refresh</span>
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-icons mr-2 text-sm">save</span>
                                            Save Settings
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {message && (
                            <div className={`mb-6 py-3 px-4 rounded-md ${message.type === 'success' ? 'bg-success-light text-success' : 'bg-error-light text-error'}`}>
                                <p>{message.text}</p>
                            </div>
                        )}

                        {/* Add Category Uploader component */}
                        <div className="mb-10">
                            <CategoryUploader />
                        </div>

                        {settings && (
                            <div className="space-y-10">
                                {/* Scraping Settings */}
                                <div className="card p-6">
                                    <h2 className="text-xl font-semibold mb-5 flex items-center">
                                        <span className="material-icons mr-3 text-primary">search</span>
                                        Scraping Settings
                                    </h2>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Max Results Per Search</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.scraping.maxResultsPerSearch}
                                                onChange={e => handleInputChange('scraping', 'maxResultsPerSearch', parseInt(e.target.value))}
                                                min={10}
                                                max={1000}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Maximum number of results to collect per search</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Concurrent Tasks</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.scraping.maxConcurrentTasks}
                                                onChange={e => handleInputChange('scraping', 'maxConcurrentTasks', parseInt(e.target.value))}
                                                min={1}
                                                max={8}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Number of concurrent search tasks</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Browser Timeout (ms)</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.scraping.browserTimeout}
                                                onChange={e => handleInputChange('scraping', 'browserTimeout', parseInt(e.target.value))}
                                                min={5000}
                                                max={60000}
                                                step={1000}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Page load timeout in milliseconds</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Retry Attempts</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.scraping.retryAttempts}
                                                onChange={e => handleInputChange('scraping', 'retryAttempts', parseInt(e.target.value))}
                                                min={1}
                                                max={5}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Number of retry attempts for failed requests</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Email Finder Settings */}
                                <div className="card p-6">
                                    <h2 className="text-xl font-semibold mb-5 flex items-center">
                                        <span className="material-icons mr-3 text-secondary">email</span>
                                        Email Finder Settings
                                    </h2>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Concurrent Tasks</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.emailFinder.maxConcurrentTasks}
                                                onChange={e => handleInputChange('emailFinder', 'maxConcurrentTasks', parseInt(e.target.value))}
                                                min={1}
                                                max={8}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Number of concurrent email discovery tasks</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Search Depth</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.emailFinder.searchDepth}
                                                onChange={e => handleInputChange('emailFinder', 'searchDepth', parseInt(e.target.value))}
                                                min={1}
                                                max={3}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">How deep to search within websites (1-3)</p>
                                        </div>

                                        <div className="md:col-span-2">
                                            <div className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    id="checkWhois"
                                                    checked={settings.emailFinder.checkWhois}
                                                    onChange={e => handleInputChange('emailFinder', 'checkWhois', e.target.checked)}
                                                    className="h-4 w-4 accent-primary"
                                                />
                                                <label htmlFor="checkWhois" className="ml-2 text-sm">Check WHOIS records for emails</label>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">May improve email discovery but slows down processing</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Batch Processing Settings */}
                                <div className="card p-6">
                                    <h2 className="text-xl font-semibold mb-5 flex items-center">
                                        <span className="material-icons mr-3 text-warning">batch_prediction</span>
                                        Batch Processing Settings
                                    </h2>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Wait Between Tasks (ms)</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.batch.waitBetweenTasks}
                                                onChange={e => handleInputChange('batch', 'waitBetweenTasks', parseInt(e.target.value))}
                                                min={1000}
                                                max={30000}
                                                step={1000}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Delay between batch tasks in milliseconds</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Max Results Per City</label>
                                            <input
                                                type="number"
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.batch.maxResultsPerCity}
                                                onChange={e => handleInputChange('batch', 'maxResultsPerCity', parseInt(e.target.value))}
                                                min={10}
                                                max={500}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Maximum number of results per city in batch mode</p>
                                        </div>

                                        <div className="md:col-span-2">
                                            <div className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    id="autoStartEmailFinder"
                                                    checked={settings.batch.autoStartEmailFinder}
                                                    onChange={e => handleInputChange('batch', 'autoStartEmailFinder', e.target.checked)}
                                                    className="h-4 w-4 accent-primary"
                                                />
                                                <label htmlFor="autoStartEmailFinder" className="ml-2 text-sm">Automatically start email finder after batch completion</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* System Settings */}
                                <div className="card p-6">
                                    <h2 className="text-xl font-semibold mb-5 flex items-center">
                                        <span className="material-icons mr-3 text-primary">settings</span>
                                        System Settings
                                    </h2>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Log Level</label>
                                            <select
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.system.logLevel}
                                                onChange={e => handleInputChange('system', 'logLevel', e.target.value)}
                                            >
                                                <option value="debug">Debug</option>
                                                <option value="info">Info</option>
                                                <option value="warn">Warning</option>
                                                <option value="error">Error</option>
                                            </select>
                                            <p className="text-xs text-gray-500 mt-1">Minimum log level to record</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium mb-2">Export File Format</label>
                                            <select
                                                className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                value={settings.export.defaultFormat}
                                                onChange={e => handleInputChange('export', 'defaultFormat', e.target.value)}
                                            >
                                                <option value="xlsx">Excel (XLSX)</option>
                                                <option value="csv">CSV</option>
                                                <option value="json">JSON</option>
                                            </select>
                                        </div>

                                        <div className="md:col-span-2">
                                            <div className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    id="cleanupOldExports"
                                                    checked={settings.system.cleanupOldExports}
                                                    onChange={e => handleInputChange('system', 'cleanupOldExports', e.target.checked)}
                                                    className="h-4 w-4 accent-primary"
                                                />
                                                <label htmlFor="cleanupOldExports" className="ml-2 text-sm">Automatically clean up old export files</label>
                                            </div>
                                        </div>

                                        {settings.system.cleanupOldExports && (
                                            <div className="md:col-span-2">
                                                <label className="block text-sm font-medium mb-2">Retention Period (days)</label>
                                                <input
                                                    type="number"
                                                    className="w-full p-2.5 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                                                    value={settings.system.exportRetentionDays}
                                                    onChange={e => handleInputChange('system', 'exportRetentionDays', parseInt(e.target.value))}
                                                    min={1}
                                                    max={365}
                                                />
                                                <p className="text-xs text-gray-500 mt-1">Number of days to keep export files before deletion</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
