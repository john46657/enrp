'use client';

import { useRef, type ReactNode } from 'react';

/**
 * Kritische Aktion mit Rückfrage: Der Knopf öffnet einen Dialog; erst "Bestätigen" schickt das Formular ab.
 * Nutzt das native <dialog>-Element (Fokus bleibt im Dialog, Escape schließt ihn).
 */
export function ConfirmDialog({
  formId,
  trigger,
  title,
  children,
  confirmLabel,
}: {
  formId: string;
  trigger: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="button button--danger" onClick={() => dialog.current?.showModal()}>
        {trigger}
      </button>
      <dialog ref={dialog} className="dialog" aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`}>{title}</h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">
          <button type="button" className="button button--secondary" onClick={() => dialog.current?.close()}>
            Abbrechen
          </button>
          <button
            type="submit"
            form={formId}
            className="button button--danger"
            onClick={() => dialog.current?.close()}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
