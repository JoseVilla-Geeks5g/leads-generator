"use client";

import React, { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';

export default function RandomLeadsTable() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    categories: [],
  });
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [hasEmail, setHasEmail] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const limit = 20;

  // Load leads on component mount and when filters change
  useEffect(() => {
    fetchLeads();
  }, [selectedCategory, searchTerm, hasEmail, currentPage, sortBy, sortOrder]);

  // Function to fetch leads with current filters
  const fetchLeads = async () => {
    try {
      setLoading(true);
      const offset = (currentPage - 1) * limit;
      
      // Build query parameters
      const params = new URLSearchParams();
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);
      
      if (selectedCategory) {
        params.append('category', selectedCategory);
      }
      
      if (searchTerm) {
        params.append('search', searchTerm);
      }
      
      if (hasEmail) {
        params.append('hasEmail', hasEmail);
      }

      // Fetch leads from API
      const response = await fetch(`/api/random-leads?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch leads');
      
      const data = await response.json();
      
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setFilters(data.filters || { categories: [] });
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle sort column click
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Handle export action
  const handleExport = async () => {
    try {
      // Create export parameters based on current filters
      const exportParams = {
        isRandomCategoryTask: true
      };

      if (selectedCategory) {
        exportParams.filter = {
          category: selectedCategory,
          hasEmail: hasEmail === 'true' ? true : hasEmail === 'false' ? false : undefined,
          searchTerm: searchTerm || undefined
        };
      }

      // Call export API
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(exportParams)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Export failed');
      }
      
      const data = await response.json();
      
      // If export is successful, download the file
      if (data.downloadUrl) {
        window.location.href = data.downloadUrl;
      }
    } catch (error) {
      console.error('Error exporting leads:', error);
      alert('Export failed: ' + error.message);
    }
  };

  // Calculate pagination values
  const totalPages = Math.ceil(total / limit);
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <div className="p-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search leads..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select
          value={selectedCategory}
          onValueChange={setSelectedCategory}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Categories</SelectItem>
            {filters.categories.map(category => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={hasEmail}
          onValueChange={setHasEmail}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Email Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any Email Status</SelectItem>
            <SelectItem value="true">Has Email</SelectItem>
            <SelectItem value="false">Missing Email</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleExport}>Export</Button>
      </div>

      {/* Summary */}
      <div className="mb-4 text-sm text-gray-500">
        Showing {leads.length} of {total} leads
        {selectedCategory && <span> in category <Badge>{selectedCategory}</Badge></span>}
        {hasEmail === 'true' && <span> with email</span>}
        {hasEmail === 'false' && <span> missing email</span>}
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px] cursor-pointer" onClick={() => handleSort('name')}>
                Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('category')}>
                Category {sortBy === 'category' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('email')}>
                Email {sortBy === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableHead>
              <TableHead>Website</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('city')}>
                City {sortBy === 'city' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('state')}>
                State {sortBy === 'state' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('rating')}>
                Rating {sortBy === 'rating' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              // Loading state
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <div className="flex justify-center items-center">
                    <svg className="animate-spin h-5 w-5 mr-3 text-primary" viewBox="0 0 24 24">
                      <circle 
                        className="opacity-25" 
                        cx="12" 
                        cy="12" 
                        r="10" 
                        stroke="currentColor" 
                        strokeWidth="4"
                      />
                      <path 
                        className="opacity-75" 
                        fill="currentColor" 
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Loading leads...
                  </div>
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              // Empty state
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  No leads found with the current filters
                </TableCell>
              </TableRow>
            ) : (
              // Results
              leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{lead.category}</Badge>
                  </TableCell>
                  <TableCell>
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="text-blue-500 hover:underline">
                        {lead.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">No email</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lead.website ? (
                      <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                        Visit site
                      </a>
                    ) : (
                      <span className="text-gray-400">No website</span>
                    )}
                  </TableCell>
                  <TableCell>{lead.city || '-'}</TableCell>
                  <TableCell>{lead.state || '-'}</TableCell>
                  <TableCell>{lead.rating || '-'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline">View</Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <Pagination>
            <Button 
              disabled={!hasPrevious} 
              onClick={() => setCurrentPage(page => page - 1)}
              variant="outline"
              size="sm"
            >
              Previous
            </Button>
            <span className="mx-4 flex items-center">
              Page {currentPage} of {totalPages}
            </span>
            <Button 
              disabled={!hasNext} 
              onClick={() => setCurrentPage(page => page + 1)}
              variant="outline"
              size="sm"
            >
              Next
            </Button>
          </Pagination>
        </div>
      )}
    </div>
  );
}
