/** Rückmeldung eines Formulars an die Oberfläche. */
export type FormState =
  | { status: 'idle' }
  | { status: 'success'; message: string; at: number }
  | {
      status: 'error';
      message: string;
      at: number;
      fields?: Record<string, string>;
      values?: Record<string, string>;
    };

export const idle: FormState = { status: 'idle' };
