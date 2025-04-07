"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ExportButton({ taskId = null, filter = null, className = "", fullWidth = false }) {
    const [isExporting, setIsExporting] = useState(false);
    const [showExportOptions, setShowExportOptions] = useState(false);
    const router = useRouter();

    const exportTypes = [
        { id: 'all', label: 'All Leads', description: 'Export all leads in the database' },
        { id: 'filtered', label: 'Filtered Leads', description: 'Export leads matching current filters', disabled: !filter },
        { id: 'task', label: 'Selected Task Only', description: 'Export leads from current task only', disabled: !taskId },
        { id: 'hasEmail', label: 'With Emails Only', description: 'Export only leads that have email addresses' },
        { id: 'withoutEmail', label: 'Without Emails', description: 'Export leads that need email finding' }
    ];

    const handleExport = async (type) => {
        try {
            setIsExporting(true);
            setShowExportOptions(false);

            // Construct request body based on export type
            const requestBody = {};

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

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.warning || 'Export failed');
            }

            const data = await response.json();

            // If there's a warning (like no records found), show it
            if (data.warning) {
                alert(data.warning);
                return;
            }

            // Open the download in a new tab
            window.open(data.downloadUrl, '_blank');
        } catch (error) {
            console.error('Export error:', error);
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
        </div>
    );
}
