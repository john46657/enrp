import type { ReactNode } from 'react';

export function PageHeader({ title, intro, aside }: { title: string; intro?: string; aside?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {intro ? <p className="page-header__intro">{intro}</p> : null}
      </div>
      {aside ? <div className="page-header__aside">{aside}</div> : null}
    </header>
  );
}
