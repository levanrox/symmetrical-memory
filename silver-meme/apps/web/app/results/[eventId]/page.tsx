'use client';

import { Download, Printer } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../../components/app-shell';
import { Button } from '../../../components/ui/button';
import { Panel } from '../../../components/ui/panel';
import { EmptyRow, Table, Td, Th, Tr } from '../../../components/ui/table';
import { api, apiBase, getToken } from '../../../lib/api';

interface AthleteRef {
  registrationId: string;
  name: string;
  club: string | null;
}

interface CategoryResult {
  categoryId: string;
  categoryName: string;
  completed: boolean;
  gold: AthleteRef | null;
  silver: AthleteRef | null;
  bronze: AthleteRef[];
}

interface MedalTallyRow {
  club: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

interface EventResults {
  eventId: string;
  eventName: string;
  venue: string | null;
  categories: CategoryResult[];
  medalsByClub: MedalTallyRow[];
  totals: { categories: number; completed: number; athletes: number };
}

export default function ResultsPage() {
  const params = useParams<{ eventId: string }>();
  const router = useRouter();
  const eventId = params.eventId;

  const [results, setResults] = useState<EventResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setResults(await api.get<EventResults>(`/events/${eventId}/results`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load results');
    }
  }, [eventId]);

  useEffect(() => {
    if (getToken() === null) {
      router.replace('/');
      return;
    }
    void load();
  }, [router, load]);

  async function downloadCsv(): Promise<void> {
    const token = getToken();
    const response = await fetch(`${apiBase()}/api/events/${eventId}/results.csv`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });

    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `results-${eventId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (error !== null) {
    return (
      <AppShell title="Results" links={[{ href: '/admin', label: 'Admin' }]}>
        <div role="alert" className="rounded-lg border border-stop/60 bg-stop/10 px-3 py-2.5 text-sm text-stop">
          {error}
        </div>
      </AppShell>
    );
  }

  if (results === null) {
    return (
      <AppShell title="Results" links={[{ href: '/admin', label: 'Admin' }]}>
        <p className="text-sm text-ink-400">Loading results…</p>
      </AppShell>
    );
  }

  const medal = (label: string, athlete: AthleteRef | null, tone: string) =>
    athlete === null ? null : (
      <Tr key={athlete.registrationId}>
        <Td className={tone}>{label}</Td>
        <Td className="text-ink-50">{athlete.name}</Td>
        <Td className="text-ink-400">{athlete.club ?? '—'}</Td>
      </Tr>
    );

  return (
    <AppShell
      title={results.eventName}
      subtitle={results.venue ?? undefined}
      links={[{ href: '/admin', label: 'Admin' }]}
      actions={
        <div className="no-print flex items-center gap-2">
          <Button size="sm" onClick={() => void downloadCsv()}>
            <Download size={14} />
            CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            <Printer size={14} />
            Print
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[23rem_1fr]">
        <Panel
          title="Medal table"
          description={`${results.totals.completed} of ${results.totals.categories} categories complete`}
          bodyClassName="p-0"
        >
          <Table>
            <thead>
              <tr>
                <Th>Club</Th>
                <Th className="w-9 text-right">G</Th>
                <Th className="w-9 text-right">S</Th>
                <Th className="w-9 text-right">B</Th>
                <Th className="w-12 text-right">Tot</Th>
              </tr>
            </thead>
            <tbody>
              {results.medalsByClub.length === 0 ? (
                <EmptyRow colSpan={5}>
                  No medals yet. Finish a category and the table fills itself.
                </EmptyRow>
              ) : (
                results.medalsByClub.map((row) => (
                  <Tr key={row.club}>
                    <Td className="max-w-0 truncate text-ink-100" title={row.club}>
                      {row.club}
                    </Td>
                    <Td className="tnum text-right font-semibold text-gold">{row.gold}</Td>
                    <Td className="tnum text-right text-ink-300">{row.silver}</Td>
                    <Td className="tnum text-right text-ink-400">{row.bronze}</Td>
                    <Td className="tnum text-right font-semibold text-ink-100">{row.total}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>

          <dl className="grid grid-cols-3 border-t border-ink-800 text-center">
            {[
              ['Categories', results.totals.categories],
              ['Complete', results.totals.completed],
              ['Entries', results.totals.athletes],
            ].map(([label, value]) => (
              <div key={label} className="px-3 py-3">
                <dt className="text-[0.68rem] uppercase tracking-wider text-ink-500">{label}</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-ink-100">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Podiums" bodyClassName="flex flex-col gap-5 p-4">
          {results.categories.map((category) => (
            <div key={category.categoryId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink-50">{category.categoryName}</h3>
                {!category.completed && (
                  <span className="text-xs uppercase tracking-wider text-ink-500">in progress</span>
                )}
              </div>

              {category.gold === null ? (
                <p className="text-sm text-ink-400">No result yet.</p>
              ) : (
                <Table>
                  <tbody>
                    {medal('1st', category.gold, 'text-gold')}
                    {medal('2nd', category.silver, 'text-ink-300')}
                    {category.bronze.map((athlete) => medal('3rd', athlete, 'text-ink-400'))}
                  </tbody>
                </Table>
              )}
            </div>
          ))}
        </Panel>
      </div>
    </AppShell>
  );
}
