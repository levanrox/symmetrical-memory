"use client";

/**
 * Judge scoring screen (P4): `/j/score` — the money screen.
 *
 * Auth: the httpOnly `judge_session` cookie (set by /api/judge/status on
 * approval). All data flows through cookie-authenticated /api/judge/bout
 * and /api/judge/scores.
 *
 * Update strategy — realtime first, polling as backstop (flaky 4G):
 *   - useLiveEvents with the ring scope triggers an immediate refetch on
 *     any ring-scoped broadcast (new active bout, confirm, incoming marks).
 *   - A modest poll keeps the screen correct when the stream is down:
 *     8s while waiting, 12s during a live bout, 5s on the result flash.
 *   - Refetch on tab re-focus too (phone locked mid-bout).
 *
 * Score entry pattern: giant − / + steppers (0.1) around a huge readout,
 * plus whole-number quick-set buttons (5-10). A judge at the tatami edge
 * scores in seconds: tap 7, tap + three times, tap SAVE. Drafts are plain
 * state; submits carry a per-(bout, side) idempotency key so retries on a
 * flaky network can never double-submit. Submitted marks stay editable
 * until the bout is confirmed (the P3 upsert corrects them).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import {
  QUICK_SET_TENTHS,
  formatTenths,
  generateIdempotencyKey,
  keyForSubmit,
  stepTenths,
  tenthsToPoints,
} from "@/lib/judge/scoreEntry";

// ---------------------------------------------------------------------------
// Types (mirror /api/judge/bout responses)
// ---------------------------------------------------------------------------

interface SideInfo {
  name: string;
  kataNumber: number | null;
  kataName: string | null;
}

interface LiveBout {
  matchId: string;
  ringId: string;
  ringName: string;
  aka: SideInfo;
  ao: SideInfo;
  myScores: { aka: number | null; ao: number | null };
  /** M4: side disqualified by the moderator — marks for it count as 0.0. */
  disqualifiedSide: "AKA" | "AO" | null;
}

interface ConfirmedBout {
  matchId: string;
  ringId: string;
  ringName: string;
  aka: { name: string };
  ao: { name: string };
  winnerSide: "AKA" | "AO" | null;
  akaVotes: number | null;
  aoVotes: number | null;
  disqualifiedSide: "AKA" | "AO" | null;
}

type Screen =
  | { kind: "boot" }
  | { kind: "unauthorized" }
  | { kind: "waiting" }
  | { kind: "live"; bout: LiveBout }
  | { kind: "confirmed"; result: ConfirmedBout; settled: boolean };

type SubmitPhase = "idle" | "sending" | "saved" | "error";

interface SideEntry {
  draft: number | null; // integer tenths
  idempotencyKey: string;
  /** Draft value the server last acknowledged (null = nothing saved yet). */
  savedTenths: number | null;
  /** True when the server answered { duplicate: true } for the last submit. */
  duplicate: boolean;
  phase: SubmitPhase;
  error: string | null;
}

const POLL_WAITING_MS = 8000;
const POLL_LIVE_MS = 12000;
const POLL_CONFIRMED_MS = 5000;
const RESULT_SETTLE_MS = 20000;

function freshEntry(): SideEntry {
  return {
    draft: null,
    idempotencyKey: generateIdempotencyKey(),
    savedTenths: null,
    duplicate: false,
    phase: "idle",
    error: null,
  };
}

function pointsToTenths(points: number | null): number | null {
  return points == null ? null : Math.round(points * 10);
}

// ---------------------------------------------------------------------------
// Score card for one side
// ---------------------------------------------------------------------------

function ScoreCard({
  side,
  accent,
  athleteName,
  kataNumber,
  kataName,
  entry,
  onDraft,
  onClear,
  onSubmit,
}: {
  side: "AKA" | "AO";
  accent: { band: string; ring: string };
  athleteName: string;
  kataNumber: number | null;
  kataName: string | null;
  entry: SideEntry;
  onDraft: (tenths: number | null) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const hasDraft = entry.draft != null;
  return (
    <section
      aria-label={`${side} scoring`}
      className="rounded-3xl bg-white text-neutral-950 shadow-2xl overflow-hidden"
    >
      <div className={`${accent.band} px-5 py-4 text-white`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-3xl font-black tracking-wide">{side}</span>
          <span className="text-xl font-bold truncate">{athleteName}</span>
        </div>
        <p className="mt-1 text-white/85 font-medium">
          {kataNumber != null ? (
            <>
              Kata #{kataNumber}
              {kataName ? ` · ${kataName}` : ""}
            </>
          ) : (
            "Kata to be announced"
          )}
        </p>
      </div>

      <div className="px-5 py-5">
        {/* Stepper row: giant touch targets */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label={`Decrease ${side} score`}
            onClick={() => onDraft(stepTenths(entry.draft, -1))}
            className="h-20 w-20 shrink-0 rounded-2xl bg-neutral-950 text-white text-5xl font-black active:scale-95 transition-transform touch-manipulation"
          >
            −
          </button>
          <div
            className="flex-1 text-center text-7xl font-black tabular-nums"
            aria-live="polite"
            aria-label={`${side} score ${formatTenths(entry.draft)}`}
          >
            {formatTenths(entry.draft)}
          </div>
          <button
            type="button"
            aria-label={`Increase ${side} score`}
            onClick={() => onDraft(stepTenths(entry.draft, 1))}
            className="h-20 w-20 shrink-0 rounded-2xl bg-neutral-950 text-white text-5xl font-black active:scale-95 transition-transform touch-manipulation"
          >
            +
          </button>
        </div>

        {/* Quick-set whole numbers */}
        <div className="mt-4 grid grid-cols-6 gap-2" role="group" aria-label={`${side} quick scores`}>
          {QUICK_SET_TENTHS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onDraft(t)}
              aria-pressed={entry.draft === t}
              className={`h-14 rounded-xl text-xl font-extrabold tabular-nums active:scale-95 transition-transform touch-manipulation ${
                entry.draft === t
                  ? `${accent.ring} ring-4 bg-neutral-950 text-white`
                  : "bg-neutral-100 text-neutral-800"
              }`}
            >
              {t / 10}
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-sm text-neutral-500 font-medium">
          Valid range 5.0 – 10.0
        </p>

        {/* Actions */}
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasDraft || entry.phase === "sending"}
            className="h-16 px-6 rounded-2xl border-2 border-neutral-300 text-lg font-bold text-neutral-600 disabled:opacity-30 active:scale-[0.98] transition-transform touch-manipulation"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!hasDraft || entry.phase === "sending"}
            className={`flex-1 h-16 rounded-2xl text-2xl font-extrabold text-white disabled:opacity-40 active:scale-[0.98] transition-transform touch-manipulation ${accent.band}`}
          >
            {entry.phase === "sending"
              ? "SENDING…"
              : entry.phase === "saved"
                ? "SAVED ✓ — TAP TO CHANGE"
                : `SAVE ${side}`}
          </button>
        </div>

        <div aria-live="polite" className="mt-2 min-h-6 text-center">
          {entry.phase === "saved" && (
            <p className="text-emerald-700 font-bold">
              {entry.duplicate
                ? "Already recorded — no change was made."
                : "Saved ✓ — you can still change it until the bout is confirmed."}
            </p>
          )}
          {entry.phase === "error" && (
            <p className="text-red-700 font-bold">
              {entry.error ?? "Could not save."}{" "}
              <button
                type="button"
                onClick={onSubmit}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function ScoreClient() {
  const [screen, setScreen] = useState<Screen>({ kind: "boot" });
  const [aka, setAka] = useState<SideEntry>(freshEntry);
  const [ao, setAo] = useState<SideEntry>(freshEntry);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  // Last known ring identity, kept across noLiveBout gaps for the realtime
  // scope and the waiting screen.
  const ringRef = useRef<{ ringId: string; ringName: string } | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const savedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    try {
      setJoinCode(sessionStorage.getItem("ringflow:judgeCode"));
    } catch {
      /* ignore */
    }
    const timers = savedTimers.current;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  const applyBoutPayload = useCallback((body: Record<string, unknown>) => {
    if (body.boutState === "live") {
      const bout = body as unknown as LiveBout;
      ringRef.current = { ringId: bout.ringId, ringName: bout.ringName };
      const prev = screenRef.current;
      const sameBout =
        prev.kind === "live" && prev.bout.matchId === bout.matchId;
      setScreen({ kind: "live", bout });
      if (!sameBout) {
        // New bout: fresh drafts (pre-filled from any marks already saved
        // from another device) and fresh idempotency keys.
        setAka({
          ...freshEntry(),
          draft: pointsToTenths(bout.myScores.aka),
        });
        setAo({
          ...freshEntry(),
          draft: pointsToTenths(bout.myScores.ao),
        });
      }
      return;
    }
    if (body.boutState === "confirmed") {
      const result = body as unknown as ConfirmedBout;
      ringRef.current = { ringId: result.ringId, ringName: result.ringName };
      const prev = screenRef.current;
      const sameResult =
        prev.kind === "confirmed" && prev.result.matchId === result.matchId;
      if (!sameResult) setScreen({ kind: "confirmed", result, settled: false });
      return;
    }
    // { noLiveBout: true } — keep the realtime scope on the last ring.
    const prev = screenRef.current;
    if (prev.kind === "confirmed" && prev.settled) return; // already settled
    if (prev.kind !== "waiting") setScreen({ kind: "waiting" });
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/judge/bout", { cache: "no-store" });
      if (res.status === 401) {
        setScreen({ kind: "unauthorized" });
        return;
      }
      if (!res.ok) return; // transient: keep current screen, polling retries
      const body = (await res.json()) as Record<string, unknown>;
      applyBoutPayload(body);
    } catch {
      /* flaky network: keep current screen, polling retries */
    }
  }, [applyBoutPayload]);

  // Initial load.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime: immediate refetch on ring-scoped broadcasts.
  const ringId = ringRef.current?.ringId ?? null;
  const { connected } = useLiveEvents(
    { ringId },
    () => {
      void refetch();
    },
    { enabled: ringId != null, debounceMs: 400 }
  );
  // NOTE: ringRef updates don't re-render, so the hook's `enabled` flips on
  // the next render after a bout payload arrives — polling covers the gap.

  // Polling backstop + tab refocus (phone locked mid-bout).
  useEffect(() => {
    const kind = screen.kind;
    const interval =
      kind === "waiting"
        ? POLL_WAITING_MS
        : kind === "live"
          ? POLL_LIVE_MS
          : kind === "confirmed"
            ? POLL_CONFIRMED_MS
            : null;
    if (interval == null) return;
    const timer = setInterval(() => void refetch(), interval);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [screen.kind, refetch]);

  // Result flash settles into "waiting" after a while; polls keep running.
  useEffect(() => {
    if (screen.kind !== "confirmed" || screen.settled) return;
    const timer = setTimeout(() => {
      setScreen((s) =>
        s.kind === "confirmed" ? { ...s, settled: true } : s
      );
    }, RESULT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [screen]);

  const submitSide = useCallback(
    (side: "AKA" | "AO") => {
      const current = screenRef.current;
      if (current.kind !== "live") return;
      const setEntry = side === "AKA" ? setAka : setAo;
      const entry = side === "AKA" ? aka : ao;
      if (entry.draft == null || entry.phase === "sending") return;
      const draft = entry.draft;
      // Idempotency contract with POST /api/judge/scores: a repeated key is
      // answered { duplicate: true } WITHOUT touching the stored mark. So
      // the key is rotated whenever the draft changed since the last save
      // (a correction must upsert), and kept stable across retries of the
      // same value (that's what the key is for). See keyForSubmit.
      const { key: idempotencyKey, rotated } = keyForSubmit(
        { key: entry.idempotencyKey, savedTenths: entry.savedTenths },
        draft
      );
      setEntry({
        ...entry,
        phase: "sending",
        error: null,
        duplicate: false,
        // A rotated key becomes the entry's key so a retry of THIS submit
        // reuses it instead of minting yet another one.
        idempotencyKey: rotated ? idempotencyKey : entry.idempotencyKey,
      });
      (async () => {
        try {
          const res = await fetch("/api/judge/scores", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              matchId: current.bout.matchId,
              side,
              score: tenthsToPoints(draft),
              idempotencyKey,
            }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            duplicate?: boolean;
          };
          if (res.status === 401) {
            setScreen({ kind: "unauthorized" });
            return;
          }
          if (!res.ok) {
            throw new Error(body.error ?? "Could not save. Check your connection.");
          }
          // duplicate:true means the server saw this key before and changed
          // nothing — surface it honestly instead of claiming a fresh save.
          const wasDuplicate = body.duplicate === true;
          setEntry((e) => ({
            ...e,
            phase: "saved",
            error: null,
            duplicate: wasDuplicate,
            // Only a real write moves the saved watermark; a duplicate
            // answer leaves it where it was.
            savedTenths: wasDuplicate ? e.savedTenths : draft,
          }));
          const timer = setTimeout(() => {
            setEntry((e) =>
              e.phase === "saved" ? { ...e, phase: "idle" } : e
            );
          }, 2500);
          savedTimers.current.push(timer);
        } catch (err) {
          setEntry((e) => ({
            ...e,
            phase: "error",
            error: err instanceof Error ? err.message : "Could not save.",
          }));
        }
      })();
    },
    [aka, ao]
  );

  const shell = (children: React.ReactNode) => (
    <main className="min-h-dvh bg-neutral-950 text-white flex flex-col">
      <div className="flex-1 w-full max-w-md mx-auto px-4 py-6 flex flex-col gap-5 justify-center">
        {children}
      </div>
      <footer className="px-4 pb-6 text-center text-xs text-white/30">
        {connected ? "Live updates on" : "Reconnecting…"} ·{" "}
        {ringRef.current?.ringName ?? ""}
      </footer>
    </main>
  );

  if (screen.kind === "boot") {
    return shell(
      <p className="text-center text-xl text-white/60" role="status">
        Loading…
      </p>
    );
  }

  if (screen.kind === "unauthorized") {
    return shell(
      <div className="text-center">
        <p className="text-2xl font-bold">Session ended</p>
        <p className="mt-2 text-white/60 text-lg">
          Please join again with the tatami QR code.
        </p>
        {joinCode && (
          <a
            href={`/j/${encodeURIComponent(joinCode)}`}
            className="mt-6 inline-flex items-center justify-center h-16 px-10 rounded-2xl bg-amber-400 text-neutral-950 text-xl font-extrabold"
          >
            Join again
          </a>
        )}
      </div>
    );
  }

  if (screen.kind === "waiting") {
    return shell(
      <div className="text-center" role="status">
        <div
          className="mx-auto mb-6 h-14 w-14 rounded-full border-4 border-white/15 border-t-amber-300 animate-spin"
          aria-hidden
        />
        <p className="text-3xl font-black">Next bout starting soon…</p>
        <p className="mt-3 text-lg text-white/60">
          The scoring cards appear here automatically.
        </p>
      </div>
    );
  }

  if (screen.kind === "confirmed") {
    const r = screen.result;
    if (screen.settled) {
      return shell(
        <div className="text-center" role="status">
          <p className="text-2xl font-bold text-white/80">
            Waiting for the next bout…
          </p>
          <p className="mt-2 text-white/50">
            The scoring cards appear here automatically.
          </p>
        </div>
      );
    }
    const winnerName =
      r.winnerSide === "AKA" ? r.aka.name : r.winnerSide === "AO" ? r.ao.name : null;
    const scoreLine =
      r.akaVotes != null && r.aoVotes != null
        ? `${r.akaVotes} – ${r.aoVotes}`
        : null;
    return shell(
      <div
        className="rounded-3xl bg-white text-neutral-950 p-8 text-center shadow-2xl"
        role="status"
      >
        <p className="text-sm font-bold tracking-[0.25em] text-neutral-500 uppercase">
          Bout result
        </p>
        <p
          className={`mt-3 text-5xl font-black ${
            r.winnerSide === "AKA"
              ? "text-red-600"
              : r.winnerSide === "AO"
                ? "text-blue-700"
                : ""
          }`}
        >
          {winnerName ? `${winnerName} wins` : "Result confirmed"}
        </p>
        {scoreLine && (
          <p className="mt-2 text-3xl font-extrabold tabular-nums">
            {scoreLine}
          </p>
        )}
        {r.disqualifiedSide != null && (
          <p className="mt-2 text-sm font-black uppercase tracking-wide text-red-600">
            Win by disqualification
          </p>
        )}
        <p className="mt-4 text-neutral-500 font-medium">
          Next bout appears automatically…
        </p>
      </div>
    );
  }

  // Live bout.
  const bout = screen.bout;
  return (
    <main className="min-h-dvh bg-neutral-950 text-white flex flex-col">
      <header className="px-4 pt-5 pb-1 text-center">
        <p className="text-sm font-bold tracking-[0.25em] text-amber-300 uppercase">
          {bout.ringName} · Live
        </p>
      </header>
      <div className="flex-1 w-full max-w-md mx-auto px-4 py-4 flex flex-col gap-5">
        {/* M4: a disqualified side's marks count as 0.0 and the opponent
            wins — make it unmissable for the judges. */}
        {bout.disqualifiedSide != null && (
          <div role="alert" className="rounded-2xl border-2 border-red-500 bg-red-600/15 px-4 py-3 text-center">
            <p className="text-base font-black uppercase tracking-wide text-red-400">
              {bout.disqualifiedSide === "AKA" ? bout.aka.name : bout.ao.name} disqualified
            </p>
            <p className="mt-1 text-sm font-semibold text-red-200">
              {bout.disqualifiedSide === "AKA" ? bout.ao.name : bout.aka.name} wins by disqualification.
            </p>
          </div>
        )}
        <ScoreCard
          side="AKA"
          accent={{ band: "bg-red-600", ring: "ring-red-600" }}
          athleteName={bout.aka.name}
          kataNumber={bout.aka.kataNumber}
          kataName={bout.aka.kataName}
          entry={aka}
          onDraft={(draft) =>
            setAka((e) => ({ ...e, draft, phase: e.phase === "error" ? "idle" : e.phase, error: null }))
          }
          onClear={() =>
            setAka((e) => ({ ...e, draft: null, phase: "idle", error: null }))
          }
          onSubmit={() => submitSide("AKA")}
        />
        <ScoreCard
          side="AO"
          accent={{ band: "bg-blue-700", ring: "ring-blue-700" }}
          athleteName={bout.ao.name}
          kataNumber={bout.ao.kataNumber}
          kataName={bout.ao.kataName}
          entry={ao}
          onDraft={(draft) =>
            setAo((e) => ({ ...e, draft, phase: e.phase === "error" ? "idle" : e.phase, error: null }))
          }
          onClear={() =>
            setAo((e) => ({ ...e, draft: null, phase: "idle", error: null }))
          }
          onSubmit={() => submitSide("AO")}
        />
      </div>
      <footer className="px-4 pb-6 text-center text-xs text-white/30">
        {connected ? "Live updates on" : "Reconnecting…"} · marks save per side
      </footer>
    </main>
  );
}
