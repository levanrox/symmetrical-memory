'use client';

import { Flag, CheckCircle, Radio, Award, Sliders, ChevronDown, Check, UserCheck } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { api, newId } from '../../../lib/api';
import { useChannel } from '../../../lib/useChannel';
import { cn } from '../../../lib/utils';

interface MatchView {
  matchId: string;
  matchNo: number;
  roundName: string;
  status: string;
  aka: { displayName: string };
  ao: { displayName: string };
  state: {
    status: string;
    flags?: { aka: number; ao: number };
    kataJudges?: Record<string, 'AKA' | 'AO'>;
    kataScores?: Record<string, { aka: number; ao: number }>;
  } | null;
}

interface RingQueueView {
  tatamiId: string;
  tatamiName: string;
  categories: Array<{
    category: { name: string; discipline?: string };
    matches: MatchView[];
    readyMatchIds: readonly string[];
  }>;
  currentMatchId: string | null;
}

interface JudgeSlot {
  judgeNo: number;
  deviceId: string;
  lastSeen: number;
}

const SCORE_PRESETS = [
  { label: '10.0', text: 'Perfect', value: 10.0, tone: 'text-amber-300 border-amber-500/50 bg-amber-500/10' },
  { label: '9.0+', text: 'Excellent', value: 9.2, tone: 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10' },
  { label: '8.0+', text: 'Very Good', value: 8.4, tone: 'text-cyan-400 border-cyan-500/50 bg-cyan-500/10' },
  { label: '7.0+', text: 'Good', value: 7.6, tone: 'text-blue-400 border-blue-500/50 bg-blue-500/10' },
  { label: '6.0+', text: 'Acceptable', value: 6.5, tone: 'text-yellow-400 border-yellow-500/50 bg-yellow-500/10' },
  { label: '5.0+', text: 'Insufficient', value: 5.5, tone: 'text-orange-400 border-orange-500/50 bg-orange-500/10' },
  { label: '0.0', text: 'Disqualified', value: 0.0, tone: 'text-rose-400 border-rose-500/50 bg-rose-500/10' },
] as const;

export default function DynamicJudgePage() {
  const params = useParams<{ tatamiId: string; judgeNo?: string }>();
  const tatamiId = params.tatamiId;
  const explicitJudgeNo = params.judgeNo ? parseInt(params.judgeNo, 10) : null;

  const [deviceId, setDeviceId] = useState<string>('');
  const [judgeNo, setJudgeNo] = useState<number>(explicitJudgeNo ?? 1);
  const [enrolled, setEnrolled] = useState<boolean>(false);
  const [slots, setSlots] = useState<JudgeSlot[]>([]);

  const [queue, setQueue] = useState<RingQueueView | null>(null);
  const [activeTab, setActiveTab] = useState<'SCORE' | 'FLAGS'>('SCORE');

  // Official WKF 5.0 - 10.0 Scores
  const [akaScore, setAkaScore] = useState<number>(7.5);
  const [aoScore, setAoScore] = useState<number>(7.5);

  const [votedSide, setVotedSide] = useState<'AKA' | 'AO' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastVotedMatchId, setLastVotedMatchId] = useState<string | null>(null);
  const [showSeatSelector, setShowSeatSelector] = useState(false);

  // Initialize or load device ID
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let storedId = localStorage.getItem('event_suite_judge_device_id');
    if (!storedId) {
      storedId = newId();
      localStorage.setItem('event_suite_judge_device_id', storedId);
    }
    setDeviceId(storedId);
  }, []);

  // Claim judge seat sequentially
  const claimSeat = useCallback(
    async (preferred?: number) => {
      if (!deviceId) return;
      try {
        const res = await api.post<{ judgeNo: number; slots: JudgeSlot[] }>(
          `/tatamis/${tatamiId}/judges/claim`,
          {
            deviceId,
            preferredJudgeNo: preferred ?? explicitJudgeNo ?? undefined,
          },
        );
        setJudgeNo(res.judgeNo);
        setSlots(res.slots ?? []);
        setEnrolled(true);
      } catch (err) {
        console.error('Failed to claim judge seat:', err);
      }
    },
    [tatamiId, deviceId, explicitJudgeNo],
  );

  useEffect(() => {
    if (deviceId) {
      void claimSeat();
    }
  }, [deviceId, claimSeat]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<RingQueueView>(`/tatamis/${tatamiId}/queue`);
      setQueue(data);

      const judgesRes = await api.get<{ slots: JudgeSlot[] }>(`/tatamis/${tatamiId}/judges`);
      if (judgesRes?.slots) setSlots(judgesRes.slots);
    } catch {
      // Ignore network hiccup
    }
  }, [tatamiId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const { connected } = useChannel<{ type: string }>(`tatami:${tatamiId}`, () => void refresh());

  const category = queue?.categories[0] ?? null;
  const activeMatch =
    category?.matches.find((m) => m.matchId === queue?.currentMatchId) ??
    category?.matches.find((m) => category.readyMatchIds.includes(m.matchId)) ??
    null;

  // Sync vote if server already recorded it for this judge
  useEffect(() => {
    if (activeMatch) {
      if (lastVotedMatchId !== activeMatch.matchId) {
        setLastVotedMatchId(activeMatch.matchId);
        const recordedSide = activeMatch.state?.kataJudges?.[String(judgeNo)];
        setVotedSide(recordedSide ?? null);

        const recordedScore = activeMatch.state?.kataScores?.[String(judgeNo)];
        if (recordedScore) {
          setAkaScore(recordedScore.aka);
          setAoScore(recordedScore.ao);
        } else {
          setAkaScore(7.5);
          setAoScore(7.5);
        }
      } else {
        const recordedSide = activeMatch.state?.kataJudges?.[String(judgeNo)];
        if (recordedSide && recordedSide !== votedSide && !submitting) {
          setVotedSide(recordedSide);
        }
        const recordedScore = activeMatch.state?.kataScores?.[String(judgeNo)];
        if (recordedScore && !submitting) {
          setAkaScore(recordedScore.aka);
          setAoScore(recordedScore.ao);
        }
      }
    }
  }, [activeMatch, judgeNo, lastVotedMatchId, votedSide, submitting]);

  // Derived verdict from numeric scores
  const calculatedWinner: 'AKA' | 'AO' | 'TIE' = useMemo(() => {
    if (akaScore > aoScore) return 'AKA';
    if (aoScore > akaScore) return 'AO';
    return 'TIE';
  }, [akaScore, aoScore]);

  async function submitVote(side: 'AKA' | 'AO', scores?: { aka: number; ao: number }) {
    if (!activeMatch || submitting) return;
    setSubmitting(true);
    setVotedSide(side);

    try {
      await api.post(`/matches/${activeMatch.matchId}/judge-vote`, {
        judgeNo,
        side,
        ...(scores ? { akaScore: scores.aka, aoScore: scores.ao } : {}),
        commandId: newId(),
      });
      await refresh();
    } catch (err) {
      console.error('Failed to submit vote:', err);
    } finally {
      setSubmitting(false);
    }
  }

  function adjustScore(target: 'AKA' | 'AO', delta: number) {
    if (target === 'AKA') {
      setAkaScore((prev) => Math.min(10.0, Math.max(0.0, Math.round((prev + delta) * 10) / 10)));
    } else {
      setAoScore((prev) => Math.min(10.0, Math.max(0.0, Math.round((prev + delta) * 10) / 10)));
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-ink-50 select-none pb-12">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-800 bg-ink-900/95 px-4 py-3 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gold">
              {queue?.tatamiName ?? 'Tatami'}
            </span>
            <button
              onClick={() => setShowSeatSelector((prev) => !prev)}
              className="flex items-center gap-1 rounded bg-ink-800 px-2.5 py-0.5 text-xs font-bold text-ink-100 hover:bg-ink-750 transition-colors border border-ink-700"
            >
              <UserCheck size={12} className="text-go" />
              <span>Judge {judgeNo}</span>
              <ChevronDown size={12} className="text-ink-400" />
            </button>
          </div>
          <p className="text-xs text-ink-400 mt-0.5">
            {category ? category.category.name : 'Waiting for category...'}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              'flex items-center gap-1 font-medium',
              connected ? 'text-go' : 'text-ink-500',
            )}
          >
            <Radio size={12} className={connected ? 'animate-pulse' : ''} />
            {connected ? 'Live' : 'Connecting'}
          </span>
        </div>
      </header>

      {/* Seat Switcher Dropdown */}
      {showSeatSelector && (
        <div className="border-b border-ink-800 bg-ink-900 p-4 animate-in slide-in-from-top-2">
          <p className="text-xs font-bold text-ink-300 uppercase tracking-wider mb-2">
            Switch Seated Position:
          </p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((num) => {
              const isCurrent = judgeNo === num;
              return (
                <button
                  key={num}
                  onClick={() => {
                    void claimSeat(num);
                    setShowSeatSelector(false);
                  }}
                  className={cn(
                    'rounded-lg py-2 text-xs font-bold transition-all border',
                    isCurrent
                      ? 'border-gold bg-gold text-ink-950 shadow-md'
                      : 'border-ink-700 bg-ink-800 text-ink-300 hover:bg-ink-750',
                  )}
                >
                  Judge {num}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Match Banner */}
      <div className="border-b border-ink-800/80 bg-ink-900/60 px-4 py-2.5">
        {activeMatch ? (
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-ink-300 uppercase tracking-wider">
              {activeMatch.roundName} · Match {activeMatch.matchNo}
            </span>
            <span className="rounded bg-ink-800 px-2 py-0.5 font-bold uppercase tracking-wider text-ink-400">
              {activeMatch.status.toLowerCase()}
            </span>
          </div>
        ) : (
          <div className="text-xs text-ink-400 text-center py-1">
            Waiting for next match to be selected on tatami...
          </div>
        )}
      </div>

      {/* Mode Switcher */}
      <div className="px-4 pt-3 pb-2 flex gap-2">
        <button
          onClick={() => setActiveTab('SCORE')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all border',
            activeTab === 'SCORE'
              ? 'border-gold/60 bg-gold/15 text-gold shadow-sm'
              : 'border-ink-800 bg-ink-900 text-ink-400 hover:text-ink-200',
          )}
        >
          <Award size={15} />
          <span>WKF 5.0–10.0 Scores</span>
        </button>
        <button
          onClick={() => setActiveTab('FLAGS')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all border',
            activeTab === 'FLAGS'
              ? 'border-gold/60 bg-gold/15 text-gold shadow-sm'
              : 'border-ink-800 bg-ink-900 text-ink-400 hover:text-ink-200',
          )}
        >
          <Flag size={15} />
          <span>Direct Flags</span>
        </button>
      </div>

      {activeTab === 'SCORE' ? (
        /* Official WKF 5.0 to 10.0 Score Evaluation Pad */
        <main className="flex-1 flex flex-col gap-4 px-4 pt-2">
          {/* AKA Performance Scoring */}
          <section className="rounded-2xl border-2 border-aka/60 bg-aka/10 p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="rounded bg-aka px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-white">
                AKA (Red)
              </span>
              <span className="text-xs font-bold text-aka truncate max-w-[200px]">
                {activeMatch?.aka.displayName || 'AKA Competitor'}
              </span>
            </div>

            {/* Big Score Readout */}
            <div className="mt-3 flex items-center justify-center gap-4">
              <button
                onClick={() => adjustScore('AKA', -0.1)}
                className="h-12 w-12 rounded-xl bg-ink-800 border border-ink-700 font-bold text-xl active:bg-ink-700 flex items-center justify-center shadow"
              >
                -0.1
              </button>
              <div className="text-center">
                <span className="tnum font-mono text-5xl font-black text-aka tabular-nums">
                  {akaScore.toFixed(1)}
                </span>
                <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider mt-0.5">
                  {akaScore === 10
                    ? 'Perfect'
                    : akaScore >= 9.0
                    ? 'Excellent'
                    : akaScore >= 8.0
                    ? 'Very Good'
                    : akaScore >= 7.0
                    ? 'Good'
                    : akaScore >= 6.0
                    ? 'Acceptable'
                    : akaScore >= 5.0
                    ? 'Insufficient'
                    : 'Disqualified'}
                </p>
              </div>
              <button
                onClick={() => adjustScore('AKA', 0.1)}
                className="h-12 w-12 rounded-xl bg-ink-800 border border-ink-700 font-bold text-xl active:bg-ink-700 flex items-center justify-center shadow"
              >
                +0.1
              </button>
            </div>

            {/* Quick Score Presets */}
            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {SCORE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setAkaScore(p.value)}
                  className={cn(
                    'rounded-lg border px-1.5 py-1 text-center transition-all text-xs font-bold',
                    Math.abs(akaScore - p.value) < 0.05
                      ? 'border-aka bg-aka text-white shadow-md'
                      : 'border-ink-800 bg-ink-900/80 text-ink-300 hover:bg-ink-850',
                  )}
                >
                  <div>{p.label}</div>
                  <div className="text-[9px] font-normal opacity-80">{p.text}</div>
                </button>
              ))}
            </div>
          </section>

          {/* AO Performance Scoring */}
          <section className="rounded-2xl border-2 border-ao/60 bg-ao/10 p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="rounded bg-ao px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-white">
                AO (Blue)
              </span>
              <span className="text-xs font-bold text-ao truncate max-w-[200px]">
                {activeMatch?.ao.displayName || 'AO Competitor'}
              </span>
            </div>

            {/* Big Score Readout */}
            <div className="mt-3 flex items-center justify-center gap-4">
              <button
                onClick={() => adjustScore('AO', -0.1)}
                className="h-12 w-12 rounded-xl bg-ink-800 border border-ink-700 font-bold text-xl active:bg-ink-700 flex items-center justify-center shadow"
              >
                -0.1
              </button>
              <div className="text-center">
                <span className="tnum font-mono text-5xl font-black text-ao tabular-nums">
                  {aoScore.toFixed(1)}
                </span>
                <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider mt-0.5">
                  {aoScore === 10
                    ? 'Perfect'
                    : aoScore >= 9.0
                    ? 'Excellent'
                    : aoScore >= 8.0
                    ? 'Very Good'
                    : aoScore >= 7.0
                    ? 'Good'
                    : aoScore >= 6.0
                    ? 'Acceptable'
                    : aoScore >= 5.0
                    ? 'Insufficient'
                    : 'Disqualified'}
                </p>
              </div>
              <button
                onClick={() => adjustScore('AO', 0.1)}
                className="h-12 w-12 rounded-xl bg-ink-800 border border-ink-700 font-bold text-xl active:bg-ink-700 flex items-center justify-center shadow"
              >
                +0.1
              </button>
            </div>

            {/* Quick Score Presets */}
            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {SCORE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setAoScore(p.value)}
                  className={cn(
                    'rounded-lg border px-1.5 py-1 text-center transition-all text-xs font-bold',
                    Math.abs(aoScore - p.value) < 0.05
                      ? 'border-ao bg-ao text-white shadow-md'
                      : 'border-ink-800 bg-ink-900/80 text-ink-300 hover:bg-ink-850',
                  )}
                >
                  <div>{p.label}</div>
                  <div className="text-[9px] font-normal opacity-80">{p.text}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Verdict Banner & Submission */}
          <div className="mt-auto rounded-2xl border border-ink-700 bg-ink-900 p-4 shadow-xl text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-ink-400">
              Judge #{judgeNo} Verdict
            </div>
            <div className="mt-1.5 text-base font-extrabold flex items-center justify-center gap-2">
              {calculatedWinner === 'AKA' ? (
                <span className="text-aka flex items-center gap-1">
                  <span>🔴 AKA Leads</span>
                  <span className="text-xs font-mono text-ink-300">
                    ({akaScore.toFixed(1)} vs {aoScore.toFixed(1)})
                  </span>
                </span>
              ) : calculatedWinner === 'AO' ? (
                <span className="text-ao flex items-center gap-1">
                  <span>🔵 AO Leads</span>
                  <span className="text-xs font-mono text-ink-300">
                    ({aoScore.toFixed(1)} vs {akaScore.toFixed(1)})
                  </span>
                </span>
              ) : (
                <span className="text-gold">
                  Tie ({akaScore.toFixed(1)} = {aoScore.toFixed(1)}) · Choose winner below
                </span>
              )}
            </div>

            {/* Submit Button */}
            {calculatedWinner !== 'TIE' ? (
              <button
                disabled={submitting || !activeMatch}
                onClick={() => submitVote(calculatedWinner, { aka: akaScore, ao: aoScore })}
                className={cn(
                  'mt-3.5 w-full rounded-xl py-4 font-black uppercase tracking-wider text-white shadow-lg transition-all active:scale-[0.98]',
                  calculatedWinner === 'AKA'
                    ? 'bg-aka hover:bg-aka/90 shadow-aka/30'
                    : 'bg-ao hover:bg-ao/90 shadow-ao/30',
                )}
              >
                {submitting
                  ? 'Submitting...'
                  : votedSide === calculatedWinner
                  ? `✓ Vote Recorded for ${calculatedWinner}`
                  : `Submit ${calculatedWinner} Vote (${akaScore.toFixed(1)} to ${aoScore.toFixed(1)})`}
              </button>
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  disabled={submitting || !activeMatch}
                  onClick={() => submitVote('AKA', { aka: akaScore, ao: aoScore })}
                  className="flex-1 rounded-xl bg-aka py-3.5 font-black uppercase text-white shadow-md active:scale-98"
                >
                  Vote AKA (Red)
                </button>
                <button
                  disabled={submitting || !activeMatch}
                  onClick={() => submitVote('AO', { aka: akaScore, ao: aoScore })}
                  className="flex-1 rounded-xl bg-ao py-3.5 font-black uppercase text-white shadow-md active:scale-98"
                >
                  Vote AO (Blue)
                </button>
              </div>
            )}
          </div>
        </main>
      ) : (
        /* Direct Flag Voting Pad */
        <main className="flex-1 grid grid-rows-2 gap-3 p-4">
          {/* AKA (Red) Flag Pad */}
          <button
            type="button"
            disabled={submitting || !activeMatch}
            onClick={() => submitVote('AKA')}
            className={cn(
              'group relative flex flex-col justify-between rounded-2xl border-4 p-6 transition-all active:scale-[0.98]',
              votedSide === 'AKA'
                ? 'border-white bg-aka shadow-[0_0_30px_rgba(239,68,68,0.6)] ring-4 ring-aka/50'
                : 'border-aka bg-aka/90 hover:bg-aka active:bg-aka-deep',
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className="rounded bg-black/40 px-3 py-1 text-base font-black tracking-widest text-white backdrop-blur-sm">
                AKA · RED
              </span>
              {votedSide === 'AKA' && (
                <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-aka shadow">
                  <CheckCircle size={16} />
                  YOUR VOTE
                </span>
              )}
            </div>

            <div className="my-auto text-center">
              <span className="text-3xl sm:text-4xl font-black uppercase tracking-wider text-white drop-shadow-md">
                {activeMatch?.aka.displayName || 'AKA ATHLETE'}
              </span>
            </div>

            <div className="w-full text-center">
              <span className="text-xs font-semibold uppercase tracking-widest text-white/80">
                Tap to cast Red Flag
              </span>
            </div>
          </button>

          {/* AO (Blue) Flag Pad */}
          <button
            type="button"
            disabled={submitting || !activeMatch}
            onClick={() => submitVote('AO')}
            className={cn(
              'group relative flex flex-col justify-between rounded-2xl border-4 p-6 transition-all active:scale-[0.98]',
              votedSide === 'AO'
                ? 'border-white bg-ao shadow-[0_0_30px_rgba(59,130,246,0.6)] ring-4 ring-ao/50'
                : 'border-ao bg-ao/90 hover:bg-ao active:bg-ao-deep',
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className="rounded bg-black/40 px-3 py-1 text-base font-black tracking-widest text-white backdrop-blur-sm">
                AO · BLUE
              </span>
              {votedSide === 'AO' && (
                <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-ao shadow">
                  <CheckCircle size={16} />
                  YOUR VOTE
                </span>
              )}
            </div>

            <div className="my-auto text-center">
              <span className="text-3xl sm:text-4xl font-black uppercase tracking-wider text-white drop-shadow-md">
                {activeMatch?.ao.displayName || 'AO ATHLETE'}
              </span>
            </div>

            <div className="w-full text-center">
              <span className="text-xs font-semibold uppercase tracking-widest text-white/80">
                Tap to cast Blue Flag
              </span>
            </div>
          </button>
        </main>
      )}

      {/* Footer Info */}
      <footer className="mt-4 px-4 text-center text-xs text-ink-400">
        WKF Kata Competition Rules 2026 · Scale 5.0 to 10.0 (Art. 5.4)
      </footer>
    </div>
  );
}
