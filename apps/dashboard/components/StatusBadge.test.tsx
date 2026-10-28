import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('rendert Text und ein dekoratives, für Screenreader verstecktes Symbol', () => {
    const html = renderToStaticMarkup(<StatusBadge tone="ok">Online</StatusBadge>);
    expect(html).toContain('badge--ok');
    expect(html).toContain('Online');
    expect(html).toContain('aria-hidden="true"');
  });
});
