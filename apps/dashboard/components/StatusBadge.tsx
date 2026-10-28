import type { ReactNode } from 'react';
import { CheckIcon, ClockIcon, DashIcon, ErrorIcon, WarningIcon } from './icons';

export type StatusTone = 'ok' | 'warn' | 'error' | 'planned' | 'neutral';

const ICONS: Record<StatusTone, () => ReactNode> = {
  ok: () => <CheckIcon />,
  warn: () => <WarningIcon />,
  error: () => <ErrorIcon />,
  planned: () => <ClockIcon />,
  neutral: () => <DashIcon />,
};

/** Status immer als Symbol + Text, nie nur über Farbe. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {ICONS[tone]()}
      <span>{children}</span>
    </span>
  );
}
