'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const TOPIC_QUERIES: Record<string, string[][]> = {
  servers: [['overview'], ['roblox-servers'], ['roblox-server']],
  tickets: [['list', '/tickets'], ['overview']],
  reports: [['list', '/reports'], ['overview']],
  alerts: [['overview'], ['alerts']],
  jobs: [['queues']],
  incidents: [['list', '/incidents'], ['overview']],
  approvals: [['list', '/approvals'], ['overview']],
};

/**
 * Live-Aktualisierung über Server-Sent Events. Der Browser verbindet sich bei Abbruch selbst neu
 * (Server sendet retry: 5000); Ereignisse lösen nur ein Neuladen der betroffenen Daten aus.
 */
export function useRealtime(): 'connecting' | 'live' | 'offline' {
  const client = useQueryClient();
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/v1/realtime/stream');
    source.addEventListener('ready', () => setState('live'));
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    for (const [topic, keys] of Object.entries(TOPIC_QUERIES)) {
      source.addEventListener(topic, () => {
        for (const key of keys) void client.invalidateQueries({ queryKey: key });
      });
    }
    return () => source.close();
  }, [client]);
  return state;
}
