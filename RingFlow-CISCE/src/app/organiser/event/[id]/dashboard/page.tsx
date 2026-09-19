import React from "react";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { ensureOrganiserHasAccessToTournament } from "@/actions/organiser";
import { getTournamentActiveBouts } from "@/actions/matches";

export default async function OrganiserDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  
  try {
    await ensureOrganiserHasAccessToTournament(tournamentId);
  } catch {
    redirect("/");
  }

  const supabase = await createClient();

  // 1. Fetch Tournament
  const { data: tournament, error: tournamentError } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .single();

  if (tournamentError || !tournament) {
    redirect("/");
  }

  // 2. Fetch Categories stats
  const { count: categoryCount, error: categoryCountError } = await supabase
    .from("categories")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  if (categoryCountError) {
    console.error("[dashboard] category count failed:", categoryCountError.message);
  }

  // 3. Fetch Rings
  const { data: rings, error: ringsError } = await supabase
    .from("rings")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("ring_order", { ascending: true });
  if (ringsError) {
    console.error("[dashboard] rings query failed:", ringsError.message);
  }

  const ringIds = rings?.map(r => r.id) || [];

  // Fetch Category Assignments, skipped when the event has no tatamis yet.
  let assignments: any[] = [];
  if (ringIds.length > 0) {
    const { data, error } = await supabase
      .from("category_assignments")
      .select("*, categories(name, expected_matches)")
      .in("ring_id", ringIds)
      .order("queue_order", { ascending: true });

    if (error) {
      // Every counter on this dashboard is derived from these rows.
      console.error("[dashboard] category assignments query failed:", error.message);
    }
    assignments = data ?? [];
  }

  // 4. Fetch Moderator Requests
  let modRequests: any[] = [];
  if (ringIds.length > 0) {
    const { data: reqs } = await supabase
      .from("moderator_requests")
      .select("*, rings(name)")
      .in("ring_id", ringIds)
      .order("created_at", { ascending: false })
      .limit(20);
    if (reqs) modRequests = reqs;
  }

  // 5. Fetch Event Logs
  const { data: logs, error: logsError } = await supabase
    .from("event_log")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (logsError) {
    console.error("[dashboard] event log query failed:", logsError.message);
  }

  // Prepare assignments data joined with categories for client
  const fullAssignments = await Promise.all(assignments?.map(async (a) => {
    const { data: cat } = await supabase.from("categories").select("*").eq("id", a.category_id).single();
    return { ...a, categories: cat };
  }) || []);

  // Who is fighting whom on each mat, so the organiser view names the bout.
  const initialActiveBouts = await getTournamentActiveBouts(tournamentId).catch((err) => {
    console.error("[dashboard] live bout lookup failed:", err);
    return {};
  });

  return (
    <AdminDashboardClient 
      tournament={tournament}
      categoryCount={categoryCount}
      initialRings={rings}
      initialAssignments={fullAssignments}
      initialModRequests={modRequests}
      initialLogs={logs}
      initialActiveBouts={initialActiveBouts}
      readOnly={true}
    />
  );
}
