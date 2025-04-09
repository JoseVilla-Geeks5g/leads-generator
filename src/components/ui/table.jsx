import React from 'react';

export function Table({ className, ...props }) {
  return <table className={`w-full ${className || ''}`} {...props} />;
}

export function TableHeader({ className, ...props }) {
  return <thead className={className} {...props} />;
}

export function TableBody({ className, ...props }) {
  return <tbody className={className} {...props} />;
}

export function TableFooter({ className, ...props }) {
  return <tfoot className={className} {...props} />;
}

export function TableRow({ className, ...props }) {
  return <tr className={`border-b hover:bg-gray-50 ${className || ''}`} {...props} />;
}

export function TableHead({ className, ...props }) {
  return <th className={`px-4 py-3 text-left font-medium text-gray-900 ${className || ''}`} {...props} />;
}

export function TableCell({ className, ...props }) {
  return <td className={`px-4 py-3 ${className || ''}`} {...props} />;
}
