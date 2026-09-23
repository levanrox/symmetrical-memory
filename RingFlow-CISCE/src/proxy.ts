import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'
import { getPeerIp, isPrivateIp, isRestrictedPath, isTunnelRequest } from '@/lib/judgeAccess'

// One-time warning when the gate has no peer IP to work with (see below).
let warnedMissingPeerHeader = false

export async function proxy(request: NextRequest) {
  // ─── LAN-only gate for staff areas (PHASE P7a, hardened in P9) ─────────────
  // Judges on their own phones (own 4G, or venue WiFi) may only reach /j/*
  // and public endpoints. /admin, /moderator, /organiser and /stager return
  // 404 unless the request BOTH:
  //   1. arrived over a direct connection from a private/LAN peer IP, AND
  //   2. did NOT come through the public cloudflared tunnel.
  //
  // The peer IP comes ONLY from the `x-rf-peer` header, which server.mjs
  // stamps from the TCP socket's remoteAddress on every request (overwriting
  // any client-sent value, so it cannot be spoofed). `X-Forwarded-For` /
  // `X-Real-IP` are IGNORED entirely — they are client-controlled, so trusting
  // them let any public client bypass this gate with
  // `X-Forwarded-For: 10.0.0.1` (P9 M-1/L-5), and NextRequest.ip does not
  // exist in Next 16, so the socket-stamped header is the only peer-IP
  // source available to middleware.
  //
  // The tunnel check matters because cloudflared terminates at localhost:3000
  // (scripts/start-judge-tunnel.sh): tunnel traffic has a *private* peer IP
  // (127.0.0.1) and would otherwise sail through check (1). cloudflared
  // always adds CF-Ray / CF-Connecting-IP, which clients cannot suppress on
  // the tunnel path. (A direct client CAN forge those headers, but that only
  // fails closed — denies staff — never bypasses.)
  //
  // FAIL-CLOSED (P9 H-1): when `x-rf-peer` is absent (the app was started
  // without server.mjs, e.g. plain `next start`), the peer IP is not
  // verifiable and staff pages 404. The server logs its gate mode at startup;
  // a missing header also logs a one-time warning here. This gate is
  // defense-in-depth behind the app's own session auth, not a sole control.
  //
  // Kept FAST by design: pure string/prefix checks, no DB, no network.
  const pathname = request.nextUrl.pathname
  if (isRestrictedPath(pathname)) {
    const peerIp = getPeerIp(request.headers)
    if (!peerIp) {
      if (!warnedMissingPeerHeader) {
        warnedMissingPeerHeader = true
        console.warn(
          '[ringflow] lan-gate: no x-rf-peer header — not running under server.mjs? ' +
            'Peer IP is not verifiable; staff pages fail closed (404).'
        )
      }
      return new NextResponse(null, { status: 404 })
    }
    if (!isPrivateIp(peerIp) || isTunnelRequest(request.headers)) {
      return new NextResponse(null, { status: 404 })
    }
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
