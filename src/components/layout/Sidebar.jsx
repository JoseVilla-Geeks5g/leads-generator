"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
    const pathname = usePathname();
    const [expandedSection, setExpandedSection] = useState('leads');

    // Updated navigation with grouped items
    const navSections = [
        {
            id: 'main',
            items: [
                { icon: 'dashboard', label: 'Dashboard', path: '/' }
            ]
        },
        {
            id: 'leads',
            title: 'Lead Generation',
            expandable: true,
            items: [
                { icon: 'search', label: 'Find Leads', path: '/leads' },
                { icon: 'category', label: 'Random Categories', path: '/random-categories', highlight: true },
                { icon: 'task_alt', label: 'Tasks', path: '/tasks' }
            ]
        },
        {
            id: 'emails',
            title: 'Email Tools',
            expandable: true,
            items: [
                { icon: 'email', label: 'Email Finder', path: '/email-finder' },
                { icon: 'verified', label: 'Validation', path: '/email-validation' }
            ]
        },
        {
            id: 'data',
            title: 'Data Management',
            expandable: true,
            items: [
                { icon: 'people', label: 'Contacts', path: '/contacts' },
                { icon: 'history', label: 'History', path: '/history' },
                { icon: 'download', label: 'Exports', path: '/export' }
            ]
        },
        {
            id: 'other',
            items: [
                { icon: 'analytics', label: 'Analytics', path: '/analytics' },
                { icon: 'settings', label: 'Settings', path: '/settings' }
            ]
        }
    ];

    const toggleSection = (sectionId) => {
        setExpandedSection(expandedSection === sectionId ? null : sectionId);
    };

    return (
        <aside className="w-64 bg-card shadow-md hidden md:block h-screen overflow-y-auto">
            <div className="p-5 flex items-center">
                <Link href="/" className="flex items-center">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mr-3">
                        <img src="/geeks5g.webp" alt="geeks5g logo" />
                    </div>
                    <h2 className="text-2xl font-bold text-secundary">Geeks5g</h2>
                </Link>
            </div>

            <div className="px-3 py-2">
                <nav>
                    {navSections.map((section, sectionIndex) => (
                        <div key={section.id} className="mb-4">
                            {section.title && (
                                <div 
                                    className={`flex items-center justify-between px-4 py-2 text-sm text-gray-500 ${section.expandable ? 'cursor-pointer' : ''}`}
                                    onClick={() => section.expandable && toggleSection(section.id)}
                                >
                                    <span>{section.title}</span>
                                    {section.expandable && (
                                        <span className="material-icons text-sm">
                                            {expandedSection === section.id ? 'expand_less' : 'expand_more'}
                                        </span>
                                    )}
                                </div>
                            )}
                            
                            <div className={`space-y-1 ${section.expandable && expandedSection !== section.id ? 'hidden' : ''}`}>
                                {section.items.map((item, index) => {
                                    const isActive = pathname === item.path;
                                    return (
                                        <Link
                                            key={index}
                                            href={item.path}
                                            className={`flex items-center px-4 py-3 rounded-lg transition 
                                            ${isActive
                                                ? 'bg-primary-light text-primary font-medium'
                                                : item.highlight 
                                                  ? 'bg-accent border-l-4 border-primary hover:bg-primary-light hover:text-primary'
                                                  : 'hover:bg-accent hover:text-primary'
                                            }`}
                                        >
                                            <span className={`material-icons mr-3 ${isActive ? 'text-primary' : ''}`}>
                                                {item.icon}
                                            </span>
                                            <span>{item.label}</span>

                                            {isActive && (
                                                <div className="ml-auto w-1.5 h-5 bg-primary rounded-full"></div>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
            </div>

            <div className="absolute bottom-0 p-4 w-64 border-t border-light">
                <div className="flex items-center p-2 rounded-lg hover:bg-accent cursor-pointer">
                    <div className="w-10 h-10 bg-primary-light text-primary rounded-lg flex items-center justify-center font-semibold">
                        DS
                    </div>
                    <div className="ml-3">
                        <div className="font-medium">David Shnader</div>
                        <div className="text-xs text-gray-500 flex items-center">
                            <span className="inline-block w-2 h-2 bg-success rounded-full mr-1"></span>
                        </div>
                    </div>
                    <span className="material-icons ml-auto text-gray-400">expand_more</span>
                </div>
            </div>
        </aside>
    );
}
