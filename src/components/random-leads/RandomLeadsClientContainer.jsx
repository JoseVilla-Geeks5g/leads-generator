"use client";

import React, { useState, useEffect } from 'react';
import RandomLeadsTable from '@/components/dashboard/RandomLeadsTable';
import { Button } from '@/components/ui/button';

// This client component handles all the client-side logic
export default function RandomLeadsClientContainer() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchRandomLeads() {
      try {
        setLoading(true);
        const response = await fetch('/api/random-leads');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        
        const data = await response.json();
        setLeads(data.leads || []);
      } catch (err) {
        console.error('Error fetching random leads:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchRandomLeads();
  }, []);

  const handleExport = async () => {
    try {
      window.location.href = '/export?dataSource=random_category_leads';
    } catch (error) {
      console.error('Error starting export:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Random Category Leads</h1>
          <p className="text-gray-500">
            View and manage leads from random category scraping
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleExport}>
            Export Random Leads
          </Button>
        </div>
      </div>

      {error ? (
        <div className="bg-error-light text-error p-4 rounded-md">
          Error loading random leads: {error}
        </div>
      ) : (
        <RandomLeadsTable leads={leads} loading={loading} />
      )}
    </div>
  );
}
