import type { Metadata } from 'next';
import './globals.css';
import { LiveProvider } from '@/components/live';

export const metadata: Metadata = {
  title: 'BƏRƏKƏT',
  description: 'Many small farms, woven into one reliable supply.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400;1,8..60,600&family=Source+Sans+3:wght@400;500;600;700&display=swap"
        />
        <link rel="icon" href="/icon.svg" />
      </head>
      <body>
        <LiveProvider>{children}</LiveProvider>
      </body>
    </html>
  );
}
