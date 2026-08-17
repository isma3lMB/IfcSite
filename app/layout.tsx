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
    'Tracez un rectangle sur une carte et obtenez un fichier IFC géoréférencé des bâtiments, voiries et terrain qu’il contient — entièrement dans le navigateur.',
};

/**
 * Run before the first paint, ahead of React.
 *
 * The app is a static export: the HTML on disk carries no theme, so a visitor who
 * has chosen dark would get a white flash while the bundle loads and
 * ThemeProvider's effect runs. This stamps the class in the head instead. It
 * duplicates the resolution in lib/theme/context — a stored override, otherwise
 * the light default — and the two have to stay in step, or the first frame and
 * the first render disagree.
 */
const NO_FLASH = `try{var d=localStorage.getItem('ifcsite.theme')==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang starts at the default and is corrected client-side once the stored or
  // URL preference is known; see LangProvider. suppressHydrationWarning is for
  // the class and style the script above writes on this element before React
  // sees it — without it every load logs a mismatch on <html>.
  return (
    <html
      lang="fr"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Both themes are supported, so form controls and scrollbars follow. */}
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
