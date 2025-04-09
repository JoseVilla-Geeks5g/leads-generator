import React from 'react';

const ColumnSelector = ({ columns, selectedColumns, onChange }) => {
  // Toggle selection of a column
  const toggleColumn = (column) => {
    if (selectedColumns.includes(column)) {
      onChange(selectedColumns.filter(c => c !== column));
    } else {
      onChange([...selectedColumns, column]);
    }
  };

  // Toggle all columns
  const toggleAll = (checked) => {
    if (checked) {
      onChange(columns.map(col => col.key));
    } else {
      onChange([]);
    }
  };

  // Check if all columns are selected
  const allSelected = columns.length === selectedColumns.length;

  return (
    <div className="border border-light rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-medium">Select Columns to Export</h3>
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="form-checkbox h-4 w-4 text-primary"
            checked={allSelected}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span className="ml-2 text-xs text-gray-600">Select All</span>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {columns.map((column) => (
          <label key={column.key} className="flex items-center cursor-pointer p-1.5 hover:bg-gray-50 rounded">
            <input
              type="checkbox"
              className="form-checkbox h-4 w-4 text-primary"
              checked={selectedColumns.includes(column.key)}
              onChange={() => toggleColumn(column.key)}
            />
            <span className="ml-2 text-sm">{column.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default ColumnSelector;
