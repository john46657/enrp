import { BRAND } from '@emden-network/shared';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Minimalistische Ergebnisseite ohne Skripte. Alle dynamischen Werte werden escaped. */
export function resultPage(opts: { title: string; message: string; success: boolean }): string {
  const color = opts.success ? '#2ea043' : '#d1242f';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(opts.title)} – ${escapeHtml(BRAND.name)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { max-width: 32rem; padding: 2rem; border-radius: 12px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); margin: 1rem; }
  h1 { margin-top: 0; font-size: 1.4rem; color: ${color}; }
  p { line-height: 1.5; }
  small { opacity: .7; }
</style>
</head>
<body><main>
<h1>${escapeHtml(opts.title)}</h1>
<p>${escapeHtml(opts.message)}</p>
<p><small>${escapeHtml(BRAND.name)} · Du kannst dieses Fenster schließen und zu Discord zurückkehren.</small></p>
</main></body>
</html>`;
}
