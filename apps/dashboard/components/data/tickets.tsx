import { Badge } from '../ui/primitives';

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: string;
  priority: string;
  creatorDiscordId: string;
  assigneeDiscordId: string | null;
  discordChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PRIORITY: Record<string, { label: string; tone: 'muted' | 'info' | 'warn' | 'bad' }> = {
  low: { label: 'Niedrig', tone: 'muted' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'Hoch', tone: 'warn' },
  urgent: { label: 'Dringend', tone: 'bad' },
};
export const PriorityBadge = ({ p }: { p: string }) => (
  <Badge tone={PRIORITY[p]?.tone ?? 'muted'}>{PRIORITY[p]?.label ?? p}</Badge>
);
