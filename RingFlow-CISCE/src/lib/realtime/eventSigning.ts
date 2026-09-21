/**
 * Server-side live-event signing (Ed25519).
 *
 * Browsers verify each broadcast event's `sig` before scope matching, so a
 * LAN attacker who can observe or inject realtime traffic cannot forge
 * score-change notifications. HMAC won't work here — the verifier (browser)
 * must not hold the secret — so the server signs with a private key and
 * publishes the public key at `/api/live-pubkey`.
 *
 * The keypair is derived deterministically from SESSION_SECRET
 * (`SHA256("ringflow-live-event-v1:" || secret)` as the Ed25519 seed), so it
 * is stable across restarts with no key storage to manage. Rotating
 * SESSION_SECRET rotates the signing key (all clients refetch the public key
 * on their next page load / reconnect).
 *
 * Server-only: imports node:crypto and the session secret. Never import from
 * client components — browsers use `verifyLiveEventSignature` in events.ts.
 */
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getSessionSecret } from "@/lib/auth/sessionCookies";
import { canonicalizeLiveEvent, type LiveEvent } from "./events";

const SEED_CONTEXT = "ringflow-live-event-v1:";

function seed(): Uint8Array {
  return createHash("sha256").update(SEED_CONTEXT, "utf8").update(getSessionSecret(), "utf8").digest();
}

/** Hex-encoded Ed25519 public key served to browsers. */
export function getLiveEventPublicKeyHex(): string {
  return Buffer.from(ed25519.getPublicKey(seed())).toString("hex");
}

/** Attach a hex Ed25519 `sig` over the canonical payload. */
export function signLiveEvent(event: LiveEvent): LiveEvent {
  const msg = new TextEncoder().encode(canonicalizeLiveEvent(event));
  const sig = ed25519.sign(msg, seed());
  return { ...event, sig: Buffer.from(sig).toString("hex") };
}
