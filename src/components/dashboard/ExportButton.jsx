"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ColumnSelector from '../export/ColumnSelector';
import { Progress } from "@/components/ui/progress";
import { Button, CircularProgress } from '@mui/material';
import { Download as DownloadIcon, Loader2 } from '@mui/icons-material';
import axios from 'axios';

// Add missing UI component imports
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
  Alert,
  AlertTitle,
  AlertDescription,
  Link,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox
} from "@/components/ui";

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
    const [isExporting, setIsExporting] = useState(false); // Add missing state variable
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
                                setIsExporting(false);

                                if (data.downloadUrl) {
                                    const refreshedUrl = data.downloadUrl.replace(
                                        /^http:\/\/localhost:[0-9]+/,
                                        getBaseUrl()
                                    );
                                    setDownloadUrl(refreshedUrl);
                                    
                                    // Auto-initiate download if filename is provided
                                    if (data.filename) {
                                        initiateDownload(data.filename);
                                    }
                                }
                            }

                            if (data.status === 'error') {
                                setExportStatus('error');
                                setMessage(`Export failed: ${data.error || 'Unknown error'}`);
                                setIsExporting(false);
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
            setIsExporting(true);
            setExportStatus('loading');
            setMessage('Preparing data for export...');
            setDownloadUrl(null);
            setExportStats(null);
            setExportProgress(0);
            setProgressDetails(null);

            const cleanedFilter = cleanFilter();
            
            const exportParams = {
                filter: cleanedFilter,
                forceUnfiltered,
                columns: selectedColumns.length > 0 ? selectedColumns : null,
                excludeNullPhone: filter.excludeNullPhone === true,
                dataSource: dataSource
            };

            // Add more detailed logging to help troubleshoot
            console.log('Export params:', exportParams);
            console.log(`Selected data source: ${dataSource}`);
            console.log(`Filters applied:`, cleanedFilter);
            
            // Display a message to the user about the current operation
            setMessage(`Exporting data from ${dataSource === 'all' ? 'all sources' : 
                        dataSource === 'business_listings' ? 'main listings' : 
                        'random categories'} table...`);

            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(exportParams)
            });

            const data = await response.json();

            if (response.ok) {
                if (data.downloadUrl) {
                    setExportStatus('success');
                    setMessage(`Export completed successfully with ${data.count || 0} records.`);

                    const fixedUrl = data.downloadUrl.replace(
                        /^http:\/\/localhost:[0-9]+/,
                        getBaseUrl()
                    );
                    setDownloadUrl(fixedUrl);
                    
                    // If we have a filename, automatically start the download
                    if (data.filename) {
                        initiateDownload(data.filename);
                    }
                } else if (data.exportId) {
                    setExportId(data.exportId);
                    // The status polling will handle the rest of the process
                } else if (data.filename) {
                    setExportStatus('success');
                    setMessage(`Export completed successfully.`);
                    setIsExporting(false);

                    const baseUrl = getBaseUrl();
                    const downloadUrl = `${baseUrl}/api/export/download?filename=${encodeURIComponent(data.filename)}`;
                    setDownloadUrl(downloadUrl);
                    
                    // Auto-initiate download
                    initiateDownload(data.filename);
                }

                if (data.diagnostics) {
                    setExportStats(data.diagnostics);
                }
            } else {
                setExportStatus('error');
                setMessage(data.error || data.message || 'Export failed. Please try again.');
                setIsExporting(false);
                console.error('Export API responded with error:', data);
            }
        } catch (error) {
            console.error('Export error:', error);
            setExportStatus('error');
            setMessage('An unexpected error occurred. Please try again.');
            setIsExporting(false);
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

    const initiateDownload = (filename) => {
        try {
            setExportStatus('Downloading file...');
            
            // Create the download URL with filename parameter
            const baseUrl = getBaseUrl();
            const downloadUrl = `${baseUrl}/api/export/download?filename=${encodeURIComponent(filename)}`;
            
            // Add timestamp to avoid browser caching
            const urlWithTimestamp = `${downloadUrl}&t=${Date.now()}`;
            
            // Create a hidden link element for download
            const link = document.createElement('a');
            link.href = urlWithTimestamp;
            link.download = filename; // This forces download instead of navigation
            link.target = '_blank'; // Open in new tab as fallback
            link.rel = 'noopener noreferrer'; // Security best practice
            
            // Add to DOM, click, then remove
            document.body.appendChild(link);
            
            // Use a slight timeout to ensure the link is properly appended
            setTimeout(() => {
              link.click();
              
              // Clean up after click
              setTimeout(() => {
                document.body.removeChild(link);
                setExportStatus('success');
                setMessage('Download complete!');
                setIsExporting(false);
              }, 100);
            }, 50);
            
        } catch (error) {
            console.error('Download error:', error);
            setExportStatus('error');
            setMessage(`Download failed: ${error.message}`);
            setIsExporting(false);
        }
    };

    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={disabled || isExporting}
                variant="contained"
                color="primary"
                startIcon={<DownloadIcon />}
            >
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
                                        <Button variant="outlined" size="small" className="flex items-center">
                                            <DownloadIcon className="mr-1 h-4 w-4" />
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

                                        <div className="space-y-1 col-span-2">
                                            <Label htmlFor="category" className="text-sm">Category</Label>
                                            <input
                                                id="category"
                                                type="text"
                                                className="w-full p-2 border rounded-md text-sm"
                                                placeholder="Enter category to filter by"
                                                value={filter.category || ''}
                                                onChange={(e) => setFilter({
                                                    ...filter,
                                                    category: e.target.value || null
                                                })}
                                                disabled={exportStatus === 'loading'}
                                            />
                                            <div className="text-xs text-gray-500">
                                                Filter by business category (partial matching)
                                            </div>
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
                                                Include all data (filters still apply if set)
                                            </Label>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Add ColumnSelector component here */}
                        <div className="grid gap-2">
                            <Label>Select Columns for Export</Label>
                            <ColumnSelector 
                                columns={[
                                    { key: 'name', label: 'Business Name' },
                                    { key: 'email', label: 'Email' },
                                    { key: 'phone', label: 'Phone' },
                                    { key: 'formattedPhone', label: 'Formatted Phone' },
                                    { key: 'website', label: 'Website' },
                                    { key: 'address', label: 'Address' },
                                    { key: 'city', label: 'City' },
                                    { key: 'state', label: 'State' },
                                    { key: 'country', label: 'Country' },
                                    { key: 'postal_code', label: 'Postal Code' },
                                    { key: 'category', label: 'Category' },
                                    { key: 'rating', label: 'Rating' }
                                ]}
                                selectedColumns={selectedColumns}
                                onChange={setSelectedColumns}
                            />
                        </div>

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
                            variant="outlined"
                            onClick={() => setShowModal(false)}
                            disabled={exportStatus === 'loading'}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleExport}
                            disabled={exportStatus === 'loading' || isExporting}
                            className={exportStatus === 'loading' ? 'animate-pulse' : ''}
                            startIcon={exportStatus === 'loading' ? <CircularProgress size={16} /> : <DownloadIcon />}
                        >
                            {exportStatus === 'loading' ? `Exporting... ${Math.round(exportProgress)}%` : 'Export'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ExportButton;
