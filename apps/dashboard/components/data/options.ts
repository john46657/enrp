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

/** Leitstelle */
export const DISPATCH_PRIORITY_OPTIONS = [
  { value: '1', label: 'P1 · Hoch' },
  { value: '2', label: 'P2 · Mittel' },
  { value: '3', label: 'P3 · Niedrig' },
];
export const DISPATCH_STATUS_OPTIONS = [
  { value: 'open', label: 'Offen' },
  { value: 'assigned', label: 'Zugewiesen' },
  { value: 'en_route', label: 'Anfahrt' },
  { value: 'on_scene', label: 'Vor Ort' },
];
export const UNIT_STATUS_OPTIONS = [
  { value: 'available', label: 'Status 2 · Einsatzbereit' },
  { value: 'en_route', label: 'Status 3 · Anfahrt' },
  { value: 'on_scene', label: 'Status 4 · Am Einsatzort' },
  { value: 'busy', label: 'Status 5 · Beschäftigt' },
  { value: 'off_duty', label: 'Status 6 · Außer Dienst' },
];
