/**
 * Pure session-token validation helpers (H2).
 *
 * Moderator / organiser / stager requests authenticate with a per-request
 * `sessionToken` (a random credential stored in an httpOnly cookie). The
 * request's *id* is broadcast over the realtime socket and visible to any
 * passive LAN sniffer, so it must NEVER be accepted as a credential.
 *
 * These helpers encode the token-only contract in a unit-testable form; the
 * server-action validators in src/actions/{moderator,organiser,stager}.ts
 * query by sessionToken and then apply `assertValidSession`.
 */

export interface SessionRequest {
  id: string;
  sessionToken: string | null;
  status: string;
  expiresAt: Date | string | null;
}

/**
 * Returns the request when `token` is the request's live sessionToken and
 * the session is not expired; otherwise null.
 *
 * Critically, `token === request.id` does NOT validate — the id is public.
 */
export function assertValidSession<T extends SessionRequest>(
  request: T | null | undefined,
  token: string | null | undefined
): T | null {
  if (!request || !token) return null;
  // Token-only: the credential is the sessionToken column. Never fall back
  // to comparing against the request id (it is broadcast publicly).
  if (request.sessionToken !== token) return null;
  if (
    request.expiresAt &&
    new Date(request.expiresAt).getTime() < Date.now()
  ) {
    return null;
  }
  return request;
}
