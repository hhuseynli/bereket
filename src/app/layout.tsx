import type { Metadata } from 'next';
// Fonts ship with the app (SIL Open Font License, via Fontsource), so the UI looks the same with no internet.
// The latin-ext subsets cover Azerbaijani: Ə ə Ğ ğ I ı İ Ö ö Ş ş Ü ü Ç ç, and the manat sign ₼.
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/500.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/600-italic.css';
import './globals.css';
import { LangProvider } from '@/components/lang';
import { LiveProvider } from '@/components/live';

export const metadata: Metadata = {
  title: 'BƏRƏKƏT',
  description: 'Many small farms, woven into one reliable supply.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" />
      </head>
      <body>
        <LangProvider>
          <LiveProvider>{children}</LiveProvider>
        </LangProvider>
      </body>
    </html>
  );
}
