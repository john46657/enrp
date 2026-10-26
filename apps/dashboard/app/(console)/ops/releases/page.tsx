'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, ErrorState, PageHeader, Panel, Select, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';

interface Env {
  id: string;
  key: string;
  name: string;
  currentVersion: string | null;
  url: string | null;
  requiresApproval: boolean;
  updatedAt: string;
}
interface Rel {
  release: {
    id: string;
    number: number;
    version: string;
    kind: string;
    status: string;
    commitSha: string | null;
    notes: string;
    preparedBy: string;
    approvedBy: string | null;
    pipelineRunUrl: string | null;
    failureReason: string | null;
    createdAt: string;
  };
  environmentKey: string;
}

const ENV_OPTIONS = [
  { value: 'development', label: 'Entwicklung' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Produktion' },
];

export default function ReleasesPage() {
  const can = useCan();
  const me = useSession();
  const [a, setA] = useState('staging');
  const [b, setB] = useState('production');
  const envs = useQuery({ queryKey: ['environments'], queryFn: () => get<{ items: Env[] }>('/environments') });
  const releases = useQuery({
    queryKey: ['releases'],
    queryFn: () => get<{ items: Rel[] }>('/releases', { limit: 50 }),
  });
  const diff = useQuery({
    queryKey: ['env-compare', a, b],
    queryFn: () =>
      get<{
        versionDiffers: boolean;
        configDiff: Array<{ path: string; before: unknown; after: unknown }>;
        a: { version: string | null };
        b: { version: string | null };
      }>('/environments/compare', { a, b }),
  });
  if (envs.isLoading) return <Skeleton />;
  if (envs.error) return <ErrorState error={envs.error} />;
  const invalidate = [['releases'], ['environments']];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Releases & Umgebungen"
        description="Releases laufen ausschließlich über die CI/CD-Pipeline. Die freigebende Person muss eine andere sein als die vorbereitende."
        actions={
          can('releases:create') && (
            <ActionDialog
              title="Release vorbereiten"
              submitLabel="Vorbereiten"
              fields={[
                { name: 'version', label: 'Version (z. B. 1.4.0)', required: true },
                { name: 'environment', label: 'Umgebung', type: 'select', required: true, options: ENV_OPTIONS },
                {
                  name: 'kind',
                  label: 'Art',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'deploy', label: 'Deployment' },
                    { value: 'rollback', label: 'Rollback auf diese Version' },
                    { value: 'promote', label: 'Promotion' },
                  ],
                },
                { name: 'commitSha', label: 'Commit-Hash' },
                { name: 'notes', label: 'Release-Notizen', type: 'textarea' },
              ]}
              onSubmit={(v, k) => post('/releases', v, k)}
              successMessage={(r) => `Release #${(r as { number: number }).number} vorbereitet`}
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Release vorbereiten
                </Button>
              )}
            />
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {envs.data!.items.map((e) => (
          <Panel key={e.id} title={e.name}>
            <p className="tabular text-2xl font-semibold">{e.currentVersion ?? 'unbekannt'}</p>
            <p className="text-sm text-muted">zuletzt gemeldet {fmtRelative(e.updatedAt)}</p>
            {e.requiresApproval && <p className="mt-1 text-xs text-muted">Freigabe durch zweite Person erforderlich</p>}
          </Panel>
        ))}
      </div>
      <Panel title="Releases">
        <ul className="divide-y divide-line text-sm">
          {releases.data?.items.map(({ release: r, environmentKey }) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="tabular font-medium">#{r.number}</span>
              <span>
                {r.kind === 'rollback' ? 'Rollback' : r.kind === 'promote' ? 'Promotion' : 'Deployment'} {r.version}{' '}
                nach {environmentKey}
              </span>
              <StatusBadge status={r.status} />
              <span className="text-muted">
                vorbereitet von {r.preparedBy}
                {r.approvedBy ? `, freigegeben von ${r.approvedBy}` : ''}, {fmtDateTime(r.createdAt)}
              </span>
              {r.failureReason && <span className="text-bad">{r.failureReason}</span>}
              {r.pipelineRunUrl && (
                <a href={r.pipelineRunUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  Pipeline
                </a>
              )}
              {r.status === 'prepared' && can('releases:approve') && r.preparedBy !== me.user.id && (
                <ActionDialog
                  title={`Release #${r.number} freigeben`}
                  description="Nach der Freigabe stößt der Worker die konfigurierte Pipeline an."
                  submitLabel="Freigeben"
                  requireReason
                  fields={[]}
                  onSubmit={(v, k) => post(`/releases/${r.id}/approve`, v, k)}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" variant="primary" className="ml-auto" onClick={open}>
                      Freigeben
                    </Button>
                  )}
                />
              )}
              {r.status === 'prepared' && can('releases:create') && (
                <ActionDialog
                  title={`Release #${r.number} abbrechen`}
                  submitLabel="Abbrechen"
                  danger
                  requireReason
                  fields={[]}
                  onSubmit={(v) => post(`/releases/${r.id}/cancel`, v)}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" variant="ghost" onClick={open}>
                      Abbrechen
                    </Button>
                  )}
                />
              )}
            </li>
          ))}
          {!releases.data?.items.length && <li className="text-muted">Noch keine Releases.</li>}
        </ul>
      </Panel>
      <Panel
        title="Umgebungsvergleich"
        actions={
          <>
            <Select aria-label="Umgebung A" className="w-auto" value={a} onChange={(e) => setA(e.target.value)}>
              {ENV_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Umgebung B" className="w-auto" value={b} onChange={(e) => setB(e.target.value)}>
              {ENV_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </>
        }
      >
        {diff.data ? (
          <>
            <p className="text-sm">
              Version: {diff.data.a.version ?? 'unbekannt'} gegenüber {diff.data.b.version ?? 'unbekannt'}
            </p>
            {diff.data.configDiff.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {diff.data.configDiff.map((d) => (
                  <li key={d.path}>
                    <code>{d.path}</code>: {JSON.stringify(d.before)} / {JSON.stringify(d.after)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Keine Unterschiede in der gemeldeten, nicht geheimen Konfiguration.
              </p>
            )}
          </>
        ) : (
          <Skeleton rows={2} />
        )}
      </Panel>
    </div>
  );
}
