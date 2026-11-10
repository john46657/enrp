'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { get } from '@/lib/api';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton } from '../ui/primitives';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Wert für die Sortierung innerhalb der geladenen Seite. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
}

export interface FilterSpec {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

interface Page<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Datentabelle mit Serverpaginierung, Suche und Filtern sowie Sortierung der geladenen Seite.
 * Unterstützt Endpunkte mit {items,total,page,pageSize} und einfache {items}-Listen.
 */
export function ResourceTable<T>({
  path,
  columns,
  filters = [],
  searchable = true,
  rowKey,
  rowHref,
  emptyTitle = 'Keine Einträge',
  emptyText,
  baseQuery = {},
  pageSize = 25,
  select,
}: {
  path: string;
  columns: Column<T>[];
  filters?: FilterSpec[];
  searchable?: boolean;
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  emptyTitle?: string;
  emptyText?: ReactNode;
  baseQuery?: Record<string, string | number | boolean | undefined>;
  pageSize?: number;
  select?: (data: unknown) => Page<T>;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const query = { ...baseQuery, ...filterValues, q: search || undefined, page, pageSize };
  const result = useQuery({
    queryKey: ['list', path, query],
    queryFn: async () => {
      const raw = await get<unknown>(path, query);
      return select ? select(raw) : (raw as Page<T>);
    },
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => {
    const items = result.data?.items ?? [];
    if (!sort) return items;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return items;
    return [...items].sort((a, b) => {
      const va = col.sortValue!(a) ?? '';
      const vb = col.sortValue!(b) ?? '';
      return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
    });
  }, [result.data, sort, columns]);

  const total = result.data?.total;
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="space-y-3">
      {(searchable || filters.length > 0) && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q);
          }}
        >
          {searchable && (
            <div className="relative min-w-56 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
              <Input
                aria-label="Suchen"
                placeholder="Suchen …"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
              />
            </div>
          )}
          {filters.map((f) => (
            <Select
              key={f.name}
              aria-label={f.label}
              className="w-auto"
              value={filterValues[f.name] ?? ''}
              onChange={(e) => {
                setPage(1);
                setFilterValues((v) => ({ ...v, [f.name]: e.target.value }));
              }}
            >
              <option value="">{f.label}: alle</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ))}
          {searchable && (
            <Button type="submit" size="md">
              Suchen
            </Button>
          )}
        </form>
      )}

      {result.isLoading ? (
        <Skeleton />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : !rows.length ? (
        <EmptyState title={emptyTitle}>{emptyText}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 font-medium whitespace-nowrap ${c.className ?? ''}`}
                    aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sortValue ? (
                      <button
                        className="inline-flex items-center gap-1 hover:text-text"
                        onClick={() =>
                          setSort((s) =>
                            s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 },
                          )
                        }
                      >
                        {c.header}
                        {sort?.key === c.key &&
                          (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={rowKey(row)} className="bg-surface hover:bg-surface-2">
                  {columns.map((c, i) => (
                    <td key={c.key} className={`px-3 py-2 align-top ${c.className ?? ''}`}>
                      {i === 0 && rowHref ? (
                        <Link href={rowHref(row)} className="font-medium hover:text-signal hover:underline">
                          {c.render(row)}
                        </Link>
                      ) : (
                        c.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total !== undefined && total > pageSize && (
        <nav className="flex items-center justify-between text-sm text-muted" aria-label="Seiten">
          <span className="tabular">
            {total.toLocaleString('de-DE')} Einträge, Seite {page} von {pages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Zurück
            </Button>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Weiter
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

/** Kleine Hilfe für Detailseiten. */
export function useDetail<T>(key: unknown[], path: string, enabled = true) {
  return useQuery({ queryKey: key, queryFn: () => get<T>(path), enabled });
}
