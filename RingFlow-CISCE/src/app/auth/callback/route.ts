import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get('next') ?? '/admin'

  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
  const isLocalEnv = process.env.NODE_ENV === 'development'
  const baseOrigin = isLocalEnv ? origin : (forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${baseOrigin}${next}`)
    } else {
      console.error("Auth callback session exchange error:", error.message);
      const errorLoginPath = next.startsWith('/organiser') ? '/login/organiser' : '/login/admin';
      return NextResponse.redirect(`${baseOrigin}${errorLoginPath}?error=${encodeURIComponent(error.message)}`);
    }
  }

  // return the user to an error page with instructions
  const errorLoginPath = next.startsWith('/organiser') ? '/login/organiser' : '/login/admin';
  return NextResponse.redirect(`${baseOrigin}${errorLoginPath}?error=AuthFailed`);
}

