"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { getBrowserRealtimeClient } from "@/lib/realtime/client";
import {
  eventMatchesScope,
  parseLiveEvent,
  verifyLiveEventSignature,
  LIVE_CHANNEL_TOPIC,
  type LiveEvent,
  type LiveScope,
} from "@/lib/realtime/events";

/**
 * Cached server public key for live-event signature verification. Fetched
 * once per page load from same-origin `/api/live-pubkey`.
 */
let cachedPublicKey: string | null | undefined;

async function getServerPublicKey(): Promise<string | null> {
  if (cachedPublicKey !== undefined) return cachedPublicKey;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch("/api/live-pubkey", { signal: controller.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { publicKey?: string };
      cachedPublicKey = typeof body.publicKey === "string" ? body.publicKey : null;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn("[realtime] could not fetch event public key; live events will be ignored.", err);
    cachedPublicKey = null;
  }
  return cachedPublicKey;
}

/**
 * Subscribe to the server's change feed over Supabase Realtime broadcast.
 *
 * `onChange` fires at most once per debounce window, so a burst of writes (a
 * score save followed by a ring update) costs one refetch rather than five.
 * `connected` lets a screen keep its polling as a fallback when the stream is
 * down; nothing here throws, and a failure just means "poll like before".
 *
 * Events are notifications only — the screen refetches through its existing
 * server actions, so a dropped connection degrades instead of freezing, and a
 * reconnect triggers a refetch to resynchronize with the current server state.
 */

export function useLiveEvents(
  scope: LiveScope,
  onChange: (event?: LiveEvent) => void,
  options?: { enabled?: boolean; debounceMs?: number }
): { connected: boolean } {
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? 0;

  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const key = [scope.tournamentId ?? "", scope.ringId ?? "", scope.categoryId ?? "", scope.requestId ?? ""].join("|");
  const hasScope = Boolean(scope.tournamentId || scope.ringId || scope.categoryId || scope.requestId);

  useEffect(() => {
    if (!enabled || !hasScope || typeof window === "undefined") return;

    const client = getBrowserRealtimeClient();
    if (!client) return; // Realtime not configured; polling fallback covers this.

    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    // Becomes true on the first successful subscribe, so a later re-subscribe
    // (after a drop) can trigger a resync refetch.
    let everSubscribed = false;

    const fire = (event?: LiveEvent) => {
      if (debounceMs <= 0) {
        onChangeRef.current(event);
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        onChangeRef.current(event);
      }, debounceMs);
    };

    channel = client.channel(LIVE_CHANNEL_TOPIC);
    // The server's public key, fetched once before subscribing. Events are
    // signature-verified BEFORE scope matching: a forged or tampered event
    // (e.g. injected by another LAN host) is dropped here and can never
    // trigger a refetch. Fail closed: without the key, events are ignored
    // and screens fall back to polling.
    const publicKeyPromise = getServerPublicKey();
    channel.on("broadcast", { event: "change" }, ({ payload }) => {
      if (disposed) return;
      // Strict envelope validation: a malformed or hostile payload is dropped
      // here so it can never trigger scope matching / refetch storms.
      const liveEvent = parseLiveEvent(payload);
      if (!liveEvent) return;
      void publicKeyPromise.then((publicKey) => {
        if (disposed) return;
        if (!publicKey || !verifyLiveEventSignature(liveEvent, publicKey)) return;
        if (!eventMatchesScope(liveEvent, scope)) return;
        fire(liveEvent);
      });
    });
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        setConnected(true);
        if (everSubscribed) {
          // We were connected before and lost it: events may have been missed
          // while down, so ask the screen to refetch its current state.
          fire();
        }
        everSubscribed = true;
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnected(false);
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        // Realtime reconnects on its own; polling covers the gap meanwhile.
      }
    });

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) void client.removeChannel(channel);
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, hasScope, debounceMs]);

  return { connected };
}
