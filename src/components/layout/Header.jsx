"use client";

import React from 'react';

export default function Header() {
    return (
        <header className="bg-card shadow-sm py-4 px-6">
            <div className="flex justify-between items-center">
                <div className="flex md:hidden">
                    <button
                        className="p-2 rounded-lg hover:bg-accent text-gray-500 hover:text-primary transition"
                        aria-label="Open menu"
                    >
                        <span className="material-icons">menu</span>
                    </button>
                    <div className="ml-3 flex items-center">
                        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                            <span className="material-icons text-white">bolt</span>
                        </div>
                        <h1 className="ml-2 text-xl font-bold text-primary">LeadGen</h1>
                    </div>
                </div>

                <div className="hidden md:flex items-center gap-3">
                    <span className="text-lg font-semibold">Dashboard</span>
                    <div className="text-xs bg-primary-light text-primary font-medium px-3 py-1 rounded-full">Beta</div>
                </div>

                <div className="hidden md:block relative w-1/3 max-w-md">
                    <input
                        type="search"
                        placeholder="Search anything..."
                        className="pl-11 pr-5 py-2.5 w-full rounded-lg bg-accent focus:bg-white border border-transparent focus:border-primary transition shadow-sm focus:shadow-md"
                    />
                    <span className="material-icons absolute left-3.5 top-2.5 text-gray-400">search</span>
                </div>

                <div className="flex items-center gap-5">
                    <button
                        className="p-2 rounded-lg hover:bg-accent text-gray-500 hover:text-primary transition relative"
                        aria-label="Notifications"
                    >
                        <span className="material-icons">notifications</span>
                        <span className="absolute -top-0.5 -right-0.5 bg-primary text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">3</span>
                    </button>

                    <button
                        className="p-2 rounded-lg hover:bg-accent text-gray-500 hover:text-primary transition"
                        aria-label="Help"
                    >
                        <span className="material-icons">help_outline</span>
                    </button>

                    <div className="flex items-center gap-3 pl-2 border-l border-light">
                        <div className="w-10 h-10 bg-primary-light text-primary rounded-lg flex items-center justify-center font-semibold">
                            JD
                        </div>
                        <div className="hidden md:block">
                            <div className="font-medium">David Shnader</div>
                            <div className="text-xs text-gray-500">david.shnader@example.com</div>
                        </div>
                        <span className="material-icons text-gray-400">expand_more</span>
                    </div>
                </div>
            </div>
        </header>
    );
}
