/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
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
    }
}

module.exports = nextConfig
