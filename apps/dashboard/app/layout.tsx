import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'ENRP Verwaltung', template: '%s · ENRP Verwaltung' },
  description: 'Verwaltung des GermanRP-Servers: Spieler, Fraktionen, Moderation, Betrieb und Sicherheit.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0d1626', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" data-theme="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
