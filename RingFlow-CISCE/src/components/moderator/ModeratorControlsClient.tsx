"use client";

import React, { useState } from "react";
import { logRingEvent } from "@/actions/moderator";

export default function ModeratorControlsClient({ ringId }: { ringId: string }) {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleEmergency = async () => {
    setShowEmergencyModal(false);
    setLoading(true);
    try {
      await logRingEvent(ringId, "EMERGENCY_ALERT", { reason: "Manual trigger" });
      showToast("Emergency alert dispatched to all staff.", "success");
    } catch (e) {
      console.error(e);
      showToast("Failed to trigger emergency.", "error");
    } finally {
      setLoading(false);
    }
  };

  const requestAssistance = async (type: string) => {
    setLoading(true);
    try {
      if (type === "Doctor") {
        const { pauseCurrentRingAssignment } = await import('@/actions/moderator');
        await pauseCurrentRingAssignment(ringId);
        await logRingEvent(ringId, "REQUEST_ASSISTANCE", { message: `Requested: ${type}`, type });
        showToast(`${type} requested. Tatami has been paused.`, "success");
      } else {
        await logRingEvent(ringId, "REQUEST_ASSISTANCE", { message: `Requested: ${type}`, type });
        showToast(`${type} requested.`, "success");
      }
    } catch (e) {
      console.error(e);
      showToast("Failed to request assistance.", "error");
    } finally {
      setLoading(false);
    }
  };

  const assistanceItems = [
    { type: "Doctor", icon: "medical_information", subtitle: "Pauses tatami automatically", color: "text-[#DC2626]" },
    { type: "Technical Support", icon: "engineering", subtitle: "Equipment or system issue", color: "text-[#2563EB]" },
    { type: "Admin", icon: "badge", subtitle: "Tournament administration", color: "text-[#0E9C7C]" },
    { type: "Security", icon: "security", subtitle: "Safety or crowd issue", color: "text-amber-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold animate-fadeIn max-w-sm ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {toast.type === "success" ? "check_circle" : "error"}
          </span>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mb-2">
        <h1 className="font-headline-lg text-xl sm:text-headline-lg text-primary mb-0.5">Controls</h1>
        <p className="text-on-surface-variant font-body-sm text-xs sm:text-sm">Assistance & tatami management</p>
      </div>

      {/* Session info card */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 sm:p-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-secondary-container shrink-0">
          <span className="material-symbols-outlined text-secondary text-[20px]">cast_connected</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-on-surface truncate">Tatami Session Active</p>
          <p className="text-[10px] sm:text-[11px] text-on-surface-variant">Ring ID: {ringId.slice(0, 8)}…</p>
        </div>
        <a
          href={`/scoreboard/${ringId}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#0E9C7C] bg-[#E3F6F0] px-3 py-1.5 text-[10px] sm:text-xs font-bold text-[#0B7C63] transition-colors hover:bg-[#d3f0e7] shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">tv</span>
          <span className="hidden sm:inline">Scoreboard</span>
        </a>
      </div>

      {/* Assistance grid — larger buttons with descriptions */}
      <section className="space-y-3">
        <h2 className="font-headline-sm text-sm sm:text-headline-sm text-on-surface px-0.5">Request Assistance</h2>
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {assistanceItems.map(({ type, icon, subtitle, color }) => (
            <button
              key={type}
              disabled={loading}
              onClick={() => requestAssistance(type)}
              className="bg-white border border-outline-variant p-4 sm:p-5 rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-surface-container hover:border-secondary/40 transition-all active:scale-[0.97] group disabled:opacity-50"
            >
              <span className={`material-symbols-outlined ${color} text-2xl sm:text-3xl transition-transform group-hover:scale-110`}>{icon}</span>
              <span className="font-label-caps text-[10px] sm:text-label-caps text-on-surface">{type}</span>
              <span className="text-[9px] sm:text-[10px] text-on-surface-variant leading-tight text-center">{subtitle}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Emergency — larger, always accessible */}
      <section className="pt-4 sm:pt-6">
        <button 
          onClick={() => setShowEmergencyModal(true)}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-error/30 bg-error/5 hover:bg-error/10 py-3.5 sm:py-4 text-error font-bold text-xs sm:text-sm transition-colors disabled:opacity-50 active:scale-[0.98]"
        >
          <span className="material-symbols-outlined text-[20px]">warning</span>
          Trigger Emergency Alert
        </button>
        <p className="text-center text-[10px] text-on-surface-variant mt-1.5">
          Notifies all tournament staff immediately
        </p>
      </section>

      {/* Emergency confirmation modal */}
      {showEmergencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-outline-variant bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-error text-2xl">warning</span>
              </div>
              <div>
                <h3 className="text-base font-extrabold text-[#1B1815]">Emergency Alert</h3>
                <p className="text-xs text-[#68645A]">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-on-surface-variant mb-5 leading-relaxed">
              This will immediately notify <strong>all tournament staff</strong>. Only use this for genuine emergencies.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowEmergencyModal(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-outline-variant bg-white text-[#3D3A33] font-bold text-xs hover:bg-[#F5F3EC] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEmergency}
                disabled={loading}
                className="flex-1 min-h-[44px] rounded-xl bg-error text-white font-bold text-xs hover:bg-error/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">warning</span>
                Confirm Emergency
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
