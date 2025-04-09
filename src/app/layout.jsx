import { Inter } from 'next/font/google';
import './globals.css';
import { ClientProvider } from '@/components/providers/ClientProvider';

// Initialize the Inter font
const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter',
});

// Force all pages to be server rendered to avoid static generation issues
export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Leads Generator',
    description: 'Generate leads for your business',
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
            <body className={inter.className}>
                <ClientProvider>
                    {children}
                </ClientProvider>
            </body>
        </html>
    );
}
