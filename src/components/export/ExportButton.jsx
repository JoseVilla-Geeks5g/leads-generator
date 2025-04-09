import React, { useState } from 'react';

const ExportButton = ({ onClick, isExporting, count = null, disabled = false }) => {
  return (
    <button
      onClick={onClick}
      disabled={isExporting || disabled}
      className="btn btn-primary px-6 py-2.5 flex items-center shadow-md hover:shadow-lg"
    >
      {isExporting ? (
        <>
          <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
          Exporting...
        </>
      ) : (
        <>
          <span className="material-icons mr-2">download</span>
          Export Data {count !== null && `(${count.toLocaleString()})`}
        </>
      )}
    </button>
  );
};

export default ExportButton;
