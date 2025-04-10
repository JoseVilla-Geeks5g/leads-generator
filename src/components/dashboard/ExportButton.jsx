"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ColumnSelector from '../export/ColumnSelector';
import { Progress } from "@/components/ui/progress";

// Helper function to get the correct base URL
function getBaseUrl() {
    // In production, always use the Render URL
    return process.env.NEXT_PUBLIC_APP_URL || 'https://leads-generator-8en5.onrender.com';
}

const ExportButton = ({ disabled = false, initialFilters = {}, showFilters = true }) => {
    const [exportStatus, setExportStatus] = useState('idle'); // idle, loading, success, error
    const [showModal, setShowModal] = useState(false);
    const [filter, setFilter] = useState({
        hasEmail: null,
        hasWebsite: null,
        hasPhone: null,
        hasAddress: null,
        excludeNullPhone: true,
        ...initialFilters
    });
    const [dataSource, setDataSource] = useState('business_listings'); // Changed default to business_listings
    const [message, setMessage] = useState('');
    const [downloadUrl, setDownloadUrl] = useState(null);
    const [exportStats, setExportStats] = useState(null);
    const [selectedColumns, setSelectedColumns] = useState([]);
    const [forceUnfiltered, setForceUnfiltered] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [exportId, setExportId] = useState(null);
    const [progressDetails, setProgressDetails] = useState(null);
    const progressInterval = useRef(null);
    const router = useRouter();

    useEffect(() => {
        return () => {
            if (progressInterval.current) {
                clearInterval(progressInterval.current);
            }
        };
    }, []);

    useEffect(() => {
        if (exportStatus === 'loading' && exportId) {
            progressInterval.current = setInterval(async () => {
                try {
                    const response = await fetch(`/api/export/status?id=${exportId}`);
                    if (response.ok) {
                        const data = await response.json();
                        setExportProgress(data.progress || 0);
                        setProgressDetails(data);

                        if (data.status === 'completed' || data.status === 'error' || data.progress >= 100) {
                            clearInterval(progressInterval.current);

                            if (data.status === 'completed') {
                                setExportStatus('success');
                                setMessage(`Export completed successfully with ${data.processedCount || '?'} records.`);

                                if (downloadUrl) {
                                    const refreshedUrl = downloadUrl.replace(
                                        /^http:\/\/localhost:[0-9]+/,
                                        getBaseUrl()
                                    );
                                    setDownloadUrl(refreshedUrl);
                                }
                            }

                            if (data.status === 'error') {
                                setExportStatus('error');
                                setMessage(`Export failed: ${data.error || 'Unknown error'}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error checking export status:', error);
                }
            }, 1000);

            return () => clearInterval(progressInterval.current);
        }
    }, [exportStatus, exportId]);

    const handleExport = async () => {
        try {
            setExportStatus('loading');
            setMessage('Exporting data...');
            setDownloadUrl(null);
            setExportStats(null);
            setExportProgress(0);
            setProgressDetails(null);

            const exportParams = {
                filter: cleanFilter(),
                forceUnfiltered,
                columns: selectedColumns.length > 0 ? selectedColumns : null,
                excludeNullPhone: filter.excludeNullPhone === true,
                dataSource: dataSource
            };

            console.log('Export params:', exportParams);

            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(exportParams)
            });

            const data = await response.json();

            if (response.ok) {
                if (data.downloadUrl) {
                    setExportStatus('success');
                    setMessage(`Export completed successfully with ${data.count} records.`);

                    const fixedUrl = data.downloadUrl.replace(
                        /^http:\/\/localhost:[0-9]+/,
                        getBaseUrl()
                    );
                    setDownloadUrl(fixedUrl);
                } else if (data.exportId) {
                    setExportId(data.exportId);
                } else if (data.filename) {
                    setExportStatus('success');
                    setMessage(`Export completed successfully.`);

                    const baseUrl = getBaseUrl();
                    setDownloadUrl(`${baseUrl}/api/export/download?file=${encodeURIComponent(data.filename)}`);
                }

                if (data.diagnostics) {
                    setExportStats(data.diagnostics);
                }
            } else {
                setExportStatus('error');
                setMessage(data.error || 'Export failed. Please try again.');
            }
        } catch (error) {
            console.error('Export error:', error);
            setExportStatus('error');
            setMessage('An unexpected error occurred. Please try again.');
        } finally {
            window.scrollTo(0, 0);
        }
    };

    const cleanFilter = () => {
        const cleanedFilter = {};
        Object.entries(filter).forEach(([key, value]) => {
            if (value !== null) {
                cleanedFilter[key] = value;
            }
        });
        return cleanedFilter;
    };

    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={disabled}
            >
                <Download className="mr-2 h-4 w-4" />
                Export Data
            </Button>

            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Export Data</DialogTitle>
                        <DialogDescription>
                            Select options for the data export
                        </DialogDescription>
                    </DialogHeader>

                    {exportStatus === 'success' && downloadUrl && (
                        <Alert className="mb-4 bg-success-light border-success">
                            <AlertTitle className="text-success">Export Successful</AlertTitle>
                            <AlertDescription>
                                {message}
                                <div className="mt-2">
                                    <Link
                                        href={downloadUrl}
                                        className="text-primary hover:underline"
                                        target="_blank"
                                    >
                                        <Button variant="outline" size="sm" className="flex items-center">
                                            <Download className="mr-1 h-4 w-4" />
                                            Download File
                                        </Button>
                                    </Link>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}

                    {exportStatus === 'error' && (
                        <Alert className="mb-4 bg-error-light border-error">
                            <AlertTitle className="text-error">Export Error</AlertTitle>
                            <AlertDescription>{message}</AlertDescription>
                        </Alert>
                    )}

                    {exportStatus === 'loading' && (
                        <div className="mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium">Export in progress...</span>
                                <span className="text-sm">{Math.round(exportProgress)}%</span>
                            </div>
                            <Progress value={exportProgress} className="h-2" />

                            {progressDetails && (
                                <div className="mt-2 text-xs text-muted-foreground">
                                    {progressDetails.status === 'counting' && 'Counting records...'}
                                    {progressDetails.status === 'preparing-excel' && 'Preparing export file...'}
                                    {progressDetails.status === 'processing-chunks' &&
                                        `Processing ${progressDetails.processedCount || 0} of ${progressDetails.totalCount || '?'} records...`}
                                    {progressDetails.status === 'saving-file' && 'Saving file...'}
                                    {progressDetails.status === 'splitting-files' &&
                                        `Large dataset detected. Splitting into ${progressDetails.numFiles || 'multiple'} files...`}
                                    {progressDetails.status === 'exporting-part' &&
                                        `Exporting part ${progressDetails.partProgress?.currentFile || 1} of ${progressDetails.partProgress?.numFiles || '?'}...`}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="dataSource">Data Source</Label>
                            <Select
                                id="dataSource"
                                value={dataSource}
                                onValueChange={setDataSource}
                                disabled={exportStatus === 'loading'}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Data Source" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Sources (Combined)</SelectItem>
                                    <SelectItem value="business_listings">Main Listings</SelectItem>
                                    <SelectItem value="random_category_leads">Random Categories</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="text-sm text-muted-foreground mt-1">
                                {dataSource === 'all' && "Combines data from all sources"}
                                {dataSource === 'business_listings' && "Business listings from regular scraped data"}
                                {dataSource === 'random_category_leads' && "Leads generated from random category searches"}
                            </div>
                        </div>

                        {showFilters && (
                            <>
                                <div className="grid gap-2">
                                    <Label>Filter Options</Label>

                                    <div className="grid grid-cols-2 gap-4 mt-1">
                                        <div className="space-y-1">
                                            <Label htmlFor="hasEmail" className="text-sm">Email Status</Label>
                                            <Select
                                                id="hasEmail"
                                                value={filter.hasEmail === null ? "null" : filter.hasEmail.toString()}
                                                onValueChange={(value) => setFilter({
                                                    ...filter,
                                                    hasEmail: value === "null" ? null : value === "true"
                                                })}
                                                disabled={exportStatus === 'loading'}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Any email status" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="null">Any email status</SelectItem>
                                                    <SelectItem value="true">Has email</SelectItem>
                                                    <SelectItem value="false">No email</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1">
                                            <Label htmlFor="hasWebsite" className="text-sm">Website Status</Label>
                                            <Select
                                                id="hasWebsite"
                                                value={filter.hasWebsite === null ? "null" : filter.hasWebsite.toString()}
                                                onValueChange={(value) => setFilter({
                                                    ...filter,
                                                    hasWebsite: value === "null" ? null : value === "true"
                                                })}
                                                disabled={exportStatus === 'loading'}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Any website status" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="null">Any website status</SelectItem>
                                                    <SelectItem value="true">Has website</SelectItem>
                                                    <SelectItem value="false">No website</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1">
                                            <Label htmlFor="hasPhone" className="text-sm">Phone Status</Label>
                                            <Select
                                                id="hasPhone"
                                                value={filter.hasPhone === null ? "null" : filter.hasPhone.toString()}
                                                onValueChange={(value) => setFilter({
                                                    ...filter,
                                                    hasPhone: value === "null" ? null : value === "true"
                                                })}
                                                disabled={exportStatus === 'loading'}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Any phone status" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="null">Any phone status</SelectItem>
                                                    <SelectItem value="true">Has phone</SelectItem>
                                                    <SelectItem value="false">No phone</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1">
                                            <Label htmlFor="hasAddress" className="text-sm">Address Status</Label>
                                            <Select
                                                id="hasAddress"
                                                value={filter.hasAddress === null ? "null" : filter.hasAddress.toString()}
                                                onValueChange={(value) => setFilter({
                                                    ...filter,
                                                    hasAddress: value === "null" ? null : value === "true"
                                                })}
                                                disabled={exportStatus === 'loading'}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Any address status" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="null">Any address status</SelectItem>
                                                    <SelectItem value="true">Has address</SelectItem>
                                                    <SelectItem value="false">No address</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2 mt-2">
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="excludeNullPhone"
                                                checked={filter.excludeNullPhone}
                                                onCheckedChange={(checked) => setFilter({
                                                    ...filter,
                                                    excludeNullPhone: checked
                                                })}
                                                disabled={exportStatus === 'loading'}
                                            />
                                            <Label
                                                htmlFor="excludeNullPhone"
                                                className="text-sm font-normal cursor-pointer"
                                            >
                                                Exclude "[null]" phone values
                                            </Label>
                                        </div>

                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="forceUnfiltered"
                                                checked={forceUnfiltered}
                                                onCheckedChange={setForceUnfiltered}
                                                disabled={exportStatus === 'loading'}
                                            />
                                            <Label
                                                htmlFor="forceUnfiltered"
                                                className="text-sm font-normal cursor-pointer"
                                            >
                                                Export all data (ignore filters)
                                            </Label>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {exportStats && (
                            <div className="mt-4 p-4 border rounded-md bg-muted">
                                <h4 className="font-medium mb-2">Export Statistics</h4>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div>Total Records: {exportStats.totalCount || 'N/A'}</div>
                                    <div>Duration: {exportStats.durationMs ? `${(exportStats.durationMs / 1000).toFixed(2)}s` : 'N/A'}</div>
                                    <div>File Size: {exportStats.fileSizeMB ? `${exportStats.fileSizeMB} MB` : 'N/A'}</div>
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setShowModal(false)}
                            disabled={exportStatus === 'loading'}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleExport}
                            disabled={exportStatus === 'loading'}
                            className={exportStatus === 'loading' ? 'animate-pulse' : ''}
                        >
                            {exportStatus === 'loading' ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Exporting... {Math.round(exportProgress)}%
                                </>
                            ) : (
                                <>
                                    <Download className="mr-2 h-4 w-4" />
                                    Export
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ExportButton;
