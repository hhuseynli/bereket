import type { Metadata, Viewport } from 'next';

// Phone screen: no pinch zoom, and "Add to Home Screen" opens without browser chrome. No viewport-fit=cover: in
// iPhone Safari that lets the page run under the floating bottom toolbar, which then hides the input row and mic.
export const metadata: Metadata = {
  title: 'WhatsApp',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'WhatsApp' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0b141a' },
  ],
};

export default function WaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
