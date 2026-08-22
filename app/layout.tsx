import type { Metadata, Viewport } from 'next';
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
  title: 'IFC SITE',
  description:
    'Générer une maquette site IFC géoréférencée entièrement dans le navigateur.',
};

/**
 * `viewport-fit: cover` is what lets the app own the whole phone screen rather
 * than the rounded-rectangle safe box inside it — the viewer is full-bleed, and
 * a letterboxed one on a notched device reads as a broken page.
 *
 * It comes with an obligation, discharged in globals.css: with `cover` the
 * chrome is free to land *under* the notch and the home indicator, so .overlay's
 * padding is the safe-area insets rather than a flat 12px. The two are one
 * change; neither is correct on its own.
 *
 * Nothing here restricts zoom — no maximum-scale, no user-scalable=no. Pinching
 * is the only way to read fine print on a phone and taking it away is an
 * accessibility failure, so the fix for iOS's focus-zoom is the 16px input rule
 * in globals.css, not a locked viewport.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
