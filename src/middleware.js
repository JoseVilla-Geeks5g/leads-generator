import { NextResponse } from 'next/server';

export function middleware(request) {
  // Make sure we properly handle dynamic routes
  const response = NextResponse.next();
  
  // Add cache control headers to prevent issues
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  
  return response;
}

export const config = {
  // Only run middleware on API routes
  matcher: '/api/:path*',
};
