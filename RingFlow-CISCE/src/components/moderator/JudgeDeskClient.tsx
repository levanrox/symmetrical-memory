"use client";

/**
 * JudgeDeskClient (P5) — the per-tatami judge desk.
 *
 * One screen for everything judge-related on this tatami:
 *   1. Pending approvals — name + 1-tap Approve/Reject (the moderator's most
 *      time-critical judge action during a bout).
 *   2. Join QR card — large, printable (prints only the card), with manual
 *      code and a two-step regenerate.
 *   3. Seated judges — seat #, name, per-side submitted status, revoke.
 *
 * Payloads come from `getRingJudgeState`, which selects explicit fields —
 * judge session tokens never leave the DB (C1). The desk refetches live:
 * join-code, request and score broadcasts all carry this ring's id.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  approveJudgeRequest,
  generateJoinCode,
  getRingJudgeState,
  regenerateJoinCode,
  rejectJudgeRequest,
  revokeJudgeSeat,
} from "@/actions/judge";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import JudgeQrCard from "@/components/moderator/JudgeQrCard";

type JudgeState = Awaited<ReturnType<typeof getRingJudgeState>>;

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function JudgeDeskClient({ ringId }: { ringId: string }) {
  const [state, setState] = useState<JudgeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const refresh = useCallback(async () => {
    try {
      setState(await getRingJudgeState(ringId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the judge desk.");
    }
  }, [ringId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveEvents(
    { ringId },
    () => {
      void refresh();
    },
    { debounceMs: 500 }
  );

  const runAction = async (id: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    try {
      await fn();
      showToast(okMsg);
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleRegenerate = async () => {
    if (!confirmRegen) {
      setConfirmRegen(true);
      return;
    }
    setConfirmRegen(false);
    await runAction("regen", () => regenerateJoinCode(ringId), "New join code issued.");
  };

  const handleCopyLink = async () => {
    const url = state?.joinCode?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Join link copied.");
    } catch {
      showToast("Could not copy the link.", "error");
    }
  };

  const tatamiLabel = (state?.ring.name ?? "Tatami").replace(/Ring/i, "Tatami");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 lg:max-w-4xl">
      {toast && (
        <div
          className={`fixed top-20 left-1/2 z-50 flex max-w-sm -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg animate-fadeIn ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {toast.type === "success" ? "check_circle" : "error"}
          </span>
          {toast.message}
        </div>
      )}

      <div className="mb-2">
        <h1 className="text-xl font-black tracking-tight text-primary sm:text-2xl">
          Judge desk
        </h1>
        <p className="text-xs text-on-surface-variant sm:text-sm">
          {tatamiLabel} · judge join codes, approvals &amp; seats
        </p>
      </div>

      {loadError && (
        <p className="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm font-semibold text-error">
          {loadError}
        </p>
      )}

      {!state ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-container" />
          ))}
        </div>
      ) : (
        <>
          {/* Pending approvals — the time-critical list */}
          <section
            aria-label="Pending judge approvals"
            className={`overflow-hidden rounded-2xl border shadow-sm ${
              state.pending.length > 0
                ? "border-amber-300 bg-amber-50/60"
                : "border-outline-variant bg-surface-container-lowest"
            }`}
          >
            <div className="flex min-h-[52px] items-center gap-2 px-4">
              <span className="material-symbols-outlined text-[20px] text-amber-600">
                person_add
              </span>
              <h2 className="text-sm font-extrabold text-on-surface">
                Pending approvals
                {state.pending.length > 0 && (
                  <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-black text-white">
                    {state.pending.length}
                  </span>
                )}
              </h2>
            </div>
            {state.pending.length === 0 ? (
              <p className="border-t border-outline-variant px-4 py-4 text-sm text-on-surface-variant">
                No judges waiting. When a judge scans the QR code, they appear here
                for approval.
              </p>
            ) : (
              <ul className="border-t border-amber-200/60">
                {state.pending.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 border-b border-amber-200/60 px-4 py-3 last:border-b-0"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-black text-amber-800">
                      {p.judgeName.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-extrabold text-on-surface">
                        {p.judgeName}
                      </span>
                      <span className="text-xs text-on-surface-variant">
                        requested {timeAgo(p.createdAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() =>
                        runAction(p.id, () => rejectJudgeRequest(p.id, ringId), "Request rejected.")
                      }
                      className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-error/40 px-4 text-sm font-black text-error transition-colors hover:bg-error/10 disabled:opacity-50 cursor-pointer active:scale-95"
                    >
                      {busyId === p.id ? (
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-error border-t-transparent" />
                      ) : (
                        "Reject"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() =>
                        runAction(
                          p.id,
                          () => approveJudgeRequest(p.id, ringId),
                          "Judge approved — seat assigned."
                        )
                      }
                      className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 cursor-pointer active:scale-95"
                    >
                      <span className="material-symbols-outlined text-[20px]">check</span>
                      Approve
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Join QR card */}
          <section aria-label="Judge join code" className="space-y-3">
            {state.joinCode ? (
              <>
                <JudgeQrCard
                  eventName={state.tournament?.name ?? "RingFlow Tournament"}
                  tatamiLabel={tatamiLabel}
                  joinUrl={state.joinCode.url}
                  joinCode={state.joinCode.code}
                  expiresAt={state.joinCode.expiresAt}
                />
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-xs font-black uppercase tracking-wide text-on-surface transition-colors hover:bg-surface-container-low cursor-pointer active:scale-[0.98]"
                  >
                    <span className="material-symbols-outlined text-[20px]">print</span>
                    Print
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-xs font-black uppercase tracking-wide text-on-surface transition-colors hover:bg-surface-container-low cursor-pointer active:scale-[0.98]"
                  >
                    <span className="material-symbols-outlined text-[20px]">link</span>
                    Copy link
                  </button>
                  <button
                    type="button"
                    disabled={busyId === "regen"}
                    onClick={handleRegenerate}
                    onBlur={() => setConfirmRegen(false)}
                    className={`flex min-h-[52px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-black uppercase tracking-wide transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50 ${
                      confirmRegen
                        ? "border-error bg-error text-white"
                        : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low"
                    }`}
                  >
                    {busyId === "regen" ? (
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <span className="material-symbols-outlined text-[20px]">refresh</span>
                    )}
                    {confirmRegen ? "Tap to confirm" : "New code"}
                  </button>
                </div>
                {confirmRegen && (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    Regenerating revokes the current code immediately — judges who
                    haven&apos;t joined yet will need the new one.
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 text-center shadow-sm">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant">qr_code_2</span>
                <p className="mt-2 text-sm font-bold text-on-surface">
                  No active join code for this tatami.
                </p>
                <button
                  type="button"
                  disabled={busyId === "gen"}
                  onClick={() =>
                    runAction("gen", () => generateJoinCode(ringId), "Join code issued.")
                  }
                  className="mx-auto mt-3 flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-secondary px-6 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                >
                  {busyId === "gen" ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <span className="material-symbols-outlined text-[20px]">add</span>
                  )}
                  Generate join code
                </button>
              </div>
            )}
          </section>

          {/* Seated judges */}
          <section
            aria-label="Seated judges"
            className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm"
          >
            <div className="flex min-h-[52px] items-center gap-2 px-4">
              <span className="material-symbols-outlined text-[20px] text-secondary">event_seat</span>
              <h2 className="text-sm font-extrabold text-on-surface">
                Seated judges · panel of {state.panelSize}
              </h2>
            </div>
            <ul className="border-t border-outline-variant">
              {state.seats.map((s) => (
                <li
                  key={s.seatNumber}
                  className="flex min-h-[60px] items-center gap-3 border-b border-outline-variant px-4 py-2 last:border-b-0"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-sm font-black text-on-surface">
                    {s.seatNumber}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-on-surface">
                      {s.judgeName ?? "Empty seat"}
                    </span>
                    {s.judgeName && (
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] font-bold text-on-surface-variant">
                        <span className={s.submittedAka ? "text-emerald-600" : ""}>
                          AKA {s.submittedAka ? "✓" : "·"}
                        </span>
                        <span className={s.submittedAo ? "text-emerald-600" : ""}>
                          AO {s.submittedAo ? "✓" : "·"}
                        </span>
                      </span>
                    )}
                  </span>
                  {s.requestId &&
                    (confirmRevokeId === s.requestId ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(null)}
                          className="flex min-h-[48px] items-center rounded-xl border border-outline-variant px-3 text-xs font-bold text-on-surface cursor-pointer"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          disabled={busyId === s.requestId}
                          onClick={() =>
                            runAction(
                              s.requestId!,
                              () => revokeJudgeSeat(s.requestId!, ringId),
                              `Seat ${s.seatNumber} revoked.`
                            ).finally(() => setConfirmRevokeId(null))
                          }
                          className="flex min-h-[48px] items-center rounded-xl bg-error px-3 text-xs font-black text-white disabled:opacity-50 cursor-pointer"
                        >
                          Revoke
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(s.requestId!)}
                        className="flex min-h-[48px] shrink-0 items-center rounded-xl border border-outline-variant px-3 text-xs font-bold text-on-surface-variant transition-colors hover:border-error/40 hover:text-error cursor-pointer"
                      >
                        Revoke
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </section>

          <p className="px-1 text-center text-[11px] text-on-surface-variant">
            Scanning the QR only opens the join page — nothing is granted until
            the moderator approves the named seat.
          </p>
        </>
      )}
    </div>
  );
}
