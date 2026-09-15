'use client';

import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  Lock,
  Medal,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { Button } from '../../components/ui/button';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Panel } from '../../components/ui/panel';
import { StatusPill, toneForMatchStatus } from '../../components/ui/status-pill';
import { EmptyRow, Table, Td, Th, Tr } from '../../components/ui/table';
import { DrawBracket } from '../../components/ui/draw-bracket';
import { api, clearToken, getToken } from '../../lib/api';
import { cn } from '../../lib/utils';

interface EventRecord {
  id: string;
  name: string;
  venue: string | null;
  rulesetId: string;
}

interface Tatami {
  id: string;
  number: number;
  name: string;
}

interface CategorySummary {
  id: string;
  name: string;
  ageGroup: string;
  gender: string;
  state: string;
  discipline?: string;
  entrantCount: number;
  durationSeconds: number;
  /** Read from the draw itself, so the list cannot go stale. */
  draw: { state: string; version: number } | null;
}

interface Assignment {
  tatamiId: string;
  categoryId: string;
  sequence: number;
}

interface EventDetail {
  event: EventRecord;
  tatamis: Tatami[];
  assignments: Assignment[];
  categories: CategorySummary[];
}

interface Registration {
  id: string;
  displayName: string;
  clubName: string | null;
}

interface MatchView {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots?: Array<{
    position: number;
    registrationId: string | null;
    sourceMatchId: string | null;
  }>;
  aka: { displayName: string };
  ao: { displayName: string };
  state?: {
    points?: { aka: number; ao: number };
    winner?: { side: string; method: string };
  } | null;
}

interface CategoryView {
  draw: {
    version: number;
    state: string;
    checksum: string;
    tournamentSize: number;
    byeCount: number;
  } | null;
  matches: MatchView[];
  readyMatchIds: readonly string[];
  podium: { goldRegistrationId: string } | null;
  problems: Array<{ code: string; message: string }>;
}

/** One athlete per line: `Name` or `Name, Club`. A tab counts as a comma. */
function parseEntries(text: string): Array<{ name: string; club: string | null }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\t|,/).map((part) => part.trim());
      const name = parts[0] ?? '';
      const club = parts[1] ?? null;
      return { name, club: club === '' ? null : club };
    })
    .filter((entry) => entry.name.length > 0);
}

export default function AdminPage() {
  const router = useRouter();

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryView | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);

  const [newEventName, setNewEventName] = useState('');
  const [newEventVenue, setNewEventVenue] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryAge, setNewCategoryAge] = useState('senior');
  const [newCategoryGender, setNewCategoryGender] = useState('MALE');
  const [newCategoryDiscipline, setNewCategoryDiscipline] = useState<'KUMITE' | 'KATA' | 'TEAM_KATA' | 'TEAM_KUMITE'>('KUMITE');
  const [bronzeMedals, setBronzeMedals] = useState<'1' | '2'>('2');
  const [entriesText, setEntriesText] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void>, message?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        if (message !== undefined) setNotice(message);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const loadEvents = useCallback(async () => {
    const list = await api.get<EventRecord[]>('/events');
    setEvents(list);
    setEventId((current) => current ?? list[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await api.get<EventDetail>(`/events/${id}`));
  }, []);

  const loadCategory = useCallback(async (id: string) => {
    setCategory(await api.get<CategoryView>(`/categories/${id}/matches`));
    const found = await api.get<{ registrations: Registration[] }>(`/categories/${id}`);
    setRegistrations(found.registrations);
  }, []);

  useEffect(() => {
    if (getToken() === null) {
      router.replace('/');
      return;
    }
    void run(() => loadEvents());
  }, [router, loadEvents, run]);

  useEffect(() => {
    if (eventId !== null) void run(() => loadDetail(eventId));
  }, [eventId, loadDetail, run]);

  useEffect(() => {
    if (categoryId === null) {
      setCategory(null);
      setRegistrations([]);
      return;
    }
    void run(() => loadCategory(categoryId));
  }, [categoryId, loadCategory, run]);

  const selectedCategory = detail?.categories.find((item) => item.id === categoryId) ?? null;
  const assignmentOf = (id: string) => detail?.assignments.find((a) => a.categoryId === id);

  const pendingEntries = parseEntries(entriesText);

  const links =
    eventId === null
      ? []
      : [
          { href: `/results/${eventId}`, label: 'Results' },
          ...(detail?.tatamis.slice(0, 2).map((tatami) => ({
            href: `/ring/${tatami.id}`,
            label: tatami.name,
          })) ?? []),
        ];

  return (
    <AppShell
      title="Event Suite"
      subtitle={detail?.event.name}
      links={links}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearToken();
            router.replace('/');
          }}
        >
          Sign out
        </Button>
      }
    >
      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-stop/60 bg-stop/10 px-3 py-2.5 text-sm text-stop"
        >
          {error}
        </div>
      )}
      {notice !== null && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-go/40 bg-go/10 px-3 py-2.5 text-sm text-go">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Event picker. */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-ink-700 bg-ink-900 p-4">
        <Field id="event" label="Event" className="min-w-64 flex-1">
          <Select
            id="event"
            value={eventId ?? ''}
            onChange={(event) => {
              setEventId(event.target.value === '' ? null : event.target.value);
              setCategoryId(null);
            }}
          >
            <option value="">Select an event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="new-event" label="New event" className="min-w-48 flex-1">
          <Input
            id="new-event"
            value={newEventName}
            placeholder="Karnataka State Championship"
            onChange={(event) => setNewEventName(event.target.value)}
          />
        </Field>

        <Field id="new-venue" label="Venue" className="min-w-48 flex-1">
          <Input
            id="new-venue"
            value={newEventVenue}
            placeholder="Koramangala Indoor Stadium"
            onChange={(event) => setNewEventVenue(event.target.value)}
          />
        </Field>

        <Button
          variant="primary"
          disabled={busy || newEventName.trim() === ''}
          onClick={() =>
            void run(async () => {
              const created = await api.post<EventRecord>('/events', {
                name: newEventName.trim(),
                venue: newEventVenue.trim() === '' ? null : newEventVenue.trim(),
              });
              setNewEventName('');
              setNewEventVenue('');
              await loadEvents();
              setEventId(created.id);
            }, 'Event created.')
          }
        >
          <Plus size={15} />
          Create
        </Button>
      </div>

      {detail === null ? (
        <Panel title="No event selected">
          <p className="text-sm text-ink-400">
            Pick an event above, or create one to start entering athletes.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          {/* Main column: the compare surfaces. */}
          <div className="flex flex-col gap-4">
            <Panel
              title="Categories"
              description={`${detail.categories.length} total`}
              bodyClassName="p-0"
            >
              {/* Adding a category is its own row rather than squeezed into the
                  panel header, so the controls get real width. */}
              <div className="flex flex-wrap items-end gap-2 border-b border-ink-800 p-3">
                <Field id="new-category" label="New category" className="min-w-44 flex-1">
                  <Input
                    id="new-category"
                    value={newCategoryName}
                    placeholder="Senior Male -67kg"
                    onChange={(event) => setNewCategoryName(event.target.value)}
                  />
                </Field>
                <Field id="new-category-age" label="Age group" className="w-28">
                  <Select
                    id="new-category-age"
                    value={newCategoryAge}
                    onChange={(event) => setNewCategoryAge(event.target.value)}
                  >
                    {['senior', 'u21', 'junior', 'cadet', 'u14'].map((age) => (
                      <option key={age} value={age}>
                        {age}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="new-category-gender" label="Gender" className="w-24">
                  <Select
                    id="new-category-gender"
                    value={newCategoryGender}
                    onChange={(event) => setNewCategoryGender(event.target.value)}
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="MIXED">Mixed</option>
                  </Select>
                </Field>
                <Field id="new-category-discipline" label="Discipline" className="w-32">
                  <Select
                    id="new-category-discipline"
                    value={newCategoryDiscipline}
                    onChange={(event) =>
                      setNewCategoryDiscipline(
                        event.target.value as 'KUMITE' | 'KATA' | 'TEAM_KATA' | 'TEAM_KUMITE',
                      )
                    }
                  >
                    <option value="KUMITE">Kumite</option>
                    <option value="KATA">Kata</option>
                    <option value="TEAM_KATA">Team Kata</option>
                    <option value="TEAM_KUMITE">Team Kumite</option>
                  </Select>
                </Field>
                <Button
                  variant="primary"
                  disabled={busy || newCategoryName.trim() === ''}
                  onClick={() =>
                    void run(async () => {
                      await api.post(`/events/${detail.event.id}/categories`, {
                        name: newCategoryName.trim(),
                        ageGroup: newCategoryAge,
                        gender: newCategoryGender,
                        discipline: newCategoryDiscipline,
                      });
                      setNewCategoryName('');
                      await loadDetail(detail.event.id);
                    }, 'Category created.')
                  }
                >
                  <Plus size={15} />
                  Add category
                </Button>
              </div>

              <Table>
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th className="w-20 text-right">Entrants</Th>
                    <Th className="w-24 text-right">Bout</Th>
                    <Th className="w-32">Draw</Th>
                    <Th className="w-24">Ring</Th>
                    <Th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {detail.categories.length === 0 ? (
                    <EmptyRow colSpan={6}>
                      No categories yet. Add one above to start entering athletes.
                    </EmptyRow>
                  ) : (
                    detail.categories.map((item) => {
                      const assignment = assignmentOf(item.id);
                      const ring = detail.tatamis.find((tatami) => tatami.id === assignment?.tatamiId);
                      const selected = item.id === categoryId;

                      return (
                        <Tr key={item.id} className={cn(selected && 'bg-ink-850')}>
                          <Td>
                            <div className="flex items-baseline gap-2 whitespace-nowrap">
                              <span className="font-medium text-ink-50">{item.name}</span>
                              <span className="text-xs text-ink-500">
                                {item.ageGroup} · {item.gender.toLowerCase()}
                                {item.discipline && item.discipline !== 'KUMITE' && (
                                  <span className="ml-1.5 rounded bg-ink-800 px-1.5 py-0.5 text-[0.65rem] font-bold text-gold border border-gold/30">
                                    {item.discipline.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </span>
                            </div>
                          </Td>
                          <Td className="tnum text-right text-ink-300">{item.entrantCount}</Td>
                          <Td className="tnum text-right text-ink-400">{item.durationSeconds}s</Td>
                          <Td>
                            {item.draw === null ? (
                              <StatusPill tone="neutral">No draw</StatusPill>
                            ) : (
                              <StatusPill tone={item.draw.state === 'LOCKED' ? 'good' : 'warn'}>
                                {item.draw.state === 'LOCKED' ? 'Locked' : 'Draft'} v{item.draw.version}
                              </StatusPill>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap text-ink-400">{ring?.name ?? '—'}</Td>
                          <Td className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setCategoryId(selected ? null : item.id)}
                            >
                              {selected ? 'Close' : 'Manage'}
                              {!selected && <ChevronRight size={14} />}
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </Panel>

            {selectedCategory !== null && (
              <Panel
                title={selectedCategory.name}
                description={`${registrations.length} entrants · ${selectedCategory.ageGroup} · ${selectedCategory.gender.toLowerCase()}`}
                actions={
                  category?.draw !== null && category?.draw !== undefined ? (
                    <StatusPill tone={category.draw.state === 'LOCKED' ? 'good' : 'warn'}>
                      draw v{category.draw.version} · {category.draw.state.toLowerCase()}
                    </StatusPill>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-5">
                  {/* Entries. */}
                  <div className="flex flex-col gap-2">
                    <Field
                      id="entries"
                      label="Entries"
                      hint="One per line as Name, Club. Copying two columns straight out of Excel works too."
                    >
                      <Textarea
                        id="entries"
                        value={entriesText}
                        onChange={(event) => setEntriesText(event.target.value)}
                        placeholder={'Rahul Kumar, Bengaluru Karate Academy\nArjun Shetty, Mysuru Dojo'}
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        disabled={busy || pendingEntries.length === 0}
                        onClick={() =>
                          void run(async () => {
                            for (const entry of parseEntries(entriesText)) {
                              const athlete = await api.post<{ id: string }>('/athletes', {
                                displayName: entry.name,
                                clubName: entry.club,
                              });
                              await api.post(`/categories/${categoryId}/registrations`, {
                                athleteId: athlete.id,
                                clubName: entry.club,
                              });
                            }
                            setEntriesText('');
                            await loadCategory(categoryId ?? '');
                            await loadDetail(detail.event.id);
                          }, 'Entries imported.')
                        }
                      >
                        <Plus size={15} />
                        Import {pendingEntries.length > 0 ? pendingEntries.length : ''} entries
                      </Button>
                      {registrations.length > 0 && (
                        <span className="text-xs text-ink-400">
                          {registrations.length} already entered
                        </span>
                      )}
                    </div>

                    {registrations.length > 0 && (
                      <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
                        {registrations.map((registration, index) => (
                          <li key={registration.id} className="flex gap-1.5">
                            <span className="tnum text-ink-600">{index + 1}</span>
                            <span className="text-ink-100">{registration.displayName}</span>
                            {registration.clubName !== null && (
                              <span className="text-ink-500">· {registration.clubName}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  {/* Draw controls. */}
                  <div className="flex flex-wrap items-end gap-2 border-t border-ink-800 pt-4">
                    <Field
                      id="bronze"
                      label="Bronze medals"
                      hint="Decided here, before the draw."
                      className="w-44"
                    >
                      <Select
                        id="bronze"
                        value={bronzeMedals}
                        disabled={category?.draw?.state === 'LOCKED'}
                        onChange={(event) => setBronzeMedals(event.target.value === '1' ? '1' : '2')}
                      >
                        <option value="2">Two bronze (repechage)</option>
                        <option value="1">One bronze</option>
                      </Select>
                    </Field>

                    <Button
                      variant="secondary"
                      disabled={busy || registrations.length < 2 || category?.draw?.state === 'LOCKED'}
                      onClick={() =>
                        void run(async () => {
                          const result = await api.post<{ warnings: Array<{ message: string }> }>(
                            `/categories/${categoryId}/draw`,
                            { bronzeMedals: Number(bronzeMedals) as 1 | 2 },
                          );
                          await loadCategory(categoryId ?? '');
                          await loadDetail(detail.event.id);
                          const warnings = result.warnings.map((warning) => warning.message).join(' ');
                          setNotice(
                            warnings === '' ? 'Draw generated.' : `Draw generated. ${warnings}`,
                          );
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      {category?.draw == null ? 'Generate draw' : 'Regenerate'}
                    </Button>

                    <Button
                      variant="primary"
                      disabled={busy || category?.draw == null || category.draw.state === 'LOCKED'}
                      onClick={() =>
                        void run(async () => {
                          await api.post(`/categories/${categoryId}/draw/lock`);
                          await loadCategory(categoryId ?? '');
                          await loadDetail(detail.event.id);
                        }, 'Draw locked. It can no longer be changed.')
                      }
                    >
                      <Lock size={15} />
                      Lock draw
                    </Button>

                    {category?.draw?.state === 'LOCKED' && (
                      <Field id="ring" label="Assign to ring" className="w-48">
                        <Select
                          id="ring"
                          value={assignmentOf(selectedCategory.id)?.tatamiId ?? ''}
                          onChange={(event) => {
                            const tatamiId = event.target.value;
                            if (tatamiId === '') return;
                            void run(async () => {
                              await api.post('/assignments', {
                                eventId: detail.event.id,
                                tatamiId,
                                categoryId: selectedCategory.id,
                              });
                              await loadDetail(detail.event.id);
                              await loadCategory(selectedCategory.id);
                            }, 'Assigned to ring.');
                          }}
                        >
                          <option value="">Choose a ring</option>
                          {detail.tatamis.map((tatami) => (
                            <option key={tatami.id} value={tatami.id}>
                              {tatami.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>

                  {category?.draw != null && (
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-400">
                      <div className="flex gap-1.5">
                        <dt>Bracket</dt>
                        <dd className="tnum text-ink-200">
                          {category.draw.tournamentSize} places, {category.draw.byeCount} bye(s)
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Checksum</dt>
                        <dd className="font-mono text-ink-200">
                          {category.draw.checksum.slice(0, 12)}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Matches</dt>
                        <dd className="tnum text-ink-200">{category.matches.length}</dd>
                      </div>
                    </dl>
                  )}

                  {category !== null && category.problems.length > 0 && (
                    <ul className="flex flex-col gap-1 rounded-lg border border-gold/50 bg-gold-soft px-3 py-2 text-sm text-gold">
                      {category.problems.map((problem) => (
                        <li key={`${problem.code}-${problem.message}`} className="flex gap-2">
                          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                          {problem.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {category?.podium != null && (
                    <p className="flex items-center gap-2 rounded-lg border border-go/40 bg-go/10 px-3 py-2 text-sm text-go">
                      <Medal size={15} />
                      Category complete. Gold, silver and bronze have been awarded.
                    </p>
                  )}

                  {/* Visual Bracket Tree */}
                  {category !== null && category.matches.length > 0 && (
                    <div className="border-t border-ink-800 pt-4">
                      <DrawBracket
                        matches={category.matches}
                        readyMatchIds={category.readyMatchIds}
                        categoryName={selectedCategory.name}
                        version={category.draw?.version}
                        showDownload={true}
                      />
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>

          {/* Aside: rings. */}
          <aside className="flex flex-col gap-4">
            <Panel
              title="Rings"
              description={`${detail.tatamis.length} configured`}
              actions={
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post(`/events/${detail.event.id}/tatamis`, {
                        number: detail.tatamis.length + 1,
                      });
                      await loadDetail(detail.event.id);
                    }, 'Ring added.')
                  }
                >
                  <Plus size={14} />
                  Add
                </Button>
              }
              bodyClassName="p-0"
            >
              <Table>
                <tbody>
                  {detail.tatamis.length === 0 ? (
                    <EmptyRow colSpan={3}>No rings yet. Add one to run matches.</EmptyRow>
                  ) : (
                    detail.tatamis.map((tatami) => {
                      const assigned = detail.assignments.filter((a) => a.tatamiId === tatami.id).length;

                      return (
                        <Tr key={tatami.id}>
                          <Td className="font-medium text-ink-100">{tatami.name}</Td>
                          <Td className="text-right text-xs text-ink-400">
                            {assigned} categor{assigned === 1 ? 'y' : 'ies'}
                          </Td>
                          <Td className="text-right">
                            <Link
                              href={`/ring/${tatami.id}`}
                              className="text-xs font-semibold text-gold hover:underline"
                            >
                              Open
                            </Link>
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </Panel>

            <Panel title="This event" bodyClassName="p-0">
              <Table>
                <tbody>
                  <Tr>
                    <Td className="text-ink-400">Ruleset</Td>
                    <Td className="text-right text-ink-200">{detail.event.rulesetId}</Td>
                  </Tr>
                  <Tr>
                    <Td className="text-ink-400">Venue</Td>
                    <Td className="text-right text-ink-200">{detail.event.venue ?? '—'}</Td>
                  </Tr>
                  <Tr>
                    <Td className="text-ink-400">Categories</Td>
                    <Td className="tnum text-right text-ink-200">{detail.categories.length}</Td>
                  </Tr>
                  <Tr>
                    <Td className="text-ink-400">Entries</Td>
                    <Td className="tnum text-right text-ink-200">
                      {detail.categories.reduce((total, item) => total + item.entrantCount, 0)}
                    </Td>
                  </Tr>
                </tbody>
              </Table>
            </Panel>
          </aside>
        </div>
      )}

      {busy && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-500" role="status">
          <Loader2 size={13} className="animate-spin" />
          Working
        </p>
      )}
    </AppShell>
  );
}
