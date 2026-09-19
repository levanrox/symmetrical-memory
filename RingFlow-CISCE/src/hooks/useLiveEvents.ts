"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Subscribe to the server's change feed (`/api/live`).
 *
 * `onChange` fires at most once per debounce window, so a burst of writes (a
 * score save followed by a ring update) costs one refetch rather than five.
 * `connected` lets a screen keep its polling as a fallback when the stream is
 * down; nothing here throws, and a failure just means "poll like before".
 */

export interface LiveScope {
  tournamentId?: string | null;
  ringId?: string | null;
  categoryId?: string | null;
  requestId?: string | null;
}

export function useLiveEvents(
  scope: LiveScope,
  onChange: () => void,
  options?: { enabled?: boolean; debounceMs?: number }
): { connected: boolean } {
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? 150;

  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const key = [scope.tournamentId ?? "", scope.ringId ?? "", scope.categoryId ?? "", scope.requestId ?? ""].join("|");
  const hasScope = Boolean(scope.tournamentId || scope.ringId || scope.categoryId || scope.requestId);

  useEffect(() => {
    if (!enabled || !hasScope || typeof window === "undefined") return;

    const params = new URLSearchParams();
    if (scope.ringId) params.set("ringId", scope.ringId);
    else if (scope.requestId) params.set("requestId", scope.requestId);
    else if (scope.categoryId) params.set("categoryId", scope.categoryId);
    else if (scope.tournamentId) params.set("tournamentId", scope.tournamentId);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const source = new EventSource(`/api/live?${params.toString()}`);

    const fire = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        onChangeRef.current();
      }, debounceMs);
    };

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("ready", () => setConnected(true));
    // A reconnected stream may have missed changes while it was down.
    source.addEventListener("change", fire);
    source.addEventListener("error", () => {
      setConnected(false);
      if (debounceTimer) clearTimeout(debounceTimer);
      // EventSource reconnects on its own; polling covers the gap meanwhile.
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      source.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, hasScope, debounceMs]);

  return { connected };
}
