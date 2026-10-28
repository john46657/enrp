import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Semi_Condensed } from 'next/font/google';
import { BRAND } from '@emden/shared';
import { Sidebar } from '@/components/Sidebar';
import './globals.css';

// Barlow: nüchterne Grotesk mit Anleihen an Beschilderung – passt zum Hafen-Leitstand.
const body = Barlow({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' });
const display = Barlow_Semi_Condensed({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: { default: BRAND.dashboard, template: `%s · ${BRAND.dashboard}` },
  description: 'Servermanagement für das Emden Network GermanRP-Spiel auf Roblox.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0a1220', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${body.variable} ${display.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Zum Inhalt springen
        </a>
        <div className="shell">
          <Sidebar />
          <main id="main" className="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
