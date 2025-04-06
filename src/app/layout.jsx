import { Inter } from 'next/font/google';
import './globals.css';

// Initialize the Inter font
const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
});

export const metadata = {
    title: 'Lead Generator Dashboard',
    description: 'Extract business data and contact information from Google Maps',
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
            </head>
            <body className={inter.className}>{children}</body>
        </html>
    );
}
