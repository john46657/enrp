import type { ReactNode } from 'react';
import { CheckIcon, ErrorIcon, WarningIcon, DashIcon } from './icons';

export type NoticeTone = 'success' | 'error' | 'warn' | 'info';

const ICONS: Record<NoticeTone, () => ReactNode> = {
  success: () => <CheckIcon />,
  error: () => <ErrorIcon />,
  warn: () => <WarningIcon />,
  info: () => <DashIcon />,
};

/** Rückmeldung mit Symbol und Text. Fehler werden Screenreadern sofort vorgelesen. */
export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {ICONS[tone]()}
      <div>{children}</div>
    </div>
  );
}
