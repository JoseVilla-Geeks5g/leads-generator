/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  swcMinify: true,
  // Add headers for API routes security
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  },
  // Increase API response limit for export data
  experimental: {
    serverComponentsExternalPackages: ['pg', 'exceljs', 'playwright'],
  },
  // Support loading environment variables from .env file
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    PGUSER: process.env.PGUSER,
    PGHOST: process.env.PGHOST,
    PGDATABASE: process.env.PGDATABASE,
    PGPASSWORD: process.env.PGPASSWORD,
    PGPORT: process.env.PGPORT,
  }
}

module.exports = nextConfig
