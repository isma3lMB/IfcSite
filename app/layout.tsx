import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-mono',
  display: 'swap',
});

// Static metadata is in the default language, matching the lang attribute
// below. LangProvider rewrites both once the stored/URL preference is known.
export const metadata: Metadata = {
  title: 'IFC Site — contexte de site vers IFC',
  description:
    'Tracez un rectangle sur une carte et obtenez un fichier IFC4 géoréférencé des bâtiments, voiries et terrain qu’il contient — entièrement dans le navigateur.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang starts at the default and is corrected client-side once the stored or
  // URL preference is known; see LangProvider.
  return (
    <html lang="fr" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
