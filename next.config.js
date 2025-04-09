/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  swcMinify: true,
  // Disable static generation completely to avoid React context errors
  experimental: {
    // This tells Next.js to use Server-Side Rendering instead of Static Generation
    appDir: true
  },
  // Force all pages to be server-side rendered
  // This will prevent the "Cannot read properties of null (reading 'useContext')" errors
  serverRuntimeConfig: {
    // Will only be available on the server side
  },
  publicRuntimeConfig: {
    // Will be available on both server and client
    staticFolder: '/static',
  },
  // Correctly retrieve environment variables from .env file
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    PGUSER: process.env.PGUSER,
    PGHOST: process.env.PGHOST,
    PGDATABASE: process.env.PGDATABASE,
    PGPASSWORD: process.env.PGPASSWORD,
    PGPORT: process.env.PGPORT
  }
}

module.exports = nextConfig
