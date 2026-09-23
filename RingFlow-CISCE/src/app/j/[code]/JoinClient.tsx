"use client";

/**
 * Judge join screen (P4): `/j/<code>`.
 *
 * Mobile-first, no login, no app install. Flow:
 *   1. Verify the code via /api/judge/code-info and show the TATAMI NAME huge
 *      (a mis-scanned QR must be obvious at a glance).
 *   2. Judge enters a display name (1-40 chars) and taps JOIN.
 *   3. "Waiting for approval" — polls /api/judge/status every ~3s with
 *      backoff on network failure (flaky 4G). On approval the status
 *      response sets the httpOnly session cookie, so we hard-navigate to
 *      /j/score and the scoring page is authenticated.
 *   4. Rejected/expired/invalid states offer "try again".
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Phase =
  | "checking"
  | "join"
  | "waiting"
  | "approved"
  | "rejected"
  | "expired"
  | "invalid";

interface CodeInfo {
  valid: boolean;
  ringName?: string;
  tournamentName?: string;
}

const POLL_MS = 3000;
const POLL_MAX_MS = 30000;

export function JoinClient({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [info, setInfo] = useState<CodeInfo | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingName, setWaitingName] = useState("");
  const pollDelay = useRef(POLL_MS);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  // 1. Verify the code before showing the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/judge/code-info?code=${encodeURIComponent(code)}`
        );
        const body = (await res.json()) as CodeInfo;
        if (cancelled || disposed.current) return;
        setInfo(body);
        setPhase(body.valid ? "join" : "invalid");
      } catch {
        if (cancelled || disposed.current) return;
        // Can't verify on a flaky network: let them try joining anyway —
        // the join endpoint re-validates the code server-side.
        setInfo({ valid: false });
        setPhase("join");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // 3. Approval polling with backoff on network failure.
  const pollStatus = useCallback(
    (requestId: string) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tick = async () => {
        if (disposed.current) return;
        try {
          const res = await fetch(
            `/api/judge/status?requestId=${encodeURIComponent(requestId)}`
          );
          const body = (await res.json()) as {
            approved?: boolean;
            status?: string;
          };
          if (disposed.current) return;
          pollDelay.current = POLL_MS; // success resets the backoff
          if (body.approved) {
            // The response set the httpOnly judge_session cookie; the
            // scoring page is now authenticated. Hard-navigate so the new
            // page loads with the cookie in place.
            try {
              sessionStorage.setItem("ringflow:judgeCode", code);
            } catch {
              /* storage unavailable — non-fatal */
            }
            setPhase("approved");
            window.location.replace("/j/score");
            return;
          }
          if (body.status === "rejected" || body.status === "revoked") {
            setPhase("rejected");
            return;
          }
          if (body.status === "expired" || body.status === "not_found") {
            setPhase("expired");
            return;
          }
          // Still pending (or an unexpected shape): keep waiting.
          timer = setTimeout(tick, POLL_MS);
        } catch {
          // Network failure (flaky 4G): back off, keep waiting.
          if (disposed.current) return;
          pollDelay.current = Math.min(pollDelay.current * 2, POLL_MAX_MS);
          timer = setTimeout(tick, pollDelay.current);
        }
      };
      void tick();
      return () => {
        if (timer) clearTimeout(timer);
      };
    },
    [code]
  );

  const startJoin = useCallback(
    async (displayName: string, requestId?: string) => {
      if (requestId) {
        setWaitingName(displayName);
        setPhase("waiting");
        return pollStatus(requestId);
      }
      setJoining(true);
      setError(null);
      try {
        const res = await fetch("/api/judge/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, name: displayName }),
        });
        const body = (await res.json()) as {
          requestId?: string;
          error?: string;
        };
        if (!res.ok || !body.requestId) {
          throw new Error(body.error ?? "Could not join. Please try again.");
        }
        if (disposed.current) return undefined;
        setWaitingName(displayName);
        setPhase("waiting");
        return pollStatus(body.requestId);
      } catch (err) {
        if (!disposed.current) {
          setError(
            err instanceof Error ? err.message : "Could not join. Please try again."
          );
        }
        return undefined;
      } finally {
        if (!disposed.current) setJoining(false);
      }
    },
    [code, pollStatus]
  );

  // Polling lifecycle for the waiting phase.
  const stopPolling = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (phase !== "waiting") return;
    return () => {
      stopPolling.current?.();
      stopPolling.current = undefined;
    };
  }, [phase]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = name.trim();
    if (!displayName || joining) return;
    stopPolling.current?.();
    void startJoin(displayName).then((stop) => {
      stopPolling.current = stop;
    });
  };

  const ringName = info?.valid ? (info.ringName ?? "TATAMI") : null;
  const tournamentName = info?.valid ? info.tournamentName : null;

  return (
    <main className="min-h-dvh bg-neutral-950 text-white flex flex-col">
      {/* Hero: tatami name huge — a mis-scan must be obvious. */}
      <header className="px-5 pt-10 pb-6 text-center border-b border-white/10">
        <p className="text-sm font-semibold tracking-[0.25em] text-amber-300 uppercase">
          {phase === "invalid" ? "Judge join" : "Judge scoring"}
        </p>
        <h1 className="mt-2 text-6xl font-black tracking-tight leading-none">
          {phase === "checking"
            ? "…"
            : phase === "invalid"
              ? "Invalid code"
              : (ringName ?? "Tatami").toUpperCase()}
        </h1>
        {tournamentName && (
          <p className="mt-3 text-lg text-white/70 font-medium">
            {tournamentName}
          </p>
        )}
      </header>

      <div className="flex-1 flex flex-col justify-center px-5 py-8 w-full max-w-md mx-auto">
        {phase === "checking" && (
          <p className="text-center text-white/60 text-lg" role="status">
            Checking your code…
          </p>
        )}

        {phase === "invalid" && (
          <div className="text-center">
            <p className="text-xl text-white/80">
              This judge code isn&apos;t valid or has expired.
            </p>
            <p className="mt-2 text-white/50">
              Please scan the QR code on your tatami again.
            </p>
          </div>
        )}

        {(phase === "join" || phase === "rejected" || phase === "expired") && (
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            {phase === "rejected" && (
              <div
                role="alert"
                className="rounded-2xl bg-red-950 border border-red-500/40 p-4 text-center"
              >
                <p className="text-lg font-bold text-red-200">
                  Your request was declined.
                </p>
                <p className="text-white/60 mt-1">
                  Please check with the moderator, then try again.
                </p>
              </div>
            )}
            {phase === "expired" && (
              <div
                role="alert"
                className="rounded-2xl bg-amber-950 border border-amber-500/40 p-4 text-center"
              >
                <p className="text-lg font-bold text-amber-200">
                  Your request expired.
                </p>
                <p className="text-white/60 mt-1">Please join again below.</p>
              </div>
            )}
            <div>
              <label
                htmlFor="judge-name"
                className="block text-lg font-semibold text-white/80 mb-2"
              >
                Your name
              </label>
              <input
                id="judge-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="words"
                placeholder="e.g. Priya Sharma"
                className="w-full h-16 rounded-2xl bg-white/10 border border-white/20 px-5 text-[16px] text-white placeholder:text-white/30 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/40"
              />
              <p className="mt-2 text-sm text-white/40">
                Shown to the moderator for approval. 1–40 characters.
              </p>
            </div>
            {error && (
              <p role="alert" className="text-red-300 font-medium">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={joining || name.trim().length === 0}
              className="h-16 rounded-2xl bg-amber-400 text-neutral-950 text-2xl font-extrabold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
            >
              {joining ? "JOINING…" : "JOIN"}
            </button>
          </form>
        )}

        {phase === "waiting" && (
          <div className="text-center" role="status">
            <div
              className="mx-auto mb-6 h-14 w-14 rounded-full border-4 border-white/15 border-t-amber-300 animate-spin"
              aria-hidden
            />
            <p className="text-2xl font-bold">Waiting for approval</p>
            <p className="mt-2 text-lg text-white/60">
              <span className="text-white font-semibold">{waitingName}</span>
              {" — "}show this screen to the moderator at{" "}
              <span className="text-white font-semibold">
                {(ringName ?? "your tatami").toUpperCase()}
              </span>
              .
            </p>
            <p className="mt-4 text-sm text-white/40">
              This screen updates automatically once approved.
            </p>
          </div>
        )}

        {phase === "approved" && (
          <p className="text-center text-xl text-white/70" role="status">
            Approved — loading the scoring screen…
          </p>
        )}
      </div>

      <footer className="px-5 pb-8 text-center text-xs text-white/30">
        Works offline on venue WiFi · no app install needed
      </footer>
    </main>
  );
}
