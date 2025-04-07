import React from 'react';
import { Metadata } from 'next';
import RandomLeadsTable from '@/components/dashboard/RandomLeadsTable';
import DashboardLayout from '@/components/layouts/DashboardLayout';

export const metadata = {
  title: 'Random Category Leads | Leads Generator',
  description: 'View and manage leads generated from random categories',
};

export default function RandomLeadsPage() {
  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-800 flex items-center">
            <span className="material-icons mr-3 text-primary">category</span>
            Random Category Leads
          </h1>
          <p className="text-gray-600 mt-2">
            Leads generated using the random categories feature
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <RandomLeadsTable />
        </div>
      </div>
    </DashboardLayout>
  );
}
