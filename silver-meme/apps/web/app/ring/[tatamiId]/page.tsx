'use client';

import {
  ArrowLeftRight,
  CircleAlert,
  Clock,
  Flag,
  GitBranch,
  Hand,
  Play,
  QrCode,
  Radio,
  Save,
  Sliders,
  Undo2,
  UserX,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../../components/app-shell';
import { JudgeQrModal } from '../../../components/judge-qr-modal';
import { Button } from '../../../components/ui/button';
import { DrawBracket } from '../../../components/ui/draw-bracket';
import { Panel } from '../../../components/ui/panel';
import { StatusPill, toneForMatchStatus } from '../../../components/ui/status-pill';
import { api, getToken, newId } from '../../../lib/api';
import { useChannel } from '../../../lib/useChannel';
import { isTimeWarning, useMatchClock } from '../../../lib/useMatchClock';
import { cn, formatClock } from '../../../lib/utils';

interface PenaltyRecord {
  level: string;
  category?: number;
  seq: number;
}

interface PenaltyProgress {
  taken: number;
  total: number;
  next: string;
  endsBout: boolean;
}

interface MatchState {
  status: string;
  aka: { displayName: string };
  ao: { displayName: string };
  senshu: 'AKA' | 'AO' | null;
  /** Set once SENSHU is withdrawn late, after which it cannot be re-awarded. */
  senshuLocked: boolean;
  kiken: 'AKA' | 'AO' | null;
  clock: { elapsedMs: number; running: boolean; startedAtMs: number | null };
  penalties: { aka: PenaltyRecord[]; ao: PenaltyRecord[] };
  derived: {
    aka: { points: number; ippon: number; wazaAri: number; yuko: number; chui: number };
    ao: { points: number; ippon: number; wazaAri: number; yuko: number; chui: number };
  };
  superior: boolean;
  winner?: { side: string; method: string };
  decisionMethod?: string;
  kataJudges?: Record<string, 'AKA' | 'AO'>;
  kataScores?: Record<string, { aka: number; ao: number }>;
  flags?: { aka: number; ao: number };
  teamBouts?: Array<{
    boutNo: number;
    winner: string;
    akaPoints: number;
    aoPoints: number;
    method: string;
  }>;
}

interface MatchView {
  matchId: string;
  matchNo: number;
  roundNo?: number;
  roundName: string;
  bracketType?: string;
  status: string;
  slots?: Array<{
    position: number;
    registrationId: string | null;
    sourceMatchId: string | null;
  }>;
  aka: { displayName: string };
  ao: { displayName: string };
  state: MatchState | null;
  proposal: { kind: string; side?: string; method?: string; reason: string } | null;
  /** Resolved server-side: where each athlete is on the penalty ladder. */
  penalties: { aka: PenaltyProgress; ao: PenaltyProgress } | null;
  history: Array<{ seq: number; label: string }>;
  undoable: { seq: number; label: string } | null;
}

interface CategoryView {
  category: { id: string; name: string; discipline?: string };
  durationSeconds: number;
  matches: MatchView[];
  readyMatchIds: readonly string[];
}

interface RingQueueView {
  tatamiId: string;
  tatamiName: string;
  categories: CategoryView[];
  currentMatchId: string | null;
}

const SCORE_BUTTONS = [
  { label: 'Yuko', value: 1, target: 'CHUDAN', technique: 'TSUKI', detail: 'punch · 1' },
  { label: 'Waza-ari', value: 2, target: 'CHUDAN', technique: 'KERI', detail: 'body kick · 2' },
  { label: 'Ippon', value: 3, target: 'JODAN', technique: 'KERI', detail: 'head kick · 3' },
] as const;

/** How the console names the rung this athlete is about to reach. */
function nextPenaltyText(progress: PenaltyProgress): string {
  if (progress.next === 'CHUI') return `CHUI ${progress.taken + 1}`;
  return progress.next.replace(/_/g, ' ');
}

export default function RingConsolePage() {
  const params = useParams<{ tatamiId: string }>();
  const router = useRouter();
  const tatamiId = params.tatamiId;

  const [queue, setQueue] = useState<RingQueueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [showDrawTree, setShowDrawTree] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedTeamBout, setSelectedTeamBout] = useState<number>(1);
  const [showManualScoreEditor, setShowManualScoreEditor] = useState(false);
  const [manualScores, setManualScores] = useState<Record<number, { aka: number; ao: number }>>({
    1: { aka: 7.5, ao: 7.5 },
    2: { aka: 7.5, ao: 7.5 },
    3: { aka: 7.5, ao: 7.5 },
    4: { aka: 7.5, ao: 7.5 },
    5: { aka: 7.5, ao: 7.5 },
  });


  const refresh = useCallback(async () => {
    try {
      setQueue(await api.get<RingQueueView>(`/tatamis/${tatamiId}/queue`));
      setError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not load this ring';
      // "No assigned categories" is a normal state, not an error to shout about.
      setError(message.includes('no assigned') || message.includes('404') ? null : message);
      setQueue(null);
    }
  }, [tatamiId]);

  useEffect(() => {
    if (getToken() === null) {
      router.replace('/');
      return;
    }
    void refresh();
  }, [router, refresh]);

  const { connected } = useChannel<{ type: string }>(`tatami:${tatamiId}`, () => void refresh());

  // A slow poll is the safety net for a dropped socket.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const category = queue?.categories[0] ?? null;

  // Active match: operator can explicitly pick any match from the draw tree/dropdown,
  // falling back to the queue's recommended match, or the first ready/unplayed match.
  const activeMatchId = useMemo(() => {
    if (selectedMatchId !== null) {
      const exists = category?.matches.some((m) => m.matchId === selectedMatchId);
      if (exists) return selectedMatchId;
    }
    return (
      queue?.currentMatchId ??
      category?.matches.find((m) => category.readyMatchIds.includes(m.matchId))?.matchId ??
      null
    );
  }, [selectedMatchId, queue?.currentMatchId, category]);

  const match = useMemo(
    () => category?.matches.find((candidate) => candidate.matchId === activeMatchId) ?? null,
    [category, activeMatchId],
  );

  // Interpolated locally between server readings. The server still owns the
  // clock; this only advances it smoothly in between.
  const remainingMs = useMatchClock(match?.state?.clock ?? null, category?.durationSeconds ?? null);

  async function send(type: string, payload: Record<string, unknown> = {}): Promise<void> {
    if (match === null) return;

    setBusy(true);
    setError(null);

    try {
      await api.post(`/matches/${match.matchId}/commands`, {
        v: 1,
        id: newId(),
        ts: Date.now(),
        channel: `tatami:${tatamiId}`,
        type,
        payload: { matchId: match.matchId, commandId: newId(), ...payload },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That command was rejected');
    } finally {
      setBusy(false);
    }
  }

  const state = match?.state ?? null;
  const live = state !== null && state.status !== 'CONFIRMED' && state.status !== 'FINISHED';
  const discipline = category?.category?.discipline ?? 'KUMITE';
  const isKata = discipline === 'KATA' || discipline === 'TEAM_KATA';
  const isTeamKumite = discipline === 'TEAM_KUMITE';

  const upcoming = (category?.matches ?? []).filter(
    (candidate) =>
      candidate.matchId !== queue?.currentMatchId &&
      candidate.status !== 'FINISHED' &&
      candidate.status !== 'WALKOVER' &&
      candidate.aka.displayName !== '',
  );

  const shellLinks = [
    { href: `/scoreboard/${tatamiId}`, label: 'Scoreboard' },
    { href: '/admin', label: 'Admin' },
  ];

  const isCategoryComplete =
    category !== null &&
    category.matches.length > 0 &&
    category.matches.every(
      (m) => m.status === 'CONFIRMED' || m.status === 'FINISHED' || m.status === 'WALKOVER',
    );

  if (queue === null || category === null) {
    return (
      <AppShell title="Ring" connected={connected} links={shellLinks}>
        <Panel title="Nothing assigned to this ring">
          <p className="text-sm text-ink-400">
            The admin console has not put a locked category on this ring yet. Once it does, the
            matches appear here automatically.
          </p>
        </Panel>
      </AppShell>
    );
  }

  if (match === null) {
    if (isCategoryComplete) {
      return (
        <AppShell
          title={queue.tatamiName}
          subtitle={category.category.name}
          connected={connected}
          links={shellLinks}
        >
          <Panel
            title="Category complete"
            description={`${category.category.name} has no matches left to run.`}
          >
            <p className="text-sm text-ink-400">
              Every bout in this category has been decided and the bracket has advanced.
            </p>
          </Panel>
        </AppShell>
      );
    }

    return (
      <AppShell
        title={queue.tatamiName}
        subtitle={category.category.name}
        connected={connected}
        links={shellLinks}
      >
        <div className="flex flex-col gap-4">
          <Panel
            title="Choose a Match to Conduct"
            description="Select which match from the draw tree you want to conduct on this ring."
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {category.matches
                  .filter((m) => m.status !== 'CONFIRMED' && m.status !== 'FINISHED')
                  .map((m) => {
                    const isReady = category.readyMatchIds.includes(m.matchId);
                    return (
                      <Button
                        key={m.matchId}
                        variant={isReady ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setSelectedMatchId(m.matchId)}
                      >
                        M{m.matchNo} · {m.roundName}: {m.aka.displayName || '—'} v {m.ao.displayName || '—'}
                      </Button>
                    );
                  })}
              </div>

              <DrawBracket
                matches={category.matches.map((m) => ({
                  ...m,
                  roundNo: m.roundNo ?? 1,
                  bracketType: m.bracketType ?? 'MAIN',
                }))}
                readyMatchIds={category.readyMatchIds}
                selectedMatchId={null}
                onMatchClick={(id) => setSelectedMatchId(id)}
                categoryName={category.category.name}
                title="Click any match in the tree to conduct"
              />
            </div>
          </Panel>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={queue.tatamiName}
      subtitle={category.category.name}
      connected={connected}
      links={shellLinks}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowQrModal(true)}
            title="Scan QR codes for judge wireless flag devices"
            className="flex items-center gap-1.5"
          >
            <QrCode size={14} className="text-gold" />
            <span>Judge QR</span>
          </Button>
          <Button
            variant={showDrawTree ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowDrawTree((prev) => !prev)}
            title="View or hide category draw tree"
          >
            <GitBranch size={14} />
            <span>{showDrawTree ? 'Hide Draw' : 'Draw Tree'}</span>
          </Button>
          <StatusPill tone={toneForMatchStatus(match.status)}>{match.status.toLowerCase()}</StatusPill>
        </div>
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

      {/* Match Selection Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900/95 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            Conducting:
          </span>
          <select
            value={selectedMatchId ?? '__auto__'}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedMatchId(val === '__auto__' ? null : val);
            }}
            className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs font-medium text-ink-100 focus:border-gold focus:outline-none max-w-[280px] sm:max-w-md truncate"
          >
            <option value="__auto__">
              Auto-queue (Recommended
              {queue.currentMatchId
                ? `: M${category.matches.find((m) => m.matchId === queue.currentMatchId)?.matchNo}`
                : ''}
              )
            </option>
            {category.matches.map((m) => {
              const isReady = category.readyMatchIds.includes(m.matchId);
              return (
                <option key={m.matchId} value={m.matchId}>
                  M{m.matchNo} · {m.roundName} · {m.aka.displayName || '—'} v{' '}
                  {m.ao.displayName || '—'} [{isReady ? 'READY' : m.status.toLowerCase()}]
                </option>
              );
            })}
          </select>
        </div>

        {selectedMatchId !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-gold hover:text-gold/80"
            onClick={() => setSelectedMatchId(null)}
          >
            Reset to Auto
          </Button>
        )}
      </div>

      {/* Expandable Draw Tree Bracket */}
      {showDrawTree && (
        <div className="mb-4">
          <Panel
            title="Ring Draw Tree"
            description="Click any match in the tree to conduct it immediately on this tatami."
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowDrawTree(false)}>
                Close
              </Button>
            }
          >
            <DrawBracket
              matches={category.matches.map((m) => ({
                ...m,
                roundNo: m.roundNo ?? 1,
                bracketType: m.bracketType ?? 'MAIN',
              }))}
              readyMatchIds={category.readyMatchIds}
              selectedMatchId={match.matchId}
              onMatchClick={(chosenId) => {
                setSelectedMatchId(chosenId);
              }}
              categoryName={category.category.name}
              title="Click any match in the tree to conduct"
            />
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          {/* Bout header: what is being fought, and how long is left. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-400">
                {match.roundName} · match {match.matchNo}
              </div>
              <div className="mt-0.5 text-sm text-ink-300">
                {isKata ? (
                  <span className="text-gold font-medium">
                    Kata Majority Flags · {state?.flags ? `${state.flags.aka}–${state.flags.ao}` : 'Awaiting flags'}
                  </span>
                ) : state === null || state.senshu === null ? (
                  'No senshu yet'
                ) : (
                  `Senshu ${state.senshu}`
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Clock size={16} className="text-ink-400" />
              <span
                className={cn(
                  'tnum font-mono text-4xl font-bold tabular-nums',
                  isTimeWarning(remainingMs) ? 'text-gold' : 'text-ink-50',
                )}
                aria-label="Time remaining"
              >
                {remainingMs === null ? '--:--' : formatClock(remainingMs)}
              </span>
            </div>

            {discipline === 'TEAM_KATA' && (
              <StatusPill tone="good">Team Kata · 5:00 Bunkai Limit</StatusPill>
            )}

            {discipline === 'KATA' && (
              <StatusPill tone="neutral">Kata Flag Judging</StatusPill>
            )}

            {discipline === 'TEAM_KUMITE' && (
              <StatusPill tone="good">Team Kumite · Bout {selectedTeamBout} of 5</StatusPill>
            )}

            {state?.superior === true && !isKata && (
              <StatusPill tone="warn" icon={<CircleAlert size={12} />}>
                Eight-point lead
              </StatusPill>
            )}

            {state?.clock.running === true && (
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-go">
                <Radio size={12} />
                clock running
              </span>
            )}
          </div>

          {/* Team Kumite Overview Banner & Bout Manager */}
          {isTeamKumite && (
            <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-ink-100 flex items-center gap-2">
                    <Flag size={16} className="text-gold" />
                    <span>Team Kumite Match (5 Bouts)</span>
                  </h3>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Individual bouts permit HIKIWAKE (draws). Win requires most bout victories or total points.
                  </p>
                </div>

                {/* Team Points & Wins */}
                {(() => {
                  const bouts = state?.teamBouts ?? [];
                  let akaWins = 0;
                  let aoWins = 0;
                  let draws = 0;
                  let akaPts = 0;
                  let aoPts = 0;
                  for (const b of bouts) {
                    if (b.winner === 'AKA') akaWins += 1;
                    else if (b.winner === 'AO') aoWins += 1;
                    else if (b.winner === 'HIKIWAKE') draws += 1;
                    akaPts += b.akaPoints;
                    aoPts += b.aoPoints;
                  }
                  return (
                    <div className="flex items-center gap-3 text-center">
                      <div className="rounded-lg border border-stop/40 bg-stop/10 px-3 py-1 text-stop">
                        <span className="text-[10px] uppercase font-bold text-ink-400 block">AKA</span>
                        <span className="text-base font-black">{akaWins} wins ({akaPts} pts)</span>
                      </div>
                      <span className="text-ink-600 font-bold">:</span>
                      <div className="rounded-lg border border-ao/40 bg-ao/10 px-3 py-1 text-ao">
                        <span className="text-[10px] uppercase font-bold text-ink-400 block">AO</span>
                        <span className="text-base font-black">{aoWins} wins ({aoPts} pts)</span>
                      </div>
                      {draws > 0 && <span className="text-xs text-ink-400">({draws} D)</span>}
                    </div>
                  );
                })()}
              </div>

              {/* Bout Switcher & Record */}
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                <div className="flex gap-1.5 overflow-x-auto">
                  {[1, 2, 3, 4, 5].map((bNo) => {
                    const recorded = state?.teamBouts?.find((b) => b.boutNo === bNo);
                    return (
                      <button
                        key={bNo}
                        type="button"
                        onClick={() => setSelectedTeamBout(bNo)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors',
                          selectedTeamBout === bNo
                            ? 'bg-gold text-ink-950 border-gold shadow'
                            : 'bg-ink-850 text-ink-300 border-ink-750 hover:bg-ink-800',
                        )}
                      >
                        Bout {bNo}
                        {recorded && (
                          <span className="ml-1 text-[10px] opacity-80">
                            ({recorded.winner === 'HIKIWAKE' ? 'DRAW' : recorded.winner})
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const akaPts = state?.derived.aka.points ?? 0;
                      const aoPts = state?.derived.ao.points ?? 0;
                      void send('RECORD_TEAM_BOUT', {
                        boutNo: selectedTeamBout,
                        winner: 'AKA',
                        akaPoints: akaPts > aoPts ? akaPts : 1,
                        aoPoints: aoPts,
                        method: 'POINTS',
                      });
                    }}
                    className="text-xs text-stop hover:bg-stop/20"
                  >
                    Bout {selectedTeamBout} → AKA Win
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const akaPts = state?.derived.aka.points ?? 0;
                      const aoPts = state?.derived.ao.points ?? 0;
                      void send('RECORD_TEAM_BOUT', {
                        boutNo: selectedTeamBout,
                        winner: 'AO',
                        akaPoints: akaPts,
                        aoPoints: aoPts > akaPts ? aoPts : 1,
                        method: 'POINTS',
                      });
                    }}
                    className="text-xs text-ao hover:bg-ao/20"
                  >
                    Bout {selectedTeamBout} → AO Win
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void send('RECORD_TEAM_BOUT', {
                        boutNo: selectedTeamBout,
                        winner: 'HIKIWAKE',
                        akaPoints: 0,
                        aoPoints: 0,
                        method: 'HIKIWAKE',
                      });
                    }}
                    className="text-xs text-gold hover:bg-gold/20"
                  >
                    Bout {selectedTeamBout} → Draw
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* If Kata, show Kata Flag Judging Interface */}
          {isKata ? (
            <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-ink-100 flex items-center gap-2">
                    <Flag size={16} className="text-gold" />
                    <span>Kata Judging Panel (5 Judges)</span>
                  </h3>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Judges scan QR to cast live votes, or operator clicks below to set/override flags.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 rounded-lg border border-stop/40 bg-stop/10 px-3 py-1 text-stop font-black text-lg">
                    AKA: {state?.flags?.aka ?? 0}
                  </div>
                  <span className="text-ink-600 font-bold">:</span>
                  <div className="flex items-center gap-1.5 rounded-lg border border-ao/40 bg-ao/10 px-3 py-1 text-ao font-black text-lg">
                    AO: {state?.flags?.ao ?? 0}
                  </div>
                </div>
              </div>

              {/* Individual Judge Seats */}
              <div className="grid grid-cols-5 gap-2 my-4">
                {[1, 2, 3, 4, 5].map((judgeNo) => {
                  const vote = state?.kataJudges?.[String(judgeNo)];
                  const score = state?.kataScores?.[String(judgeNo)];
                  return (
                    <div
                      key={judgeNo}
                      className={cn(
                        'flex flex-col items-center rounded-xl border p-2.5 transition-all text-center',
                        vote === 'AKA'
                          ? 'border-stop/60 bg-stop/15 text-stop shadow-sm'
                          : vote === 'AO'
                            ? 'border-ao/60 bg-ao/15 text-ao shadow-sm'
                            : 'border-ink-800 bg-ink-850 text-ink-400',
                      )}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-wider text-ink-300">
                        Judge {judgeNo}
                      </span>
                      <div className="my-1.5 flex items-center justify-center font-black text-base">
                        {vote === 'AKA' ? (
                          <span className="flex items-center gap-1 text-stop">🔴 AKA</span>
                        ) : vote === 'AO' ? (
                          <span className="flex items-center gap-1 text-ao">🔵 AO</span>
                        ) : (
                          <span className="text-xs font-normal text-ink-500 italic">Pending</span>
                        )}
                      </div>

                      {score && (
                        <div className="text-[10px] font-mono font-bold text-ink-300 mb-1">
                          {score.aka.toFixed(1)} vs {score.ao.toFixed(1)}
                        </div>
                      )}

                      <div className="flex gap-1 mt-1 w-full">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void send('VOTE_FLAG', { judgeNo, side: 'AKA' })}
                          className={cn(
                            'flex-1 rounded py-1 text-[10px] font-bold border transition-colors',
                            vote === 'AKA'
                              ? 'bg-stop text-white border-white/40'
                              : 'bg-stop/20 text-stop border-stop/30 hover:bg-stop/30',
                          )}
                        >
                          AKA
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void send('VOTE_FLAG', { judgeNo, side: 'AO' })}
                          className={cn(
                            'flex-1 rounded py-1 text-[10px] font-bold border transition-colors',
                            vote === 'AO'
                              ? 'bg-ao text-white border-white/40'
                              : 'bg-ao/20 text-ao border-ao/30 hover:bg-ao/30',
                          )}
                        >
                          AO
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Manual Score Entry Collapsible Panel */}
              {showManualScoreEditor && (
                <div className="mb-4 rounded-xl border border-ink-700 bg-ink-950 p-3.5 animate-in fade-in">
                  <div className="flex items-center justify-between pb-2.5 border-b border-ink-800">
                    <div className="text-xs font-bold uppercase tracking-wider text-gold flex items-center gap-1.5">
                      <Sliders size={14} />
                      <span>Manual Score Entry (Official WKF 5.0 – 10.0 Scale)</span>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      className="text-xs font-bold"
                      onClick={async () => {
                        for (let j = 1; j <= 5; j++) {
                          const s = manualScores[j] ?? { aka: 7.5, ao: 7.5 };
                          const side = s.aka >= s.ao ? 'AKA' : 'AO';
                          await send('VOTE_FLAG', {
                            judgeNo: j,
                            side,
                            akaScore: s.aka,
                            aoScore: s.ao,
                          });
                        }
                      }}
                    >
                      <Save size={13} className="mr-1" />
                      Apply All 5 Scores
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-3">
                    {[1, 2, 3, 4, 5].map((j) => {
                      const cur = manualScores[j] ?? { aka: 7.5, ao: 7.5 };
                      return (
                        <div
                          key={j}
                          className="rounded-lg border border-ink-800 bg-ink-900/80 p-2.5 flex flex-col gap-2"
                        >
                          <span className="text-[11px] font-bold text-ink-300">Judge #{j}</span>
                          <div className="flex items-center justify-between gap-1 text-xs">
                            <span className="text-stop font-bold">AKA:</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="10"
                              value={cur.aka}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setManualScores((prev) => ({
                                  ...prev,
                                  [j]: { ...prev[j], aka: val, ao: prev[j]?.ao ?? 7.5 },
                                }));
                              }}
                              className="w-16 rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-right font-mono font-bold text-ink-100 focus:border-stop focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-1 text-xs">
                            <span className="text-ao font-bold">AO:</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="10"
                              value={cur.ao}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setManualScores((prev) => ({
                                  ...prev,
                                  [j]: { ...prev[j], ao: val, aka: prev[j]?.aka ?? 7.5 },
                                }));
                              }}
                              className="w-16 rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-right font-mono font-bold text-ink-100 focus:border-ao focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const side = cur.aka >= cur.ao ? 'AKA' : 'AO';
                              void send('VOTE_FLAG', {
                                judgeNo: j,
                                side,
                                akaScore: cur.aka,
                                aoScore: cur.ao,
                              });
                            }}
                            className="mt-1 rounded bg-ink-800 py-1 text-[10px] font-bold text-gold hover:bg-ink-750 transition-colors border border-ink-700"
                          >
                            Submit J{j} ({cur.aka >= cur.ao ? 'AKA' : 'AO'})
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick Flag Presets & Manual Adjustments */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink-400">Quick Flag Decisions:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { aka: 5, ao: 0, label: '5–0 AKA' },
                      { aka: 4, ao: 1, label: '4–1 AKA' },
                      { aka: 3, ao: 2, label: '3–2 AKA' },
                      { aka: 2, ao: 3, label: '2–3 AO' },
                      { aka: 1, ao: 4, label: '1–4 AO' },
                      { aka: 0, ao: 5, label: '0–5 AO' },
                    ].map((preset) => (
                      <Button
                        key={preset.label}
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void send('RECORD_FLAGS', { akaFlags: preset.aka, aoFlags: preset.ao })
                        }
                        className={cn(
                          'text-xs font-bold',
                          preset.aka > preset.ao ? 'hover:text-stop' : 'hover:text-ao',
                        )}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <Button
                  variant={showManualScoreEditor ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setShowManualScoreEditor((prev) => !prev)}
                  className="text-xs font-bold flex items-center gap-1.5"
                >
                  <Sliders size={13} />
                  <span>{showManualScoreEditor ? 'Hide Manual Scores' : 'Manual Score Entry'}</span>
                </Button>
              </div>
            </div>
          ) : (
            /* Standard Kumite Athlete Scoring Panels */
            <div className="grid gap-4 md:grid-cols-2">
              {(['AKA', 'AO'] as const).map((side) => (
                <AthletePanel
                  key={side}
                  side={side}
                  state={state}
                  match={match}
                  busy={busy}
                  live={live}
                  onScore={(value, target, technique) =>
                    void send('SCORE', { side, value, target, technique })
                  }
                  onPenalty={() => void send('PENALTY', { side })}
                  onSenshu={() => void send('SENSHU', { side })}
                  onSenshuTorimasen={() => void send('SENSHU_TORIMASEN', { side })}
                />
              ))}
            </div>
          )}


          {/* Bout controls. Undo sits beside the actions it takes back. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-3">
            {state === null ? (
              <>
                <Button variant="secondary" size="lg" disabled={busy} onClick={() => void send('CALL_MATCH')}>
                  <Flag size={16} />
                  Call to tatami
                </Button>
                <Button variant="primary" size="lg" disabled={busy} onClick={() => void send('START_MATCH')}>
                  <Play size={16} />
                  Start bout
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant={state.clock.running ? 'secondary' : 'primary'}
                  size="lg"
                  disabled={busy || !live}
                  onClick={() => void send(state.clock.running ? 'PAUSE_MATCH' : 'RESUME_MATCH')}
                >
                  <Clock size={16} />
                  {state.clock.running ? 'Stop clock' : 'Start clock'}
                </Button>
                <Button variant="primary" size="lg" disabled={busy || !live} onClick={() => void send('END_MATCH')}>
                  <Flag size={16} />
                  End bout
                </Button>
              </>
            )}

            <span className="mx-1 hidden w-px self-stretch bg-ink-800 sm:block" />

            {/*
              Undo is what the event log was built for: the event is voided rather
              than deleted, so a mis-tap mid-bout is recoverable and the record of
              it survives in the log.
            */}
            <Button
              variant="secondary"
              size="lg"
              disabled={busy || match.undoable === null}
              title={match.undoable === null ? 'Nothing to undo' : `Undo ${match.undoable.label}`}
              onClick={() => void send('UNDO_LAST')}
            >
              <Undo2 size={16} />
              {match.undoable === null ? 'Nothing to undo' : `Undo ${match.undoable.label}`}
            </Button>

            <span className="mx-1 hidden w-px self-stretch bg-ink-800 sm:block" />

            <Button
              variant="danger"
              size="lg"
              disabled={busy || !live}
              onClick={() => void send('KIKEN', { side: 'AKA' })}
            >
              <UserX size={16} />
              AKA no-show
            </Button>
            <Button
              variant="danger"
              size="lg"
              disabled={busy || !live}
              onClick={() => void send('KIKEN', { side: 'AO' })}
            >
              <UserX size={16} />
              AO no-show
            </Button>
          </div>
        </div>

        {/* Result, log and queue. */}
        <aside className="flex flex-col gap-4">
          <Panel title="Result">
            {match.proposal === null ? (
              <p className="text-sm text-ink-400">
                Start the bout to see the result the rules imply.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-ink-300">{match.proposal.reason}</p>

                {state?.status === 'CONFIRMED' ? (
                  <>
                    <p className="rounded-lg border border-go/40 bg-go/10 px-3 py-2 text-sm text-go">
                      Confirmed: {state.winner?.side} by {state.decisionMethod?.toLowerCase()}. The
                      bracket has advanced.
                    </p>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          'Why is this result being reversed? The original stays in the log.',
                        );
                        if (reason !== null && reason.trim() !== '') {
                          void send('VOID_RESULT', { reason: reason.trim() });
                        }
                      }}
                    >
                      <ArrowLeftRight size={15} />
                      Reverse this result
                    </Button>
                  </>
                ) : match.proposal.kind === 'DECIDED' ? (
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={busy}
                    onClick={() =>
                      void send('CONFIRM_RESULT', {
                        winner: match.proposal?.side,
                        method: match.proposal?.method,
                      })
                    }
                  >
                    Confirm {match.proposal.side} wins by {match.proposal.method?.toLowerCase()}
                  </Button>
                ) : (
                  <>
                    <p className="text-xs text-ink-400">
                      {match.proposal.kind === 'HANTEI_REQUIRED'
                        ? 'Level on every criterion. The panel decides (HANTEI); record their verdict.'
                        : 'Level on every criterion, and a draw is permitted here.'}
                    </p>
                    <div className="flex flex-col gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => void send('CONFIRM_RESULT', { winner: 'AKA', method: 'HANTEI' })}
                      >
                        AKA wins on HANTEI
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void send('CONFIRM_RESULT', { winner: 'AO', method: 'HANTEI' })}
                      >
                        AO wins on HANTEI
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void send('CONFIRM_RESULT', { winner: 'HIKIWAKE', method: 'HIKIWAKE' })
                        }
                      >
                        Draw (HIKIWAKE)
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </Panel>

          <Panel title="This bout" description="Newest last">
            {match.history.length === 0 ? (
              <p className="text-sm text-ink-400">Nothing recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-1 text-xs">
                {match.history.map((entry) => (
                  <li key={entry.seq} className="flex gap-2">
                    <span className="tnum w-6 shrink-0 text-ink-600">{entry.seq}</span>
                    <span className="text-ink-300">{entry.label}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Next on this ring" description={`${upcoming.length} match(es) waiting`}>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-400">Nothing left in this category.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {upcoming.slice(0, 8).map((candidate) => (
                  <li
                    key={candidate.matchId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-ink-800 bg-ink-850/60 p-2 text-sm transition-colors hover:border-ink-700"
                  >
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono text-xs text-ink-500 shrink-0">
                        M{candidate.matchNo}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-ink-100">
                          {candidate.aka.displayName || '—'} v {candidate.ao.displayName || '—'}
                        </span>
                        <span className="text-xs text-ink-400">{candidate.roundName}</span>
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs font-semibold text-gold shrink-0 hover:bg-gold-soft"
                      onClick={() => setSelectedMatchId(candidate.matchId)}
                    >
                      Conduct
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </aside>
      </div>

      <JudgeQrModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        tatamiId={tatamiId}
        tatamiName={queue.tatamiName}
      />
    </AppShell>
  );
}

/**
 * One side of the bout.
 *
 * AKA and AO are labelled in text as well as coloured: the surface is red
 * against blue, and roughly one in twelve men cannot reliably separate the two
 * by hue alone.
 *
 * There is one penalty button, not three. WKF Art. 10.2-10.3 fixes the sequence
 * — CHUI, CHUI, CHUI, HANSOKU CHUI, HANSOKU — and each athlete carries their own
 * ladder, so the operator reports *that a penalty happened* and the server
 * decides the rung. Asking a scorer to pick the level is how a bout ends up with
 * four CHUIs.
 */
function AthletePanel({
  side,
  state,
  match,
  busy,
  live,
  onScore,
  onPenalty,
  onSenshu,
  onSenshuTorimasen,
}: {
  side: 'AKA' | 'AO';
  state: MatchState | null;
  match: MatchView;
  busy: boolean;
  live: boolean;
  onScore: (value: 1 | 2 | 3, target: string, technique: string) => void;
  onPenalty: () => void;
  onSenshu: () => void;
  onSenshuTorimasen: () => void;
}) {
  const isAka = side === 'AKA';
  const tally = state === null ? null : isAka ? state.derived.aka : state.derived.ao;
  const penalties = state === null ? [] : isAka ? state.penalties.aka : state.penalties.ao;
  const progress = match.penalties === null ? null : isAka ? match.penalties.aka : match.penalties.ao;
  const senshuLocked = state?.senshuLocked ?? false;

  const name =
    (isAka ? state?.aka.displayName : state?.ao.displayName) ||
    (isAka ? match.aka.displayName : match.ao.displayName);
  const hasSenshu = state?.senshu === side;

  return (
    <section
      aria-label={`${side} athlete`}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-ink-900 p-4',
        isAka ? 'border-aka/40' : 'border-ao/40',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider',
                isAka ? 'bg-aka text-ink-950' : 'bg-ao text-ink-950',
              )}
            >
              {side}
            </span>
            {hasSenshu && (
              <StatusPill tone={isAka ? 'aka' : 'ao'} icon={<Hand size={11} />}>
                Senshu
              </StatusPill>
            )}
            {state?.kiken === side && (
              <StatusPill tone="bad" icon={<UserX size={11} />}>
                No-show
              </StatusPill>
            )}
          </div>
          <p className="mt-1.5 truncate text-lg font-semibold text-ink-50">{name || '—'}</p>
        </div>

        <div
          className={cn(
            'tnum font-mono text-5xl font-bold leading-none tabular-nums',
            isAka ? 'text-aka' : 'text-ao',
          )}
          aria-label={`${side} score`}
        >
          {tally?.points ?? 0}
        </div>
      </header>

      <dl className="flex gap-4 text-xs text-ink-400">
        <div>
          <dt className="sr-only">Ippon</dt>
          <dd>
            <span className="tnum font-semibold text-ink-200">{tally?.ippon ?? 0}</span> ippon
          </dd>
        </div>
        <div>
          <dt className="sr-only">Waza-ari</dt>
          <dd>
            <span className="tnum font-semibold text-ink-200">{tally?.wazaAri ?? 0}</span> waza-ari
          </dd>
        </div>
        <div>
          <dt className="sr-only">Yuko</dt>
          <dd>
            <span className="tnum font-semibold text-ink-200">{tally?.yuko ?? 0}</span> yuko
          </dd>
        </div>
      </dl>

      {/* The score pad. Tall targets, because this is used at speed with a
          queue of people waiting on the result. */}
      <div className="grid grid-cols-3 gap-2">
        {SCORE_BUTTONS.map((button) => (
          <Button
            key={button.label}
            variant={isAka ? 'aka' : 'ao'}
            size="tap"
            disabled={busy || !live}
            onClick={() => onScore(button.value, button.target, button.technique)}
            className="flex-col gap-0"
          >
            <span>{button.label}</span>
            <span className="text-[0.65rem] font-normal opacity-70">{button.detail}</span>
          </Button>
        ))}
      </div>

      {/* Where this athlete stands, and what their next penalty would be. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
        {/*
          One control, two meanings: award the advantage, or withdraw it. The
          rulebook has the referee announce the withdrawal explicitly
          ("AKA/AO SENSHU TORIMASEN", Art. 12.2.8), so it is the operator's
          action rather than something the software infers — it happens either
          when an athlete avoids combat late in the bout (Art. 10.4.16) or when
          a video review shows the opponent also scored (Art. 12.2.9).
        */}
        {hasSenshu ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !live}
            onClick={() => onSenshuTorimasen()}
            title="Referee announced SENSHU TORIMASEN — the advantage is withdrawn (Art. 12.2.8)"
          >
            <Hand size={14} />
            Withdraw senshu
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !live || senshuLocked}
            onClick={onSenshu}
            title={
              senshuLocked
                ? 'SENSHU was withdrawn late in the bout, so it cannot be awarded again (Art. 12.2.10)'
                : 'First unopposed score advantage'
            }
          >
            <Hand size={14} />
            Senshu
          </Button>
        )}

        <Button
          variant={progress?.endsBout === true ? 'danger' : 'ghost'}
          size="sm"
          disabled={busy || !live || progress === null}
          onClick={onPenalty}
          title="Records the next penalty on this athlete's ladder"
        >
          <CircleAlert size={14} />
          {progress === null ? 'Penalty' : `Penalty · ${nextPenaltyText(progress)}`}
        </Button>

        {progress?.endsBout === true && (
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-stop">
            next penalty loses the bout
          </span>
        )}

        {penalties.length > 0 && (
          <ol className="flex flex-wrap gap-1.5">
            {penalties.map((penalty) => (
              <li key={penalty.seq}>
                <StatusPill tone={penalty.level === 'CHUI' ? 'warn' : 'bad'}>
                  {penalty.level.replace(/_/g, ' ').toLowerCase()}
                </StatusPill>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
