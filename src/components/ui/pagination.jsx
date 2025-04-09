import React from 'react';

export function Pagination({ 
  className, 
  currentPage = 1, 
  totalPages = 1,
  onPageChange,
  ...props 
}) {
  // Generate array of page numbers to show
  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;
    
    if (totalPages <= maxPagesToShow) {
      // If we have fewer pages than max, show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      // Calculate start and end of middle pages
      let startPage = Math.max(2, currentPage - 1);
      let endPage = Math.min(totalPages - 1, currentPage + 1);
      
      // Adjust if at the start or end
      if (currentPage <= 2) {
        endPage = 3;
      } else if (currentPage >= totalPages - 1) {
        startPage = totalPages - 2;
      }
      
      // Add ellipsis before middle pages if needed
      if (startPage > 2) {
        pages.push('...');
      }
      
      // Add middle pages
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
      
      // Add ellipsis after middle pages if needed
      if (endPage < totalPages - 1) {
        pages.push('...');
      }
      
      // Always show last page
      pages.push(totalPages);
    }
    
    return pages;
  };

  const handlePageClick = (page) => {
    if (typeof onPageChange === 'function') {
      onPageChange(page);
    }
  };

  return (
    <div className={`flex items-center justify-center space-x-1 ${className || ''}`} {...props}>
      {/* Previous Button */}
      <button
        onClick={() => currentPage > 1 && handlePageClick(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/80 disabled:opacity-50 disabled:pointer-events-none"
      >
        Previous
      </button>
      
      {/* Page Numbers */}
      {getPageNumbers().map((page, index) => (
        <React.Fragment key={index}>
          {page === '...' ? (
            <span className="px-3 py-2">...</span>
          ) : (
            <button
              onClick={() => handlePageClick(page)}
              className={`px-3 py-2 rounded-md text-sm font-medium
                ${currentPage === page ? 'bg-primary text-white' : 'bg-accent hover:bg-accent/80'}`}
            >
              {page}
            </button>
          )}
        </React.Fragment>
      ))}
      
      {/* Next Button */}
      <button
        onClick={() => currentPage < totalPages && handlePageClick(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/80 disabled:opacity-50 disabled:pointer-events-none"
      >
        Next
      </button>
    </div>
  );
}

export default Pagination;
