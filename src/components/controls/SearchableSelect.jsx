"use client";

import { useState, useEffect, useRef } from 'react';

export default function SearchableSelect({
    placeholder = "Search...",
    value = "",
    onChange = () => { },
    onSelect = () => { },
    apiUrl,
    minSearchLength = 0,
    maxItems = 10,
    debounceMs = 300,
    className = "",
    searchKey = "query"
}) {
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showOptions, setShowOptions] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const cachedResultsRef = useRef({});

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setShowOptions(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // Handle input changes with debounce
    const handleInputChange = (e) => {
        const inputValue = e.target.value;
        setQuery(inputValue);
        onChange(inputValue);

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        if (inputValue.length >= minSearchLength) {
            setShowOptions(true);
            setLoading(true);

            debounceTimerRef.current = setTimeout(() => {
                fetchOptions(inputValue);
            }, debounceMs);
        } else {
            setOptions([]);
            setShowOptions(false);
        }
    };

    // Handle keyboard navigation
    const handleKeyDown = (e) => {
        if (!showOptions) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : prev));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0) {
                    handleOptionSelect(options[selectedIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setShowOptions(false);
                break;
            case 'Tab':
                setShowOptions(false);
                break;
        }
    };

    // Fetch options from API
    const fetchOptions = async (searchQuery) => {
        // Check cache first
        const cacheKey = `${searchQuery.trim().toLowerCase()}`;

        if (cachedResultsRef.current[cacheKey]) {
            setOptions(cachedResultsRef.current[cacheKey]);
            setLoading(false);
            return;
        }

        try {
            // Build URL with search parameter
            const url = `${apiUrl}?${searchKey}=${encodeURIComponent(searchQuery)}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('Failed to fetch options');
            }

            const data = await response.json();

            // Extract options - adapt this based on your API response structure
            // We assume the API returns an object with a 'categories' array
            const extractedOptions = data.categories || data.options || data.results || [];

            // Update cache and state
            cachedResultsRef.current[cacheKey] = extractedOptions;
            setOptions(extractedOptions);
        } catch (error) {
            console.error('Error fetching options:', error);
            setOptions([]);
        } finally {
            setLoading(false);
        }
    };

    // Handle option selection
    const handleOptionSelect = (option) => {
        setQuery(option);
        onChange(option);
        onSelect(option);
        setShowOptions(false);
        setSelectedIndex(-1);
    };

    // Focus the input when clicking on the container
    const handleContainerClick = () => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    return (
        <div
            ref={wrapperRef}
            className={`relative ${className}`}
            onClick={handleContainerClick}
        >
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    placeholder={placeholder}
                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                    value={query || value}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => {
                        if (query.length >= minSearchLength || value.length >= minSearchLength) {
                            setShowOptions(true);
                            fetchOptions(query || value);
                        }
                    }}
                />
                <span className="material-icons absolute left-3 top-3 text-gray-400">search</span>

                {loading && (
                    <span className="absolute right-3 top-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"></div>
                    </span>
                )}

                {!loading && query && (
                    <button
                        type="button"
                        className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                        onClick={() => {
                            setQuery('');
                            onChange('');
                            setOptions([]);
                            if (inputRef.current) {
                                inputRef.current.focus();
                            }
                        }}
                    >
                        <span className="material-icons text-sm">close</span>
                    </button>
                )}
            </div>

            {showOptions && options.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-light rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <ul>
                        {options.slice(0, maxItems).map((option, index) => (
                            <li
                                key={index}
                                className={`px-4 py-2 cursor-pointer text-sm hover:bg-primary-light ${selectedIndex === index ? 'bg-primary-light' : ''}`}
                                onClick={() => handleOptionSelect(option)}
                            >
                                {option}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {showOptions && loading && options.length === 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-light rounded-md shadow-lg p-4 text-center text-sm text-gray-500">
                    Loading options...
                </div>
            )}

            {showOptions && !loading && options.length === 0 && query.length >= minSearchLength && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-light rounded-md shadow-lg p-4 text-center text-sm text-gray-500">
                    No options found
                </div>
            )}
        </div>
    );
}
