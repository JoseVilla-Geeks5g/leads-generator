"use client";

import React, { useState } from 'react';

/**
 * Export Button Component with loading state and feedback
 */
export default function ExportButton({
    filter = null,
    taskId = null,
    state = null,
    label = "Export",
    buttonClass = "btn btn-primary px-4 py-2.5",
    icon = "file_download"
}) {
    const [isExporting, setIsExporting] = useState(false);
    const [message, setMessage] = useState(null);
    const [isCheckingData, setIsCheckingData] = useState(false);

    // Pre-check if data exists before starting full export
    const checkForData = async () => {
        try {
            setIsCheckingData(true);

            // Build check params
            const params = {};
            if (filter) params.filter = filter;
            if (taskId) params.taskId = taskId;
            if (state) params.state = state;

            // Add a flag to just check for existence
            params.countOnly = true;

            const response = await fetch('/api/export/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });

            const data = await response.json();

            // If no records would be found, warn the user
            if (!response.ok || data.count === 0) {
                setMessage({
                    type: 'warning',
                    text: 'Your current filters would result in an empty export. Would you like to proceed anyway?',
                    action: true
                });
                return false;
            }

            // Data exists, proceed with export
            return true;
        } catch (error) {
            console.error('Error checking for exportable data:', error);
            return true; // Proceed with export on error to be safe
        } finally {
            setIsCheckingData(false);
        }
    };

    const exportData = async () => {
        try {
            // Clear any existing message
            setMessage(null);

            // If we're not in the middle of confirming an empty export
            if (!message?.action) {
                // Check if data exists first
                const hasData = await checkForData();
                if (!hasData) return;
            }

            setIsExporting(true);
            setMessage(null);

            // Prepare export parameters
            const params = {};
            if (filter) params.filter = filter;
            if (taskId) params.taskId = taskId;
            if (state) params.state = state;

            // Add force unfiltered flag to ensure we get all records when exporting all
            if (!filter && !taskId && !state) {
                params.forceUnfiltered = true;
            }

            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });

            const data = await response.json();

            if (response.status === 404) {
                setMessage({
                    type: 'warning',
                    text: data.warning || 'No records found matching your criteria'
                });
                return;
            }

            if (!response.ok) {
                throw new Error(data.error || data.details || 'Export failed');
            }

            // If export is empty but has a file
            if (data.count === 0) {
                setMessage({
                    type: 'warning',
                    text: 'Export completed. No matching records were found, but an empty template file was created.'
                });

                // Still allow download of the empty template
                window.open(data.downloadUrl, '_blank');
                return;
            }

            // Success case
            setMessage({
                type: 'success',
                text: `${data.count} records exported successfully`
            });

            // Open download in new tab
            window.open(data.downloadUrl, '_blank');
        } catch (error) {
            console.error('Export error:', error);
            setMessage({
                type: 'error',
                text: error.message || 'An error occurred during export'
            });
        } finally {
            setIsExporting(false);

            // Clear success/warning messages after a delay (except for action messages)
            if (message && message.type !== 'error' && !message.action) {
                setTimeout(() => setMessage(null), 5000);
            }
        }
    };

    return (
        <div>
            {message?.action ? (
                <div className="flex flex-col space-y-2">
                    <div className="text-sm p-2 rounded bg-warning-light text-warning">
                        {message.text}
                    </div>
                    <div className="flex space-x-2">
                        <button
                            onClick={exportData}
                            className="btn btn-warning btn-sm px-3 py-1"
                        >
                            Yes, continue
                        </button>
                        <button
                            onClick={() => setMessage(null)}
                            className="btn btn-outline btn-sm px-3 py-1"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={exportData}
                    disabled={isExporting || isCheckingData}
                    className={buttonClass}
                >
                    {isCheckingData ? (
                        <>
                            <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                            Checking data...
                        </>
                    ) : isExporting ? (
                        <>
                            <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                            Exporting...
                        </>
                    ) : (
                        <>
                            <span className="material-icons mr-2 text-sm">{icon}</span>
                            {label}
                        </>
                    )}
                </button>
            )}

            {message && !message.action && (
                <div className={`mt-2 text-sm p-2 rounded ${message.type === 'success' ? 'text-success bg-success-light' :
                    message.type === 'warning' ? 'text-warning bg-warning-light' :
                        'text-error bg-error-light'
                    }`}>
                    {message.text}
                </div>
            )}
        </div>
    );
}
