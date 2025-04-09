import React from 'react';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import RandomLeadsClientContainer from '@/components/random-leads/RandomLeadsClientContainer';

// This can be exported from a server component
export const metadata = {
  title: 'Random Category Leads | Leads Generator',
  description: 'View and manage leads generated from random categories',
};

// Server component that holds the metadata
export default function RandomLeadsPage() {
  return (
    <DashboardLayout>
      <RandomLeadsClientContainer />
    </DashboardLayout>
  );
}
