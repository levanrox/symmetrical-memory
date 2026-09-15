import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * /stager root - resolves active stager session and navigates directly to event balance
 */
export default async function StagerRootPage() {
  const cookieStore = await cookies();
  const stagerToken = cookieStore.get("stager_token")?.value;

  if (!stagerToken) {
    redirect("/login/stager");
  }

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("stager_requests")
    .select("tournament_id, status, expires_at")
    .or(`session_token.eq.${stagerToken},id.eq.${stagerToken}`)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (request?.tournament_id && (!request.expires_at || new Date(request.expires_at).getTime() >= Date.now())) {
    redirect(`/stager/event/${request.tournament_id}/balance`);
  }

  redirect("/login/stager");
}
