'use client';

import { LangProvider } from '@/lib/i18n/context';
import { ThemeProvider } from '@/lib/theme/context';
import { IfcSite } from '@/components/ifc-site';

export default function Page() {
  // Both providers sit above everything so switching language or theme never
  // remounts the 3D canvas or the map — both are imperative and would lose their
  // state. The theme is the outer one: it writes a class on <html> rather than
  // rendering anything, so it has no reason to sit inside the language.
  return (
    <ThemeProvider>
      <LangProvider>
        <IfcSite />
      </LangProvider>
    </ThemeProvider>
  );
}
