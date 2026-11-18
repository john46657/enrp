const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Schlichte, statische Ergebnisseite (z. B. nach der Verifizierung). Alle Inhalte werden escaped. */
export function resultPage(input: { title: string; message: string; success: boolean }): string {
  const color = input.success ? '#16a34a' : '#dc2626';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;color:#e5e7eb;font:16px/1.5 system-ui,sans-serif}main{max-width:28rem;padding:2rem;border:1px solid #1f2937;border-radius:12px;background:#111827}h1{font-size:1.25rem;margin:0 0 .5rem;color:${color}}p{margin:0;color:#9ca3af}</style>
</head><body><main><h1>${escape(input.title)}</h1><p>${escape(input.message)}</p></main></body></html>`;
}

export const RESULT_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
