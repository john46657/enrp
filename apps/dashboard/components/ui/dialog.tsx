'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Modaler Dialog auf Basis des nativen <dialog>-Elements (Fokusfalle, Escape, Barrierefreiheit). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="dialog-title"
      className={`m-auto w-[calc(100vw-2rem)] rounded-xl border border-line-strong bg-surface p-0 text-text shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
    >
      {open && (
        <div>
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id="dialog-title" className="text-lg">
              {title}
            </h2>
            <button onClick={onClose} aria-label="Dialog schließen" className="text-muted hover:text-text">
              <X className="size-5" />
            </button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
