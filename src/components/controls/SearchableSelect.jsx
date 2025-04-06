"use client";

import React, { useState, useEffect, useRef } from 'react';

export default function SearchableSelect({
    placeholder = 'Search...',
    value = '',
    onChange = () => { },
    onSelect = () => { },
    apiUrl = '/api/categories',
    minSearchLength = 1,
    maxItems = 10
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [options, setOptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedItem, setSelectedItem] = useState(value);
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Handle search input changes
    const handleSearchChange = (e) => {
        const term = e.target.value;
        setSearchTerm(term);
        onChange(term);

        if (term.length >= minSearchLength) {
            fetchOptions(term);
        } else {
            setOptions([]);
        }
    };

    // Fetch options from API
    const fetchOptions = async (term) => {
        try {
            setLoading(true);
            const response = await fetch(`${apiUrl}?query=${encodeURIComponent(term)}&limit=${maxItems}`);

            if (response.ok) {
                const data = await response.json();
                setOptions(data.categories || []);
            }
        } catch (error) {
            console.error('Error fetching options:', error);
        } finally {
            setLoading(false);
        }
    };

    // Handle option selection
    const handleSelectOption = (option) => {
        setSelectedItem(option);
        setSearchTerm(option);
        onSelect(option);
        setIsOpen(false);

        // Focus back on input after selection
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    return (
        <div className="relative w-full" ref={dropdownRef}>
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    className="w-full p-3 pl-10 border border-light rounded-md focus:ring-primary focus:border-primary shadow-sm"
                    placeholder={placeholder}
                    value={searchTerm}
                    onChange={handleSearchChange}
                    onFocus={() => setIsOpen(true)}
                />
                <span className="material-icons absolute left-3 top-3 text-gray-400">search</span>
                {loading && (
                    <span className="absolute right-3 top-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    </span>
                )}
            </div>

            {isOpen && searchTerm.length >= minSearchLength && (
                <div className="absolute z-10 w-full mt-1 bg-white shadow-lg rounded-md border border-light max-h-60 overflow-auto">
                    {options.length > 0 ? (
                        <ul className="py-1">
                            {options.map((option, index) => (
                                <li
                                    key={index}
                                    className="px-4 py-2 hover:bg-accent cursor-pointer transition"
                                    onClick={() => handleSelectOption(option)}
                                >
                                    {option}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="px-4 py-3 text-sm text-gray-500">
                            {loading ? 'Searching...' : 'No results found'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
