import { getLiveEventPublicKeyHex } from "@/lib/realtime/eventSigning";

/**
 * Serves the Ed25519 public key browsers use to verify live-event
 * signatures. Public by design — verification needs it, and it confers no
 * signing ability. Cached for a minute; the key only changes when
 * SESSION_SECRET rotates.
 */
export async function GET() {
  return Response.json(
    { publicKey: getLiveEventPublicKeyHex() },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
