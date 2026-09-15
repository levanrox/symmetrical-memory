import React from "react";
import { createClient } from "@/utils/supabase/server";
import { notFound } from "next/navigation";
import PublicEventClient from "@/components/public/PublicEventClient";

export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  const supabase = await createClient();

  const { data: rings } = await supabase
    .from("rings")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("ring_order", { ascending: true });

  const ringIds = rings?.map(r => r.id) || [];

  const [
    { data: tournament },
    { data: assignments },
    { data: categories }
  ] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", tournamentId).single(),
    supabase.from("category_assignments").select(`
      *,
      categories(name, athletes_count, expected_matches)
    `).in("ring_id", ringIds).order("queue_order", { ascending: true }),
    supabase.from("categories").select("*").eq("tournament_id", tournamentId)
  ]);

  if (!tournament) return notFound();

  if (tournament.status === "draft") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">{tournament.name}</h1>
          <p className="text-slate-400 text-sm mb-6">This tournament has not started yet. Please check back when the event begins.</p>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-xs text-slate-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Status: Draft
          </div>
        </div>
      </div>
    );
  }

  return (
    <PublicEventClient 
      tournament={tournament} 
      initialRings={rings || []} 
      initialAssignments={assignments || []} 
      categories={categories || []}
    />
  );
}
