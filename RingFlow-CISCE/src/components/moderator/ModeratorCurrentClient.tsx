"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { adjustMatchCount, finishCategory, setRingStatus, returnCategoryToQueue, logRingEvent, logoutModerator } from "@/actions/moderator";
import { getRingActiveBout, setActiveBout } from "@/actions/matches";
import { getRingClock } from "@/actions/clock";
import { normalizeClock, type RingClock } from "@/lib/matchClock";
import { getCategoryDraw } from "@/actions/draws";
import { BoutScoringPad } from "@/components/moderator/BoutScoringPad";
import { BoutPickerModal } from "@/components/moderator/BoutPickerModal";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";
import MatchTimer from "@/components/moderator/MatchTimer";

export default function ModeratorCurrentClient({ ringId, initialAssignments, allAthletes }: { ringId: string, initialAssignments: any[], allAthletes: any[] }) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAssistanceModal, setShowAssistanceModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnConfirmText, setReturnConfirmText] = useState("");
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [syncErrorModal, setSyncErrorModal] = useState<{ title: string; message: string; isUnauthorized: boolean } | null>(null);
  const [showAdvancedModalOptions, setShowAdvancedModalOptions] = useState(false);
  const [isUpdatingMatch, setIsUpdatingMatch] = useState(false);
  const [activeDelta, setActiveDelta] = useState<number | null>(null);
  const [clickTimestamps, setClickTimestamps] = useState<number[]>([]);
  const [spamNotice, setSpamNotice] = useState<string | null>(null);
  const [boutData, setBoutData] = useState<any>(null);
  const [drawData, setDrawData] = useState<any>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  // The bout list is a tool, not the desk: it opens as a full-view picker so the
  // clock and the point buttons stay in reach on a phone.
  const [showBoutSelector, setShowBoutSelector] = useState(false);
  const [activeMode, setActiveMode] = useState<"digital" | "counter">("digital");
  const [showBracketModal, setShowBracketModal] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const loadBoutData = React.useCallback(async (targetMatchId?: string) => {
    try {
      const targetId = targetMatchId !== undefined ? targetMatchId : selectedMatchId || undefined;
      const data = await getRingActiveBout(ringId, targetId);
      setBoutData(data);
      if (data?.currentMatch && !selectedMatchId) {
        setSelectedMatchId(data.currentMatch.id);
      }
      if (data?.category?.id) {
        const d = await getCategoryDraw(data.category.id);
        setDrawData(d);
      }
    } catch (err) {
      console.error("Failed to load active bout:", err);
    }
  }, [ringId, selectedMatchId]);

  const handleSelectBout = async (matchId: string) => {
    setSelectedMatchId(matchId);
    setShowBoutSelector(false);
    await setActiveBout(ringId, matchId);
    await loadBoutData(matchId);
  };

  useEffect(() => {
    loadBoutData();
  }, [loadBoutData]);

  useEffect(() => {
    const channel = supabase.channel(`current_${ringId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'category_assignments',
        filter: `ring_id=eq.${ringId}`
      }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setAssignments(prev => {
            const idx = prev.findIndex(a => a.id === payload.new.id);
            if (idx > -1) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...payload.new };
              return copy;
            }
            return prev;
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ringId, supabase]);

  // Keep this desk's clock tied to the server: realtime push where available,
  // a cheap single-row poll where it is not (local PostgREST has no realtime).
  useEffect(() => {
    const applyRingRow = (row: any) => {
      setBoutData((prev: any) =>
        prev
          ? { ...prev, clock: normalizeClock(row), serverNow: Date.now() }
          : prev
      );
    };

    const channel = supabase
      .channel(`mod_ring_${ringId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rings", filter: `id=eq.${ringId}` },
        (payload) => {
          if (payload.new) applyRingRow(payload.new);
        }
      )
      .subscribe();

    const poll = setInterval(async () => {
      const sentAt = Date.now();
      try {
        const res = await getRingClock(ringId);
        const receivedAt = Date.now();
        if (res.success && res.clock) {
          setBoutData((prev: any) =>
            prev
              ? {
                  ...prev,
                  clock: res.clock,
                  serverNow: res.serverNow,
                  serverNowSentAt: sentAt,
                  serverNowReceivedAt: receivedAt,
                }
              : prev
          );
        }
      } catch {
        /* transient — the next tick retries */
      }
    }, 1000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [ringId, supabase]);

  const activeAssignment = assignments.find(a => a.status === 'running' || a.status === 'paused');

  if (!activeAssignment) {
    return (
      <section className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-24 h-24 bg-surface-container rounded-full flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-4xl text-outline" style={{ fontVariationSettings: '"FILL" 1' }}>event_busy</span>
        </div>
        <h2 className="font-headline-sm text-headline-sm mb-2">No category running</h2>
        <p className="text-on-surface-variant mb-8 max-w-sm">Please initialize the next category from the Queue to begin.</p>
        <button
          onClick={() => router.push(`/moderator/ring/${ringId}/queue`)}
          className="bg-primary text-on-primary px-8 py-3 rounded-lg font-bold flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>queue</span>
          Go to Queue
        </button>
      </section>
    );
  }

  const handleAdjustMatch = async (delta: number) => {
    if (isUpdatingMatch || loading) return;

    const now = Date.now();
    const windowMs = 2500;
    const recent = clickTimestamps.filter(t => now - t < windowMs);

    // If 3 rapid clicks occur in short duration (2 existing + current 1), reject all!
    if (recent.length >= 2) {
      setClickTimestamps([]);
      setSpamNotice("One click = 😎 | 20 clicks = 🤡");
      setTimeout(() => setSpamNotice(null), 3500);
      return;
    }

    setClickTimestamps([...recent, now]);
    setIsUpdatingMatch(true);
    setActiveDelta(delta);

    try {
      const res = await adjustMatchCount(activeAssignment.id, ringId, delta);
      if (res && typeof res.matches_completed === 'number') {
        setAssignments(prev => {
          const idx = prev.findIndex(a => a.id === activeAssignment.id);
          if (idx > -1) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], matches_completed: res.matches_completed };
            return copy;
          }
          return prev;
        });
      }
    } catch (e: any) {
      console.error(e);
      if (e?.message?.includes("Too many rapid attempts")) {
        setSpamNotice("Too many rapid clicks. Action rejected.");
        setTimeout(() => setSpamNotice(null), 3500);
      } else if (e?.message?.includes("Unauthorized") || e?.message?.includes("Session")) {
        setSyncErrorModal({
          title: "Session Expired",
          message: "Your moderator session is no longer active. Please re-login with your access code or reload the page.",
          isUnauthorized: true
        });
      } else {
        setSyncErrorModal({
          title: "Failed to Update Score",
          message: "💀 Score update failed. The app and server might be out of sync (or your access changed). Refresh the page, check your match count, and try again.",
          isUnauthorized: false
        });
      }
    } finally {
      setIsUpdatingMatch(false);
      setActiveDelta(null);
    }
  };

  const handleTogglePause = async () => {
    setLoading(true);
    try {
      await setRingStatus(activeAssignment.id, ringId, activeAssignment.status === 'running');
    } catch (e) {
      console.error(e);
      alert("Failed to pause/resume ring");
    } finally {
      setLoading(false);
    }
  };

  const executeCompleteCategory = async (fillExpected: boolean) => {
    setLoading(true);
    try {
      if (fillExpected) {
        const totalMatches = activeAssignment.categories?.expected_matches || 0;
        const diff = totalMatches - activeAssignment.matches_completed;
        if (diff > 0) {
          await adjustMatchCount(activeAssignment.id, ringId, diff);
        }
      }
      await finishCategory(activeAssignment.id, ringId);
      router.push(`/moderator/ring/${ringId}/queue`);
    } catch (e) {
      console.error(e);
      alert("Failed to complete category");
    } finally {
      setLoading(false);
      setShowCompleteModal(false);
      setShowSettings(false);
    }
  };

  const executeReturnToQueue = async () => {
    if (returnConfirmText !== "CONFIRM") {
      alert("Must type CONFIRM exactly to return.");
      return;
    }
    setLoading(true);
    try {
      await returnCategoryToQueue(activeAssignment.id, ringId);
      router.push(`/moderator/ring/${ringId}/queue`);
    } catch (e) {
      console.error(e);
      alert("Failed to return to queue");
    } finally {
      setLoading(false);
      setShowReturnModal(false);
      setShowSettings(false);
    }
  };

  const handleRequestAssistance = async (type: string) => {
    setShowAssistanceModal(false);
    try {
      if (type === 'Doctor / Medical') {
        setLoading(true);
        try {
          await setRingStatus(activeAssignment.id, ringId, true); // true = isPaused
        } catch (e) {
          console.error("Failed to auto-pause for doctor", e);
        } finally {
          setLoading(false);
        }
      }
      await logRingEvent(ringId, "REQUEST_ASSISTANCE", { message: `Requested: ${type}`, type });
      alert(`Assistance requested: ${type}`);
    } catch (e) {
      console.error(e);
      alert("Failed to request assistance");
    }
  };

  const handleEmergency = async () => {
    try {
      await logRingEvent(ringId, "EMERGENCY_ALERT", { message: "Critical Emergency Triggered from UI" });
      alert("Emergency alert sent to admin.");
    } catch (e) {
      console.error(e);
      alert("Failed to send emergency alert");
    }
  };

  const totalMatches = activeAssignment.categories?.expected_matches || 0;
  const currentCompleted = activeAssignment.matches_completed;
  const percentage = totalMatches > 0 ? (currentCompleted / totalMatches) * 100 : 0;
  const isPaused = activeAssignment.status === 'paused';

  return (
    <div className="space-y-0">
      <div className="flex justify-between items-center mb-6 sm:mb-8 gap-2">
        <div className="min-w-0">
          <h1 className="font-headline-lg text-2xl sm:text-headline-lg text-primary tracking-tight truncate">Tatami Controls</h1>
          <p className="font-body-sm text-xs sm:text-body-sm text-on-surface-variant">Moderator Dashboard</p>
        </div>
        <div className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full shadow-sm shrink-0 ${isPaused ? 'bg-error-container text-on-error-container border-error/20 border' : 'bg-success/10 text-emerald-700 border border-emerald-500/20'}`}>
          {!isPaused && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}
          {isPaused && (
            <span className="flex h-2 w-2 relative">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-error"></span>
            </span>
          )}
          <span className="font-label-caps text-xs sm:text-label-caps">{isPaused ? 'PAUSED' : 'LIVE'}</span>
        </div>
      </div>

      {/* One DOM order for phones; explicit columns from lg up (status rail · desk · queue rail) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 sm:p-card-padding shadow-sm relative overflow-hidden mb-6 sm:mb-10 lg:col-span-3 lg:col-start-1 lg:row-start-1 lg:mb-0">
        <div className={`absolute top-0 left-0 w-1 h-full ${isPaused ? 'bg-error' : 'bg-secondary'}`}></div>
        <div className="flex justify-between items-start mb-4 gap-2">
          <div className="min-w-0">
            <span className="font-label-caps text-[10px] sm:text-label-caps text-on-surface-variant block mb-1">CURRENT CATEGORY</span>
            <h2 className="font-headline-sm text-lg sm:text-headline-sm text-primary truncate">{activeAssignment.categories?.name}</h2>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setShowSettings(!showSettings)} className="w-10 h-10 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors">
              <span className="material-symbols-outlined">settings</span>
            </button>
            {showSettings && (
              <div className="absolute top-12 right-0 bg-surface-container-lowest border border-outline-variant shadow-lg rounded-xl w-48 z-10 overflow-hidden">
                <button disabled={loading} onClick={() => setShowCompleteModal(true)} className="w-full text-left px-4 py-3 text-body-sm font-semibold hover:bg-surface-container flex items-center gap-2 disabled:opacity-50 text-secondary">
                  <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: '"FILL" 1' }}>check_circle</span>
                  Complete Category
                </button>
                <button disabled={loading} onClick={() => setShowReturnModal(true)} className="w-full text-left px-4 py-3 text-body-sm font-semibold hover:bg-surface-container flex items-center gap-2 disabled:opacity-50 border-t border-outline-variant text-error">
                  <span className="material-symbols-outlined text-xl">undo</span>
                  Return to Queue
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 mt-6">
          <div className="flex justify-between items-center font-body-sm text-body-sm">
            <span className="font-semibold text-primary inline-flex items-center gap-1.5">
              {currentCompleted} / {totalMatches} <span className="font-normal text-on-surface-variant">Completed</span>
              {isUpdatingMatch && (
                <span className="inline-block w-3.5 h-3.5 border-2 border-secondary border-t-transparent rounded-full animate-spin ml-1"></span>
              )}
            </span>
            <span className="text-secondary font-bold">{percentage.toFixed(0)}% Complete</span>
          </div>
          <div className={`w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden ${isUpdatingMatch ? 'animate-pulse' : ''}`}>
            <div className={`${isPaused ? 'bg-error/40' : 'bg-secondary'} h-full transition-all duration-500 ease-out`} style={{ width: `${Math.min(100, percentage)}%` }}></div>
          </div>
          <div className="flex justify-between text-on-surface-variant font-label-caps text-label-caps pt-1">
            <span>{percentage > 100 ? 0 : Math.max(0, totalMatches - currentCompleted)} REMAINING</span>
          </div>
        </div>
      </div>

      <div className="lg:col-span-6 lg:col-start-4 lg:row-span-2 lg:row-start-1">
      {/* Mode Switcher & Bracket Button (When digital draw exists) */}
      {boutData?.hasDraw && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-white p-3 rounded-xl border border-[#E1DDCF] shadow-2xs">
          <div className="flex items-center gap-1 bg-[#F5F3EC] p-1 rounded-lg border border-[#E1DDCF]">
            <button
              onClick={() => setActiveMode("digital")}
              className={`min-h-[44px] px-3 py-2 rounded-md text-xs font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:py-1.5 ${
                activeMode === "digital"
                  ? "bg-[#0E9C7C] text-white shadow-xs"
                  : "text-[#68645A] hover:text-[#1B1815]"
              }`}
            >
              Digital Match Runner
            </button>
            <button
              onClick={() => setActiveMode("counter")}
              className={`min-h-[44px] px-3 py-2 rounded-md text-xs font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:py-1.5 ${
                activeMode === "counter"
                  ? "bg-[#0E9C7C] text-white shadow-xs"
                  : "text-[#68645A] hover:text-[#1B1815]"
              }`}
            >
              Quick Counter
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowBoutSelector(true)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#E1DDCF] bg-white px-3 py-2 text-xs font-bold text-[#1B1815] transition-colors hover:bg-[#FAF9F5] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:min-h-[36px]"
            >
              <span className="material-symbols-outlined text-[16px]">grid_view</span>
              Change bout
            </button>

            {(() => {
              const nextReady = boutData.matches.find(
                (m: any) => m.isReady && m.id !== boutData.currentMatch?.id
              );
              if (!nextReady) return null;
              return (
                <button
                  onClick={() => void handleSelectBout(nextReady.id)}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-900 transition-colors hover:bg-amber-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:min-h-[36px]"
                >
                  <span className="material-symbols-outlined text-[16px]">bolt</span>
                  Next ready · Bout #{nextReady.matchNo}
                </button>
              );
            })()}

            <button
              onClick={() => setShowBracketModal(true)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#0E9C7C] bg-white px-3 py-2 text-xs font-bold text-[#0E9C7C] transition-colors hover:bg-emerald-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:min-h-[36px]"
            >
              <span className="material-symbols-outlined text-[16px]">account_tree</span>
              Category bracket
            </button>
          </div>
        </div>
      )}

      {/* Digital Bout Runner Mode */}
      {boutData?.hasDraw && activeMode === "digital" && (
        <div className="space-y-4 mb-8">

          {/* Active Bout Scoring Pad with unified clock */}
          {boutData.currentMatch ? (
            <BoutScoringPad
              match={boutData.currentMatch}
              ringId={ringId}
              categoryName={activeAssignment.categories?.name || "Category"}
              clock={normalizeClock(boutData.clock ?? boutData.ring)}
              serverNow={boutData.serverNow}
              serverNowSentAt={boutData.serverNowSentAt}
              serverNowReceivedAt={boutData.serverNowReceivedAt}
              sidesSwapped={boutData.ring?.sidesSwapped ?? false}
              nextBout={boutData.nextBout}
              onBoutCompleted={() => {
                // Instantly increment match count on client for immediate UI feedback
                setAssignments((prev) =>
                  prev.map((a) =>
                    a.id === activeAssignment.id
                      ? { ...a, matches_completed: Math.min((activeAssignment.categories?.expected_matches || 99), (a.matches_completed || 0) + 1) }
                      : a
                  )
                );
                setSelectedMatchId(null);
                loadBoutData();
                router.refresh();
              }}
            />
          ) : (
            <div className="p-8 bg-white rounded-2xl border border-[#E1DDCF] text-center">
              <span className="material-symbols-outlined text-4xl text-neutral-400 mb-2">sports_martial_arts</span>
              <p className="font-bold text-sm text-neutral-700">All bouts in this category are completed!</p>
            </div>
          )}
        </div>
      )}

      {/* Manual Counter Mode (only shown when user toggles to Quick Counter) */}
      {(!boutData?.hasDraw || activeMode === "counter") && (
        <>
          <MatchTimer
            ringId={ringId}
            clock={normalizeClock(boutData?.clock ?? boutData?.ring)}
            serverNow={boutData?.serverNow}
            isPaused={isPaused}
          />

      <section className="space-y-4 mb-10">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant">MATCH ADJUSTMENT</h3>
          {isUpdatingMatch && (
            <span className="text-xs text-secondary font-medium animate-pulse flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-secondary animate-ping"></span> Updating...
            </span>
          )}
        </div>

        {spamNotice && (
          <div className="bg-error-container/90 text-on-error-container border border-error/20 p-3 rounded-xl text-sm font-semibold flex items-center gap-2 animate-fadeIn">
            <span className="material-symbols-outlined text-base">block</span>
            <span>{spamNotice}</span>
          </div>
        )}

        <div className="space-y-3">
          {/* Prominent, highlighted +1 button */}
          <button
            onClick={() => handleAdjustMatch(1)}
            disabled={isPaused || loading || isUpdatingMatch}
            className="w-full bg-primary text-white border-2 border-primary h-20 rounded-xl flex items-center justify-center active:scale-[0.98] transition-all hover:bg-neutral-800 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer relative"
          >
            {activeDelta === 1 && isUpdatingMatch ? (
              <span className="w-7 h-7 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <span className="font-headline-lg text-4xl font-black tracking-tight">+1</span>
            )}
          </button>

          {/* Secondary adjustments */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { delta: -1, label: "-1" },
              { delta: -5, label: "-5" },
              { delta: 5, label: "+5" },
            ].map(({ delta, label }) => {
              const isThisUpdating = activeDelta === delta && isUpdatingMatch;
              const isDisabled = isPaused || loading || isUpdatingMatch;
              return (
                <button
                  key={delta}
                  onClick={() => handleAdjustMatch(delta)}
                  disabled={isDisabled}
                  className="bg-surface-container-lowest border border-outline-variant h-14 rounded-xl flex items-center justify-center active:scale-95 transition-transform hover:bg-surface-container shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isThisUpdating ? (
                    <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <span className="font-headline-sm text-headline-sm text-on-surface-variant font-bold">{label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>
      </>
      )}

      <div className="grid grid-cols-1 gap-4 pt-4 mb-10">
        <button
          disabled={loading}
          onClick={handleTogglePause}
          className={`w-full bg-surface-container-lowest border h-14 rounded-xl font-bold font-body-md flex items-center justify-center gap-2 transition-colors ${isPaused ? 'border-emerald-500 text-emerald-700 active:bg-emerald-50' : 'border-amber-500 text-amber-700 active:bg-amber-50'
            }`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>{isPaused ? 'play_circle' : 'pause_circle'}</span>
          {isPaused ? 'Resume Tatami' : 'Pause Tatami'}
        </button>
      </div>
      </div>

      <div className="mt-8 bg-surface-container-low p-4 rounded-xl border border-outline-variant flex flex-col gap-4 lg:col-span-3 lg:col-start-1 lg:row-start-2 lg:mt-0">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-secondary opacity-50">visibility</span>
          <div className="flex-1">
            <h4 className="font-label-caps text-label-caps text-on-surface-variant opacity-70">CURRENTLY LIVE TO PUBLIC</h4>
            <p className="font-body-sm text-body-sm text-on-surface">
              Tatami Status: <span className={`${isPaused ? 'text-error' : 'text-emerald-600'} font-semibold uppercase`}>{isPaused ? 'Paused' : 'Active'} - {activeAssignment.categories?.name}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-outline-variant">
          <button
            onClick={() => setShowAssistanceModal(true)}
            className="flex items-center gap-2 text-primary font-bold font-label-caps text-xs hover:bg-primary/10 px-3 py-2 rounded transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">support_agent</span> Request Assistance
          </button>

          <button
            onClick={handleEmergency}
            className="flex min-h-[44px] items-center gap-1 text-error font-bold font-label-caps text-[10px] opacity-60 hover:opacity-100 hover:bg-error/10 px-3 py-2 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
          >
            <span className="material-symbols-outlined text-[14px]">warning</span> EMERGENCY
          </button>
        </div>
      </div>

      {/* Queue rail: what is coming on this tatami, and the arena screen link */}
      <aside className="mt-8 space-y-4 lg:col-span-3 lg:col-start-10 lg:row-span-2 lg:row-start-1 lg:mt-0">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
          <h3 className="font-label-caps text-label-caps tracking-widest text-on-surface-variant">UP NEXT</h3>
          <div className="mt-3 space-y-2">
            {assignments
              .filter((a) => a.status === "pending")
              .slice(0, 4)
              .map((a) => (
                <div key={a.id} className="rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2">
                  <p className="truncate text-xs font-bold text-[#1B1815]">{a.categories?.name}</p>
                  <p className="text-[11px] text-[#68645A]">
                    {a.categories?.expected_matches ?? 0} matches
                  </p>
                </div>
              ))}
            {assignments.filter((a) => a.status === "pending").length === 0 && (
              <p className="text-xs text-[#68645A]">Nothing queued after this category.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
          <h3 className="font-label-caps text-label-caps tracking-widest text-on-surface-variant">ON DECK</h3>
          {boutData?.nextBout ? (
            <div className="mt-3 rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] px-3 py-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-[#8C877C]">
                Bout #{boutData.nextBout.matchNo} · {boutData.nextBout.roundName}
              </p>
              <p className="mt-1 truncate text-xs font-bold text-[#DC2626]">
                AKA {boutData.nextBout.aka?.name || "TBD"}
              </p>
              <p className="truncate text-xs font-bold text-[#2563EB]">
                AO {boutData.nextBout.ao?.name || "TBD"}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[#68645A]">No ready bout waiting.</p>
          )}
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
          <h3 className="font-label-caps text-label-caps tracking-widest text-on-surface-variant">ARENA SCREEN</h3>
          <p className="mt-2 text-xs text-[#68645A]">
            Open the scoreboard on the TV in a new window, then press F for full screen.
          </p>
          <a
            href={`/scoreboard/${ringId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#0E9C7C] bg-[#E3F6F0] px-3 py-2 text-xs font-bold text-[#0B7C63] transition-colors hover:bg-[#d3f0e7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
          >
            <span className="material-symbols-outlined text-[16px]">tv</span>
            Open TV scoreboard
          </a>
        </div>
      </aside>
      </div>

      {/* Bout picker: full view on a laptop, full sheet on a phone */}
      {showBoutSelector && boutData?.matches && boutData.matches.length > 0 && (
        <BoutPickerModal
          isOpen={showBoutSelector}
          onClose={() => setShowBoutSelector(false)}
          categoryName={activeAssignment.categories?.name || "Tournament Category"}
          bouts={boutData.matches}
          drawMatches={drawData?.matches || []}
          tournamentSize={drawData?.draw?.tournamentSize}
          activeMatchId={boutData.currentMatch?.id}
          onSelect={(matchId) => void handleSelectBout(matchId)}
        />
      )}

      {/* Modals */}
      {showAssistanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4">
            <h3 className="font-headline-sm text-primary font-bold">Request Assistance</h3>
            <p className="text-body-sm text-on-surface-variant">Select the type of assistance needed for this tatami. Admin will be notified softly.</p>
            <div className="grid grid-cols-1 gap-2">
              {['Doctor / Medical', 'Technical Support', 'Security', 'General Assistance'].map(type => (
                <button
                  key={type}
                  onClick={() => handleRequestAssistance(type)}
                  className="bg-surface-container hover:bg-surface-container-high py-3 rounded font-bold text-sm border border-outline-variant"
                >
                  {type}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAssistanceModal(false)} className="w-full mt-2 py-2 text-on-surface-variant font-bold text-sm">Cancel</button>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4">
            <h3 className="font-headline-sm text-error font-bold">Return to Queue</h3>
            <p className="text-body-sm text-on-surface-variant">Are you sure? This will remove the category from the live tatami.</p>
            <div>
              <label className="text-[10px] font-bold text-on-surface-variant mb-1 block uppercase tracking-wider">Type CONFIRM to proceed</label>
              <input
                type="text"
                value={returnConfirmText}
                onChange={(e) => setReturnConfirmText(e.target.value)}
                className="w-full bg-surface-container border border-outline-variant p-3 rounded text-on-surface font-bold"
                placeholder="CONFIRM"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowReturnModal(false)} className="flex-1 py-3 bg-surface-container hover:bg-surface-container-high rounded font-bold text-sm text-on-surface">Cancel</button>
              <button
                onClick={executeReturnToQueue}
                disabled={returnConfirmText !== "CONFIRM" || loading}
                className="flex-1 py-3 bg-error text-white rounded font-bold text-sm disabled:opacity-50"
              >
                Return
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4">
            <h3 className="font-headline-sm text-secondary font-bold">Complete Category</h3>
            <p className="text-body-sm text-on-surface-variant">How would you like to record this category's completion?</p>
            <div className="space-y-3">
              <button
                onClick={() => executeCompleteCategory(false)}
                disabled={loading}
                className="w-full text-left p-4 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-xl flex flex-col gap-1"
              >
                <span className="font-bold text-primary">Complete at Current State</span>
                <span className="text-xs text-on-surface-variant">Mark as finished with {currentCompleted} matches recorded.</span>
              </button>
              <button
                onClick={() => executeCompleteCategory(true)}
                disabled={loading}
                className="w-full text-left p-4 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-xl flex flex-col gap-1"
              >
                <span className="font-bold text-secondary">Mark All Completed</span>
                <span className="text-xs text-on-surface-variant">Set matches to {totalMatches} expected matches and finish.</span>
              </button>
            </div>
            <button onClick={() => setShowCompleteModal(false)} className="w-full mt-2 py-2 text-on-surface-variant font-bold text-sm">Cancel</button>
          </div>
        </div>
      )}

      {syncErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4 shadow-xl border border-outline-variant">
            <div className="flex items-center gap-3 text-error">
              <span className="material-symbols-outlined text-3xl">warning</span>
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">{syncErrorModal.title}</h3>
            </div>
            <p className="text-body-sm text-on-surface-variant leading-relaxed">
              {syncErrorModal.message}
            </p>
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-sm"
              >
                <span className="material-symbols-outlined text-lg">refresh</span>
                Reload Page
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setShowAdvancedModalOptions(!showAdvancedModalOptions)}
                  className="text-xs text-on-surface-variant hover:text-on-surface flex items-center justify-center gap-1 mx-auto transition-colors font-medium py-1"
                >
                  <span>More Options</span>
                  <span className="material-symbols-outlined text-base">
                    {showAdvancedModalOptions ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {showAdvancedModalOptions && (
                  <div className="mt-3 pt-3 border-t border-outline-variant animate-fadeIn">
                    <button
                      onClick={async () => {
                        try {
                          await logoutModerator();
                        } catch (err) {
                          console.error(err);
                        }
                        router.push("/login/mod");
                      }}
                      className="w-full py-2.5 bg-error/10 hover:bg-error/20 text-error font-semibold rounded-xl flex items-center justify-center gap-2 text-xs transition-colors border border-error/20"
                    >
                      <span className="material-symbols-outlined text-base">logout</span>
                      Logout & Re-login
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Bracket Tree Modal */}
      {showBracketModal && activeAssignment?.categoryId && (
        <DrawBracketModal
          categoryId={activeAssignment.categoryId}
          categoryName={activeAssignment.categories?.name || "Category"}
          isOpen={showBracketModal}
          onClose={() => setShowBracketModal(false)}
          onSelectMatch={(m) => handleSelectBout(m.matchId)}
        />
      )}
    </div>
  );
}
