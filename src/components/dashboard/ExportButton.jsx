"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import ColumnSelector from '../export/ColumnSelector';

// Add a helper function to get the correct base URL
function getBaseUrl() {
    // If we're in the browser, use the current window location origin
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    
    // In SSR context, use the environment variable
    return process.env.NEXT_PUBLIC_APP_URL || 'https://leads-generator-8en5.onrender.com';
}

export default function ExportButton({ taskId = null, filter = null, className = "", fullWidth = false, isRandomCategoryTask }) {
    const [isExporting, setIsExporting] = useState(false);
    const [showExportOptions, setShowExportOptions] = useState(false);
    const [exportFormat, setExportFormat] = useState('xlsx');
    const [exportError, setExportError] = useState(null);
    const [availableColumns, setAvailableColumns] = useState([
        { key: 'name', label: 'Business Name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'formattedPhone', label: 'Formatted Phone (12065551234)' },
        { key: 'website', label: 'Website' },
        { key: 'address', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'country', label: 'Country' },
        { key: 'category', label: 'Category' },
        { key: 'rating', label: 'Rating' }
    ]);
    const [selectedColumns, setSelectedColumns] = useState([
        'name', 'email', 'phone', 'formattedPhone', 'website', 'address', 'city', 'state'
    ]);
    const [dataSource, setDataSource] = useState(isRandomCategoryTask ? 'random_category_leads' : 'all');
    const router = useRouter();

    const exportTypes = [
        { id: 'all', label: 'All Leads', description: 'Export all leads in the database' },
        { id: 'filtered', label: 'Filtered Leads', description: 'Export leads matching current filters', disabled: !filter },
        { id: 'task', label: 'Selected Task Only', description: 'Export leads from current task only', disabled: !taskId },
        { id: 'hasEmail', label: 'With Emails Only', description: 'Export only leads that have email addresses' },
        { id: 'withoutEmail', label: 'Without Emails', description: 'Export leads that need email finding' }
    ];

    const handleExport = async (type) => {
        if (isExporting) return;

        try {
            setIsExporting(true);
            setShowExportOptions(false);
            setExportError(null);

            // Construct request body based on export type
            const requestBody = {
                taskId,
                isRandom: isRandomCategoryTask || dataSource === 'random_category_leads',
                columns: selectedColumns,
                format: exportFormat,
                dataSource: dataSource
            };

            switch (type) {
                case 'all':
                    requestBody.forceUnfiltered = true;
                    break;
                case 'filtered':
                    if (filter) {
                        requestBody.filter = filter;
                    }
                    break;
                case 'task':
                    requestBody.taskId = taskId;
                    break;
                case 'hasEmail':
                    requestBody.filter = { hasEmail: true };
                    break;
                case 'withoutEmail':
                    requestBody.filter = { hasEmail: false };
                    break;
            }

            // Call export API
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            const data = await response.json();
            
            if (response.ok) {
                setExportStatus('success');
                setMessage(`Export completed successfully with ${data.count} records.`);
                
                // If we got a download URL, use it directly (it should already have the correct base URL)
                if (data.downloadUrl) {
                    setDownloadUrl(data.downloadUrl);
                } 
                // Otherwise, construct one with the correct base URL
                else if (data.filename) {
                    const baseUrl = getBaseUrl();
                    setDownloadUrl(`${baseUrl}/api/export/download?file=${encodeURIComponent(data.filename)}`);
                }
                
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.warning || 'Export failed');
            }

            // If there's a warning (like no records found), show it
            if (data.warning) {
                alert(data.warning);
                return;
            }

            // Open the download in a new tab
            window.open(data.downloadUrl, '_blank');
        } catch (error) {
            console.error('Export error:', error);
            setExportError(error.message);
            alert(`Export failed: ${error.message}`);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setShowExportOptions(!showExportOptions)}
                className={`btn btn-secondary ${fullWidth ? 'w-full' : ''} px-4 py-2.5 flex items-center justify-center shadow-sm ${className}`}
                disabled={isExporting}
            >
                {isExporting ? (
                    <>
                        <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                        Exporting...
                    </>
                ) : (
                    <>
                        <span className="material-icons mr-1.5 text-sm">file_download</span>
                        Export Data
                    </>
                )}
            </button>

            {showExportOptions && (
                <div className="absolute z-10 right-0 mt-2 bg-white rounded-md shadow-lg border border-light w-64">
                    <div className="py-1">
                        <div className="px-4 py-2 border-b border-light">
                            <h3 className="text-sm font-medium">Export Options</h3>
                        </div>

                        {exportTypes.map(type => (
                            <button
                                key={type.id}
                                className={`w-full px-4 py-2 text-left text-sm hover:bg-accent transition ${type.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={() => !type.disabled && handleExport(type.id)}
                                disabled={type.disabled || isExporting}
                            >
                                <div className="font-medium">{type.label}</div>
                                <div className="text-xs text-gray-500">{type.description}</div>
                            </button>
                        ))}

                        <div className="border-t border-light px-4 py-2">
                            <button
                                onClick={() => router.push('/export')}
                                className="text-xs text-primary hover:underline"
                            >
                                Advanced Export Options
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showExportOptions && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowExportOptions(false)}>
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-semibold mb-4">Export Options</h3>

                        {/* Column Selection */}
                        <div className="mb-4">
                            <ColumnSelector 
                                columns={availableColumns}
                                selectedColumns={selectedColumns}
                                onChange={setSelectedColumns}
                            />
                        </div>

                        {/* Format Selection */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-2">Export Format</label>
                            <div className="flex gap-3">
                                <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportFormat === 'xlsx' ? 'bg-primary-light' : 'bg-accent'}`}>
                                    <input
                                        type="radio"
                                        className="mr-2 accent-primary h-4 w-4"
                                        checked={exportFormat === 'xlsx'}
                                        onChange={() => setExportFormat('xlsx')}
                                    />
                                    <span className="text-sm">Excel (XLSX)</span>
                                </label>

                                <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${exportFormat === 'csv' ? 'bg-primary-light' : 'bg-accent'}`}>
                                    <input
                                        type="radio"
                                        className="mr-2 accent-primary h-4 w-4"
                                        checked={exportFormat === 'csv'}
                                        onChange={() => setExportFormat('csv')}
                                    />
                                    <span className="text-sm">CSV</span>
                                </label>
                            </div>
                        </div>

                        {/* Data Source Selection */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-2">Data Source</label>
                            <div className="flex gap-3">
                                <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${dataSource === 'all' ? 'bg-primary-light' : 'bg-accent'}`}>
                                    <input
                                        type="radio"
                                        className="mr-2 accent-primary h-4 w-4"
                                        checked={dataSource === 'all'}
                                        onChange={() => setDataSource('all')}
                                    />
                                    <span className="text-sm">All Sources</span>
                                </label>

                                <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${dataSource === 'business_listings' ? 'bg-primary-light' : 'bg-accent'}`}>
                                    <input
                                        type="radio"
                                        className="mr-2 accent-primary h-4 w-4"
                                        checked={dataSource === 'business_listings'}
                                        onChange={() => setDataSource('business_listings')}
                                    />
                                    <span className="text-sm">Main Listings</span>
                                </label>

                                <label className={`flex-1 flex items-center p-3 rounded-md hover:bg-primary-light transition cursor-pointer ${dataSource === 'random_category_leads' ? 'bg-primary-light' : 'bg-accent'}`}>
                                    <input
                                        type="radio"
                                        className="mr-2 accent-primary h-4 w-4"
                                        checked={dataSource === 'random_category_leads'}
                                        onChange={() => setDataSource('random_category_leads')}
                                    />
                                    <span className="text-sm">Random Categories</span>
                                </label>
                            </div>
                        </div>

                        {exportError && (
                            <div className="mb-4 p-3 bg-error-light text-error rounded-md">
                                {exportError}
                            </div>
                        )}

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowExportOptions(false)}
                                className="btn btn-outline px-4 py-2"
                            >
                                Cancel
                            </button>

                            <button
                                onClick={handleExport}
                                disabled={isExporting || selectedColumns.length === 0}
                                className="btn btn-primary px-4 py-2 flex items-center gap-2"
                            >
                                {isExporting ? (
                                    <>
                                        <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                                        Exporting...
                                    </>
                                ) : (
                                    <>
                                        <span className="material-icons text-sm">download</span>
                                        Export
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
