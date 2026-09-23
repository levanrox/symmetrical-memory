import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'
import { getClientIp, isPrivateIp, isRestrictedPath } from '@/lib/judgeAccess'

export async function proxy(request: NextRequest) {
  // ─── LAN-only gate for staff areas (PHASE P7a) ─────────────────────────────
  // Judges on their own phones (own 4G, or venue WiFi) may only reach /j/*
  // and public endpoints. /admin, /moderator, /organiser and /stager return
  // 404 for any client whose IP is not a private/LAN address, so they stay
  // unreachable through a public tunnel (cloudflared) while remaining fully
  // usable on the venue LAN. Localhost is private, so `next dev` keeps
  // working untouched.
  //
  // SECURITY NOTE (defense-in-depth, not a sole control): the client IP is
  // read from `x-forwarded-for` / `x-real-ip`, which are trustworthy when
  // RingFlow is reached directly (venue LAN) or via cloudflared (it sets
  // them honestly for the real client). If some other proxy were ever put
  // in front of the app those headers could be spoofed — the staff areas
  // are still protected by the app's own session auth behind this gate.
  //
  // Kept FAST by design: pure string/prefix checks, no DB, no network.
  const pathname = request.nextUrl.pathname
  if (isRestrictedPath(pathname)) {
    const clientIp = getClientIp(request.headers)
    if (!isPrivateIp(clientIp)) {
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
