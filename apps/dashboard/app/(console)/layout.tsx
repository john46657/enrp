'use client';

import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/shell';
import { SessionProvider } from '@/lib/session';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
