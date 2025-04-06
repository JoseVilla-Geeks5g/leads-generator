"use client";

import React, { useState, useRef } from 'react';

export default function CategoryUploader() {
    const [file, setFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [message, setMessage] = useState(null);
    const [categories, setCategories] = useState([]);
    const [previewText, setPreviewText] = useState('');
    const [uploadStats, setUploadStats] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileChange = async (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        // Validate file type
        const validTypes = ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'];
        if (!validTypes.includes(selectedFile.type) && !selectedFile.name.endsWith('.csv')) {
            setMessage({
                type: 'error',
                text: 'Please select a valid CSV file. Other file types are not supported.'
            });
            return;
        }

        setFile(selectedFile);
        setMessage(null);

        // Read file for preview
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;

                // Show truncated preview
                const previewLength = 500;
                setPreviewText(text.substring(0, previewLength) + (text.length > previewLength ? '...' : ''));

                // Parse preview to extract categories
                const lines = text.split(/[\r\n]+/).filter(line => line.trim() !== '');
                const extractedCategories = new Set();

                for (const line of lines) {
                    // Handle both comma and semicolon separators
                    let items;
                    if (line.includes(',')) {
                        items = line.split(',');
                    } else if (line.includes(';')) {
                        items = line.split(';');
                    } else {
                        items = [line];
                    }

                    for (let item of items) {
                        // Clean up the item
                        item = item.replace(/^["'](.*)["']$/, '$1').trim();
                        if (item) extractedCategories.add(item);

                        // Limit preview to 15 items
                        if (extractedCategories.size >= 15) break;
                    }

                    if (extractedCategories.size >= 15) break;
                }

                setCategories(Array.from(extractedCategories));
            } catch (err) {
                console.error('Error parsing CSV preview:', err);
                setMessage({ type: 'error', text: 'Error parsing CSV file. Please check the format.' });
            }
        };

        reader.onerror = () => {
            setMessage({ type: 'error', text: 'Error reading file. The file may be corrupted.' });
        };

        reader.readAsText(selectedFile);
    };

    const uploadFile = async (e) => {
        e.preventDefault();

        if (!file) {
            setMessage({ type: 'error', text: 'Please select a CSV file' });
            return;
        }

        try {
            setIsUploading(true);
            setMessage(null);
            setUploadStats(null);

            const formData = new FormData();
            formData.append('csvFile', file);

            const response = await fetch('/api/categories/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.details || 'Failed to upload CSV');
            }

            setMessage({
                type: 'success',
                text: `Success! Added ${result.added} categories. ${result.duplicates} duplicates were skipped.`
            });

            setUploadStats({
                added: result.added,
                duplicates: result.duplicates,
                total: result.total
            });

            // Reset form for another upload
            setFile(null);
            setPreviewText('');
            setCategories([]);
            if (fileInputRef.current) fileInputRef.current.value = '';

            // Refresh category list if needed (by triggering an event)
            window.dispatchEvent(new CustomEvent('categoriesUpdated'));

        } catch (error) {
            setMessage({
                type: 'error',
                text: `Error: ${error.message}`
            });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="card p-6">
            <h2 className="text-xl font-semibold mb-5 flex items-center">
                <span className="material-icons mr-3 text-primary">upload_file</span>
                Upload Categories CSV
            </h2>

            <form onSubmit={uploadFile}>
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-2" htmlFor="csv-file-input">
                        Upload a CSV file with categories
                    </label>
                    <input
                        id="csv-file-input"
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv,application/vnd.ms-excel"
                        onChange={handleFileChange}
                        className="block w-full p-2 text-sm text-gray-900 border border-light rounded-lg cursor-pointer bg-white focus:outline-none"
                    />
                    <div className="text-xs text-gray-500 mt-1 space-y-1">
                        <p>CSV format: each category should be in a new line or separated by commas/semicolons</p>
                        <p>Example: Marketing Agencies,Web Design,SEO Services</p>
                    </div>
                </div>

                {previewText && (
                    <div className="mb-4">
                        <h3 className="text-sm font-medium mb-2">File Preview:</h3>
                        <div className="p-3 bg-accent rounded-md overflow-auto text-xs max-h-32 font-mono">
                            {previewText}
                        </div>
                    </div>
                )}

                {categories.length > 0 && (
                    <div className="mb-4">
                        <h3 className="text-sm font-medium mb-2">Categories detected:</h3>
                        <div className="flex flex-wrap gap-2">
                            {categories.map((category, index) => (
                                <span key={index} className="px-3 py-1.5 bg-secondary-light text-secondary rounded-full text-xs">
                                    {category}
                                </span>
                            ))}
                            {categories.length === 15 && (
                                <span className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-full text-xs">
                                    and more...
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {message && (
                    <div className={`mb-4 p-3 rounded-md ${message.type === 'success' ? 'bg-success-light text-success' : 'bg-error-light text-error'}`}>
                        {message.text}
                    </div>
                )}

                {uploadStats && (
                    <div className="mb-4 bg-accent p-4 rounded-md">
                        <h3 className="font-medium mb-2">Upload Results</h3>
                        <ul className="space-y-1 text-sm">
                            <li className="flex justify-between">
                                <span>Total categories processed:</span>
                                <span className="font-medium">{uploadStats.total}</span>
                            </li>
                            <li className="flex justify-between">
                                <span>New categories added:</span>
                                <span className="font-medium text-success">{uploadStats.added}</span>
                            </li>
                            <li className="flex justify-between">
                                <span>Duplicates skipped:</span>
                                <span className="font-medium text-warning">{uploadStats.duplicates}</span>
                            </li>
                        </ul>
                    </div>
                )}

                <div className="flex space-x-3">
                    <button
                        type="submit"
                        disabled={isUploading || !file}
                        className="btn btn-primary px-4 py-2.5"
                    >
                        {isUploading ? (
                            <>
                                <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
                                Uploading...
                            </>
                        ) : (
                            <>
                                <span className="material-icons mr-2 text-sm">upload</span>
                                Upload Categories
                            </>
                        )}
                    </button>

                    {file && (
                        <button
                            type="button"
                            onClick={() => {
                                setFile(null);
                                setPreviewText('');
                                setCategories([]);
                                setUploadStats(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                            className="btn btn-outline px-4 py-2.5"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
}
