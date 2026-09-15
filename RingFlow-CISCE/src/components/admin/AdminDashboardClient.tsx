"use client";

import React, { useState, useEffect } from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import HeaderSearchBar from "@/components/layout/HeaderSearchBar";
import RingCard from "@/components/admin/RingCard";
import LiveActivityFeed from "@/components/admin/LiveActivityFeed";
import ModeratorRequestsWidget from "@/components/admin/ModeratorRequestsWidget";
import { createClient } from "@/utils/supabase/client";
import { toggleRingTimer, setAllRingTimers, resetRingTimer } from "@/actions/rings";
import OverviewSupportFooter from "@/components/support/OverviewSupportFooter";
import BackNavigationGuard from "@/components/common/BackNavigationGuard";

export default function AdminDashboardClient({ 
  tournament, 
  categoryCount, 
  initialRings, 
  initialAssignments, 
  initialModRequests, 
  initialLogs,
  readOnly = false,
}: any) {
  const [rings, setRings] = useState<any[]>(initialRings || []);
  const [assignments, setAssignments] = useState<any[]>(initialAssignments || []);
  const [logs, setLogs] = useState<any[]>(initialLogs || []);
  const [activeAlert, setActiveAlert] = useState<any | null>(null);
  
  const supabase = createClient();

  useEffect(() => {
    // Listen to assignment updates, ring changes, and event logs in realtime
    const channel = supabase.channel(`admin_dashboard_${tournament.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'category_assignments'
      }, async (payload) => {
        if (payload.eventType === 'UPDATE') {
          setAssignments(prev => {
            const idx = prev.findIndex(a => a.id === payload.new.id);
            if (idx > -1) {
              const copy = [...prev];
              copy[idx] = { 
                ...copy[idx], 
                ...payload.new,
                // Preserve category data if payload does not have joined categories
                categories: copy[idx].categories || payload.new.categories
              };
              return copy;
            } else if (rings.some(r => r.id === payload.new.ring_id)) {
              return [...prev, payload.new];
            }
            return prev;
          });
        } else if (payload.eventType === 'INSERT') {
          if (!rings.some(r => r.id === payload.new.ring_id)) return;
          // Fetch joined category data if missing so division name and match count are populated
          const { data: cat } = await supabase
            .from("categories")
            .select("name, expected_matches, athletes_count")
            .eq("id", payload.new.category_id)
            .single();
          setAssignments(prev => {
            if (prev.some(a => a.id === payload.new.id)) return prev;
            return [...prev, { ...payload.new, categories: cat }];
          });
        } else if (payload.eventType === 'DELETE') {
          setAssignments(prev => prev.filter(a => a.id !== payload.old.id));
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rings',
        filter: `tournament_id=eq.${tournament.id}`
      }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setRings(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r));
        } else if (payload.eventType === 'INSERT') {
          setRings(prev => [...prev, payload.new].sort((a, b) => a.ring_order - b.ring_order));
        } else if (payload.eventType === 'DELETE') {
          setRings(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'event_log',
        filter: `tournament_id=eq.${tournament.id}`
      }, (payload) => {
        setLogs(prev => [payload.new, ...prev]);
        if (payload.new.action === "EMERGENCY_ALERT" || payload.new.action === "REQUEST_ASSISTANCE") {
          setActiveAlert(payload.new);
        }
      })
      .subscribe();

    // Secondary reconciliation function as fallback to Realtime
    const syncData = async () => {
      const ringIds = rings.map(r => r.id);
      if (ringIds.length === 0) return;
      
      const { data: latestAssignments } = await supabase
        .from("category_assignments")
        .select("*, categories(name, expected_matches, athletes_count)")
        .in("ring_id", ringIds)
        .order("queue_order", { ascending: true });

      if (latestAssignments && latestAssignments.length > 0) {
        setAssignments(latestAssignments);
      }

      const { data: latestLogs } = await supabase
        .from("event_log")
        .select("*")
        .eq("tournament_id", tournament.id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (latestLogs && latestLogs.length > 0) {
        setLogs(latestLogs);
      }

      const { data: latestRings } = await supabase
        .from("rings")
        .select("*")
        .eq("tournament_id", tournament.id)
        .order("ring_order", { ascending: true });

      if (latestRings && latestRings.length > 0) {
        setRings(latestRings);
      }
    };

    // Reconcile every 45s in background instead of hammering DB every 5s
    const syncInterval = setInterval(syncData, 45000);

    // Also reconcile immediately whenever user switches back to this tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(syncInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [tournament.id, rings, supabase]);

  // Calculate totals
  let totalMatches = 0;
  let completedMatches = 0;

  assignments.forEach(a => {
    if (a.categories?.expected_matches) {
      totalMatches += a.categories.expected_matches;
      completedMatches += (a.matches_completed || 0);
    }
  });

  const completedCategories = assignments.filter(a => a.status === "completed").length;
  const totalCategories = categoryCount || assignments.length || 0;
  const progressPercent = totalMatches > 0 ? (completedMatches / totalMatches) * 100 : 0;

  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

  // Live timer interval to update elapsed times every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Check if all rings are paused or if any ring is running
  const anyRunning = rings.some((r) => r.timer_status === "running");
  const areAllPaused = rings.length > 0 && rings.every((r) => r.timer_status === "paused");

  // Toggle individual tatami timer (Start -> Pause -> Resume)
  const toggleRingPause = async (ringId: string) => {
    const targetRing = rings.find((r) => r.id === ringId);
    if (!targetRing) return;

    const currentStatus = targetRing.timer_status || "idle";
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // Instant optimistic update
    if (currentStatus === "running") {
      const additional = targetRing.timer_started_at
        ? Math.max(0, Math.floor((now - new Date(targetRing.timer_started_at).getTime()) / 1000))
        : 0;
      const newAccum = (targetRing.timer_accumulated_seconds || 0) + additional;
      setRings((prev) =>
        prev.map((r) =>
          r.id === ringId
            ? {
                ...r,
                timer_status: "paused",
                timer_started_at: null,
                timer_paused_at: nowIso,
                timer_accumulated_seconds: newAccum,
              }
            : r
        )
      );
    } else {
      setRings((prev) =>
        prev.map((r) =>
          r.id === ringId
            ? {
                ...r,
                timer_status: "running",
                timer_started_at: nowIso,
                timer_paused_at: null,
              }
            : r
        )
      );
    }

    try {
      await toggleRingTimer(ringId, tournament.id, currentStatus);
    } catch (err) {
      console.error("Failed to toggle ring timer:", err);
    }
  };

  // Reset individual tatami timer
  const handleResetTimer = async (ringId: string) => {
    setRings((prev) =>
      prev.map((r) =>
        r.id === ringId
          ? {
              ...r,
              timer_status: "idle",
              timer_started_at: null,
              timer_paused_at: null,
              timer_accumulated_seconds: 0,
            }
          : r
      )
    );
    try {
      await resetRingTimer(ringId, tournament.id);
    } catch (err) {
      console.error("Failed to reset ring timer:", err);
    }
  };

  // Toggle pause/resume for all tatamis at once
  const toggleAllPace = async () => {
    const shouldPause = anyRunning;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // Instant optimistic update
    setRings((prev) =>
      prev.map((r) => {
        if (shouldPause) {
          if (r.timer_status === "running") {
            const additional = r.timer_started_at
              ? Math.max(0, Math.floor((now - new Date(r.timer_started_at).getTime()) / 1000))
              : 0;
            return {
              ...r,
              timer_status: "paused",
              timer_started_at: null,
              timer_paused_at: nowIso,
              timer_accumulated_seconds: (r.timer_accumulated_seconds || 0) + additional,
            };
          }
          return r;
        } else {
          if (r.timer_status !== "running") {
            return {
              ...r,
              timer_status: "running",
              timer_started_at: nowIso,
              timer_paused_at: null,
            };
          }
          return r;
        }
      })
    );

    try {
      await setAllRingTimers(tournament.id, shouldPause);
    } catch (err) {
      console.error("Failed to toggle all tatami timers:", err);
    }
  };

  // Calculate elapsed time vs expected time for each tatami
  const getRingTiming = (ring: any, ringAssignments: any[]) => {
    const timerStatus = ring.timer_status || "idle";
    const accumulated = ring.timer_accumulated_seconds || 0;
    const isStarted = timerStatus === "running" || timerStatus === "paused" || accumulated > 0;
    const isRunning = timerStatus === "running";
    const isManuallyPaused = timerStatus === "paused";

    let actualSeconds = accumulated;
    if (isRunning && ring.timer_started_at) {
      const runningSecs = Math.max(0, Math.floor((currentTime - new Date(ring.timer_started_at).getTime()) / 1000));
      actualSeconds += runningSecs;
    }

    // Helper to get expected duration for a category (standard 109s per match)
    const getCatExpectedSeconds = (cat: any) => {
      const matches = cat?.expected_matches || cat?.athletes_count || 4;
      return Math.max(1, matches) * 109;
    };

    const sortedAssignments = [...(ringAssignments || [])].sort(
      (a: any, b: any) => (a.queue_order || 0) - (b.queue_order || 0)
    );

    // Sum total expected duration for all categories in queue for this tatami (e.g. 9m)
    let expectedSeconds = 0;
    sortedAssignments.forEach((a: any) => {
      expectedSeconds += getCatExpectedSeconds(a.categories);
    });
    if (expectedSeconds === 0 && sortedAssignments.length > 0) {
      expectedSeconds = 15 * 60;
    }

    // Benchmark pace calculation:
    // Compare actual time against expected duration of completed categories + active category progress
    let diffSeconds = 0;

    if (isStarted && sortedAssignments.length > 0) {
      let completedExpectedSeconds = 0;
      let activeCatExpectedSeconds = 0;
      let activeMatchesExpectedSeconds = 0;
      let hasActive = false;

      sortedAssignments.forEach((a: any) => {
        const catDuration = getCatExpectedSeconds(a.categories);
        if (a.status === "completed") {
          completedExpectedSeconds += catDuration;
        } else if (!hasActive && (a.status === "running" || a.status === "paused")) {
          hasActive = true;
          activeCatExpectedSeconds = catDuration;
          const matchesDone = a.matches_completed || 0;
          activeMatchesExpectedSeconds = matchesDone * 109;
        }
      });

      const targetWhenActiveFinishes = completedExpectedSeconds + activeCatExpectedSeconds;
      const completedWorkExpected = completedExpectedSeconds + activeMatchesExpectedSeconds;

      if (hasActive) {
        if (actualSeconds > targetWhenActiveFinishes) {
          // Exceeded total scheduled time for this category -> late!
          diffSeconds = actualSeconds - targetWhenActiveFinishes;
        } else if (completedWorkExpected > 0) {
          // Compare elapsed time against completed categories/matches benchmark
          diffSeconds = actualSeconds - completedWorkExpected;
        } else {
          // On first category, within scheduled time window -> on pace
          diffSeconds = 0;
        }
      } else if (completedExpectedSeconds > 0) {
        // No currently active category, but some completed (or in-between / all completed)
        diffSeconds = actualSeconds - completedExpectedSeconds;
      } else {
        diffSeconds = 0;
      }
    }

    return {
      startTime: ring.timer_started_at ? new Date(ring.timer_started_at).getTime() : null,
      isStarted,
      isRunning,
      isManuallyPaused,
      isAllCompleted: ringAssignments.length > 0 && ringAssignments.every((a: any) => a.status === "completed"),
      actualSeconds,
      expectedSeconds,
      diffSeconds,
    };
  };

  const formatTimeTook = (totalSeconds: number) => {
    if (totalSeconds <= 0) return "00m 00s";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
    }
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  };

  const formatTimeExpected = (totalSeconds: number) => {
    if (totalSeconds <= 0) return "--";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes > 0 ? `${minutes}m` : ""}`;
    }
    return `${minutes}m`;
  };

  return (
    <>
      <BackNavigationGuard />
      {readOnly ? (
        <OrganiserHeader title="Overview" eventName={tournament.name} tournamentId={tournament.id} />
      ) : (
        <AdminHeader title="Overview" eventName={tournament.name} tournamentId={tournament.id} />
      )}
      
      {activeAlert && (
        <div className="fixed top-4 sm:top-6 right-4 sm:right-6 left-4 sm:left-auto z-50 flex items-center justify-center">
          <div className={`${activeAlert.action === 'EMERGENCY_ALERT' ? 'bg-error-container text-on-error-container border-error' : 'bg-amber-100 text-amber-900 border-amber-500'} max-w-sm w-full p-4 rounded-xl shadow-2xl border-2 transform animate-bounce-short flex gap-4`}>
            <span className="material-symbols-outlined text-4xl mt-1" style={{fontVariationSettings: '"FILL" 1'}}>
              {activeAlert.action === 'EMERGENCY_ALERT' ? 'warning' : 'support_agent'}
            </span>
            <div className="flex-1">
              <h2 className="text-headline-sm font-headline-sm font-bold leading-tight">
                {activeAlert.action === 'EMERGENCY_ALERT' ? 'EMERGENCY ASSISTANCE' : 'ASSISTANCE REQUESTED'}
              </h2>
              <span className={`font-label-caps text-[10px] ${activeAlert.action === 'EMERGENCY_ALERT' ? 'text-error' : 'text-amber-700'} font-bold mb-2 block uppercase tracking-wider`}>
                {rings.find(r => r.id === activeAlert.ring_id)?.name || "Unknown Tatami"}
              </span>
              <p className="text-body-sm font-body-sm mb-4 leading-snug">
                {activeAlert.metadata?.message || "Assistance requested"}
              </p>
              <button 
                onClick={() => setActiveAlert(null)}
                className={`w-full ${activeAlert.action === 'EMERGENCY_ALERT' ? 'bg-error text-white' : 'bg-amber-500 text-white'} py-2 rounded font-bold font-label-caps tracking-widest active:scale-95 transition-transform text-xs`}
              >
                DISMISS
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 pb-24 w-full">
        {/* Mobile Organiser Search Bar - Detached into Page (Organiser Mobile Only) */}
        {readOnly && (
          <div className="md:hidden w-full">
            <HeaderSearchBar
              tournamentId={tournament.id}
              role="organiser"
              className="w-full max-w-none"
            />
          </div>
        )}

        {/* Global Tournament Stats */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-gutter">
          <div className="bg-white p-4 sm:p-card-padding border border-[#E1DDCF] hover:border-[#CDC8BA] rounded-lg flex flex-col justify-between shadow-xs hover:shadow-sm transition-all">
            <div className="flex justify-between items-start">
              <span className="font-label-caps text-label-caps text-on-surface-variant">Completed Categories</span>
              <span className="material-symbols-outlined text-secondary">category</span>
            </div>
            <div className="mt-4">
              <span className="font-headline-lg text-headline-lg font-bold">
                {completedCategories} / {totalCategories}
              </span>
              <p className="text-body-sm text-on-surface-variant mt-1">
                {totalCategories > 0 && completedCategories === totalCategories
                  ? "All categories finished"
                  : `${Math.max(0, totalCategories - completedCategories)} categories remaining`}
              </p>
            </div>
          </div>
          
          <div className="bg-white p-4 sm:p-card-padding border border-[#E1DDCF] hover:border-[#CDC8BA] rounded-lg flex flex-col justify-between shadow-xs hover:shadow-sm transition-all">
            <div className="flex justify-between items-start">
              <span className="font-label-caps text-label-caps text-on-surface-variant">Completed Matches</span>
              <span className="material-symbols-outlined text-on-secondary-fixed-variant" style={{fontVariationSettings: '"FILL" 1'}}>check_circle</span>
            </div>
            <div className="mt-4">
              <span className="font-headline-lg text-headline-lg font-bold">{completedMatches} / {totalMatches}</span>
              <p className="text-body-sm text-on-surface-variant mt-1">Live aggregated match count</p>
            </div>
          </div>
          
          <div className="bg-white p-4 sm:p-card-padding border border-[#E1DDCF] hover:border-[#CDC8BA] rounded-lg shadow-xs hover:shadow-sm transition-all">
            <div className="flex justify-between items-start">
              <span className="font-label-caps text-label-caps text-on-surface-variant">Overall Progress</span>
              <span className="material-symbols-outlined text-secondary">speed</span>
            </div>
            <div className="mt-6">
              <div className="w-full bg-slate-100 border border-[#E1DDCF]/70 h-2 rounded-full overflow-hidden">
                <div className="bg-secondary h-full transition-all duration-1000 ease-out" style={{ width: `${Math.min(100, progressPercent)}%` }}></div>
              </div>
              <div className="flex justify-between mt-2">
                <span className="font-data-mono text-data-mono text-secondary font-bold">{progressPercent.toFixed(1)}%</span>
                <span className="font-data-mono text-data-mono text-on-surface-variant">{Math.max(0, totalMatches - completedMatches)} Remaining</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section Heading & Global Pace Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-3">
            <h3 className="font-headline-sm text-headline-sm text-primary font-bold">
              Live Tatami Status & Pace
            </h3>
            {!readOnly && rings.length > 0 && (
              <button
                type="button"
                onClick={toggleAllPace}
                title={anyRunning ? "Pause all tatami timers" : "Resume all tatami timers"}
                className={`px-3 py-1.5 text-xs font-label-caps font-semibold rounded-md border flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs ${
                  !anyRunning && areAllPaused
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 font-bold"
                    : "border-slate-200 bg-white hover:bg-slate-50 text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {anyRunning ? "pause" : "play_arrow"}
                </span>
                <span>{anyRunning ? "Pause All Tatamis" : "Resume All Tatamis"}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-label-caps text-on-surface-variant">
            <span
              className={`w-2 h-2 rounded-full ${
                anyRunning
                  ? "bg-secondary animate-pulse"
                  : areAllPaused
                  ? "bg-amber-500"
                  : "bg-outline"
              }`}
            />
            <span>
              {anyRunning
                ? "Realtime Pace Tracking"
                : areAllPaused
                ? "Pace Tracking Paused"
                : "Pace Tracking Ready"}
            </span>
          </div>
        </div>

        <div className={readOnly ? "space-y-4" : "grid grid-cols-1 xl:grid-cols-4 gap-8 items-start"}>
          {/* Unified Tatamis Grid Overview */}
          <div className={readOnly ? "w-full" : "xl:col-span-3"}>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 ${
                readOnly ? "xl:grid-cols-3 2xl:grid-cols-4" : "xl:grid-cols-2 2xl:grid-cols-3"
              } gap-5`}
            >
              {rings.map((ring) => {
                const ringAssignments = assignments.filter((a) => a.ring_id === ring.id) || [];
                const activeAssignment =
                  ringAssignments.find((a) => a.status === "running") ||
                  ringAssignments.find((a) => a.status === "paused");
                const nextAssignment = ringAssignments.find((a) => a.status === "pending");
                
                const assignment = activeAssignment || nextAssignment;
                const timing = getRingTiming(ring, ringAssignments);
                
                // Tatami status is driven strictly by activeAssignment (matching public spectator page):
                const status = activeAssignment
                  ? activeAssignment.status === "running"
                    ? "Running"
                    : activeAssignment.status === "paused"
                    ? "Paused"
                    : "Empty"
                  : timing.isAllCompleted
                  ? "Completed"
                  : "Empty";

                const categoryName =
                  assignment?.categories?.name ||
                  ringAssignments[0]?.categories?.name ||
                  "No categories assigned";
                const totalMatchesForRing = assignment?.categories?.expected_matches || 0;
                const currentMatch = assignment?.matches_completed || 0;
                const totalExpectedMatches = ringAssignments.reduce(
                  (acc, a) => acc + (a.categories?.expected_matches || 0),
                  0
                );

                const ringProgressPercent =
                  totalMatchesForRing > 0 ? (currentMatch / totalMatchesForRing) * 100 : 0;

                // Calculate Estimated Finish Time
                let estFinish = "--:--";
                if (status === "Running" && totalMatchesForRing > 0) {
                  const remaining = Math.max(0, totalMatchesForRing - currentMatch);
                  const msRemaining = remaining * 109 * 1000; // 109 seconds per match
                  estFinish = new Date(Date.now() + msRemaining).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }

                return (
                  <RingCard
                    key={ring.id}
                    name={ring.name.replace(/Ring/i, "Tatami")}
                    status={status as any}
                    categoryName={categoryName}
                    nextCategoryName={nextAssignment?.categories?.name}
                    ringOrder={ring.ring_order}
                    currentMatch={currentMatch}
                    totalMatches={totalMatchesForRing}
                    totalExpectedMatches={totalExpectedMatches}
                    divisionCount={ringAssignments.length}
                    progressPercent={ringProgressPercent}
                    estimatedFinish={estFinish}
                    timing={timing}
                    onTogglePause={readOnly ? undefined : () => toggleRingPause(ring.id)}
                    onResetTimer={readOnly ? undefined : () => handleResetTimer(ring.id)}
                    formatTimeTook={formatTimeTook}
                    formatTimeExpected={formatTimeExpected}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          </div>

          {!readOnly && (
            <div className="space-y-3.5">
              <LiveActivityFeed tournamentId={tournament.id} initialLogs={logs} rings={rings} />
              <ModeratorRequestsWidget tournamentId={tournament.id} initialRequests={initialModRequests} readOnly={readOnly} />
            </div>
          )}
        </div>

        {/* Support & Crux Contact Desk */}
        <OverviewSupportFooter />
      </div>
    </>
  );
}
