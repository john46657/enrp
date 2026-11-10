export const FACTION_OPTIONS = [
  { value: 'polizei', label: 'Polizei' },
  { value: 'feuerwehr', label: 'Feuerwehr' },
  { value: 'rettungsdienst', label: 'Rettungsdienst' },
  { value: 'zivil', label: 'Zivilisten' },
];
export const DUTY_FACTION_OPTIONS = FACTION_OPTIONS.slice(0, 3);
export const PERIOD_OPTIONS = [
  { value: 'day', label: 'Letzte 24 Stunden' },
  { value: 'week', label: 'Letzte 7 Tage' },
  { value: 'month', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Gesamt' },
];
export const opts = (values: string[], labels: (v: string) => string) =>
  values.map((value) => ({ value, label: labels(value) }));

export const SEVERITY_OPTIONS = [
  { value: 'sev1', label: 'SEV1 – kritisch' },
  { value: 'sev2', label: 'SEV2 – hoch' },
  { value: 'sev3', label: 'SEV3 – mittel' },
  { value: 'sev4', label: 'SEV4 – niedrig' },
];
