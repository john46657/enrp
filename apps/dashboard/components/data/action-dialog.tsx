'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, newIdempotencyKey } from '@/lib/api';
import { Dialog } from '../ui/dialog';
import { Button, Field, Input, Select, Textarea } from '../ui/primitives';
import { useToast } from '../ui/toast';

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'datetime' | 'json';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
}

export interface ActionDialogProps {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: ReactNode;
  fields: FieldSpec[];
  /** Kritische Aktionen verlangen eine Begründung (Feld "reason"). */
  requireReason?: boolean;
  /** Text auf dem Bestätigungsbutton, gleichzeitig Erfolgsmeldung (z. B. "Bannen" → "Bannen: erledigt"). */
  submitLabel: string;
  successMessage?: string | ((result: unknown) => string);
  danger?: boolean;
  /** Zusätzliche Bestätigung durch Eintippen eines Wortes (z. B. bei Wiederherstellungen). */
  confirmWord?: string;
  onSubmit: (values: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
  invalidate?: unknown[][];
  onDone?: (result: unknown) => void;
}

function convert(spec: FieldSpec, raw: FormDataEntryValue | null, form: HTMLFormElement): unknown {
  if (spec.type === 'checkbox') return (form.elements.namedItem(spec.name) as HTMLInputElement).checked;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return undefined;
  if (spec.type === 'number') return Number(value);
  if (spec.type === 'datetime') return new Date(value).toISOString();
  if (spec.type === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${spec.label}: ungültiges JSON`);
    }
  }
  return value;
}

/**
 * Einheitlicher Aktionsdialog: Formular, clientseitige Pflichtfeldprüfung, Fehler aus der API je Feld,
 * Idempotenzschlüssel gegen Doppelklicks, Erfolgsmeldung und Aktualisierung der betroffenen Daten.
 */
export function ActionDialog(props: ActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const toast = useToast();
  const client = useQueryClient();
  const fields = props.requireReason
    ? [
        ...props.fields,
        {
          name: 'reason',
          label: 'Begründung',
          type: 'textarea' as const,
          required: true,
          hint: 'Wird im Audit-Log gespeichert.',
        },
      ]
    : props.fields;

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => props.onSubmit(values, key),
    onSuccess: async (result) => {
      toast(
        'success',
        typeof props.successMessage === 'function'
          ? props.successMessage(result)
          : (props.successMessage ?? `${props.submitLabel}: erledigt`),
      );
      await Promise.all((props.invalidate ?? []).map((k) => client.invalidateQueries({ queryKey: k })));
      setOpen(false);
      props.onDone?.(result);
    },
    onError: (err) => {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const map: Record<string, string> = {};
        for (const d of err.details as Array<{ path: string; message: string }>)
          map[d.path.replace(/^\//, '').split('/')[0] ?? ''] = d.message;
        setErrors(map);
      }
      setFormError(err.message);
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const values: Record<string, unknown> = {};
    const missing: Record<string, string> = {};
    try {
      for (const f of fields) {
        const v = convert(f, data.get(f.name), form);
        if (f.required && (v === undefined || v === '')) missing[f.name] = 'Pflichtfeld';
        if (f.name === 'reason' && typeof v === 'string' && v.length < 3)
          missing.reason = 'Bitte mindestens 3 Zeichen.';
        if (v !== undefined) values[f.name] = v;
      }
    } catch (err) {
      setFormError((err as Error).message);
      return;
    }
    if (props.confirmWord && data.get('__confirm') !== props.confirmWord)
      missing.__confirm = `Bitte „${props.confirmWord}“ eingeben.`;
    setErrors(missing);
    setFormError(null);
    if (Object.keys(missing).length) return;
    mutation.mutate(values);
  }

  const openDialog = () => {
    setErrors({});
    setFormError(null);
    setKey(newIdempotencyKey());
    mutation.reset();
    setOpen(true);
  };

  return (
    <>
      {props.trigger(openDialog)}
      <Dialog open={open} onClose={() => setOpen(false)} title={props.title}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {props.description && <div className="text-sm text-muted">{props.description}</div>}
          {fields.map((f) => {
            const id = `f-${f.name}`;
            const common = {
              id,
              name: f.name,
              'aria-invalid': Boolean(errors[f.name]),
              placeholder: f.placeholder,
              required: f.required,
            };
            return f.type === 'checkbox' ? (
              <label key={f.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id={id}
                  name={f.name}
                  defaultChecked={Boolean(f.defaultValue)}
                  className="size-4 accent-[var(--signal)]"
                />
                {f.label}
              </label>
            ) : (
              <Field
                key={f.name}
                label={`${f.label}${f.required ? ' *' : ''}`}
                hint={f.hint}
                error={errors[f.name]}
                htmlFor={id}
              >
                {f.type === 'textarea' || f.type === 'json' ? (
                  <Textarea
                    {...common}
                    defaultValue={f.defaultValue as string | undefined}
                    className={f.type === 'json' ? 'font-mono text-sm' : ''}
                  />
                ) : f.type === 'select' ? (
                  <Select {...common} defaultValue={f.defaultValue as string | undefined}>
                    {!f.required && <option value="">–</option>}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    {...common}
                    type={f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                    min={f.min}
                    max={f.max}
                    defaultValue={f.defaultValue as string | undefined}
                  />
                )}
              </Field>
            );
          })}
          {props.confirmWord && (
            <Field
              label={`Zur Bestätigung „${props.confirmWord}“ eingeben`}
              error={errors.__confirm}
              htmlFor="f-confirm"
            >
              <Input id="f-confirm" name="__confirm" autoComplete="off" />
            </Field>
          )}
          {formError && (
            <p className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad" role="alert">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" variant={props.danger ? 'danger' : 'primary'} disabled={mutation.isPending}>
              {mutation.isPending ? 'Wird ausgeführt …' : props.submitLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
