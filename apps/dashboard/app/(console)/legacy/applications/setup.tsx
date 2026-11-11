'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { RoleMultiSelect, SettingsForm, type SettingField } from '@/components/data/legacy';
import { Button, Field, Input, Panel, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { legacyAction, legacyKey, saveLegacySettings, type LegacyGuild } from '@/lib/legacy';

interface Option {
  label: string;
  value?: string;
  roleId?: string;
  description?: string;
}
interface Question {
  key: string;
  type: string;
  label: string;
  description?: string;
  required?: boolean;
  min?: number;
  max?: number;
  multiple?: boolean;
  options?: Option[];
}
export interface AppType {
  id: string;
  name: string;
  emoji?: string;
  enabled: boolean;
  panel: 'apply' | 'quali';
  workflow: 'police' | 'simple';
  questions: Question[];
}

const GENERAL: SettingField[] = [
  {
    path: 'applications.channel',
    label: 'Team-Kanal für das Bewerbungs-Panel',
    type: 'channel',
    hint: 'Hier landen neue Bewerbungen, wenn die Art keinen eigenen Kanal hat.',
  },
  { path: 'applications.qualiChannel', label: 'Team-Kanal für das Qualifikations-Panel', type: 'channel' },
  { path: 'applications.panels.apply.title', label: 'Bewerbungs-Panel: Überschrift', type: 'text', maxLength: 200 },
  { path: 'applications.panels.quali.title', label: 'Qualifikations-Panel: Überschrift', type: 'text', maxLength: 200 },
  { path: 'applications.panels.apply.description', label: 'Bewerbungs-Panel: Text', type: 'textarea', maxLength: 1500 },
  {
    path: 'applications.panels.quali.description',
    label: 'Qualifikations-Panel: Text',
    type: 'textarea',
    maxLength: 1500,
  },
  { path: 'applications.panels.apply.image', label: 'Bewerbungs-Panel: Banner (Bild-URL)', type: 'text' },
  { path: 'applications.panels.quali.image', label: 'Qualifikations-Panel: Banner (Bild-URL)', type: 'text' },
];

const typeFields = (id: string): SettingField[] => {
  const p = `applications.types.${id}`;
  return [
    { path: `${p}.enabled`, label: 'Bewerbungen annehmen', type: 'bool' },
    { path: `${p}.teamThreads`, label: 'Zu jeder Bewerbung einen Thread fürs Team öffnen', type: 'bool' },
    { path: `${p}.name`, label: 'Name', type: 'text', maxLength: 80 },
    { path: `${p}.emoji`, label: 'Emoji', type: 'text', maxLength: 40 },
    { path: `${p}.description`, label: 'Beschreibung im Panel', type: 'textarea', maxLength: 500 },
    {
      path: `${p}.panel`,
      label: 'Panel',
      type: 'select',
      options: [
        { value: 'apply', label: 'Bewerbungs-Panel' },
        { value: 'quali', label: 'Qualifikations-Panel' },
      ],
    },
    {
      path: `${p}.onLeave`,
      label: 'Wenn der Bewerber den Server verlässt',
      type: 'select',
      options: [
        { value: 'NONE', label: 'Nichts' },
        { value: 'DENY', label: 'Ablehnen' },
        { value: 'WITHDRAW', label: 'Zurückziehen' },
      ],
    },
    {
      path: `${p}.cooldownMinutes`,
      label: 'Wartezeit zwischen zwei Bewerbungen (Minuten)',
      type: 'number',
      min: 0,
      max: 525600,
    },
    { path: `${p}.timeLimitMinutes`, label: 'Zeit zum Ausfüllen (Minuten)', type: 'number', min: 5, max: 10080 },
    {
      path: `${p}.channels.open`,
      label: 'Kanal für neue Bewerbungen',
      type: 'channel',
      hint: 'Leer = Team-Kanal des Panels.',
    },
    { path: `${p}.channels.accepted`, label: 'Kopie angenommener Bewerbungen', type: 'channel' },
    { path: `${p}.channels.rejected`, label: 'Kopie abgelehnter Bewerbungen', type: 'channel' },
    { path: `${p}.roles.managers`, label: 'Dürfen in Discord entscheiden', type: 'roles' },
    { path: `${p}.roles.ping`, label: 'Werden bei neuen Bewerbungen markiert', type: 'roles' },
    {
      path: `${p}.roles.required`,
      label: 'Erforderliche Rollen',
      type: 'roles',
      hint: 'Ohne diese Rollen keine Bewerbung.',
    },
    {
      path: `${p}.roles.blocked`,
      label: 'Sperr-Rollen',
      type: 'roles',
      hint: 'Mit einer dieser Rollen keine Bewerbung.',
    },
    { path: `${p}.roles.pending`, label: 'Rolle, solange die Bewerbung offen ist', type: 'roles' },
    { path: `${p}.roles.acceptAdd`, label: 'Bei Annahme vergeben', type: 'roles' },
    { path: `${p}.roles.acceptRemove`, label: 'Bei Annahme entfernen', type: 'roles' },
    { path: `${p}.roles.rejectAdd`, label: 'Bei Ablehnung vergeben', type: 'roles' },
    {
      path: `${p}.messages.start`,
      label: 'Nachricht zum Start',
      type: 'textarea',
      maxLength: 1500,
      hint: 'Platzhalter: {applicant} {applicationName} {questionCount} {timeLimit}',
    },
    {
      path: `${p}.messages.finish`,
      label: 'Nachricht nach dem Einreichen',
      type: 'textarea',
      maxLength: 1500,
      hint: 'Platzhalter: {applicationName} {number}',
    },
    {
      path: `${p}.messages.accept`,
      label: 'Nachricht bei Annahme',
      type: 'textarea',
      maxLength: 1500,
      hint: 'Platzhalter: {applicant} {applicationName} {number} {user} {reason}',
    },
    {
      path: `${p}.messages.reject`,
      label: 'Nachricht bei Ablehnung',
      type: 'textarea',
      maxLength: 1500,
      hint: 'Platzhalter wie bei Annahme. Ein Grund wird angehängt, wenn {reason} fehlt.',
    },
  ];
};

const QUESTION_LABELS: Record<string, string> = {
  TEXT: 'Freitext',
  CHOICE: 'Auswahl',
  ROLE: 'Rollen-Auswahl',
  ROBLOX: 'Roblox-Benutzer',
};

function Questions({ guild, type, canEdit }: { guild: LegacyGuild; type: AppType; canEdit: boolean }) {
  const toast = useToast();
  const client = useQueryClient();
  const [questions, setQuestions] = useState<Question[]>(type.questions);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(questions) !== JSON.stringify(type.questions);
  const patch = (index: number, change: Partial<Question>) =>
    setQuestions((all) => all.map((q, i) => (i === index ? { ...q, ...change } : q)));
  const move = (index: number, by: number) =>
    setQuestions((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  const save = useMutation({
    mutationFn: () => {
      for (const [i, q] of questions.entries()) {
        if (!q.label.trim()) throw new Error(`Frage ${i + 1}: Der Fragetext fehlt.`);
        if ((q.type === 'CHOICE' || q.type === 'ROLE') && !q.options?.length)
          throw new Error(`Frage ${i + 1}: Mindestens eine Option ist nötig.`);
      }
      return saveLegacySettings([{ path: `applications.types.${type.id}.questions`, value: questions }]);
    },
    onSuccess: async () => {
      toast('success', 'Fragen gespeichert. Gilt für neue Bewerbungen.');
      setError(null);
      await client.invalidateQueries({ queryKey: legacyKey('guild') });
    },
    onError: (err) => setError((err as Error).message),
  });
  const types = Array.isArray(guild.questionTypes) ? guild.questionTypes : Object.keys(guild.questionTypes);
  return (
    <Panel title={`Fragen: ${type.name}`}>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.key} className="rounded-md border border-line p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Frage {i + 1}</span>
              {canEdit && (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Nach oben"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === questions.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Nach unten"
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={questions.length === 1}
                    onClick={() => setQuestions((all) => all.filter((_, x) => x !== i))}
                  >
                    Entfernen
                  </Button>
                </span>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
              <Field label="Fragetext" htmlFor={`q-${q.key}-label`}>
                <Input
                  id={`q-${q.key}-label`}
                  value={q.label}
                  maxLength={250}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
              </Field>
              <Field label="Art" htmlFor={`q-${q.key}-type`}>
                <Select
                  id={`q-${q.key}-type`}
                  value={q.type}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = e.target.value;
                    patch(i, {
                      type: next,
                      options: next === 'CHOICE' || next === 'ROLE' ? [] : undefined,
                      multiple: next === 'CHOICE' || next === 'ROLE' ? false : undefined,
                      min: undefined,
                      max: next === 'TEXT' ? 1000 : undefined,
                    });
                  }}
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {QUESTION_LABELS[t] ?? t}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {q.type === 'TEXT' && (
                <>
                  <Field label="Mindestlänge (Zeichen)" htmlFor={`q-${q.key}-min`}>
                    <Input
                      id={`q-${q.key}-min`}
                      type="number"
                      min={0}
                      max={5000}
                      value={q.min ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => patch(i, { min: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </Field>
                  <Field label="Höchstlänge (Zeichen)" htmlFor={`q-${q.key}-max`}>
                    <Input
                      id={`q-${q.key}-max`}
                      type="number"
                      min={1}
                      max={5000}
                      value={q.max ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => patch(i, { max: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </Field>
                </>
              )}
              {q.type === 'CHOICE' && (
                <div className="md:col-span-2">
                  <Field label="Optionen (eine je Zeile, höchstens 25)" htmlFor={`q-${q.key}-options`}>
                    <Textarea
                      id={`q-${q.key}-options`}
                      rows={Math.min(8, Math.max(3, (q.options?.length ?? 0) + 1))}
                      value={(q.options ?? []).map((o) => o.label).join('\n')}
                      disabled={!canEdit}
                      onChange={(e) =>
                        patch(i, {
                          options: e.target.value
                            .split('\n')
                            .slice(0, 25)
                            // Vorhandene Optionen (mit Wert/Beschreibung) bleiben erhalten, wenn der Text gleich bleibt.
                            .map((label) => q.options?.find((o) => o.label === label) ?? { label }),
                        })
                      }
                      onBlur={() => patch(i, { options: (q.options ?? []).filter((o) => o.label.trim()) })}
                    />
                  </Field>
                </div>
              )}
              {q.type === 'ROLE' && (
                <div className="md:col-span-2">
                  <Field
                    label="Rollen zur Auswahl"
                    htmlFor={`q-${q.key}-roles`}
                    hint="Der Bewerber wählt daraus; bei Annahme bekommt er die gewählten Rollen."
                  >
                    <RoleMultiSelect
                      id={`q-${q.key}-roles`}
                      roles={guild.roles}
                      disabled={!canEdit}
                      value={(q.options ?? []).map((o) => o.roleId ?? '').filter(Boolean)}
                      onChange={(ids) =>
                        patch(i, {
                          options: ids.map(
                            (roleId) =>
                              q.options?.find((o) => o.roleId === roleId) ?? {
                                label: guild.roles.find((r) => r.id === roleId)?.name ?? roleId,
                                roleId,
                              },
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={q.required !== false}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />
                Pflichtfrage
              </label>
              {(q.type === 'CHOICE' || q.type === 'ROLE') && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(q.multiple)}
                    disabled={!canEdit}
                    onChange={(e) => patch(i, { multiple: e.target.checked })}
                  />
                  Mehrere Antworten erlaubt
                </label>
              )}
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p className="mt-3 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            disabled={questions.length >= 50}
            onClick={() =>
              setQuestions((all) => [
                ...all,
                { key: `frage_${Date.now().toString(36)}`, type: 'TEXT', label: '', required: true, max: 1000 },
              ])
            }
          >
            Frage hinzufügen
          </Button>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Speichert …' : 'Fragen speichern'}
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setQuestions(type.questions);
                setError(null);
              }}
            >
              Verwerfen
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

export function ApplicationSetup({ guild, canEdit }: { guild: LegacyGuild; canEdit: boolean }) {
  const types = ((guild.config.applications as { types?: AppType[] })?.types ?? []) as AppType[];
  const [selected, setSelected] = useState(types[0]?.id ?? '');
  const current = types.find((t) => t.id === selected) ?? types[0];
  const textChannels = guild.channels.filter((c) => c.type === 0 || c.type === 5);
  return (
    <div className="space-y-6">
      <SettingsForm
        title="Panels und Team-Kanäle"
        guild={guild}
        fields={GENERAL}
        canEdit={canEdit}
        actions={
          canEdit && (
            <ActionDialog
              title="Bewerbungs-Panel posten"
              description="Postet das Panel, über das sich Mitglieder bewerben. Es zeigt alle aktiven Arten dieses Panels."
              fields={[
                {
                  name: 'kind',
                  label: 'Panel',
                  type: 'select',
                  required: true,
                  defaultValue: 'apply',
                  options: [
                    { value: 'apply', label: 'Bewerbungs-Panel' },
                    { value: 'quali', label: 'Qualifikations-Panel' },
                  ],
                },
                {
                  name: 'channelId',
                  label: 'Kanal',
                  type: 'select',
                  required: true,
                  options: textChannels.map((c) => ({ value: c.id, label: `# ${c.name}` })),
                },
              ]}
              submitLabel="Posten"
              successMessage="Panel gepostet."
              onSubmit={(v) => legacyAction('app-panel-post', v)}
              trigger={(o) => (
                <Button variant="primary" onClick={o}>
                  Panel posten
                </Button>
              )}
            />
          )
        }
      />
      {current && (
        <>
          <SettingsForm
            key={`settings-${current.id}`}
            title={`Bewerbungsart: ${current.emoji ?? ''} ${current.name}`}
            description={`Ablauf: ${current.workflow === 'police' ? 'Polizei-Bewerbung mit Prüfschritten (Eingereicht → In Prüfung → Gespräch → Entscheidung)' : 'einfache Bewerbung (Annehmen oder Ablehnen)'}. Neue Bewerbungsarten legst du weiterhin in der config.json der Altmodule an.`}
            guild={guild}
            fields={typeFields(current.id)}
            canEdit={canEdit}
            actions={
              <Select
                aria-label="Bewerbungsart wählen"
                value={current.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.enabled ? '' : ' (aus)'}
                  </option>
                ))}
              </Select>
            }
          />
          <Questions key={`questions-${current.id}`} guild={guild} type={current} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}
