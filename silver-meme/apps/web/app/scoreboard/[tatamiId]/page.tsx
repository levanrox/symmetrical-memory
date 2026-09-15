'use client';

import { Hand } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useChannel } from '../../../lib/useChannel';
import { isTimeWarning, useMatchClock } from '../../../lib/useMatchClock';
import { cn } from '../../../lib/utils';

interface PenaltyRecord {
  level: string;
  seq: number;
}

interface MatchState {
  status: string;
  aka: { displayName: string };
  ao: { displayName: string };
  senshu: 'AKA' | 'AO' | null;
  kiken: 'AKA' | 'AO' | null;
  clock: { elapsedMs: number; running: boolean; startedAtMs: number | null };
  penalties: { aka: PenaltyRecord[]; ao: PenaltyRecord[] };
  derived: {
    aka: { points: number; ippon: number; wazaAri: number; yuko: number };
    ao: { points: number; ippon: number; wazaAri: number; yuko: number };
  };
  superior: boolean;
  winner?: { side: string; method: string };
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
  roundName: string;
  status: string;
  aka: { displayName: string };
  ao: { displayName: string };
  state: MatchState | null;
}

interface RingQueueView {
  tatamiId: string;
  tatamiName: string;
  categories: Array<{
    category: { name: string; discipline?: string };
    durationSeconds: number;
    matches: MatchView[];
  }>;
  currentMatchId: string | null;
}

/**
 * The crowd-facing display.
 *
 * Sized in `clamp()` against the viewport rather than in fixed breakpoints: it
 * is opened on whatever the venue happens to have — a laptop, a TV, a projector
 * nobody measured — and has to fill the screen and stay legible from the back of
 * the hall on all of them. Nothing here scrolls.
 *
 * Deliberately unauthenticated and read-only: nothing on this surface can change
 * a result, so it can be left on unattended.
 */
export default function ScoreboardPage() {
  const params = useParams<{ tatamiId: string }>();
  const tatamiId = params.tatamiId;

  const [queue, setQueue] = useState<RingQueueView | null>(null);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    try {
      setQueue(await api.get<RingQueueView>(`/tatamis/${tatamiId}/queue`));
    } catch {
      setQueue(null);
    }
  }, [tatamiId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useChannel<{ type: string }>(`tatami:${tatamiId}`, () => void refresh());

  // A slow poll in case the socket drops; the venue has no one watching for it.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  // A wall clock, so a spectator can see the board is alive even when idle.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const category = queue?.categories[0] ?? null;
  const match = useMemo(
    () => category?.matches.find((candidate) => candidate.matchId === queue?.currentMatchId) ?? null,
    [category, queue],
  );

  const remainingMs = useMatchClock(match?.state?.clock ?? null, category?.durationSeconds ?? null);

  const upcoming = (category?.matches ?? []).filter(
    (candidate) =>
      candidate.matchId !== queue?.currentMatchId &&
      candidate.status !== 'FINISHED' &&
      candidate.status !== 'WALKOVER' &&
      candidate.aka.displayName !== '',
  );

  const state = match?.state ?? null;
  const finished = state?.status === 'CONFIRMED';
  const discipline = category?.category.discipline ?? 'KUMITE';
  const isKata = discipline === 'KATA' || discipline === 'TEAM_KATA';
  const isTeamKumite = discipline === 'TEAM_KUMITE';

  const teamTally = useMemo(() => {
    if (!isTeamKumite || !state?.teamBouts) return null;
    let akaWins = 0;
    let aoWins = 0;
    let draws = 0;
    let akaPts = 0;
    let aoPts = 0;
    for (const b of state.teamBouts) {
      akaPts += b.akaPoints;
      aoPts += b.aoPoints;
      if (b.winner === 'AKA') akaWins++;
      else if (b.winner === 'AO') aoWins++;
      else if (b.winner === 'DRAW') draws++;
    }
    return { akaWins, aoWins, draws, akaPts, aoPts, boutsCompleted: state.teamBouts.length };
  }, [isTeamKumite, state?.teamBouts]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-baseline justify-between gap-6 px-[3vw] py-[1.6vh]">
        <div className="flex items-center gap-3">
          <span className="text-[clamp(0.9rem,1.6vw,1.6rem)] font-bold uppercase tracking-[0.25em] text-ink-400">
            {queue?.tatamiName ?? 'Tatami'}
          </span>
          {discipline !== 'KUMITE' && (
            <span className="rounded-full border border-gold/40 bg-gold-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-gold">
              {discipline.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <span className="text-[clamp(0.85rem,1.4vw,1.35rem)] text-ink-400">
          {match === null
            ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : `${category?.category.name} · ${match.roundName} · match ${match.matchNo}`}
        </span>
      </header>

      {/* Team Kumite Match Summary Bar */}
      {isTeamKumite && teamTally && (
        <div className="mx-[3vw] mb-[1vh] flex shrink-0 items-center justify-between rounded-xl border border-ink-700 bg-ink-900/90 px-6 py-2 shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="rounded bg-aka px-2 py-0.5 text-xs font-black text-ink-950">AKA</span>
            <span className="text-sm sm:text-base font-bold text-ink-100">
              {teamTally.akaWins} Bouts · {teamTally.akaPts} Pts
            </span>
          </div>
          <div className="text-xs uppercase tracking-widest text-ink-400 font-semibold">
            Team Match · Bout {teamTally.boutsCompleted + 1 <= 5 ? teamTally.boutsCompleted + 1 : 5} of 5 ({teamTally.draws} Draws)
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-sm sm:text-base font-bold text-ink-100">
              {teamTally.aoWins} Bouts · {teamTally.aoPts} Pts
            </span>
            <span className="rounded bg-ao px-2 py-0.5 text-xs font-black text-ink-950">AO</span>
          </div>
        </div>
      )}

      {match === null || category === null ? (
        <IdleScreen upcoming={upcoming} categoryName={category?.category.name ?? null} />
      ) : (
        <>
          <main className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] items-stretch gap-[1.4vw] px-[3vw]">
            <BoardSide
              side="AKA"
              name={state?.aka.displayName || match.aka.displayName || '—'}
              score={isKata ? (state?.flags?.aka ?? 0) : (state?.derived.aka.points ?? 0)}
              ippon={state?.derived.aka.ippon ?? 0}
              wazaAri={state?.derived.aka.wazaAri ?? 0}
              yuko={state?.derived.aka.yuko ?? 0}
              senshu={!isKata && state?.senshu === 'AKA'}
              noShow={state?.kiken === 'AKA'}
              penalties={state?.penalties.aka ?? []}
              isKata={isKata}
            />

            <div className="flex flex-col items-center justify-center gap-[1.5vh]">
              <span
                className={cn(
                  'tnum font-mono font-bold leading-none tabular-nums',
                  'text-[clamp(4rem,13vw,14rem)]',
                  finished ? 'text-go' : isTimeWarning(remainingMs) ? 'text-gold' : 'text-ink-50',
                )}
                aria-label="Time remaining"
              >
                {finished ? 'END' : remainingMs === null ? '--:--' : clockText(remainingMs)}
              </span>

              {state?.superior === true && !finished && !isKata && (
                <Flag tone="gold">Eight-point lead</Flag>
              )}
              {finished && (
                <Flag tone="go">
                  {state?.winner?.side} wins by {state?.winner?.method?.toLowerCase()}
                </Flag>
              )}

              {/* 5-Judge Flag Indicators for Kata */}
              {isKata && (
                <div className="flex flex-col items-center gap-1.5 mt-2">
                  <span className="text-[clamp(0.6rem,0.9vw,0.85rem)] font-bold uppercase tracking-wider text-ink-400">
                    Judge Votes (1–5)
                  </span>
                  <div className="flex items-center gap-2 sm:gap-3">
                    {[1, 2, 3, 4, 5].map((num) => {
                      const vote = state?.kataJudges?.[String(num)];
                      const score = state?.kataScores?.[String(num)];
                      return (
                        <div
                          key={num}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-lg border px-2.5 py-1.5 transition-all',
                            vote === 'AKA'
                              ? 'border-aka bg-aka/20 text-aka ring-1 ring-aka/40'
                              : vote === 'AO'
                              ? 'border-ao bg-ao/20 text-ao ring-1 ring-ao/40'
                              : 'border-ink-800 bg-ink-900/60 text-ink-500',
                          )}
                        >
                          <span className="text-[clamp(0.55rem,0.75vw,0.75rem)] font-mono font-semibold">
                            J{num}
                          </span>
                          <div
                            className={cn(
                              'h-5 w-5 rounded-full border flex items-center justify-center font-black text-[10px]',
                              vote === 'AKA'
                                ? 'bg-aka text-white border-aka shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                                : vote === 'AO'
                                ? 'bg-ao text-white border-ao shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                                : 'bg-ink-800 border-ink-600 text-ink-500',
                            )}
                          >
                            {vote ? vote[0] : '·'}
                          </div>
                          {score && (
                            <span className="text-[10px] font-mono font-bold text-ink-300">
                              {score.aka.toFixed(1)}–{score.ao.toFixed(1)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <BoardSide
              side="AO"
              name={state?.ao.displayName || match.ao.displayName || '—'}
              score={isKata ? (state?.flags?.ao ?? 0) : (state?.derived.ao.points ?? 0)}
              ippon={state?.derived.ao.ippon ?? 0}
              wazaAri={state?.derived.ao.wazaAri ?? 0}
              yuko={state?.derived.ao.yuko ?? 0}
              senshu={!isKata && state?.senshu === 'AO'}
              noShow={state?.kiken === 'AO'}
              penalties={state?.penalties.ao ?? []}
              isKata={isKata}
            />
          </main>

          <footer className="flex shrink-0 items-center justify-center gap-[2vw] px-[3vw] py-[1.4vh] text-[clamp(0.65rem,1vw,1rem)] uppercase tracking-[0.2em] text-ink-600">
            {discipline === 'TEAM_KATA' && (
              <>
                <span>WKF Team Kata 2026</span>
                <span aria-hidden="true">·</span>
                <span>5:00 Bunkai Limit</span>
                <span aria-hidden="true">·</span>
                <span>Majority Flag Decision</span>
              </>
            )}
            {discipline === 'KATA' && (
              <>
                <span>WKF Kata 2026</span>
                <span aria-hidden="true">·</span>
                <span>Majority Flag Decision</span>
              </>
            )}
            {discipline === 'TEAM_KUMITE' && (
              <>
                <span>WKF Team Kumite 2026</span>
                <span aria-hidden="true">·</span>
                <span>5 Bouts</span>
                <span aria-hidden="true">·</span>
                <span>Hikiwake Permitted</span>
              </>
            )}
            {discipline === 'KUMITE' && (
              <>
                <span>WKF Kumite 2026</span>
                <span aria-hidden="true">·</span>
                <span>8-point margin ends the bout</span>
              </>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

function IdleScreen({
  upcoming,
  categoryName,
}: {
  upcoming: MatchView[];
  categoryName: string | null;
}) {
  const next = upcoming[0];

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3vh] px-[6vw] text-center">
      <p className="text-[clamp(1.5rem,4vw,3.5rem)] font-semibold text-ink-500">
        No match in progress
      </p>

      {next !== undefined && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 px-[4vw] py-[3vh]">
          <p className="text-[clamp(0.7rem,1.1vw,1.1rem)] uppercase tracking-[0.2em] text-ink-500">
            Up next {categoryName === null ? '' : `· ${categoryName}`}
          </p>
          <p className="mt-[1.5vh] text-[clamp(1.3rem,3.2vw,3rem)] font-bold text-ink-100">
            {next.aka.displayName || '—'}
            <span className="mx-[0.6vw] font-normal text-ink-500">v</span>
            {next.ao.displayName || '—'}
          </p>
          <p className="mt-[0.6vh] text-[clamp(0.8rem,1.4vw,1.3rem)] text-ink-400">{next.roundName}</p>
        </div>
      )}
    </main>
  );
}

/** `02:00`, from milliseconds remaining. Never negative. */
function clockText(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function Flag({ tone, children }: { tone: 'gold' | 'go'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full border px-[1.2vw] py-[0.5vh] text-[clamp(0.7rem,1.3vw,1.25rem)] font-bold uppercase tracking-[0.15em]',
        tone === 'gold' ? 'border-gold/50 bg-gold-soft text-gold' : 'border-go/50 bg-go/10 text-go',
      )}
    >
      {children}
    </span>
  );
}

/**
 * One athlete's half of the board.
 *
 * The red and blue are the belts, and the AKA/AO label is printed alongside them
 * rather than relying on hue: the board has to read correctly for the spectator
 * who cannot tell red from blue.
 */
function BoardSide({
  side,
  name,
  score,
  ippon,
  wazaAri,
  yuko,
  senshu,
  noShow,
  penalties,
  isKata = false,
}: {
  side: 'AKA' | 'AO';
  name: string;
  score: number;
  ippon: number;
  wazaAri: number;
  yuko: number;
  senshu: boolean;
  noShow: boolean;
  penalties: readonly PenaltyRecord[];
  isKata?: boolean;
}) {
  const isAka = side === 'AKA';

  return (
    <section
      aria-label={`${side} athlete`}
      className={cn(
        'flex min-w-0 flex-col justify-center gap-[1.2vh] rounded-2xl border-2 px-[2vw] py-[2vh]',
        isAka ? 'border-aka/60 bg-aka-soft' : 'border-ao/60 bg-ao-soft',
      )}
    >
      <div className="flex flex-wrap items-center gap-[0.6vw]">
        <span
          className={cn(
            'rounded px-[0.8vw] py-[0.4vh] text-[clamp(0.8rem,1.5vw,1.5rem)] font-black uppercase tracking-[0.2em]',
            isAka ? 'bg-aka text-ink-950' : 'bg-ao text-ink-950',
          )}
        >
          {side}
        </span>

        {senshu && (
          <span
            className={cn(
              'flex items-center gap-[0.4vw] rounded-full border px-[0.8vw] py-[0.4vh] text-[clamp(0.65rem,1.2vw,1.2rem)] font-bold uppercase tracking-[0.15em]',
              isAka ? 'border-aka text-aka' : 'border-ao text-ao',
            )}
          >
            <Hand size={14} />
            Senshu
          </span>
        )}

        {noShow && (
          <span className="rounded-full border border-stop bg-stop/10 px-[0.8vw] py-[0.4vh] text-[clamp(0.65rem,1.2vw,1.2rem)] font-bold uppercase tracking-[0.15em] text-stop">
            No-show
          </span>
        )}
      </div>

      {/* Two lines allowed, then it shrinks rather than pushing the score off. */}
      <p className="line-clamp-2 text-[clamp(1.2rem,2.4vw,2.6rem)] font-bold leading-tight text-ink-50">
        {name}
      </p>

      <div className="flex items-baseline gap-3">
        <p
          className={cn(
            'tnum font-mono font-black leading-none tabular-nums text-[clamp(4rem,11vw,12rem)]',
            isAka ? 'text-aka' : 'text-ao',
          )}
          aria-label={`${side} score`}
        >
          {score}
        </p>
        {isKata && (
          <span className="text-[clamp(1rem,2vw,2rem)] font-bold uppercase tracking-widest text-ink-400">
            {score === 1 ? 'Flag' : 'Flags'}
          </span>
        )}
      </div>

      {!isKata && (
        <dl className="flex flex-wrap gap-[1.4vw] text-[clamp(0.7rem,1.3vw,1.25rem)] text-ink-300">
          <div className="flex gap-[0.4vw]">
            <dt>Ippon</dt>
            <dd className="tnum font-bold text-ink-100">{ippon}</dd>
          </div>
          <div className="flex gap-[0.4vw]">
            <dt>Waza-ari</dt>
            <dd className="tnum font-bold text-ink-100">{wazaAri}</dd>
          </div>
          <div className="flex gap-[0.4vw]">
            <dt>Yuko</dt>
            <dd className="tnum font-bold text-ink-100">{yuko}</dd>
          </div>
        </dl>
      )}

      {/* The ladder is on the board because a coach has to be able to see it. */}
      {penalties.length > 0 && (
        <ol className="flex flex-wrap gap-[0.5vw]">
          {penalties.map((penalty) => (
            <li key={penalty.seq}>
              <span
                className={cn(
                  'rounded-full border px-[0.7vw] py-[0.3vh] text-[clamp(0.6rem,1.1vw,1.1rem)] font-bold uppercase tracking-[0.1em]',
                  penalty.level === 'CHUI'
                    ? 'border-gold/60 bg-gold-soft text-gold'
                    : 'border-stop bg-stop/10 text-stop',
                )}
              >
                {penalty.level.replace(/_/g, ' ').toLowerCase()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
