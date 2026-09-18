import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateModeratorSession } from "@/actions/moderator";
import { createClient } from "@/utils/supabase/server";
import ModeratorBottomNav from "@/components/moderator/ModeratorBottomNav";
import ModeratorTopTabs from "@/components/moderator/ModeratorTopTabs";
import ModeratorProfileMenu from "@/components/moderator/ModeratorProfileMenu";

export default async function ModeratorRingLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ ringId: string }>;
}) {
  const { ringId } = await params;

  // Validate Auth
  const cookieStore = await cookies();
  const token = cookieStore.get("mod_token")?.value;

  if (!token) {
    redirect("/login/mod");
  }

  const moderatorSession = await validateModeratorSession(ringId, token);
  if (!moderatorSession) {
    redirect("/login/mod");
  }

  // Fetch Ring Info
  const supabase = await createClient();
  const { data: ring } = await supabase
    .from("rings")
    .select("*")
    .eq("id", ringId)
    .single();

  if (!ring) {
    return <div>Ring not found.</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background pb-28 font-body-md text-on-background lg:pb-8">
      {/* Top bar: identity on phones, the section tabs on laptops */}
      <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between gap-2 border-b border-outline-variant bg-surface-container-lowest px-4 text-primary md:px-margin-desktop">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <span className="shrink-0 font-headline-sm text-headline-sm font-black tracking-tighter text-primary">Ring Flow</span>
          <div className="h-5 w-[1px] shrink-0 bg-outline-variant sm:h-6"></div>
          <div className="min-w-0">
            <h1 className="truncate font-body-md font-bold text-on-surface uppercase">{ring.name.replace(/Ring/i, "Tatami")}</h1>
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Moderator desk
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <ModeratorTopTabs ringId={ringId} />
          <ModeratorProfileMenu moderator={moderatorSession} />
        </div>
      </header>

      {/* Main Content — full width on laptops, comfortable measure below */}
      <main className="mx-auto w-full max-w-5xl flex-grow p-4 md:p-margin-desktop lg:max-w-[1800px]">
        {children}
      </main>

      {/* Bottom Navigation Bar (phones and tablets only) */}
      <ModeratorBottomNav ringId={ringId} />
    </div>
  );
}
