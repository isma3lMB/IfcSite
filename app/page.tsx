'use client';

import { LangProvider } from '@/lib/i18n/context';
import { IfcSite } from '@/components/ifc-site';

export default function Page() {
  // LangProvider sits above everything so switching language never remounts the
  // 3D canvas or the map — both are imperative and would lose their state.
  return (
    <LangProvider>
      <IfcSite />
    </LangProvider>
  );
}
