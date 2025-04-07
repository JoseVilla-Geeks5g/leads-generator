import { Inter } from 'next/font/google';
import './globals.css';

// Initialize the Inter font
const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
});

export const metadata = {
    title: 'Lead Generator',
    description: 'Scrape Google Maps for business leads',
};

export default function RootLayout({ children }) {
    return (
        <html
            lang="en"
            className={`${inter.variable} light-mode`}
            suppressHydrationWarning={true}
        >
            <head>
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
                <link rel="icon" href="/favicon.ico" sizes="any" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            </head>
            <body className={inter.className}>{children}</body>
        </html>
    );
}
