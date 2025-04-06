"use client";

import React from 'react';

export default function ResultsList() {
    // This would come from API in a real implementation
    const results = [
        { id: 1, name: 'Acme Corporation', category: 'Technology', phone: '(555) 123-4567', email: 'info@acme.com', address: '123 Main St, San Francisco, CA', rating: 4.5 },
        { id: 2, name: 'Globex Industries', category: 'Manufacturing', phone: '(555) 987-6543', email: 'contact@globex.com', address: '456 Market St, San Francisco, CA', rating: 4.2 },
        { id: 3, name: 'Oceanic Airlines', category: 'Travel', phone: '(555) 555-1212', email: 'bookings@oceanic.com', address: '789 Airport Blvd, San Francisco, CA', rating: 3.9 },
        { id: 4, name: 'Stark Enterprises', category: 'Technology', phone: '(555) 111-2222', email: 'hello@stark.com', address: '1 Stark Tower, New York, NY', rating: 4.8 },
        { id: 5, name: 'Wayne Industries', category: 'Manufacturing', phone: '(555) 333-4444', email: 'info@wayne.com', address: '1007 Mountain Drive, Gotham, NJ', rating: 4.3 }
    ];

    return (
        <div className="card p-5 hover:shadow-md transition">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                <h2 className="text-xl font-semibold flex items-center">
                    <span className="material-icons mr-3 text-primary">format_list_bulleted</span>
                    Extracted Leads
                </h2>

                <div className="flex gap-2">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Filter results..."
                            className="pl-9 pr-4 py-2 border border-light rounded-md focus:ring-primary focus:border-primary text-sm shadow-sm"
                        />
                        <span className="material-icons absolute left-3 top-2 text-gray-400 text-sm">filter_list</span>
                    </div>

                    <button className="btn btn-outline px-3 py-2 flex items-center shadow-sm">
                        <span className="material-icons mr-1.5 text-sm">file_download</span>
                        CSV
                    </button>

                    <button className="btn btn-secondary px-3 py-2 flex items-center shadow-sm">
                        <span className="material-icons mr-1.5 text-sm">save</span>
                        Save
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                    <thead>
                        <tr>
                            <th className="px-4 py-3 bg-accent rounded-tl-md text-left font-semibold">Business Name</th>
                            <th className="px-4 py-3 bg-accent text-left font-semibold">Category</th>
                            <th className="px-4 py-3 bg-accent text-left font-semibold">Phone</th>
                            <th className="px-4 py-3 bg-accent text-left font-semibold">Email</th>
                            <th className="px-4 py-3 bg-accent text-left font-semibold">Address</th>
                            <th className="px-4 py-3 bg-accent text-left font-semibold">Rating</th>
                            <th className="px-4 py-3 bg-accent rounded-tr-md text-left font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-light">
                        {results.map((business) => (
                            <tr key={business.id} className="hover:bg-accent transition">
                                <td className="px-4 py-3.5 font-medium text-primary">{business.name}</td>
                                <td className="px-4 py-3.5">
                                    <span className="px-2.5 py-1 bg-primary-light text-primary rounded-full text-xs font-medium">
                                        {business.category}
                                    </span>
                                </td>
                                <td className="px-4 py-3.5">{business.phone}</td>
                                <td className="px-4 py-3.5">{business.email}</td>
                                <td className="px-4 py-3.5 truncate max-w-xs">{business.address}</td>
                                <td className="px-4 py-3.5">
                                    <div className="flex items-center">
                                        <span className="font-medium">{business.rating}</span>
                                        <span className="material-icons text-warning ml-1 text-sm">star</span>
                                    </div>
                                </td>
                                <td className="px-4 py-3.5">
                                    <div className="flex">
                                        <button className="p-1.5 rounded-md hover:bg-primary-light text-gray-500 hover:text-primary mr-2 transition" title="View Details">
                                            <span className="material-icons text-sm">visibility</span>
                                        </button>
                                        <button className="p-1.5 rounded-md hover:bg-secondary-light text-gray-500 hover:text-secondary transition" title="Edit">
                                            <span className="material-icons text-sm">edit</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-light">
                <div className="text-sm text-gray-500">
                    Showing 5 of 247 results
                </div>
                <div className="flex gap-1">
                    <button className="p-2 border border-light rounded-md hover:bg-accent transition" disabled>
                        <span className="material-icons text-sm">chevron_left</span>
                    </button>
                    <button className="p-2 min-w-[40px] bg-primary text-white rounded-md">1</button>
                    <button className="p-2 min-w-[40px] border border-light rounded-md hover:bg-accent transition">2</button>
                    <button className="p-2 min-w-[40px] border border-light rounded-md hover:bg-accent transition">3</button>
                    <button className="p-2 border border-light rounded-md hover:bg-accent transition">
                        <span className="material-icons text-sm">chevron_right</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
