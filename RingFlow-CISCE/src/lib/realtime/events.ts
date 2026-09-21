/**
 * Shared realtime event model.
 *
 * This module is intentionally client-safe (no Node-only imports) so both the
 * server-side broadcast pipeline and the browser hook can use it.
 *
 * A LiveEvent is a *notification*, not the data itself: it tells screens
 * "something changed in this scope — refetch what you show". Payloads carry
 * ids (plus a few cheap score fields for scoreboards) so events stay small and
 * never become the source of truth. PostgreSQL is authoritative; screens always
 * re-read through their existing server actions, which keep enforcing the
 * application's own authentication and authorization.
 *
 * Authenticity: every event the server broadcasts carries an Ed25519 `sig`
 * over the canonical payload (see `canonicalizeLiveEvent`). Browsers verify
 * the signature against the server's public key (fetched from
 * `/api/live-pubkey`) BEFORE scope matching, so a LAN attacker who can see —
 * or inject — broadcast traffic cannot forge score-change notifications.
 * Unsigned or badly-signed events are dropped silently.
 */

import { z } from "zod";
import { ed25519 } from "@noble/curves/ed25519.js";

export interface LiveEvent {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  id?: string;
  ringId?: string;
  tournamentId?: string;
  categoryId?: string;
  matchId?: string;
  akaScore?: number;
  aoScore?: number;
  akaPenalties?: number;
  aoPenalties?: number;
  senshu?: string | null;
  status?: string;
  data?: Record<string, unknown>;
  /** Hex Ed25519 signature over the canonical payload (everything but sig). */
  sig?: string;
}

/**
 * Strict envelope schema for anything arriving over the broadcast channel.
 * `.strict()` rejects unknown keys — a malformed or hostile payload never
 * reaches the scope matcher, so it can't trigger refetch storms on live
 * screens. (Note: the old `sessionToken` field was removed — session tokens
 * must never appear in a broadcast payload.)
 */
export const LiveEventSchema = z
  .object({
    table: z.string().min(1).max(64),
    op: z.enum(["INSERT", "UPDATE", "DELETE"]),
    id: z.string().max(128).optional(),
    ringId: z.string().max(128).optional(),
    tournamentId: z.string().max(128).optional(),
    categoryId: z.string().max(128).optional(),
    matchId: z.string().max(128).optional(),
    akaScore: z.number().int().optional(),
    aoScore: z.number().int().optional(),
    akaPenalties: z.number().int().optional(),
    aoPenalties: z.number().int().optional(),
    senshu: z.string().max(16).nullable().optional(),
    status: z.string().max(32).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    // 64-byte Ed25519 signature, hex-encoded. Optional in the envelope so
    // the parser stays liberal — the hook enforces presence + validity.
    sig: z
      .string()
      .regex(/^[0-9a-f]{128}$/i)
      .optional(),
  })
  .strict();

/** Parse an untrusted broadcast payload. Returns null when it is invalid. */
export function parseLiveEvent(payload: unknown): LiveEvent | null {
  const result = LiveEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}

/**
 * Canonical payload serialization for signing/verification. Keys sorted
 * recursively, `sig` excluded, so server and browser compute identical bytes.
 * Must stay in sync with the server-side signer.
 */
export function canonicalizeLiveEvent(event: LiveEvent): string {
  const { sig: _drop, ...rest } = event;
  void _drop;
  return stableStringify(rest as Record<string, unknown>);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Verify an event's Ed25519 signature against the server's public key
 * (hex, from `/api/live-pubkey`). Returns false for missing/invalid sigs —
 * callers should drop the event. Synchronous and client-safe.
 */
export function verifyLiveEventSignature(event: LiveEvent, publicKeyHex: string): boolean {
  if (!event.sig || !publicKeyHex) return false;
  try {
    const msg = new TextEncoder().encode(canonicalizeLiveEvent(event));
    return ed25519.verify(hexToBytes(event.sig), msg, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export interface LiveScope {
  ringId?: string | null;
  tournamentId?: string | null;
  categoryId?: string | null;
  requestId?: string | null;
}

/**
 * The single broadcast channel every live screen subscribes to. One channel
 * keeps the server publisher trivial; screens filter client-side with
 * `eventMatchesScope`, which preserves the exact delivery semantics the SSE
 * feed had. Event volume at tournament scale (tens of small messages per
 * second worst case) makes per-scope topics unnecessary.
 */
export const LIVE_CHANNEL_TOPIC = "ringflow:live";

/** True when an event is relevant to a screen that scoped itself to these ids. */
export function eventMatchesScope(event: LiveEvent, scope: LiveScope): boolean {
  if (scope.ringId) {
    if (event.ringId) return event.ringId === scope.ringId;
    return false;
  }
  if (scope.requestId) return event.id === scope.requestId;
  if (scope.categoryId) {
    if (event.categoryId) return event.categoryId === scope.categoryId;
    if (event.id && event.table === "categories") return event.id === scope.categoryId;
    return false;
  }
  if (scope.tournamentId) {
    if (event.tournamentId) return event.tournamentId === scope.tournamentId;
    // A tournament-wide screen also cares about general ring/category rows
    return true;
  }
  return true;
}
