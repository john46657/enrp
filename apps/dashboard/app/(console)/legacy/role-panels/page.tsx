'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ChannelSelect, LegacyState, RoleMultiSelect } from '@/components/data/legacy';
import { Button, Field, Input, PageHeader, Panel, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { legacyAction, useLegacyGuild } from '@/lib/legacy';
import { useCan } from '@/lib/session';

export default function RolePanelsPage() {
  const can = useCan();
  const toast = useToast();
  const q = useLegacyGuild();
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const post = useMutation({
    mutationFn: () => legacyAction('role-panel-post', { channelId, title, description, roleIds }),
    onSuccess: () => {
      toast('success', 'Rollenpanel gepostet.');
      setError(null);
      setRoleIds([]);
      setTitle('');
      setDescription('');
    },
    onError: (err) => setError((err as Error).message),
  });
  const allowed = can('community:create');
  // Nur Rollen, die der Bot vergeben kann (unter seiner eigenen Rolle, nicht von Integrationen verwaltet).
  const assignable = (q.data?.roles ?? []).filter((r) => r.editable && !r.managed);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rollenpanel"
        description="Postet eine Nachricht mit Knöpfen, über die sich Mitglieder Rollen selbst geben und wieder nehmen können – wie /rollenpanel in Discord."
      />
      <LegacyState query={q}>
        {q.data && (
          <Panel title="Neues Rollenpanel posten">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                post.mutate();
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Kanal" htmlFor="rp-channel">
                  <ChannelSelect
                    id="rp-channel"
                    guild={q.data}
                    value={channelId}
                    onChange={setChannelId}
                    disabled={!allowed}
                  />
                </Field>
                <Field label="Überschrift" htmlFor="rp-title">
                  <Input
                    id="rp-title"
                    value={title}
                    maxLength={256}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={!allowed}
                  />
                </Field>
              </div>
              <Field
                label="Beschreibung"
                htmlFor="rp-description"
                hint="Leer = „Klicke auf einen Knopf, um die Rolle zu erhalten oder wieder abzugeben.“"
              >
                <Textarea
                  id="rp-description"
                  value={description}
                  maxLength={2000}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!allowed}
                />
              </Field>
              <Field
                label="Rollen (1 bis 10)"
                htmlFor="rp-roles"
                hint="Zur Auswahl stehen nur Rollen, die der Bot vergeben kann. Fehlt eine, ziehe die Bot-Rolle in Discord über sie."
              >
                <RoleMultiSelect
                  id="rp-roles"
                  roles={assignable}
                  value={roleIds}
                  onChange={setRoleIds}
                  max={10}
                  disabled={!allowed}
                />
              </Field>
              {error && (
                <p className="text-sm text-bad" role="alert">
                  {error}
                </p>
              )}
              {allowed ? (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!channelId || !title.trim() || !roleIds.length || post.isPending}
                >
                  {post.isPending ? 'Postet …' : 'Panel posten'}
                </Button>
              ) : (
                <p className="text-sm text-muted">Zum Posten brauchst du das Recht „Community: Erstellen“.</p>
              )}
            </form>
            <p className="mt-4 text-sm text-muted">
              Bereits gepostete Panels bleiben in Discord bestehen und funktionieren weiter. Zum Ändern löschst du die
              Nachricht in Discord und postest ein neues Panel.
            </p>
          </Panel>
        )}
      </LegacyState>
    </div>
  );
}
