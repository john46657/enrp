'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { LegacyState, Tabs, TABLE } from '@/components/data/legacy';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  KeyValues,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { fmtMillis, legacyAction, legacyKey, useLegacyGuild, useLegacyLive } from '@/lib/legacy';
import { useCan } from '@/lib/session';
import { ApplicationSetup, type AppType } from './setup';

interface AppRecord {
  number: string;
  type: string;
  status: string;
  createdAt: number;
  userId: string;
  userTag: string;
  userName: string | null;
  roblox?: { id?: number; name?: string } | null;
  answers: Array<{ question: string; answer: string }>;
  durationMs?: number;
  joinedAt?: number;
  accountCreatedAt?: number;
  decidedBy?: string;
  decidedByName?: string | null;
  decidedAt?: number;
  reason?: string | null;
  history: Array<{ status: string; by: string; byName: string | null; at: number; reason?: string }>;
  notes: Array<{ by: string; byName: string | null; at: number; text: string }>;
  link: string | null;
  transitions: string[];
}
interface AppList {
  records: AppRecord[];
  total: number;
  status: Record<string, string>;
  final: string[];
}
interface Progress {
  userId: string;
  userName: string;
  type: string;
  step: number;
  questions: number;
  minutes: number;
}
interface Ban {
  id: string;
  discordId: string | null;
  robloxName: string | null;
  scopes: string[];
  reason: string;
  expiresAt: number | null;
  createdAt: number;
  createdByName: string | null;
  active: boolean;
  userName: string | null;
}
interface Metrics {
  count: number;
  accepted: number;
  rejected: number;
  open: number;
  withdrawn: number;
  acceptRate: number | null;
  avgMs: number | null;
}
interface Stats {
  periods: Record<string, { current: Metrics; previous: Metrics }>;
  perType: Array<Metrics & { id: string; name: string; emoji: string }>;
  topReviewers: Array<{ id: string; name: string; count: number }>;
  total: number;
}

const TONE: Record<string, 'ok' | 'bad' | 'warn' | 'info' | 'muted'> = {
  ACCEPTED: 'ok',
  REJECTED: 'bad',
  WITHDRAWN: 'muted',
  SUBMITTED: 'warn',
  OPEN: 'warn',
  SCREENING: 'info',
  INTERVIEW: 'info',
  PENDING_DECISION: 'info',
};
const percent = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);
const hours = (ms: number | null) => {
  if (ms === null) return '–';
  const h = ms / 3_600_000;
  return h < 48 ? `${h.toFixed(1).replace('.', ',')} Std.` : `${(h / 24).toFixed(1).replace('.', ',')} Tage`;
};
const minutes = (ms?: number) => (ms ? `${Math.max(1, Math.round(ms / 60_000))} Min.` : '–');

function Detail({
  record,
  data,
  typeName,
  onClose,
}: {
  record: AppRecord;
  data: AppList;
  typeName: string;
  onClose: () => void;
}) {
  const can = useCan();
  const toast = useToast();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: legacyKey('applications') });
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown>; done: string }) =>
      legacyAction(action, { number: record.number, ...body }),
    onSuccess: async (_r, v) => {
      toast('success', v.done);
      setReason('');
      setNote('');
      await refresh();
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  const open = !data.final.includes(record.status);
  const edit = can('applications:edit');
  // Polizei-Bewerbung: Prüfschritte; Annehmen erst im letzten Schritt. Einfache Bewerbung: direkt entscheiden.
  const steps = record.transitions.filter((s) => !data.final.includes(s));
  const canAccept = open && (!record.transitions.length || record.transitions.includes('ACCEPTED'));
  return (
    <Dialog open onClose={onClose} title={`${record.number} · ${typeName}`} wide>
      <div className="space-y-5">
        <KeyValues
          items={[
            [
              'Status',
              <Badge key="s" tone={TONE[record.status] ?? 'muted'}>
                {data.status[record.status] ?? record.status}
              </Badge>,
            ],
            ['Bewerber', `${record.userName ?? record.userTag} (${record.userId})`],
            [
              'Roblox',
              record.roblox?.name ? `${record.roblox.name}${record.roblox.id ? ` (${record.roblox.id})` : ''}` : '–',
            ],
            ['Eingereicht', fmtMillis(record.createdAt)],
            ['Ausfülldauer', minutes(record.durationMs)],
            ['Auf dem Server seit', fmtMillis(record.joinedAt)],
            ['Konto erstellt', fmtMillis(record.accountCreatedAt)],
            ...(record.decidedAt
              ? ([
                  [
                    'Entschieden',
                    `${fmtMillis(record.decidedAt)} von ${record.decidedByName ?? record.decidedBy ?? '–'}`,
                  ],
                  ['Grund', record.reason || '–'],
                ] as Array<[string, string]>)
              : []),
            [
              'In Discord',
              record.link ? (
                <a key="l" href={record.link} target="_blank" rel="noreferrer" className="text-signal underline">
                  Zur Nachricht
                </a>
              ) : (
                '–'
              ),
            ],
          ]}
        />
        <section>
          <h3 className="mb-2 font-medium">Antworten</h3>
          <ol className="space-y-3">
            {record.answers.map((a, i) => (
              <li key={i} className="rounded-md border border-line p-3">
                <p className="text-sm text-muted">
                  {i + 1}. {a.question}
                </p>
                <p className="mt-1 break-words whitespace-pre-wrap">{a.answer || '—'}</p>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="mb-2 font-medium">Verlauf</h3>
          <ul className="space-y-1 text-sm">
            {record.history.map((h, i) => (
              <li key={i}>
                <span className="text-muted">{fmtMillis(h.at)}</span> · {data.status[h.status] ?? h.status} ·{' '}
                {h.byName ?? h.by}
                {h.reason ? ` – ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 font-medium">Interne Notizen</h3>
          {record.notes.length ? (
            <ul className="mb-2 space-y-2 text-sm">
              {record.notes.map((n, i) => (
                <li key={i} className="rounded-md border border-line p-2">
                  <span className="text-muted">
                    {fmtMillis(n.at)} · {n.byName ?? n.by}
                  </span>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-sm text-muted">Keine Notizen. Notizen sieht nur das Team im Dashboard.</p>
          )}
          {edit && (
            <div className="flex gap-2">
              <Input
                aria-label="Neue Notiz"
                placeholder="Notiz hinzufügen …"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                disabled={!note.trim() || run.isPending}
                onClick={() => run.mutate({ action: 'app-note', body: { text: note }, done: 'Notiz gespeichert.' })}
              >
                Speichern
              </Button>
            </div>
          )}
        </section>
        {edit && open && (
          <section className="space-y-3 border-t border-line pt-4">
            <h3 className="font-medium">Entscheiden</h3>
            {steps.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Nächster Prüfschritt:</span>
                {steps.map((s) => (
                  <Button
                    key={s}
                    disabled={run.isPending}
                    onClick={() =>
                      run.mutate({
                        action: 'app-status',
                        body: { status: s },
                        done: `Status: ${data.status[s] ?? s}`,
                      })
                    }
                  >
                    {data.status[s] ?? s}
                  </Button>
                ))}
              </div>
            )}
            <Textarea
              aria-label="Grund"
              placeholder="Grund (optional) – der Bewerber bekommt ihn per Direktnachricht."
              rows={2}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {canAccept && (
                <Button
                  variant="primary"
                  disabled={run.isPending}
                  onClick={() =>
                    run.mutate({
                      action: 'app-decide',
                      body: { action: 'accept', reason },
                      done: 'Bewerbung angenommen.',
                    })
                  }
                >
                  Annehmen
                </Button>
              )}
              <Button
                variant="danger"
                disabled={run.isPending}
                onClick={() =>
                  run.mutate({ action: 'app-decide', body: { action: 'reject', reason }, done: 'Bewerbung abgelehnt.' })
                }
              >
                Ablehnen
              </Button>
              {record.transitions.includes('WITHDRAWN') && (
                <Button
                  variant="ghost"
                  disabled={run.isPending}
                  onClick={() =>
                    run.mutate({
                      action: 'app-status',
                      body: { status: 'WITHDRAWN' },
                      done: 'Bewerbung zurückgezogen.',
                    })
                  }
                >
                  Zurückziehen
                </Button>
              )}
            </div>
            <p className="text-sm text-muted">
              Wie in Discord: Der Bewerber wird benachrichtigt, Rollen werden vergeben und die Nachricht im Team-Kanal
              wird aktualisiert.
            </p>
          </section>
        )}
        {can('applications:delete') && (
          <div className="border-t border-line pt-4">
            <ActionDialog
              title={`Bewerbung ${record.number} löschen`}
              description="Löscht die Bewerbung samt Antworten und die Nachricht im Team-Kanal. Das lässt sich nicht rückgängig machen."
              fields={[]}
              danger
              submitLabel="Löschen"
              successMessage="Bewerbung gelöscht."
              onSubmit={() => legacyAction('app-delete', { number: record.number })}
              invalidate={[legacyKey('applications')]}
              onDone={onClose}
              trigger={(o) => (
                <Button variant="danger" size="sm" onClick={o}>
                  Bewerbung löschen
                </Button>
              )}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Records({ types }: { types: AppType[] }) {
  const q = useLegacyLive<AppList>('applications', { refetchInterval: 60_000 });
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data?.records ?? []).filter(
      (r) =>
        (status === 'all' || (status === 'open' ? !q.data!.final.includes(r.status) : r.status === status)) &&
        (!type || r.type === type) &&
        (!needle ||
          [r.number, r.userName, r.userTag, r.userId, r.roblox?.name].some((v) =>
            String(v ?? '')
              .toLowerCase()
              .includes(needle),
          )),
    );
  }, [q.data, status, type, search]);
  const current = q.data?.records.find((r) => r.number === selected);
  return (
    <LegacyState query={q}>
      {q.data && (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-[12rem_14rem_1fr]">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Offen</option>
              <option value="all">Alle</option>
              {Object.entries(q.data.status).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
            <Select aria-label="Bewerbungsart" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Alle Arten</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Suche"
              placeholder="Nummer, Name, Discord-ID oder Roblox-Name …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!rows.length ? (
            <EmptyState title="Keine Bewerbungen">
              {q.data.total
                ? 'Für diese Auswahl gibt es keine Bewerbungen.'
                : 'Es ist noch keine Bewerbung eingegangen.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th>Nummer</th>
                    <th>Art</th>
                    <th>Bewerber</th>
                    <th>Status</th>
                    <th>Eingereicht</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.number}>
                      <td className="font-medium">{r.number}</td>
                      <td>{typeName(r.type)}</td>
                      <td>{r.userName ?? r.userTag}</td>
                      <td>
                        <Badge tone={TONE[r.status] ?? 'muted'}>{q.data.status[r.status] ?? r.status}</Badge>
                      </td>
                      <td>{fmtMillis(r.createdAt)}</td>
                      <td className="text-right">
                        <Button size="sm" onClick={() => setSelected(r.number)}>
                          Öffnen
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-sm text-muted">
            {rows.length} von {q.data.total} Bewerbungen. Angezeigt werden alle offenen und die neuesten entschiedenen
            (höchstens 500).
          </p>
          {current && (
            <Detail
              record={current}
              data={q.data}
              typeName={typeName(current.type)}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </LegacyState>
  );
}

function InProgress({ types }: { types: AppType[] }) {
  const q = useLegacyLive<Progress[]>('app-progress', { refetchInterval: 30_000 });
  return (
    <LegacyState query={q}>
      {!q.data?.length ? (
        <EmptyState title="Gerade füllt niemand eine Bewerbung aus" />
      ) : (
        <table className={TABLE}>
          <thead>
            <tr>
              <th>Mitglied</th>
              <th>Art</th>
              <th>Frage</th>
              <th>Seit</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((p) => (
              <tr key={`${p.userId}:${p.type}`}>
                <td>{p.userName}</td>
                <td>{types.find((t) => t.id === p.type)?.name ?? p.type}</td>
                <td>
                  {Math.min(p.step + 1, p.questions)} von {p.questions}
                </td>
                <td>{p.minutes} Min.</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LegacyState>
  );
}

function Bans({ types }: { types: AppType[] }) {
  const can = useCan();
  const q = useLegacyLive<Ban[]>('app-bans');
  const scope = (s: string) =>
    s === '*'
      ? 'Alle Bewerbungen'
      : s === 'police'
        ? 'Polizei-Bewerbungen'
        : (types.find((t) => t.id === s)?.name ?? s);
  return (
    <LegacyState query={q}>
      {can('applications:edit') && (
        <div className="mb-3">
          <ActionDialog
            title="Bewerbungssperre anlegen"
            description="Gesperrte Personen können sich nicht bewerben. Gib eine Discord-ID, einen Roblox-Namen oder beides an."
            fields={[
              { name: 'discordId', label: 'Discord-ID', placeholder: '123456789012345678' },
              { name: 'robloxName', label: 'Roblox-Name' },
              {
                name: 'scope',
                label: 'Gilt für',
                type: 'select',
                defaultValue: '*',
                options: [
                  { value: '*', label: 'Alle Bewerbungen' },
                  { value: 'police', label: 'Polizei-Bewerbungen' },
                  ...types.map((t) => ({ value: t.id, label: t.name })),
                ],
              },
              {
                name: 'days',
                label: 'Dauer in Tagen',
                type: 'number',
                min: 0,
                max: 3650,
                hint: 'Leer oder 0 = unbegrenzt.',
              },
              { name: 'reason', label: 'Grund', type: 'textarea', required: true },
            ]}
            submitLabel="Sperren"
            successMessage="Sperre angelegt."
            onSubmit={(v) => legacyAction('app-ban-add', v)}
            invalidate={[legacyKey('app-bans')]}
            trigger={(o) => (
              <Button variant="primary" onClick={o}>
                Sperre anlegen
              </Button>
            )}
          />
        </div>
      )}
      {!q.data?.length ? (
        <EmptyState title="Keine Bewerbungssperren" />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Person</th>
                <th>Gilt für</th>
                <th>Grund</th>
                <th>Bis</th>
                <th>Angelegt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>
                    {[b.discordId && (b.userName ?? b.discordId), b.robloxName && `Roblox ${b.robloxName}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                  <td>{b.scopes.map(scope).join(', ')}</td>
                  <td className="max-w-xs break-words">{b.reason}</td>
                  <td>{b.active ? b.expiresAt ? fmtMillis(b.expiresAt) : 'unbegrenzt' : <Badge>beendet</Badge>}</td>
                  <td>
                    {fmtMillis(b.createdAt)}
                    {b.createdByName ? ` · ${b.createdByName}` : ''}
                  </td>
                  <td className="text-right">
                    {b.active && can('applications:edit') && (
                      <ActionDialog
                        title={`Sperre ${b.id} aufheben`}
                        fields={[]}
                        submitLabel="Aufheben"
                        successMessage="Sperre aufgehoben."
                        onSubmit={() => legacyAction('app-ban-lift', { id: b.id })}
                        invalidate={[legacyKey('app-bans')]}
                        trigger={(o) => (
                          <Button size="sm" onClick={o}>
                            Aufheben
                          </Button>
                        )}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LegacyState>
  );
}

function Statistics() {
  const q = useLegacyLive<Stats>('app-stats');
  const [days, setDays] = useState('30');
  const period = q.data?.periods[days];
  const delta = (now: number, before: number) =>
    now === before ? 'unverändert' : `${now > before ? '+' : ''}${now - before} zum Zeitraum davor`;
  return (
    <LegacyState query={q}>
      {q.data && period && (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Select aria-label="Zeitraum" className="max-w-48" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">Letzte 7 Tage</option>
              <option value="30">Letzte 30 Tage</option>
              <option value="90">Letzte 90 Tage</option>
            </Select>
            <span className="text-sm text-muted">{q.data.total} Bewerbungen insgesamt</span>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['Eingegangen', String(period.current.count), delta(period.current.count, period.previous.count)],
                [
                  'Angenommen',
                  String(period.current.accepted),
                  delta(period.current.accepted, period.previous.accepted),
                ],
                ['Annahmequote', percent(period.current.acceptRate), `davor ${percent(period.previous.acceptRate)}`],
                ['Zeit bis zur Entscheidung', hours(period.current.avgMs), `davor ${hours(period.previous.avgMs)}`],
              ] as const
            ).map(([label, value, sub]) => (
              <div key={label} className="rounded-lg border border-line p-3">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-2xl">{value}</dd>
                <dd className="text-sm text-muted">{sub}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 font-medium">Nach Art (90 Tage)</h3>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th>Art</th>
                    <th>Eingegangen</th>
                    <th>Offen</th>
                    <th>Annahmequote</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.perType.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.emoji} {t.name}
                      </td>
                      <td>{t.count}</td>
                      <td>{t.open}</td>
                      <td>{percent(t.acceptRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-2 font-medium">Entscheidungen je Teammitglied (90 Tage)</h3>
              {q.data.topReviewers.length ? (
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th>Teammitglied</th>
                      <th>Entscheidungen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.topReviewers.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">Noch keine Entscheidungen.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </LegacyState>
  );
}

type Tab = 'list' | 'progress' | 'bans' | 'stats' | 'setup';

export default function ApplicationsPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('list');
  const guild = useLegacyGuild();
  const types = ((guild.data?.config.applications as { types?: AppType[] } | undefined)?.types ?? []) as AppType[];
  return (
    <div>
      <PageHeader
        title="Bewerbungen"
        description="Bewerbungen aus Discord lesen und entscheiden, Sperren verwalten und die Bewerbungsarten einrichten. Mitglieder bewerben sich weiterhin in Discord per Direktnachricht."
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'list', label: 'Bewerbungen' },
          { key: 'progress', label: 'In Bearbeitung' },
          { key: 'bans', label: 'Sperren' },
          { key: 'stats', label: 'Statistik' },
          { key: 'setup', label: 'Einrichtung' },
        ]}
      />
      {tab === 'setup' ? (
        <LegacyState query={guild}>
          {guild.data && <ApplicationSetup guild={guild.data} canEdit={can('applications:configure')} />}
        </LegacyState>
      ) : (
        <Panel>
          {tab === 'list' && <Records types={types} />}
          {tab === 'progress' && <InProgress types={types} />}
          {tab === 'bans' && <Bans types={types} />}
          {tab === 'stats' && <Statistics />}
        </Panel>
      )}
    </div>
  );
}
