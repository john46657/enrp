'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, ErrorState, Field, Input, Panel, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  formatPeriods,
  parsePeriods,
  readPath,
  saveLegacySettings,
  type LegacyChange,
  type LegacyChannel,
  type LegacyGuild,
  type LegacyRole,
  type Period,
} from '@/lib/legacy';

/** Lade- und Fehlerzustand für Daten, die der Bot liefert (inkl. „Bot antwortet nicht“). */
export function LegacyState({
  query,
  children,
}: {
  query: { isLoading: boolean; error: unknown; refetch: () => unknown; data: unknown };
  children: ReactNode;
}) {
  if (query.isLoading) return <Skeleton />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return <Skeleton />;
  return <>{children}</>;
}

const TEXT_TYPES = [0, 5];
const channelsFor = (channels: LegacyChannel[], kind: 'text' | 'category') =>
  channels.filter((c) => (kind === 'category' ? c.type === 4 : TEXT_TYPES.includes(c.type)));

export function ChannelSelect({
  guild,
  kind = 'text',
  value,
  onChange,
  disabled,
  id,
}: {
  guild: LegacyGuild;
  kind?: 'text' | 'category';
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const options = channelsFor(guild.channels, kind);
  const missing = value && !options.some((c) => c.id === value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">— keiner —</option>
      {missing && <option value={value}>Unbekannt ({value})</option>}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {kind === 'category' ? '📁 ' : '# '}
          {c.name}
        </option>
      ))}
    </Select>
  );
}

export function RoleSelect({
  guild,
  value,
  onChange,
  disabled,
  id,
}: {
  guild: LegacyGuild;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const missing = value && !guild.roles.some((r) => r.id === value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">— keine —</option>
      {missing && <option value={value}>Unbekannt ({value})</option>}
      {guild.roles.map((r) => (
        <option key={r.id} value={r.id}>
          @{r.name}
        </option>
      ))}
    </Select>
  );
}

/** Mehrere Rollen: gewählte Rollen als Liste, weitere über das Auswahlfeld. */
export function RoleMultiSelect({
  roles,
  value,
  onChange,
  disabled,
  max = 25,
  id,
}: {
  roles: LegacyRole[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  max?: number;
  id?: string;
}) {
  const name = (roleId: string) => roles.find((r) => r.id === roleId)?.name ?? `Unbekannt (${roleId})`;
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((roleId) => (
            <li
              key={roleId}
              className="inline-flex items-center gap-1 rounded border border-line-strong bg-surface-2 px-2 py-0.5 text-sm"
            >
              @{name(roleId)}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Rolle ${name(roleId)} entfernen`}
                  className="text-muted hover:text-bad"
                  onClick={() => onChange(value.filter((v) => v !== roleId))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && value.length < max && (
        <Select
          id={id}
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
        >
          <option value="">Rolle hinzufügen …</option>
          {roles
            .filter((r) => !value.includes(r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                @{r.name}
              </option>
            ))}
        </Select>
      )}
    </div>
  );
}

export interface SettingField {
  /** Pfad in den Einstellungen, z. B. "tickets.panel.title". */
  path: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'bool' | 'channel' | 'category' | 'role' | 'roles' | 'select' | 'periods';
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  maxLength?: number;
  /** Bei „roles“: höchstens eine Rolle (Wert bleibt eine Liste). */
  single?: boolean;
  /** Über die ganze Breite statt in einer Spalte. */
  wide?: boolean;
}

const initialValue = (config: unknown, field: SettingField): unknown => {
  const raw = readPath(config, field.path);
  if (field.type === 'bool') return Boolean(raw);
  if (field.type === 'roles') return Array.isArray(raw) ? raw : [];
  if (field.type === 'periods') return formatPeriods((raw as Period[] | undefined) ?? []);
  if (field.type === 'number') return raw === undefined || raw === null ? '' : String(raw);
  return typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw);
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Formular für einen Ausschnitt der Einstellungen der Altmodule. Gespeichert werden nur geänderte Felder; der Bot
 * prüft die Werte und übernimmt alle oder keine.
 */
export function SettingsForm({
  title,
  description,
  guild,
  fields,
  canEdit,
  actions,
}: {
  title: string;
  description?: string;
  guild: LegacyGuild;
  fields: SettingField[];
  canEdit: boolean;
  actions?: ReactNode;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const initial = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.path, initialValue(guild.config, f)])),
    [fields, guild.config],
  );
  const [edited, setEdited] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const value = (path: string) => (path in edited ? edited[path] : initial[path]);
  const set = (path: string, v: unknown) => setEdited((e) => ({ ...e, [path]: v }));
  const dirty = fields.filter((f) => f.path in edited && !same(edited[f.path], initial[f.path]));

  const save = useMutation({
    mutationFn: async () => {
      const changes: LegacyChange[] = dirty.map((f) => {
        const v = edited[f.path];
        if (f.type === 'number') {
          const n = Number(v);
          if (v === '' || !Number.isInteger(n)) throw new Error(`${f.label}: bitte eine ganze Zahl eingeben.`);
          if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max))
            throw new Error(`${f.label}: ${f.min ?? '…'} bis ${f.max ?? '…'}.`);
          return { path: f.path, value: n };
        }
        if (f.type === 'periods') return { path: f.path, value: parsePeriods(String(v)) };
        return { path: f.path, value: v };
      });
      await saveLegacySettings(changes);
      return Object.fromEntries(dirty.map((f) => [f.path, edited[f.path]]));
    },
    onSuccess: async (saved) => {
      toast('success', `${title}: gespeichert. Gilt sofort, ohne Neustart.`);
      setError(null);
      await client.invalidateQueries({ queryKey: ['legacy', 'guild'] });
      // Nur das Gespeicherte verwerfen – was inzwischen weiter getippt wurde, bleibt stehen.
      setEdited((now) =>
        Object.fromEntries(Object.entries(now).filter(([path, v]) => !(path in saved && same(v, saved[path])))),
      );
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <Panel title={title} actions={actions}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {description && <p className="text-sm text-muted">{description}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((f) => {
            const fieldId = `f-${f.path}`;
            const v = value(f.path);
            const wide = f.wide || f.type === 'textarea' || f.type === 'periods';
            if (f.type === 'bool')
              return (
                <label key={f.path} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(v)}
                    disabled={!canEdit}
                    onChange={(e) => set(f.path, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    {f.hint && <span className="block text-muted">{f.hint}</span>}
                  </span>
                </label>
              );
            return (
              <div key={f.path} className={wide ? 'md:col-span-2' : ''}>
                <Field label={f.label} hint={f.hint} htmlFor={fieldId}>
                  {f.type === 'channel' || f.type === 'category' ? (
                    <ChannelSelect
                      id={fieldId}
                      guild={guild}
                      kind={f.type === 'category' ? 'category' : 'text'}
                      value={String(v ?? '')}
                      onChange={(x) => set(f.path, x)}
                      disabled={!canEdit}
                    />
                  ) : f.type === 'role' ? (
                    <RoleSelect
                      id={fieldId}
                      guild={guild}
                      value={String(v ?? '')}
                      onChange={(x) => set(f.path, x)}
                      disabled={!canEdit}
                    />
                  ) : f.type === 'roles' ? (
                    <RoleMultiSelect
                      id={fieldId}
                      roles={guild.roles}
                      value={v as string[]}
                      onChange={(x) => set(f.path, x)}
                      disabled={!canEdit}
                      max={f.single ? 1 : 25}
                    />
                  ) : f.type === 'select' ? (
                    <Select
                      id={fieldId}
                      value={String(v ?? '')}
                      onChange={(e) => set(f.path, e.target.value)}
                      disabled={!canEdit}
                    >
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === 'textarea' ? (
                    <Textarea
                      id={fieldId}
                      value={String(v ?? '')}
                      maxLength={f.maxLength}
                      onChange={(e) => set(f.path, e.target.value)}
                      disabled={!canEdit}
                    />
                  ) : (
                    <Input
                      id={fieldId}
                      type={f.type === 'number' ? 'number' : 'text'}
                      min={f.min}
                      max={f.max}
                      maxLength={f.maxLength}
                      value={String(v ?? '')}
                      onChange={(e) => set(f.path, e.target.value)}
                      disabled={!canEdit}
                    />
                  )}
                </Field>
              </div>
            );
          })}
        </div>
        {error && (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!dirty.length || save.isPending}>
              {save.isPending ? 'Speichert …' : 'Speichern'}
            </Button>
            {dirty.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEdited({});
                  setError(null);
                }}
              >
                Verwerfen
              </Button>
            )}
            {dirty.length > 0 && <span className="text-sm text-muted">{dirty.length} Änderung(en)</span>}
          </div>
        )}
      </form>
    </Panel>
  );
}

/** Auswahl einer Unterseite (Reiter). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${value === t.key ? 'border-signal font-semibold text-text' : 'border-transparent text-muted hover:text-text'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export const TABLE =
  'w-full text-left text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-muted';
